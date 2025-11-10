'use node';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import { assertUserId } from '../../src/lib/shared/user-id';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import type { GetSubmissionInternalRef } from './types';

// Helper function to get the Firecrawl API key from environment
function getFirecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY ?? '';
}

// Helper function to get R2 credentials
function getR2Credentials() {
  const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
    throw new Error('R2 credentials not configured');
  }

  return { r2BucketName, r2AccessKeyId, r2SecretAccessKey, r2AccountId };
}

/**
 * Capture screenshot of a URL using Firecrawl and save to R2
 */
export const captureScreenshot = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx: ActionCtx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    // Get submission to check siteUrl and verify access
    const submission = await ctx.runQuery(
      (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
        .getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (!submission.siteUrl) {
      throw new Error('Submission does not have a live URL');
    }

    const apiKey = getFirecrawlApiKey();
    if (!apiKey || apiKey.length === 0) {
      throw new Error(
        'Firecrawl API key is not configured. Please set FIRECRAWL_API_KEY in your Convex environment variables.',
      );
    }

    // Record screenshot capture start time
    const screenshotCaptureStartedAt = Date.now();
    await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
      submissionId: args.submissionId,
      screenshotCaptureStartedAt,
    });

    try {
      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Use Firecrawl's scrape method with screenshot format
      // According to Firecrawl docs: https://docs.firecrawl.dev/features/scrape
      // Screenshots are returned as URLs pointing to Firecrawl's storage
      // Using object format with fullPage: true to capture full-page scrolling screenshots
      const result: unknown = await firecrawl.scrape(submission.siteUrl, {
        formats: [{ type: 'screenshot', fullPage: true }],
      });

      // Handle Firecrawl response format
      // SDK returns data directly, but structure may vary: result.screenshot or result.data?.screenshot
      let screenshotUrl: string | undefined;

      // Check if result is a string URL first
      if (typeof result === 'string' && result.startsWith('http')) {
        screenshotUrl = result;
      }
      // Check different possible response structures for object responses
      else if (typeof result === 'object' && result !== null) {
        // Check result.screenshot (direct property)
        if (typeof (result as { screenshot?: unknown }).screenshot === 'string') {
          screenshotUrl = (result as { screenshot: string }).screenshot;
        }
        // Check result.data.screenshot (nested structure)
        else if (
          typeof (result as { data?: { screenshot?: unknown } }).data?.screenshot === 'string'
        ) {
          screenshotUrl = (result as { data: { screenshot: string } }).data.screenshot;
        }
      }

      if (!screenshotUrl || !screenshotUrl.startsWith('http')) {
        console.error('Firecrawl response:', JSON.stringify(result, null, 2));
        throw new Error(
          'No valid screenshot URL returned from Firecrawl. The API may not support screenshots or returned an unexpected format.',
        );
      }

      // Fetch screenshot from Firecrawl's storage URL
      // Firecrawl returns screenshots as URLs (e.g., https://...supabase.co/storage/.../screenshot-xxx.png)
      const screenshotResponse = await fetch(screenshotUrl, {
        signal: AbortSignal.timeout(30000), // 30 second timeout for fetching the image
      });

      if (!screenshotResponse.ok) {
        throw new Error(
          `Failed to fetch screenshot from Firecrawl: ${screenshotResponse.status} ${screenshotResponse.statusText}`,
        );
      }

      const screenshotBuffer = Buffer.from(await screenshotResponse.arrayBuffer());

      // Get R2 credentials
      const { r2BucketName, r2AccessKeyId, r2SecretAccessKey, r2AccountId } = getR2Credentials();

      // Create S3 client for R2
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
        },
      });

      // Generate R2 key: hackathon-repos/repos/{submissionId}/firecrawl/screenshot-{timestamp}.png
      const timestamp = Date.now();
      const r2Key = `repos/${args.submissionId}/firecrawl/screenshot-${timestamp}.png`;

      // Upload screenshot to R2
      await s3Client.send(
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: r2Key,
          Body: screenshotBuffer,
          ContentType: 'image/png',
          Metadata: {
            submissionId: args.submissionId,
            url: submission.siteUrl,
            capturedAt: timestamp.toString(),
          },
        }),
      );

      // Generate presigned URL for R2 object (valid for 7 days - maximum allowed)
      // AWS S3/R2 presigned URLs have a maximum expiration of 7 days
      // This allows secure access to the screenshot without making the bucket public
      const getObjectCommand = new GetObjectCommand({
        Bucket: r2BucketName,
        Key: r2Key,
      });
      const publicUrl = await getSignedUrl(s3Client, getObjectCommand, {
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds (maximum allowed)
      });

      // Record screenshot capture completion time
      const screenshotCaptureCompletedAt = Date.now();

      // Update submission with screenshot metadata
      await ctx.runMutation(internal.submissions.addScreenshot, {
        submissionId: args.submissionId,
        screenshot: {
          r2Key,
          url: publicUrl,
          capturedAt: timestamp,
        },
      });

      // Update source with screenshot capture completion timestamp
      await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
        submissionId: args.submissionId,
        screenshotCaptureCompletedAt,
      });

      return {
        success: true,
        r2Key,
        url: publicUrl,
        capturedAt: timestamp,
      };
    } catch (error) {
      // Handle timeout errors specifically
      if (
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('ETIMEDOUT') ||
          error.name === 'FirecrawlSdkError')
      ) {
        throw new Error(
          'Screenshot capture timed out. The website may be slow to load or Firecrawl is experiencing high load. Please try again later.',
        );
      }

      const errorMessage = error instanceof Error ? error.message : 'Failed to capture screenshot';
      console.error('Failed to capture screenshot:', error);
      throw new Error(errorMessage);
    }
  },
});

/**
 * Internal action to capture screenshot (can be called from scheduled tasks)
 */
export const captureScreenshotInternal = internalAction({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx: ActionCtx, args) => {
    // Get submission to check siteUrl
    const submission = await ctx.runQuery(
      (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
        .getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (!submission.siteUrl) {
      // No siteUrl, skip screenshot
      return { success: false, reason: 'No siteUrl provided' };
    }

    const apiKey = getFirecrawlApiKey();
    if (!apiKey || apiKey.length === 0) {
      // Firecrawl not configured, skip screenshot
      return { success: false, reason: 'Firecrawl not configured' };
    }

    // Record screenshot capture start time
    const screenshotCaptureStartedAt = Date.now();
    await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
      submissionId: args.submissionId,
      screenshotCaptureStartedAt,
    });

    try {
      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Use Firecrawl's scrape method with screenshot format
      // Screenshots are returned as URLs pointing to Firecrawl's storage
      // Using object format with fullPage: true to capture full-page scrolling screenshots
      const result: unknown = await firecrawl.scrape(submission.siteUrl, {
        formats: [{ type: 'screenshot', fullPage: true }],
      });

      // Handle Firecrawl response format
      let screenshotUrl: string | undefined;

      // Check if result is a string URL first
      if (typeof result === 'string' && result.startsWith('http')) {
        screenshotUrl = result;
      }
      // Check different possible response structures for object responses
      else if (typeof result === 'object' && result !== null) {
        if (typeof (result as { screenshot?: unknown }).screenshot === 'string') {
          screenshotUrl = (result as { screenshot: string }).screenshot;
        } else if (
          typeof (result as { data?: { screenshot?: unknown } }).data?.screenshot === 'string'
        ) {
          screenshotUrl = (result as { data: { screenshot: string } }).data.screenshot;
        }
      }

      if (!screenshotUrl || !screenshotUrl.startsWith('http')) {
        console.error('Firecrawl response:', JSON.stringify(result, null, 2));
        throw new Error(
          'No valid screenshot URL returned from Firecrawl. The API may not support screenshots or returned an unexpected format.',
        );
      }

      // Fetch screenshot from Firecrawl's storage URL
      const screenshotResponse = await fetch(screenshotUrl, {
        signal: AbortSignal.timeout(30000), // 30 second timeout for fetching the image
      });

      if (!screenshotResponse.ok) {
        throw new Error(
          `Failed to fetch screenshot from Firecrawl: ${screenshotResponse.status} ${screenshotResponse.statusText}`,
        );
      }

      const screenshotBuffer = Buffer.from(await screenshotResponse.arrayBuffer());

      // Get R2 credentials
      const { r2BucketName, r2AccessKeyId, r2SecretAccessKey, r2AccountId } = getR2Credentials();

      // Create S3 client for R2
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
        },
      });

      // Generate R2 key
      const timestamp = Date.now();
      const r2Key = `repos/${args.submissionId}/firecrawl/screenshot-${timestamp}.png`;

      // Upload screenshot to R2
      await s3Client.send(
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: r2Key,
          Body: screenshotBuffer,
          ContentType: 'image/png',
          Metadata: {
            submissionId: args.submissionId,
            url: submission.siteUrl,
            capturedAt: timestamp.toString(),
          },
        }),
      );

      // Generate presigned URL for R2 object (valid for 7 days - maximum allowed)
      // AWS S3/R2 presigned URLs have a maximum expiration of 7 days
      const getObjectCommand = new GetObjectCommand({
        Bucket: r2BucketName,
        Key: r2Key,
      });
      const publicUrl = await getSignedUrl(s3Client, getObjectCommand, {
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds (maximum allowed)
      });

      // Record screenshot capture completion time
      const screenshotCaptureCompletedAt = Date.now();

      // Update submission with screenshot metadata and completion timestamp
      await ctx.runMutation(internal.submissions.addScreenshot, {
        submissionId: args.submissionId,
        screenshot: {
          r2Key,
          url: publicUrl,
          capturedAt: timestamp,
        },
      });

      // Update source with screenshot capture completion timestamp
      await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
        submissionId: args.submissionId,
        screenshotCaptureCompletedAt,
      });

      return {
        success: true,
        r2Key,
        url: publicUrl,
        capturedAt: timestamp,
      };
    } catch (error) {
      // Handle timeout errors specifically - return failure instead of throwing for internal action
      if (
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('ETIMEDOUT') ||
          error.name === 'FirecrawlSdkError')
      ) {
        console.error('Screenshot capture timed out:', error);
        return {
          success: false,
          reason: 'timeout',
          error: 'Screenshot capture timed out. The website may be slow to load.',
        };
      }

      const errorMessage = error instanceof Error ? error.message : 'Failed to capture screenshot';
      console.error('Failed to capture screenshot:', error);
      throw new Error(errorMessage);
    }
  },
});

/**
 * Delete screenshot from R2 storage only (used after optimistic DB deletion)
 */
export const deleteScreenshotFromR2 = action({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.string(),
  },
  handler: async (_ctx: ActionCtx, args) => {
    // Get R2 credentials
    const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    // Delete from R2 if configured
    if (r2BucketName && r2AccessKeyId && r2SecretAccessKey && r2AccountId) {
      try {
        const s3Client = new S3Client({
          region: 'auto',
          endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2AccessKeyId,
            secretAccessKey: r2SecretAccessKey,
          },
        });

        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: args.r2Key,
          }),
        );
      } catch (error) {
        // Log error but don't fail - R2 cleanup is best effort
        console.error('Failed to delete screenshot from R2:', error);
      }
    }

    return { success: true };
  },
});

/**
 * Delete a screenshot from a submission (legacy - kept for backward compatibility)
 * Note: Prefer using removeScreenshot mutation + deleteScreenshotFromR2 action for better UX
 */
export const deleteScreenshot = action({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.string(),
  },
  handler: async (ctx: ActionCtx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    // Get submission to verify access
    const submission = await ctx.runQuery(
      (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
        .getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check if user has write access to this submission's hackathon
    // Since we're in an action, we need to check membership via a query
    const userId = assertUserId(authUser, 'User ID not found');
    const membership = await ctx.runQuery(internal.hackathons.getMembershipInternal, {
      hackathonId: submission.hackathonId,
      userId,
    });

    if (!membership || membership.status !== 'active') {
      throw new Error('Not a member of this hackathon');
    }

    const allowedRoles: Array<'owner' | 'admin' | 'judge'> = ['owner', 'admin', 'judge'];
    if (!allowedRoles.includes(membership.role)) {
      throw new Error(`Insufficient permissions. Required: ${allowedRoles.join(' or ')}`);
    }

    // Verify the screenshot exists
    const screenshots = submission.screenshots || [];
    const screenshot = screenshots.find((s) => s.r2Key === args.r2Key);
    if (!screenshot) {
      throw new Error('Screenshot not found');
    }

    // Get R2 credentials
    const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    // Delete from R2 if configured
    if (r2BucketName && r2AccessKeyId && r2SecretAccessKey && r2AccountId) {
      try {
        const s3Client = new S3Client({
          region: 'auto',
          endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: r2AccessKeyId,
            secretAccessKey: r2SecretAccessKey,
          },
        });

        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: r2BucketName,
            Key: args.r2Key,
          }),
        );
      } catch (error) {
        // Log error but don't fail if R2 deletion fails (file might already be deleted)
        console.error('Failed to delete screenshot from R2:', error);
      }
    }

    // Remove from database (using internal mutation since we already checked permissions)
    await ctx.runMutation(internal.submissions.removeScreenshotInternal, {
      submissionId: args.submissionId,
      r2Key: args.r2Key,
    });

    return { success: true };
  },
});
