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
import type { GenerateEarlySummaryRef, GetSubmissionInternalRef } from './types';

// Helper function to get the Firecrawl API key from environment
function getFirecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY ?? '';
}

// Helper function to get R2 credentials
function getR2Credentials(): {
  r2BucketName: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
  r2AccountId: string;
} {
  const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
    throw new Error('R2 credentials not configured');
  }

  return { r2BucketName, r2AccessKeyId, r2SecretAccessKey, r2AccountId };
}

// Helper function to normalize URLs for comparison (removes trailing slashes, normalizes protocol)
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash from pathname
    const normalizedPath = urlObj.pathname.replace(/\/+$/, '') || '/';
    // Reconstruct URL with normalized pathname
    return `${urlObj.protocol}//${urlObj.host}${normalizedPath}${urlObj.search}${urlObj.hash}`;
  } catch {
    // If URL parsing fails, just remove trailing slash
    return url.replace(/\/+$/, '');
  }
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

      // Step 1: Use map endpoint to quickly discover URLs (much faster than crawl)
      // Map is designed for speed and costs 1 credit per site regardless of size
      const mapResult: unknown = await firecrawl.map(submission.siteUrl, {
        limit: 10, // Maximum 10 pages
      });

      // Extract URLs from map result
      let urlsToScrape: string[] = [];
      if (typeof mapResult === 'object' && mapResult !== null) {
        // Check for result.links or result.data.links (array of URL strings or objects)
        const links =
          (mapResult as { links?: unknown; data?: { links?: unknown } }).links ||
          (mapResult as { data?: { links?: unknown } }).data?.links;

        if (Array.isArray(links)) {
          urlsToScrape = links
            .map((link) => {
              if (typeof link === 'string') return link;
              if (typeof link === 'object' && link !== null && 'url' in link) {
                return typeof link.url === 'string' ? link.url : null;
              }
              return null;
            })
            .filter((url): url is string => url !== null && (url?.startsWith('http') ?? false));
        }
      }

      // Normalize the original URL for comparison
      const normalizedOriginalUrl = normalizeUrl(submission.siteUrl);

      // Deduplicate URLs using normalized comparison and ensure original URL is first
      const uniqueUrls: string[] = [];
      const seenNormalizedUrls = new Set<string>();

      // Always add the original URL first (if map results exist, we'll skip duplicates later)
      if (urlsToScrape.length > 0) {
        uniqueUrls.push(submission.siteUrl);
        seenNormalizedUrls.add(normalizedOriginalUrl);
      }

      // Add other URLs from map results, skipping duplicates (including normalized versions of the original)
      for (const url of urlsToScrape) {
        const normalizedUrl = normalizeUrl(url);
        if (!seenNormalizedUrls.has(normalizedUrl)) {
          uniqueUrls.push(url);
          seenNormalizedUrls.add(normalizedUrl);
        }
      }

      // If no URLs were found, use the original URL
      if (uniqueUrls.length === 0) {
        urlsToScrape = [submission.siteUrl];
      } else {
        urlsToScrape = uniqueUrls.slice(0, 10); // Keep max 10 URLs
      }

      // Step 2: Scrape each URL in parallel to capture screenshots
      // Using parallel scrape calls is faster and more reliable than crawl's async job system
      const scrapePromises = urlsToScrape.map(async (url) => {
        try {
          const result = await firecrawl.scrape(url, {
            formats: [{ type: 'screenshot', fullPage: true }],
          });
          // Extract screenshot URL from result (could be string or nested in data)
          let screenshotUrl: string | undefined;
          let pageName: string | undefined;

          if (typeof result === 'object' && result !== null) {
            // Extract screenshot URL
            if (typeof (result as { screenshot?: unknown }).screenshot === 'string') {
              screenshotUrl = (result as { screenshot: string }).screenshot;
            } else if (
              typeof (result as { data?: { screenshot?: unknown } }).data?.screenshot === 'string'
            ) {
              screenshotUrl = (result as { data: { screenshot: string } }).data.screenshot;
            }

            // Extract page name/title from metadata
            const metadata = (result as { metadata?: { title?: string; pageTitle?: string } })
              .metadata;
            if (metadata) {
              pageName = metadata.title || metadata.pageTitle;
            }
            // Fallback to extracting from markdown if available
            if (!pageName && typeof (result as { markdown?: string }).markdown === 'string') {
              const markdown = (result as { markdown: string }).markdown;
              const titleMatch = markdown.match(/^#\s+(.+)$/m);
              if (titleMatch) {
                pageName = titleMatch[1].trim();
              }
            }
          }

          return {
            url,
            screenshot: screenshotUrl,
            pageName,
            metadata: { sourceURL: url },
          };
        } catch (error) {
          console.warn(`Failed to scrape ${url}:`, error);
          return null;
        }
      });

      const scrapeResults = await Promise.all(scrapePromises);
      const pages: Array<{
        url: string;
        screenshot: string;
        pageName?: string;
        metadata: { sourceURL: string };
      }> = [];

      for (const page of scrapeResults) {
        if (
          page !== null &&
          typeof page.screenshot === 'string' &&
          page.screenshot.startsWith('http')
        ) {
          pages.push({
            url: page.url,
            screenshot: page.screenshot,
            pageName: page.pageName,
            metadata: page.metadata,
          });
        }
      }

      if (pages.length === 0) {
        throw new Error(
          'No pages were successfully scraped. All URLs may have failed to return screenshots.',
        );
      }

      // Get R2 credentials (throws if not configured)
      const r2Creds = getR2Credentials();

      // Create S3 client for R2
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2Creds.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2Creds.r2AccessKeyId,
          secretAccessKey: r2Creds.r2SecretAccessKey,
        },
      });

      const baseTimestamp = Date.now();

      // Process all pages in parallel for better performance
      // Each page processing is independent, so we can do them concurrently
      const screenshotPromises = pages.map(async (pageItem, i) => {
        const pageUrl: string =
          pageItem.url || pageItem.metadata?.sourceURL || submission.siteUrl || '';
        const screenshotUrl = pageItem.screenshot; // Already extracted and validated in filter

        if (!screenshotUrl) {
          console.warn(`No screenshot URL found for page ${i + 1} (${pageUrl}), skipping`);
          return null;
        }

        try {
          // Fetch screenshot from Firecrawl's storage URL
          const screenshotResponse = await fetch(screenshotUrl, {
            signal: AbortSignal.timeout(30000), // 30 second timeout for fetching the image
          });

          if (!screenshotResponse.ok) {
            console.warn(
              `Failed to fetch screenshot for page ${i + 1} (${pageUrl}): ${screenshotResponse.status} ${screenshotResponse.statusText}`,
            );
            return null;
          }

          const screenshotBuffer = Buffer.from(await screenshotResponse.arrayBuffer());

          // Generate R2 key: repos/{submissionId}/firecrawl/page-{index}-{timestamp}.png
          const timestamp = baseTimestamp + i; // Ensure unique timestamps
          const pageIndex = i + 1;
          const r2Key = `repos/${args.submissionId}/firecrawl/page-${pageIndex}-${timestamp}.png`;

          // Upload screenshot to R2
          await s3Client.send(
            new PutObjectCommand({
              Bucket: r2Creds.r2BucketName,
              Key: r2Key,
              Body: screenshotBuffer,
              ContentType: 'image/png',
              Metadata: {
                submissionId: args.submissionId,
                url: pageUrl,
                pageIndex: pageIndex.toString(),
                capturedAt: timestamp.toString(),
              },
            }),
          );

          // Generate presigned URL for R2 object (valid for 7 days - maximum allowed)
          const getObjectCommand = new GetObjectCommand({
            Bucket: r2Creds.r2BucketName,
            Key: r2Key,
          });
          const publicUrl = await getSignedUrl(s3Client, getObjectCommand, {
            expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds (maximum allowed)
          });

          return {
            r2Key,
            url: publicUrl,
            capturedAt: timestamp,
            pageUrl: pageItem.url,
            pageName: pageItem.pageName,
          };
        } catch (error) {
          console.warn(`Failed to process screenshot for page ${i + 1} (${pageUrl}):`, error);
          return null;
        }
      });

      // Wait for all screenshots to be processed in parallel
      const screenshotResults = await Promise.all(screenshotPromises);
      const capturedScreenshots: Array<{
        r2Key: string;
        url: string;
        capturedAt: number;
        pageUrl: string;
        pageName?: string;
      }> = [];

      for (const screenshot of screenshotResults) {
        if (screenshot !== null) {
          capturedScreenshots.push({
            r2Key: screenshot.r2Key,
            url: screenshot.url,
            capturedAt: screenshot.capturedAt,
            pageUrl: screenshot.pageUrl,
            pageName: screenshot.pageName,
          });
        }
      }

      if (capturedScreenshots.length === 0) {
        throw new Error(
          'No screenshots were successfully captured. All pages may have failed to capture screenshots.',
        );
      }

      // Batch add all screenshots atomically in a single mutation call
      await ctx.runMutation(internal.submissions.addScreenshots, {
        submissionId: args.submissionId,
        screenshots: capturedScreenshots,
      });

      // Record screenshot capture completion time
      const screenshotCaptureCompletedAt = Date.now();

      // Update source with screenshot capture completion timestamp
      await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
        submissionId: args.submissionId,
        screenshotCaptureCompletedAt,
      });

      // Trigger summary generation after screenshots are captured
      // If repo files are uploaded, use full AI Search summary; otherwise use early summary
      try {
        const submission = await ctx.runQuery(
          (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
            .getSubmissionInternal,
          {
            submissionId: args.submissionId,
          },
        );

        if (!submission) {
          console.warn(
            `[Screenshot] Could not fetch submission ${args.submissionId} to trigger summary generation`,
          );
          return {
            success: true,
            screenshots: capturedScreenshots,
            pagesCaptured: capturedScreenshots.length,
            totalPagesFound: pages.length,
          };
        }

        // Trigger early summary using README + screenshots (AI Search summary is only generated on-demand)
        // Early summary is saved to aiSummary, and will be overwritten by AI Search summary if user clicks "Full Summary"
        if (!submission.source?.aiSummary) {
          console.log(
            `[Screenshot] Triggering early summary with screenshots for submission ${args.submissionId}`,
          );
          await ctx.scheduler.runAfter(
            0,
            (
              internal.submissionsActions.aiSummary as unknown as {
                generateEarlySummary: GenerateEarlySummaryRef;
              }
            ).generateEarlySummary,
            {
              submissionId: args.submissionId,
              forceRegenerate: false,
            },
          );
        }
      } catch (error) {
        // Log but don't fail - summary generation is optional
        console.warn(
          `[Screenshot] Failed to schedule summary generation for submission ${args.submissionId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }

      return {
        success: true,
        screenshots: capturedScreenshots,
        pagesCaptured: capturedScreenshots.length,
        totalPagesFound: pages.length,
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

      // Step 1: Use map endpoint to quickly discover URLs (much faster than crawl)
      // Map is designed for speed and costs 1 credit per site regardless of size
      const mapResult: unknown = await firecrawl.map(submission.siteUrl, {
        limit: 10, // Maximum 10 pages
      });

      // Extract URLs from map result
      let urlsToScrape: string[] = [];
      if (typeof mapResult === 'object' && mapResult !== null) {
        // Check for result.links or result.data.links (array of URL strings or objects)
        const links =
          (mapResult as { links?: unknown; data?: { links?: unknown } }).links ||
          (mapResult as { data?: { links?: unknown } }).data?.links;

        if (Array.isArray(links)) {
          urlsToScrape = links
            .map((link) => {
              if (typeof link === 'string') return link;
              if (typeof link === 'object' && link !== null && 'url' in link) {
                return typeof link.url === 'string' ? link.url : null;
              }
              return null;
            })
            .filter((url): url is string => url !== null && (url?.startsWith('http') ?? false));
        }
      }

      // Normalize the original URL for comparison
      const normalizedOriginalUrl = normalizeUrl(submission.siteUrl);

      // Deduplicate URLs using normalized comparison and ensure original URL is first
      const uniqueUrls: string[] = [];
      const seenNormalizedUrls = new Set<string>();

      // Always add the original URL first (if map results exist, we'll skip duplicates later)
      if (urlsToScrape.length > 0) {
        uniqueUrls.push(submission.siteUrl);
        seenNormalizedUrls.add(normalizedOriginalUrl);
      }

      // Add other URLs from map results, skipping duplicates (including normalized versions of the original)
      for (const url of urlsToScrape) {
        const normalizedUrl = normalizeUrl(url);
        if (!seenNormalizedUrls.has(normalizedUrl)) {
          uniqueUrls.push(url);
          seenNormalizedUrls.add(normalizedUrl);
        }
      }

      // If no URLs were found, use the original URL
      if (uniqueUrls.length === 0) {
        urlsToScrape = [submission.siteUrl];
      } else {
        urlsToScrape = uniqueUrls.slice(0, 10); // Keep max 10 URLs
      }

      // Step 2: Scrape each URL in parallel to capture screenshots
      // Using parallel scrape calls is faster and more reliable than crawl's async job system
      const scrapePromises = urlsToScrape.map(async (url) => {
        try {
          const result = await firecrawl.scrape(url, {
            formats: [{ type: 'screenshot', fullPage: true }],
          });
          // Extract screenshot URL from result (could be string or nested in data)
          let screenshotUrl: string | undefined;
          let pageName: string | undefined;

          if (typeof result === 'object' && result !== null) {
            // Extract screenshot URL
            if (typeof (result as { screenshot?: unknown }).screenshot === 'string') {
              screenshotUrl = (result as { screenshot: string }).screenshot;
            } else if (
              typeof (result as { data?: { screenshot?: unknown } }).data?.screenshot === 'string'
            ) {
              screenshotUrl = (result as { data: { screenshot: string } }).data.screenshot;
            }

            // Extract page name/title from metadata
            const metadata = (result as { metadata?: { title?: string; pageTitle?: string } })
              .metadata;
            if (metadata) {
              pageName = metadata.title || metadata.pageTitle;
            }
            // Fallback to extracting from markdown if available
            if (!pageName && typeof (result as { markdown?: string }).markdown === 'string') {
              const markdown = (result as { markdown: string }).markdown;
              const titleMatch = markdown.match(/^#\s+(.+)$/m);
              if (titleMatch) {
                pageName = titleMatch[1].trim();
              }
            }
          }

          return {
            url,
            screenshot: screenshotUrl,
            pageName,
            metadata: { sourceURL: url },
          };
        } catch (error) {
          console.warn(`Failed to scrape ${url}:`, error);
          return null;
        }
      });

      const scrapeResults = await Promise.all(scrapePromises);
      const pages: Array<{
        url: string;
        screenshot: string;
        pageName?: string;
        metadata: { sourceURL: string };
      }> = [];

      for (const page of scrapeResults) {
        if (
          page !== null &&
          typeof page.screenshot === 'string' &&
          page.screenshot.startsWith('http')
        ) {
          pages.push({
            url: page.url,
            screenshot: page.screenshot,
            pageName: page.pageName,
            metadata: page.metadata,
          });
        }
      }

      if (pages.length === 0) {
        throw new Error(
          'No pages were successfully scraped. All URLs may have failed to return screenshots.',
        );
      }

      // Get R2 credentials (throws if not configured)
      const r2Creds = getR2Credentials();

      // Create S3 client for R2
      const s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${r2Creds.r2AccountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: r2Creds.r2AccessKeyId,
          secretAccessKey: r2Creds.r2SecretAccessKey,
        },
      });

      const baseTimestamp = Date.now();

      // Process all pages in parallel for better performance
      // Each page processing is independent, so we can do them concurrently
      const screenshotPromises = pages.map(async (pageItem, i) => {
        const pageUrl: string =
          pageItem.url || pageItem.metadata?.sourceURL || submission.siteUrl || '';
        const screenshotUrl = pageItem.screenshot; // Already extracted and validated in filter

        if (!screenshotUrl) {
          console.warn(`No screenshot URL found for page ${i + 1} (${pageUrl}), skipping`);
          return null;
        }

        try {
          // Fetch screenshot from Firecrawl's storage URL
          const screenshotResponse = await fetch(screenshotUrl, {
            signal: AbortSignal.timeout(30000), // 30 second timeout for fetching the image
          });

          if (!screenshotResponse.ok) {
            console.warn(
              `Failed to fetch screenshot for page ${i + 1} (${pageUrl}): ${screenshotResponse.status} ${screenshotResponse.statusText}`,
            );
            return null;
          }

          const screenshotBuffer = Buffer.from(await screenshotResponse.arrayBuffer());

          // Generate R2 key: repos/{submissionId}/firecrawl/page-{index}-{timestamp}.png
          const timestamp = baseTimestamp + i; // Ensure unique timestamps
          const pageIndex = i + 1;
          const r2Key = `repos/${args.submissionId}/firecrawl/page-${pageIndex}-${timestamp}.png`;

          // Upload screenshot to R2
          await s3Client.send(
            new PutObjectCommand({
              Bucket: r2Creds.r2BucketName,
              Key: r2Key,
              Body: screenshotBuffer,
              ContentType: 'image/png',
              Metadata: {
                submissionId: args.submissionId,
                url: pageUrl,
                pageIndex: pageIndex.toString(),
                capturedAt: timestamp.toString(),
              },
            }),
          );

          // Generate presigned URL for R2 object (valid for 7 days - maximum allowed)
          const getObjectCommand = new GetObjectCommand({
            Bucket: r2Creds.r2BucketName,
            Key: r2Key,
          });
          const publicUrl = await getSignedUrl(s3Client, getObjectCommand, {
            expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds (maximum allowed)
          });

          return {
            r2Key,
            url: publicUrl,
            capturedAt: timestamp,
            pageUrl: pageItem.url,
            pageName: pageItem.pageName,
          };
        } catch (error) {
          console.warn(`Failed to process screenshot for page ${i + 1} (${pageUrl}):`, error);
          return null;
        }
      });

      // Wait for all screenshots to be processed in parallel
      const screenshotResults = await Promise.all(screenshotPromises);
      const capturedScreenshots: Array<{
        r2Key: string;
        url: string;
        capturedAt: number;
        pageUrl: string;
        pageName?: string;
      }> = [];

      for (const screenshot of screenshotResults) {
        if (screenshot !== null) {
          capturedScreenshots.push({
            r2Key: screenshot.r2Key,
            url: screenshot.url,
            capturedAt: screenshot.capturedAt,
            pageUrl: screenshot.pageUrl,
            pageName: screenshot.pageName,
          });
        }
      }

      if (capturedScreenshots.length === 0) {
        return {
          success: false,
          reason: 'no_screenshots',
          error:
            'No screenshots were successfully captured. All pages may have failed to capture screenshots.',
        };
      }

      // Batch add all screenshots atomically in a single mutation call
      await ctx.runMutation(internal.submissions.addScreenshots, {
        submissionId: args.submissionId,
        screenshots: capturedScreenshots,
      });

      // Record screenshot capture completion time
      const screenshotCaptureCompletedAt = Date.now();

      // Update source with screenshot capture completion timestamp
      await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
        submissionId: args.submissionId,
        screenshotCaptureCompletedAt,
      });

      // Trigger summary generation after screenshots are captured
      // If repo files are uploaded, use full AI Search summary; otherwise use early summary
      try {
        const submission = await ctx.runQuery(
          (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
            .getSubmissionInternal,
          {
            submissionId: args.submissionId,
          },
        );

        if (!submission) {
          console.warn(
            `[Screenshot] Could not fetch submission ${args.submissionId} to trigger summary generation`,
          );
          return {
            success: true,
            screenshots: capturedScreenshots,
            pagesCaptured: capturedScreenshots.length,
            totalPagesFound: pages.length,
          };
        }

        // Trigger early summary using README + screenshots (AI Search summary is only generated on-demand)
        // Early summary is saved to aiSummary, and will be overwritten by AI Search summary if user clicks "Full Summary"
        if (!submission.source?.aiSummary) {
          console.log(
            `[Screenshot] Triggering early summary with screenshots for submission ${args.submissionId}`,
          );
          await ctx.scheduler.runAfter(
            0,
            (
              internal.submissionsActions.aiSummary as unknown as {
                generateEarlySummary: GenerateEarlySummaryRef;
              }
            ).generateEarlySummary,
            {
              submissionId: args.submissionId,
              forceRegenerate: false,
            },
          );
        }
      } catch (error) {
        // Log but don't fail - summary generation is optional
        console.warn(
          `[Screenshot] Failed to schedule summary generation for submission ${args.submissionId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }

      return {
        success: true,
        screenshots: capturedScreenshots,
        pagesCaptured: capturedScreenshots.length,
        totalPagesFound: pages.length,
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
