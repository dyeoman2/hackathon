'use node';

import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { v } from 'convex/values';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { guarded } from '../authz/guardFactory';

/**
 * Internal helper to delete R2 files for a submission
 * Called automatically when a submission is deleted
 */
async function deleteSubmissionR2Files(r2PathPrefix: string | undefined): Promise<void> {
  if (!r2PathPrefix) {
    // No R2 files to delete
    return;
  }

  const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
    // R2 not configured, skip deletion
    console.warn('R2 credentials not configured, skipping R2 file deletion');
    return;
  }

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
  });

  const prefixToDelete = r2PathPrefix.endsWith('/') ? r2PathPrefix : `${r2PathPrefix}/`;
  let continuationToken: string | undefined;

  do {
    const listCommand = new ListObjectsV2Command({
      Bucket: r2BucketName,
      Prefix: prefixToDelete,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });

    const listResponse = await s3Client.send(listCommand);
    const objects = listResponse.Contents || [];

    if (objects.length === 0) {
      break;
    }

    // Delete objects in batches
    await Promise.all(
      objects.map(async (obj) => {
        if (!obj.Key) return;

        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: r2BucketName,
              Key: obj.Key,
            }),
          );
        } catch (error) {
          console.error(
            `Failed to delete R2 object ${obj.Key}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);
}

/**
 * Internal action to delete R2 files for a submission
 * Called from deleteSubmission mutation
 */
export const deleteSubmissionR2FilesAction = internalAction({
  args: {
    r2PathPrefix: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    await deleteSubmissionR2Files(args.r2PathPrefix);
  },
});

/**
 * Delete R2 objects by prefix (e.g., delete all repos or a specific submission's files)
 * This action uses Convex environment variables, so no local env setup needed
 *
 * Requires authentication. The `confirm: true` parameter provides safety against accidental deletion.
 */
export const deleteR2ObjectsByPrefix = guarded.action(
  'user.write', // Admin-only - deleting R2 objects is a destructive operation
  {
    prefix: v.string(),
    confirm: v.boolean(), // Safety: require explicit confirmation
  },
  async (_ctx: ActionCtx, args, _role) => {
    if (!args.confirm) {
      throw new Error('Deletion requires explicit confirmation. Set confirm: true');
    }

    const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
      throw new Error('R2 credentials not configured in Convex environment variables');
    }

    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });

    const prefixToDelete = args.prefix.endsWith('/') ? args.prefix : `${args.prefix}/`;
    let totalDeleted = 0;
    let continuationToken: string | undefined;
    const deletedKeys: string[] = [];

    do {
      // List objects with the prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: r2BucketName,
        Prefix: prefixToDelete,
        ContinuationToken: continuationToken,
        MaxKeys: 1000, // Maximum per request
      });

      const listResponse = await s3Client.send(listCommand);
      const objects = listResponse.Contents || [];

      if (objects.length === 0) {
        break;
      }

      // Delete objects in batches
      const deletePromises = objects.map(async (obj) => {
        if (!obj.Key) return null;

        try {
          await s3Client.send(
            new DeleteObjectCommand({
              Bucket: r2BucketName,
              Key: obj.Key,
            }),
          );
          return obj.Key;
        } catch (error) {
          console.error(
            `Failed to delete ${obj.Key}:`,
            error instanceof Error ? error.message : error,
          );
          return null;
        }
      });

      const batchDeleted = (await Promise.all(deletePromises)).filter(
        (key): key is string => key !== null,
      );
      deletedKeys.push(...batchDeleted);
      totalDeleted += batchDeleted.length;

      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    return {
      success: true,
      prefix: prefixToDelete,
      totalDeleted,
      deletedKeys: deletedKeys.slice(0, 100), // Return first 100 for logging
    };
  },
);
