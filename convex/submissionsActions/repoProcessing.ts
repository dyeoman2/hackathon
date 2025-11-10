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
import type {
  GetSubmissionInternalRef,
  UpdateSubmissionSourceInternalRef,
} from './types';

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

    // Update submission with R2 path prefix
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        r2Key: r2PathPrefix, // Store path prefix instead of single ZIP key
        uploadedAt: Date.now(),
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

