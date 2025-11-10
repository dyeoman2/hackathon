/**
 * Alchemy Run Infrastructure as Code for Cloudflare R2
 *
 * This file defines the R2 bucket infrastructure using Alchemy Run.
 * See docs/REPO_PROCESSING_SETUP.md for setup instructions.
 *
 * Deploy with:
 *   bun alchemy deploy
 *   or
 *   npx alchemy deploy
 *
 * Reference: https://alchemy.run/getting-started
 */

import alchemy from 'alchemy';
import { AccountApiToken, PermissionGroups, R2Bucket } from 'alchemy/cloudflare';

const app = await alchemy('hackathon-infra');

/**
 * R2 Bucket for storing GitHub repository archives
 */
export const hackathonReposBucket = await R2Bucket('hackathon-repos', {
  name: 'hackathon-repos',
});

/**
 * Get permission groups for creating API tokens
 */
const permissions = await PermissionGroups();

/**
 * Cloudflare API Token for R2 management
 * This token can be used to programmatically create R2 API tokens (S3-compatible credentials)
 * via the Cloudflare API: POST /accounts/{account_id}/r2/api-tokens
 *
 * Note: This is a Cloudflare API token, not an R2 API token (S3 credentials).
 * R2 API tokens still need to be created manually or via Cloudflare API using this token.
 *
 * IMPORTANT: This may fail if your Alchemy OAuth token doesn't have permission to create API tokens.
 * If it fails, you'll need to create a Cloudflare API token manually in the Dashboard.
 */
export const r2ManagementToken = await AccountApiToken('r2-management-token', {
  name: 'Hackathon R2 Management',
  policies: [
    {
      effect: 'allow',
      resources: {
        // Allow R2 bucket operations
        'com.cloudflare.edge.r2.bucket.*': '*',
      },
      permissionGroups: [
        {
          id: permissions['Workers R2 Storage Write'].id,
        },
        {
          id: permissions['Workers R2 Storage Read'].id,
        },
      ],
    },
  ],
}).catch((error) => {
  // If API token creation fails (e.g., insufficient OAuth permissions),
  // log a warning but don't fail the entire deployment
  console.warn('\n⚠️  Warning: Could not create Cloudflare API token via Alchemy.');
  console.warn('   Error:', error instanceof Error ? error.message : String(error));
  console.warn('\n   The R2 bucket was created successfully.');
  console.warn('   You can create the API token manually:');
  console.warn('   1. Go to https://dash.cloudflare.com/profile/api-tokens');
  console.warn('   2. Create a token with R2 read/write permissions');
  console.warn('   3. Use that token with the create-r2-token script\n');
  
  // Return a placeholder so the export doesn't break
  return { value: 'MANUAL_TOKEN_REQUIRED' };
});

await app.finalize();
