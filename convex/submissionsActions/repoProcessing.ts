'use node';

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import AdmZip from 'adm-zip';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import { guarded } from '../authz/guardFactory';
import type {
  CheckCloudflareIndexingRef,
  GenerateSummaryRef,
  GetSubmissionInternalRef,
  UpdateSubmissionSourceInternalRef,
} from './types';

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

    // Check if this is an expected cooldown/rate limit error first
    // Cloudflare rate-limits syncs to prevent abuse - this is expected behavior
    // Multiple uploads within 30 seconds will share the same sync job
    let isCooldownError = false;
    if (response.status === 429) {
      isCooldownError = true;
    } else {
      // Parse error response to check for sync_in_cooldown code/message
      try {
        const errorJson = JSON.parse(errorText);
        const errors = errorJson?.errors || [];
        isCooldownError = errors.some(
          (err: { code?: number; message?: string }) =>
            err.code === 7020 ||
            err.message?.includes('sync_in_cooldown') ||
            err.message?.includes('rate limit') ||
            err.message?.includes('too frequent'),
        );
      } catch {
        // If JSON parsing fails, check text content
        isCooldownError =
          errorText.includes('sync_in_cooldown') ||
          errorText.includes('rate limit') ||
          errorText.includes('too frequent');
      }
    }

    if (isCooldownError) {
      // This is expected - sync was triggered recently, new files will be included
      console.log(
        '[AI Search] Sync already triggered recently (within 30s), new files will be included in existing sync',
      );
      return null;
    }

    // For unexpected errors, log details for debugging
    console.error(`[AI Search] Sync trigger failed: ${response.status} ${response.statusText}`);
    console.error(`[AI Search] Endpoint: ${syncUrl}`);
    console.error(`[AI Search] Error response: ${errorText}`);

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
    console.log(`[AI Search] Fetching job status from: ${jobStatusUrl}`);
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
        console.warn(`[AI Search] Job ${jobId} not found (404) - may have been cleaned up`);
        return null;
      }
      const errorText = await response.text();
      console.error(`[AI Search] Job status check failed: ${response.status} - ${errorText}`);
      return null;
    }

    const jobData = await response.json();
    console.log(`[AI Search] Job status API response:`, JSON.stringify(jobData, null, 2));
    // Response format: Envelope<{ id, source, end_reason, ended_at, last_seen_at, started_at }>
    // Reference: https://developers.cloudflare.com/api/resources/autorag/methods/sync/
    const job = jobData.result || jobData;

    console.log(`[AI Search] Parsed job data:`, {
      id: job.id,
      source: job.source,
      end_reason: job.end_reason,
      ended_at: job.ended_at,
      started_at: job.started_at,
      last_seen_at: job.last_seen_at,
    });

    // Determine job status based on API response fields:
    // - If ended_at exists, job is finished (check end_reason for success/failure)
    // - If started_at exists but no ended_at, job is running
    // - Otherwise, job is pending
    if (job.ended_at) {
      // Job has ended - check end_reason to determine if completed or failed
      // end_reason might be "completed", "success", "failed", "error", etc.
      const endReason = (job.end_reason || '').toLowerCase();
      console.log(
        `[AI Search] Job ${jobId} has ended_at: ${job.ended_at}, end_reason: ${job.end_reason || 'none'}`,
      );
      if (endReason.includes('fail') || endReason.includes('error')) {
        console.log(`[AI Search] Job ${jobId} status: FAILED (end_reason: ${job.end_reason})`);
        return 'failed';
      }
      // If ended_at exists, assume completed (even if end_reason is empty or unknown)
      console.log(`[AI Search] Job ${jobId} status: COMPLETED`);
      return 'completed';
    }
    if (job.started_at) {
      // Job has started but not ended yet - it's running
      console.log(
        `[AI Search] Job ${jobId} status: RUNNING (started_at: ${job.started_at}, no ended_at)`,
      );
      return 'running';
    }
    // Job exists but hasn't started yet - it's pending
    console.log(`[AI Search] Job ${jobId} status: PENDING (no started_at)`);
    return 'pending';
  } catch (error) {
    console.error(`[AI Search] Error checking job status for ${jobId}:`, error);
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
  console.log(`[Repo Download] Processing URL: ${githubUrl}`);

  const githubMatch = githubUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
  if (!githubMatch) {
    throw new Error(
      `Invalid GitHub URL format: ${githubUrl}. Expected format: https://github.com/owner/repo or git@github.com:owner/repo.git`,
    );
  }

  const [, owner, repo] = githubMatch;
  const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');

  console.log(`[Repo Download] Parsed owner: "${owner}", repo: "${repoName}"`);

  // Optional GitHub token for higher rate limits / private repos
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.warn(
      `[Repo Download] No GITHUB_TOKEN configured - private repositories will not be accessible`,
    );
  }

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
    const repoApiUrl = `https://api.github.com/repos/${owner}/${repoName}`;
    console.log(`[Repo Download] Fetching repo metadata from: ${repoApiUrl}`);
    console.log(`[Repo Download] Original URL: ${githubUrl}`);
    console.log(`[Repo Download] Parsed owner: ${owner}, repo: ${repoName}`);

    const repoInfoResponse = await fetch(repoApiUrl, {
      headers,
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    let defaultBranch: string | undefined;

    if (repoInfoResponse.ok) {
      const repoInfo: { default_branch?: string } = await repoInfoResponse.json();
      defaultBranch = repoInfo.default_branch;
      console.log(
        `[Repo Download] Successfully fetched repo info. Default branch: ${defaultBranch}`,
      );
    } else {
      const errorText = await repoInfoResponse.text();
      console.error(
        `[Repo Download] Failed to fetch repo metadata: ${repoInfoResponse.status} ${errorText}`,
      );

      if (repoInfoResponse.status === 404) {
        throw new Error(
          `Repository not found: https://github.com/${owner}/${repoName}. Please check that the repository exists and is accessible.`,
        );
      } else if (repoInfoResponse.status === 403) {
        throw new Error(
          `Access denied to repository: https://github.com/${owner}/${repoName}. The repository may be private and require a GitHub token.`,
        );
      } else if (repoInfoResponse.status === 401) {
        throw new Error(
          `Authentication failed for repository: https://github.com/${owner}/${repoName}. The GitHub token may be invalid or expired.`,
        );
      } else {
        throw new Error(
          `Failed to fetch repository metadata: ${repoInfoResponse.status} ${errorText}`,
        );
      }
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
      const archiveUrl = `https://codeload.github.com/${owner}/${repoName}/zip/${branch}`;
      console.log(`[Repo Download] Trying to download archive from: ${archiveUrl}`);

      try {
        const archiveResponse = await fetch(archiveUrl, {
          headers,
          signal: AbortSignal.timeout(30000), // 30 second timeout for larger downloads
        });

        console.log(
          `[Repo Download] Archive download response: ${archiveResponse.status} for branch ${branch}`,
        );

        if (archiveResponse.ok) {
          archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
          usedBranch = branch;
          console.log(`[Repo Download] Successfully downloaded archive for branch: ${branch}`);
          break;
        } else {
          const errorText = await archiveResponse.text();
          console.warn(
            `[Repo Download] Failed to download archive for branch ${branch}: ${archiveResponse.status} - ${errorText}`,
          );

          // Handle specific error cases
          if (archiveResponse.status === 404) {
            console.warn(
              `[Repo Download] Branch '${branch}' not found for repository ${owner}/${repoName}`,
            );
          } else if (archiveResponse.status === 403) {
            console.warn(
              `[Repo Download] Access denied to branch '${branch}' - repository may be private`,
            );
          }
        }
      } catch (error) {
        console.warn(
          `[Repo Download] Network error downloading branch ${branch}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (!archiveBuffer || !usedBranch) {
      console.error(`[Repo Download] All branch candidates failed: ${branchCandidates.join(', ')}`);
      throw new Error(
        `Failed to download repository archive from https://github.com/${owner}/${repoName} after trying branches: ${branchCandidates.join(', ')}. ` +
          'This could mean the repository is empty, private (requires GitHub token), or the URL is incorrect.',
      );
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

    // Trigger summary generation (using README + screenshots if available)
    // This provides immediate feedback while waiting for AI Search indexing
    try {
      await ctx.scheduler.runAfter(
        0,
        (
          internal.submissionsActions.aiSummary as unknown as {
            generateSummary: GenerateSummaryRef;
          }
        ).generateSummary,
        {
          submissionId: args.submissionId,
        },
      );
    } catch (error) {
      // Log but don't fail - summary is optional
      console.warn(
        `[R2 Upload] Failed to schedule summary generation for submission ${args.submissionId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Schedule the indexing check
    // This will poll for indexing completion and mark the submission as complete
    try {
      console.log(
        `[R2 Upload] Scheduling indexing check for submission ${args.submissionId} (will start checking in 15 seconds)`,
      );
      await ctx.scheduler.runAfter(
        15000, // Wait 15 seconds before first check to give indexing time to start
        (
          internal.submissionsActions.aiSummary as unknown as {
            checkCloudflareIndexing: CheckCloudflareIndexingRef;
          }
        ).checkCloudflareIndexing,
        {
          submissionId: args.submissionId,
          attempt: 0,
          forceRegenerate: false,
        },
      );
      console.log(
        `[R2 Upload] ✅ Successfully scheduled indexing check for submission ${args.submissionId}`,
      );
    } catch (error) {
      // Log but don't fail - this is critical but we don't want to fail the upload
      console.error(
        `[R2 Upload] ❌ Failed to schedule indexing check for submission ${args.submissionId}:`,
        error instanceof Error ? error.message : String(error),
      );
    }

    return { r2PathPrefix, uploadedAt: Date.now(), fileCount: codeFiles.length };
  } catch (error) {
    // Update submission state to error
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `[Repo Download] Error processing submission ${args.submissionId}:`,
      errorMessage,
    );

    try {
      await ctx.runMutation(
        (
          internal.submissions as unknown as {
            updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
          }
        ).updateSubmissionSourceInternal,
        {
          submissionId: args.submissionId,
          processingState: 'error',
        },
      );
    } catch (updateError) {
      console.error(
        `[Repo Download] Failed to update submission error state:`,
        updateError instanceof Error ? updateError.message : String(updateError),
      );
    }

    // Re-throw the error so it can be logged by the caller
    throw error;
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
 * Internal action to fetch README from GitHub
 * Fetches README directly from GitHub before repo is uploaded to R2
 */
export const fetchReadmeFromGitHub = internalAction({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    try {
      const submission = await ctx.runQuery(internal.submissions.getSubmissionInternal, {
        submissionId: args.submissionId,
      });

      if (!submission || !submission.repoUrl) {
        console.warn(`[README Fetch] Submission ${args.submissionId} not found or missing repoUrl`);
        return;
      }

      // Parse GitHub URL
      const githubUrl = submission.repoUrl.trim();
      const githubMatch = githubUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
      if (!githubMatch) {
        console.warn(`[README Fetch] Invalid GitHub URL: ${githubUrl}`);
        return;
      }

      const [, owner, repo] = githubMatch;
      const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');

      // Optional GitHub token for higher rate limits / private repos
      const githubToken = process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = { 'User-Agent': 'tanstack-hackathon' };
      if (githubToken) {
        headers.Authorization = `Bearer ${githubToken}`;
      }

      // Try to get default branch first
      let defaultBranch: string | undefined;
      try {
        const repoApiUrl = `https://api.github.com/repos/${owner}/${repoName}`;
        console.log(`[README Fetch] Fetching repo info from: ${repoApiUrl}`);
        console.log(`[README Fetch] Original URL: ${githubUrl}`);
        console.log(`[README Fetch] Parsed owner: ${owner}, repo: ${repoName}`);

        const repoInfoResponse = await fetch(repoApiUrl, {
          headers,
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (repoInfoResponse.ok) {
          const repoInfo: { default_branch?: string } = await repoInfoResponse.json();
          defaultBranch = repoInfo.default_branch;
          console.log(`[README Fetch] Default branch: ${defaultBranch || 'not found'}`);
        } else {
          const errorText = await repoInfoResponse.text();
          console.warn(
            `[README Fetch] Failed to get repo info: ${repoInfoResponse.status} - ${errorText}`,
          );

          // Don't throw here - README fetch is optional, we'll try with fallback branches
          if (repoInfoResponse.status === 404) {
            console.warn(
              `[README Fetch] Repository not found: https://github.com/${owner}/${repoName}`,
            );
          } else if (repoInfoResponse.status === 403) {
            console.warn(
              `[README Fetch] Access denied to repository: https://github.com/${owner}/${repoName}`,
            );
          }
        }
      } catch (error) {
        console.warn(`[README Fetch] Failed to get default branch:`, error);
      }

      // Try common README filenames in order of preference
      const readmeFilenames = ['README.md', 'README.txt', 'README', 'README.markdown'];
      const branchCandidates = Array.from(
        new Set(
          [defaultBranch, 'main', 'master'].filter((branch): branch is string => Boolean(branch)),
        ),
      );
      if (branchCandidates.length === 0) {
        branchCandidates.push('main', 'master');
      }

      let readmeContent: string | null = null;
      let readmeFilename: string | null = null;

      // Try each branch and filename combination
      console.log(
        `[README Fetch] Trying branches: ${branchCandidates.join(', ')}, filenames: ${readmeFilenames.join(', ')}`,
      );
      for (const branch of branchCandidates) {
        for (const filename of readmeFilenames) {
          try {
            // Try GitHub API first (supports private repos with token)
            const apiUrl = `https://api.github.com/repos/${owner}/${repoName}/contents/${filename}?ref=${branch}`;
            console.log(`[README Fetch] Trying API: ${apiUrl}`);
            const apiResponse = await fetch(apiUrl, {
              headers,
              signal: AbortSignal.timeout(10000), // 10 second timeout
            });

            if (apiResponse.ok) {
              const fileData: { content?: string; encoding?: string; name?: string } =
                await apiResponse.json();
              if (fileData.content && fileData.encoding === 'base64') {
                readmeContent = Buffer.from(fileData.content, 'base64').toString('utf-8');
                readmeFilename = fileData.name || filename;
                console.log(
                  `[README Fetch] ✅ Found README via API: ${filename} on branch ${branch}`,
                );
                break;
              } else {
                console.log(
                  `[README Fetch] API response OK but content/encoding missing: encoding=${fileData.encoding}, hasContent=${!!fileData.content}`,
                );
              }
            } else if (apiResponse.status === 404) {
              console.log(`[README Fetch] 404 for ${filename} on branch ${branch}`);
              // File doesn't exist, try next filename
            } else {
              const errorText = await apiResponse.text();
              console.warn(
                `[README Fetch] API error ${apiResponse.status} for ${filename} on ${branch}: ${errorText}`,
              );
            }
          } catch (error) {
            console.warn(`[README Fetch] API error for ${filename} on ${branch}:`, error);
            // Try raw GitHub URL as fallback
            try {
              const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${filename}`;
              console.log(`[README Fetch] Trying raw URL: ${rawUrl}`);
              const rawResponse = await fetch(rawUrl, {
                headers,
                signal: AbortSignal.timeout(10000), // 10 second timeout
              });

              if (rawResponse.ok) {
                readmeContent = await rawResponse.text();
                readmeFilename = filename;
                console.log(
                  `[README Fetch] ✅ Found README via raw URL: ${filename} on branch ${branch}`,
                );
                break;
              } else {
                console.log(
                  `[README Fetch] Raw URL ${rawResponse.status} for ${filename} on branch ${branch}`,
                );
              }
            } catch (rawError) {
              console.warn(`[README Fetch] Raw URL error for ${filename} on ${branch}:`, rawError);
              // Continue to next filename
            }
          }
        }

        if (readmeContent) {
          break; // Found README, stop searching
        }
      }

      if (readmeContent) {
        // Store README in submission
        await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
          submissionId: args.submissionId,
          readme: readmeContent,
          readmeFilename: readmeFilename || 'README.md',
          readmeFetchedAt: Date.now(),
        });

        console.log(
          `[README Fetch] Successfully fetched README (${readmeFilename}) for submission ${args.submissionId}`,
        );
      } else {
        console.log(
          `[README Fetch] No README found for submission ${args.submissionId} (repo: ${owner}/${repoName})`,
        );
      }
    } catch (error) {
      console.error(
        `[README Fetch] Failed to fetch README for submission ${args.submissionId}:`,
        error instanceof Error ? error.message : String(error),
      );
      // Don't throw - README fetch is optional
    }
  },
});

/**
 * Download GitHub repo, extract filtered files, and upload to R2
 * Action with "use node" for git operations
 * Public action for user-initiated calls (requires authentication)
 */
export const downloadAndUploadRepo = guarded.action(
  'submission.write',
  {
    submissionId: v.id('submissions'),
  },
  async (ctx, args, _role) => {
    return await downloadAndUploadRepoHelper(ctx, args);
  },
);

/**
 * Internal action to download and upload repo (for automated processes)
 * Called from processSubmission and other internal actions
 */
export const downloadAndUploadRepoInternal = internalAction({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    return await downloadAndUploadRepoHelper(ctx, args);
  },
});
