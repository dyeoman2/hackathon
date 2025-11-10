#!/usr/bin/env tsx
/**
 * Script to create R2 API tokens (S3-compatible credentials) using Cloudflare API
 *
 * This script uses the Cloudflare API token created by Alchemy to programmatically
 * create R2 API tokens (S3-compatible credentials) for the hackathon-repos bucket.
 *
 * Usage:
 *   After running `npx alchemy deploy`, run:
 *   CLOUDFLARE_API_TOKEN=<token-from-alchemy> CLOUDFLARE_ACCOUNT_ID=<account-id> pnpm tsx scripts/create-r2-token.ts
 *
 * Or set environment variables and run:
 *   pnpm tsx scripts/create-r2-token.ts
 */

interface R2ApiTokenResponse {
  result: {
    access_key_id: string;
    secret_access_key: string;
    expires?: string;
  };
  success: boolean;
  errors: unknown[];
  messages: unknown[];
}

async function createR2ApiToken() {
  // Get Cloudflare API token (from Alchemy or env)
  const cloudflareApiToken =
    process.env.CLOUDFLARE_API_TOKEN || process.env.ALCHEMY_R2_MANAGEMENT_TOKEN;

  if (!cloudflareApiToken) {
    console.error('❌ Error: CLOUDFLARE_API_TOKEN or ALCHEMY_R2_MANAGEMENT_TOKEN not set');
    console.error('');
    console.error('After running `npx alchemy deploy`, you can:');
    console.error('1. Get the token value from Alchemy output (r2ManagementToken.value)');
    console.error('2. Set it as: export CLOUDFLARE_API_TOKEN=<token-value>');
    console.error(
      '3. Or set it in your shell: CLOUDFLARE_API_TOKEN=<token> pnpm tsx scripts/create-r2-token.ts',
    );
    process.exit(1);
  }

  // Get account ID
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    console.error('❌ Error: CLOUDFLARE_ACCOUNT_ID not set');
    console.error('Get it from Cloudflare Dashboard (right sidebar)');
    process.exit(1);
  }

  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'hackathon-repos';
  const tokenName = process.env.R2_TOKEN_NAME || `hackathon-repos-${Date.now()}`;

  console.log('🔧 Creating R2 API token...');
  console.log(`   Account ID: ${accountId}`);
  console.log(`   Bucket: ${bucketName}`);
  console.log(`   Token Name: ${tokenName}`);
  console.log('');

  try {
    // Create R2 API token via Cloudflare API
    // Endpoint: POST /accounts/{account_id}/r2/api-tokens
    // Note: This requires a Cloudflare API token with R2 management permissions
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/api-tokens`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: tokenName,
          // R2 API tokens use bucket-specific permissions
          // Format: accountId_jurisdiction_bucketName (jurisdiction is usually "default")
          permissions: [
            {
              effect: 'allow',
              resources: {
                [`com.cloudflare.edge.r2.bucket.${accountId}_default_${bucketName}`]: '*',
              },
              permission_groups: [
                {
                  id: 'Workers R2 Storage Bucket Item Read',
                },
                {
                  id: 'Workers R2 Storage Bucket Item Write',
                },
              ],
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `❌ Error creating R2 API token: ${response.status} ${response.statusText}`;

      // Check for specific error codes
      try {
        const errorData = JSON.parse(errorText);
        if (errorData.errors && errorData.errors.length > 0) {
          const firstError = errorData.errors[0];
          errorMessage = `❌ Error creating R2 API token: ${firstError.code} - ${firstError.message}`;

          // Provide helpful guidance for common errors
          if (response.status === 404) {
            console.error(errorMessage);
            console.error(
              '\n⚠️  The R2 API token creation endpoint is not available via the Cloudflare API.',
            );
            console.error('R2 API tokens (S3-compatible credentials) must be created manually.\n');
            console.error('Please create R2 API tokens manually:');
            console.error('1. In the R2 Overview page, scroll down to "Account Details" section');
            console.error('2. Click the "{ } Manage" button next to "API Tokens"');
            console.error('3. Click "Create Account API token" (recommended for production)');
            console.error('4. Enter a token name (e.g., "hackathon-repos")');
            console.error('5. Under "Permissions", select:');
            console.error('   - Object Read: Allow');
            console.error('   - Object Write: Allow');
            console.error('6. Under "R2 Buckets", select "hackathon-repos" (or "All buckets")');
            console.error('7. Click "Create API Token"');
            console.error('8. Copy the Access Key ID and Secret Access Key (shown only once!)\n');
            console.error('Then set these Convex environment variables:');
            console.error(`   npx convex env set CLOUDFLARE_R2_BUCKET_NAME ${bucketName}`);
            console.error('   npx convex env set CLOUDFLARE_R2_ACCESS_KEY_ID <access-key-id>');
            console.error(
              '   npx convex env set CLOUDFLARE_R2_SECRET_ACCESS_KEY <secret-access-key>',
            );
            console.error(`   npx convex env set CLOUDFLARE_ACCOUNT_ID ${accountId}\n`);
            process.exit(1);
          }
        }
      } catch {
        // If we can't parse the error, use the raw text
        errorMessage += `\n${errorText}`;
      }

      console.error(errorMessage);
      process.exit(1);
    }

    const data = (await response.json()) as R2ApiTokenResponse;

    if (!data.success || !data.result) {
      console.error('❌ Failed to create R2 API token');
      console.error('Errors:', data.errors);
      process.exit(1);
    }

    const { access_key_id, secret_access_key } = data.result;

    console.log('✅ R2 API token created successfully!');
    console.log('');

    // Output in parseable format for automation scripts
    if (process.env.AUTOMATED === 'true') {
      // JSON output for automated parsing
      console.log(
        JSON.stringify({
          bucketName,
          accessKeyId: access_key_id,
          secretAccessKey: secret_access_key,
          accountId,
        }),
      );
    } else {
      // Human-readable output
      console.log('📋 Set these environment variables in Convex:');
      console.log('');
      console.log(`npx convex env set CLOUDFLARE_R2_BUCKET_NAME ${bucketName}`);
      console.log(`npx convex env set CLOUDFLARE_R2_ACCESS_KEY_ID ${access_key_id}`);
      console.log(`npx convex env set CLOUDFLARE_R2_SECRET_ACCESS_KEY ${secret_access_key}`);
      console.log(`npx convex env set CLOUDFLARE_ACCOUNT_ID ${accountId}`);
      console.log('');
      console.log('⚠️  IMPORTANT: Save these credentials securely!');
      console.log(`   Access Key ID: ${access_key_id}`);
      console.log(`   Secret Access Key: ${secret_access_key}`);
      console.log('   (The secret will not be shown again)');
      console.log('');
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

createR2ApiToken().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
