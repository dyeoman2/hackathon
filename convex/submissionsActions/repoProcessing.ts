'use node';

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import AdmZip from 'adm-zip';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action } from '../_generated/server';
import type { GetSubmissionInternalRef, UpdateSubmissionSourceInternalRef } from './types';

/**
 * Trigger Cloudflare AI Search sync to index new R2 files immediately
 * API endpoint: PATCH /accounts/{account_id}/autorag/rags/{instance_name}/sync
 * Reference: https://developers.cloudflare.com/api/resources/autorag/
 *
 * Note: This sync scans the entire R2 bucket, but Cloudflare AI Search only processes
 * new or modified files during the sync (incremental indexing). The sync is rate-limited
 * to once every 30 seconds, so multiple rapid uploads will share the same sync job.
 *
 * Returns the job_id if sync was triggered successfully, null otherwise.
 */
async function triggerAISearchSync(_ctx: ActionCtx): Promise<string | null> {
  const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!aiSearchInstanceId || !accountId || !apiToken) {
    throw new Error('Cloudflare AI Search not configured');
  }

  // API endpoint to trigger sync: PATCH /accounts/{account_id}/autorag/rags/{instance_name}/sync
  // According to Cloudflare API docs: https://developers.cloudflare.com/api/resources/autorag/
  const syncUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/sync`;

  const response = await fetch(syncUrl, {
    method: 'PATCH', // PATCH per API documentation: https://developers.cloudflare.com/api/resources/autorag/methods/sync/
    headers: {
      Authorization: `Bearer ${apiToken}`,
      // No Content-Type needed - PATCH sync endpoint doesn't require a request body
    },
  });

  if (!response.ok) {
    const errorText = await response.text();

    // Log detailed error for debugging
    console.error(`[AI Search] Sync trigger failed: ${response.status} ${response.statusText}`);
    console.error(`[AI Search] Endpoint: ${syncUrl}`);
    console.error(`[AI Search] Error response: ${errorText}`);

    // If sync was triggered recently (within 30 seconds), that's okay
    // Cloudflare rate-limits syncs to prevent abuse - this is expected behavior
    // Multiple uploads within 30 seconds will share the same sync job
    if (
      response.status === 429 ||
      errorText.includes('rate limit') ||
      errorText.includes('too frequent')
    ) {
      console.log(
        '[AI Search] Sync already triggered recently (within 30s), new files will be included in existing sync',
      );
      return null;
    }

    // For 404, check if instance ID is correct
    if (response.status === 404) {
      console.error(
        `[AI Search] Instance not found. Verify CLOUDFLARE_AI_SEARCH_INSTANCE_ID="${aiSearchInstanceId}" is correct.`,
      );
    }

    // For other errors, log but don't throw - sync will happen automatically
    console.warn(`[AI Search] Sync trigger failed: ${response.status} - ${errorText}`);
    return null;
  }

  const syncResponse = await response.json();
  // Response format: Envelope<{ job_id }> per API docs
  const jobId = syncResponse?.result?.job_id || syncResponse?.job_id;
  console.log(
    `[AI Search] Sync triggered successfully (job_id: ${jobId || 'unknown'}) - will scan bucket and index new/modified files`,
  );
  return jobId || null;
}

/**
 * Check Cloudflare AI Search sync job status
 * API endpoint: GET /accounts/{account_id}/autorag/rags/{instance_name}/jobs/{job_id}
 * Reference: https://developers.cloudflare.com/api/resources/autorag/methods/ai_search/
 *
 * Returns job status: 'pending' | 'running' | 'completed' | 'failed' | null (if job not found)
 */
export async function checkAISearchJobStatus(
  _ctx: ActionCtx,
  jobId: string,
): Promise<'pending' | 'running' | 'completed' | 'failed' | null> {
  const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!aiSearchInstanceId || !accountId || !apiToken) {
    throw new Error('Cloudflare AI Search not configured');
  }

  // API endpoint to check job status: GET /accounts/{account_id}/autorag/rags/{instance_name}/jobs/{job_id}
  const jobStatusUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/jobs/${jobId}`;

  try {
    const response = await fetch(jobStatusUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Job not found - might have been cleaned up or never existed
        console.warn(`[AI Search] Job ${jobId} not found (404)`);
        return null;
      }
      const errorText = await response.text();
      console.error(`[AI Search] Job status check failed: ${response.status} - ${errorText}`);
      return null;
    }

    const jobData = await response.json();
    // Response format: Envelope<{ id, source, end_reason, ended_at, last_seen_at, started_at }>
    // Reference: https://developers.cloudflare.com/api/resources/autorag/methods/sync/
    const job = jobData.result || jobData;

    // Determine job status based on API response fields:
    // - If ended_at exists, job is finished (check end_reason for success/failure)
    // - If started_at exists but no ended_at, job is running
    // - Otherwise, job is pending
    if (job.ended_at) {
      // Job has ended - check end_reason to determine if completed or failed
      // end_reason might be "completed", "success", "failed", "error", etc.
      const endReason = (job.end_reason || '').toLowerCase();
      if (endReason.includes('fail') || endReason.includes('error')) {
        return 'failed';
      }
      // If ended_at exists, assume completed (even if end_reason is empty or unknown)
      return 'completed';
    }
    if (job.started_at) {
      // Job has started but not ended yet - it's running
      return 'running';
    }
    // Job exists but hasn't started yet - it's pending
    return 'pending';
  } catch (error) {
    console.error(`[AI Search] Error checking job status:`, error);
    return null;
  }
}

/**
 * Helper function to download and upload repo to R2
 * Extracted so it can be called from both downloadAndUploadRepo and generateRepoSummary
 */
export async function downloadAndUploadRepoHelper(
  ctx: ActionCtx,
  args: { submissionId: Id<'submissions'> },
): Promise<{ r2PathPrefix: string; uploadedAt: number; fileCount: number }> {
  // Get submission
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

  if (!submission.repoUrl) {
    throw new Error('Repository URL not provided');
  }

  // Trigger screenshot capture if siteUrl is provided (runs in parallel, doesn't block upload)
  if (submission.siteUrl?.trim()) {
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.submissionsActions.screenshot.captureScreenshotInternal,
        {
          submissionId: args.submissionId,
        },
      );
    } catch (error) {
      // Log but don't fail - screenshot capture is optional
      console.warn(
        `[R2 Upload] Failed to schedule screenshot capture for submission ${args.submissionId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // Set processing state to downloading
  await ctx.runMutation(
    (
      internal.submissions as unknown as {
        updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
      }
    ).updateSubmissionSourceInternal,
    {
      submissionId: args.submissionId,
      processingState: 'downloading',
    },
  );

  // Parse GitHub URL
  const githubUrl = submission.repoUrl.trim();
  const githubMatch = githubUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
  if (!githubMatch) {
    throw new Error('Invalid GitHub URL');
  }

  const [, owner, repo] = githubMatch;
  const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');

  // Optional GitHub token for higher rate limits / private repos
  const githubToken = process.env.GITHUB_TOKEN;

  // Get R2 credentials from env
  const r2BucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
  const r2AccessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const r2SecretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const r2AccountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!r2BucketName || !r2AccessKeyId || !r2SecretAccessKey || !r2AccountId) {
    throw new Error('R2 credentials not configured');
  }

  // Create temporary directory for cloning
  const tempDir = join('/tmp', `repo-${args.submissionId}-${Date.now()}`);

  try {
    // Create temp directory
    mkdirSync(tempDir, { recursive: true });

    const headers: Record<string, string> = { 'User-Agent': 'tanstack-hackathon' };
    if (githubToken) {
      headers.Authorization = `Bearer ${githubToken}`;
    }

    // Fetch repository metadata to determine default branch
    const repoInfoResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
      headers,
    });

    let defaultBranch: string | undefined;

    if (repoInfoResponse.ok) {
      const repoInfo: { default_branch?: string } = await repoInfoResponse.json();
      defaultBranch = repoInfo.default_branch;
    } else if (repoInfoResponse.status !== 404) {
      const errorText = await repoInfoResponse.text();
      throw new Error(
        `Failed to fetch repository metadata: ${repoInfoResponse.status} ${errorText}`,
      );
    }

    const branchCandidates = Array.from(
      new Set(
        [defaultBranch, 'main', 'master'].filter((branch): branch is string => Boolean(branch)),
      ),
    );
    if (branchCandidates.length === 0) {
      branchCandidates.push('main', 'master');
    }

    let archiveBuffer: Buffer | null = null;
    let usedBranch: string | null = null;

    for (const branch of branchCandidates) {
      const archiveResponse = await fetch(
        `https://codeload.github.com/${owner}/${repoName}/zip/${branch}`,
        {
          headers,
        },
      );

      if (archiveResponse.ok) {
        archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
        usedBranch = branch;
        break;
      }
    }

    if (!archiveBuffer || !usedBranch) {
      throw new Error('Failed to download repository archive after trying fallback branches');
    }
    const zip = new AdmZip(archiveBuffer);
    zip.extractAllTo(tempDir, true);

    // Determine the extracted root directory (GitHub archives include {repo}-{branch}/)
    const extractedRootName =
      zip
        .getEntries()
        .map((entry) => entry.entryName.split('/')[0])
        .find((name) => !!name) ?? `${repoName}-${usedBranch}`;

    const repoRootDir = join(tempDir, extractedRootName);

    // R2 path prefix for this submission's files
    const r2PathPrefix = `repos/${args.submissionId}/files/`;

    // Filter and collect code files
    const codeFiles: Array<{ path: string; content: string }> = [];
    const maxFileSize = 100 * 1024; // 100KB per file

    const { readdirSync, statSync, readFileSync: readFileSyncAsync } = await import('node:fs');

    function collectFiles(dir: string, basePath: string = '') {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = basePath ? `${basePath}/${entry}` : entry;
        const stat = statSync(fullPath);

        if (stat.isDirectory() && !entry.startsWith('.') && entry !== 'node_modules') {
          collectFiles(fullPath, relativePath);
        } else if (stat.isFile() && stat.size < maxFileSize) {
          const ext = entry.split('.').pop()?.toLowerCase();
          const codeExtensions = [
            'js',
            'ts',
            'jsx',
            'tsx',
            'py',
            'java',
            'go',
            'rs',
            'cpp',
            'c',
            'h',
            'hpp',
            'cs',
            'php',
            'rb',
            'swift',
            'kt',
            'scala',
            'md',
            'json',
            'yaml',
            'yml',
            'toml',
            'xml',
            'html',
            'css',
            'scss',
            'sass',
            'less',
          ];
          if (ext && codeExtensions.includes(ext)) {
            try {
              const content = readFileSyncAsync(fullPath, 'utf-8');
              codeFiles.push({ path: relativePath, content });
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }
    }

    collectFiles(repoRootDir);

    // Set processing state to uploading and record upload start time
    const uploadStartedAt = Date.now();
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        processingState: 'uploading',
        uploadStartedAt,
      },
    );

    // Upload filtered files to R2 (S3-compatible)
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
    });

    // Upload each file to R2 with metadata
    for (const file of codeFiles) {
      const r2Key = `${r2PathPrefix}${file.path}`;
      await s3Client.send(
        new PutObjectCommand({
          Bucket: r2BucketName,
          Key: r2Key,
          Body: file.content,
          ContentType: 'text/plain',
          Metadata: {
            submissionId: args.submissionId,
            originalPath: file.path,
          },
        }),
      );
    }

    // Update submission with R2 path prefix, record upload completion, and set state to indexing
    const uploadCompletedAt = Date.now();
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        r2Key: r2PathPrefix, // Store path prefix instead of single ZIP key
        uploadedAt: uploadCompletedAt,
        uploadCompletedAt,
        processingState: 'indexing', // Next step is indexing
      },
    );

    // Trigger Cloudflare AI Search sync immediately after upload
    // This ensures new files are indexed right away instead of waiting for the 6-hour cycle
    const aiSearchSyncStartedAt = Date.now();
    let jobId: string | null = null;

    try {
      jobId = await triggerAISearchSync(ctx);
      console.log(
        `[R2 Upload] Triggered AI Search sync for submission ${args.submissionId}${jobId ? ` (job_id: ${jobId})` : ''}`,
      );
    } catch (syncError) {
      // Log but don't fail - sync will happen automatically eventually
      console.warn(
        `[R2 Upload] Failed to trigger AI Search sync for submission ${args.submissionId}:`,
        syncError instanceof Error ? syncError.message : String(syncError),
      );
    }

    // Record sync start time and job_id
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        aiSearchSyncStartedAt,
        aiSearchSyncJobId: jobId ?? undefined,
      },
    );

    return { r2PathPrefix, uploadedAt: Date.now(), fileCount: codeFiles.length };
  } finally {
    // Cleanup temp files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Download GitHub repo, extract filtered files, and upload to R2
 * Action with "use node" for git operations
 */
export const downloadAndUploadRepo = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    return await downloadAndUploadRepoHelper(ctx, args);
  },
});
