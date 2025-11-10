#!/usr/bin/env tsx
/**
 * Script to delete objects from Cloudflare R2 bucket
 *
 * NOTE: Since R2 credentials are stored in Convex environment variables,
 * you have two options:
 *
 * Option 1: Use Convex Action (Recommended - uses Convex env vars automatically)
 *   npx convex run submissionsActions:deleteR2ObjectsByPrefix '{"prefix": "repos/", "confirm": true}'
 *
 * Option 2: Use this script with local env vars
 *   Get values from Convex dashboard: Settings > Environment Variables
 *   Then run:
 *   CLOUDFLARE_R2_ACCESS_KEY_ID=<key> \
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY=<secret> \
 *   CLOUDFLARE_R2_BUCKET_NAME=<bucket> \
 *   CLOUDFLARE_ACCOUNT_ID=<account-id> \
 *   tsx scripts/delete-r2-objects.ts [prefix]
 *
 * Examples:
 *   # Delete all objects with prefix "repos/" (via Convex)
 *   npx convex run submissionsActions:deleteR2ObjectsByPrefix '{"prefix": "repos/", "confirm": true}'
 *
 *   # Delete objects for a specific submission (via Convex)
 *   npx convex run submissionsActions:deleteR2ObjectsByPrefix '{"prefix": "repos/k570jetynpcs627tpewytegwz17v22vq/", "confirm": true}'
 *
 *   # Delete all objects (empty bucket) - via script with env vars
 *   tsx scripts/delete-r2-objects.ts
 */

import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const prefix = process.argv[2] || '';

if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
  console.error('❌ Missing required environment variables:');
  console.error('   CLOUDFLARE_R2_BUCKET_NAME');
  console.error('   CLOUDFLARE_R2_ACCESS_KEY_ID');
  console.error('   CLOUDFLARE_R2_SECRET_ACCESS_KEY');
  console.error('   CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
});

async function deleteObjectsWithPrefix(prefixToDelete: string) {
  console.log(`\n🗑️  Deleting objects with prefix: "${prefixToDelete || '(all objects)'}"\n`);

  let totalDeleted = 0;
  let continuationToken: string | undefined;

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
      if (totalDeleted === 0) {
        console.log('ℹ️  No objects found with the specified prefix.');
      }
      break;
    }

    console.log(
      `📋 Found ${objects.length} objects (batch ${Math.floor(totalDeleted / 1000) + 1})...`,
    );

    // Delete objects in batches
    const deletePromises = objects.map(async (obj) => {
      if (!obj.Key) return;

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
          `❌ Failed to delete ${obj.Key}:`,
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    });

    const deletedKeys = (await Promise.all(deletePromises)).filter(
      (key): key is string => key !== null,
    );
    totalDeleted += deletedKeys.length;

    if (deletedKeys.length > 0) {
      console.log(`✅ Deleted ${deletedKeys.length} objects`);
      if (deletedKeys.length <= 5) {
        deletedKeys.forEach((key) => console.log(`   - ${key}`));
      } else {
        deletedKeys.slice(0, 3).forEach((key) => console.log(`   - ${key}`));
        console.log(`   ... and ${deletedKeys.length - 3} more`);
      }
    }

    continuationToken = listResponse.NextContinuationToken;
  } while (continuationToken);

  console.log(`\n✅ Total objects deleted: ${totalDeleted}`);
  console.log(
    `\n💡 Note: If you're using Cloudflare AI Search, you may need to wait for it to re-index after deletion.`,
  );
}

async function main() {
  try {
    if (prefix && !prefix.endsWith('/') && prefix !== '') {
      console.warn(
        `⚠️  Warning: Prefix "${prefix}" doesn't end with "/". Adding "/" for directory matching.`,
      );
      await deleteObjectsWithPrefix(`${prefix}/`);
    } else {
      await deleteObjectsWithPrefix(prefix);
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
