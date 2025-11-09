'use node';

import { v } from 'convex/values';
import { action } from './_generated/server';
import { internal } from './_generated/api';

/**
 * Download GitHub repo and upload to R2
 * Action with "use node" for git operations
 */
export const downloadAndUploadRepo = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    // Get submission
    const submission = await ctx.runQuery(
      (internal.submissions as any).getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (!submission.repoUrl) {
      throw new Error('Repository URL not provided');
    }

    // Parse GitHub URL
    const githubUrl = submission.repoUrl;
    const githubMatch = githubUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!githubMatch) {
      throw new Error('Invalid GitHub URL');
    }

    const [, _owner, repo] = githubMatch;
    const repoName = repo.replace(/\.git$/, '');

    // Get GitHub token from env (for future use)
    const _githubToken = process.env.GITHUB_TOKEN;

    // Get R2 credentials from env
    const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
    const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

    if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
      throw new Error('R2 credentials not configured');
    }

    // TODO: Implement git clone and zip
    // This requires Node.js packages: simple-git, archiver, @aws-sdk/client-s3
    // For now, return a placeholder
    const r2Key = `repos/${args.submissionId}/${repoName}-${Date.now()}.zip`;

    // Update submission with R2 key
    await ctx.runMutation(
      (internal.submissions as any).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        r2Key,
        uploadedAt: Date.now(),
      },
    );

    return { r2Key, uploadedAt: Date.now() };
  },
});

/**
 * Generate repository summary using Cloudflare AI Search
 */
export const generateRepoSummary = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    // Get submission
    const submission = await ctx.runQuery(
      (internal.submissions as any).getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (!submission) {
      throw new Error('Submission not found');
    }

    if (!submission.source?.r2Key) {
      throw new Error('Repository not uploaded to R2');
    }

    // Get AI Search instance ID from env
    const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!aiSearchInstanceId || !accountId || !apiToken) {
      throw new Error('Cloudflare AI Search not configured');
    }

    // TODO: Implement AI Search integration
    // 1. Read repo files from R2
    // 2. Upload files to AI Search instance (creates embeddings)
    // 3. Query AI Search to generate summary
    // For now, return a placeholder summary
    const summary = `Repository summary for ${submission.title}. This is a placeholder summary. Implement Cloudflare AI Search integration to generate actual summaries.`;

    // Update submission with summary
    await ctx.runMutation(
      (internal.submissions as any).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        aiSummary: summary,
        summarizedAt: Date.now(),
      },
    );

    return { summary };
  },
});

