'use node';

import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { downloadAndUploadRepoHelper } from './repoProcessing';
import type {
  CheckIndexingAndGenerateSummaryRef,
  GetSubmissionInternalRef,
  UpdateSubmissionSourceInternalRef,
} from './types';

/**
 * Internal action to check if files are indexed and generate summary
 * Uses Convex scheduler to poll without blocking - reschedules itself if not ready
 * Also handles download/upload if the repo hasn't been uploaded yet
 */
export const checkIndexingAndGenerateSummary = internalAction({
  args: {
    submissionId: v.id('submissions'),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const maxAttempts = 30; // Maximum 30 attempts
      const pollIntervalMs = 2000; // Check every 2 seconds

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

      // If repo hasn't been uploaded, do it now (same file, can call helper directly)
      if (!submission.source?.r2Key) {
        await downloadAndUploadRepoHelper(ctx, {
          submissionId: args.submissionId,
        });

        // After upload, wait a moment for files to be available, then continue
        // We'll check indexing on the next attempt (or immediately if attempt is 0)
        if (args.attempt === 0) {
          // First attempt after upload, reschedule immediately to check indexing
          await ctx.scheduler.runAfter(
            1000, // Wait 1 second for files to be available
            (
              internal.submissionsActions.aiSummary as unknown as {
                checkIndexingAndGenerateSummary: CheckIndexingAndGenerateSummaryRef;
              }
            ).checkIndexingAndGenerateSummary,
            {
              submissionId: args.submissionId,
              attempt: 0, // Reset attempt counter after upload
            },
          );
          return;
        }
      }

      // At this point, source.r2Key should exist (either was already there or just uploaded)
      // But TypeScript doesn't know that, so we need to check again
      if (!submission.source?.r2Key) {
        throw new Error('Repository files not uploaded to R2');
      }

      // Get AI Search instance ID from env
      const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;

      if (!aiSearchInstanceId || !accountId || !apiToken) {
        throw new Error('Cloudflare AI Search not configured');
      }

      // R2 path prefix for this submission (e.g., "repos/{submissionId}/files/")
      // We've already checked that source.r2Key exists above
      const r2PathPrefix = submission.source.r2Key;

      // Check if files are indexed by trying a test query
      let indexed = false;
      try {
        // Correct endpoint format: /autorag/rags/{instance_name}/ai-search
        const testQueryUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/ai-search`;

        // Note: Cloudflare AI Search API doesn't support filters parameter
        // We'll filter results client-side by checking the path attribute
        const testResponse = await fetch(testQueryUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: `files in ${r2PathPrefix}`,
            max_num_results: 10, // Get more results to account for client-side filtering
          }),
        });

        if (!testResponse.ok) {
          const errorText = await testResponse.text();
          console.error(`[AI Search] Test query failed: ${testResponse.status} - ${errorText}`);

          // If it's a routing error, this is a configuration issue, not an indexing issue
          if (
            testResponse.status === 400 &&
            (errorText.includes('Could not route') || errorText.includes('No route for that URI'))
          ) {
            console.error(
              `[AI Search] CRITICAL: API routing error - instance "${aiSearchInstanceId}" not found or endpoint incorrect`,
            );
            // Don't reschedule - this is a configuration error that won't fix itself
            throw new Error(
              `AI Search instance routing error: The instance "${aiSearchInstanceId}" may not exist or the API endpoint is incorrect. Check CLOUDFLARE_AI_SEARCH_INSTANCE_ID. Error: ${errorText}`,
            );
          }

          // For other errors, assume indexing might not be ready yet
          return; // Will reschedule below
        }

        const testData = await testResponse.json();
        const testDocs = testData.data || testData.result?.data || [];

        // Check if any returned documents actually match the path prefix
        const matchingDocs = testDocs.filter(
          (doc: { filename?: string; attributes?: { path?: string } }) => {
            const docPath = doc.attributes?.path || doc.filename || '';
            return docPath.startsWith(r2PathPrefix);
          },
        );

        if (matchingDocs.length > 0 || testDocs.length === 0) {
          // Either we have matching docs, or no docs returned (which could mean not indexed yet)
          // If we have docs but none match, that's a problem but we'll proceed anyway
          indexed = true;
        } else {
          console.warn(
            `[AI Search] Test query returned ${testDocs.length} documents but none match path prefix ${r2PathPrefix}`,
          );
          console.warn(
            `  Sample paths:`,
            testDocs
              .slice(0, 3)
              .map(
                (d: { filename?: string; attributes?: { path?: string } }) =>
                  d.attributes?.path || d.filename || 'Unknown',
              ),
          );
          // Still mark as indexed so we can proceed and see what happens
          indexed = true;
        }
      } catch (error) {
        // If query fails with routing error, throw it (don't retry)
        if (error instanceof Error && error.message.includes('routing error')) {
          throw error;
        }

        // For other errors, indexing might not be ready yet
        // Silently continue - will retry on next attempt
      }

      if (!indexed) {
        // If not indexed and we haven't exceeded max attempts, reschedule
        if (args.attempt < maxAttempts) {
          await ctx.scheduler.runAfter(
            pollIntervalMs,
            (
              internal.submissionsActions.aiSummary as unknown as {
                checkIndexingAndGenerateSummary: CheckIndexingAndGenerateSummaryRef;
              }
            ).checkIndexingAndGenerateSummary,
            {
              submissionId: args.submissionId,
              attempt: args.attempt + 1,
            },
          );
          return; // Exit early, will be called again by scheduler
        } else {
          // Max attempts reached - log warning but proceed anyway
          console.warn(
            `Indexing status unclear for submission ${args.submissionId} after ${maxAttempts} attempts. Proceeding with summary generation.`,
          );
        }
      }

      // Files are indexed (or we've given up waiting) - proceed with summary generation
      const summary = await generateSummaryOnceReady(
        ctx,
        args.submissionId,
        r2PathPrefix,
        aiSearchInstanceId,
        accountId,
        apiToken,
        submission.title,
      );

      // Update submission with summary
      await ctx.runMutation(
        (
          internal.submissions as unknown as {
            updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
          }
        ).updateSubmissionSourceInternal,
        {
          submissionId: args.submissionId,
          aiSummary: summary,
          summarizedAt: Date.now(),
        },
      );
    } catch (error) {
      // Log error details
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[AI Search] Error generating summary for submission ${args.submissionId}:`,
        errorMessage,
      );

      // Re-throw so Convex logs it properly
      throw error;
    }
  },
});

/**
 * Generate repository summary using Cloudflare AI Search (direct R2 indexing)
 * Files are already uploaded to R2 and indexed by AI Search automatically.
 * Uses the /ai-search endpoint which automatically generates AI-powered summaries
 * using LLM models (e.g., Llama 3.3) based on the indexed repository files.
 * This is called by checkIndexingAndGenerateSummary once indexing is confirmed ready.
 */
async function generateSummaryOnceReady(
  ctx: ActionCtx,
  _submissionId: Id<'submissions'>,
  r2PathPrefix: string,
  aiSearchInstanceId: string,
  accountId: string,
  apiToken: string,
  submissionTitle: string,
): Promise<string> {
  // Correct endpoint format: /autorag/rags/{instance_name}/ai-search
  const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/ai-search`;

  const configurationSummary = (details: string) =>
    `# Repository Summary: ${submissionTitle}\n\nAI Search configuration issue detected. ${details}\n\nVerify the following:\n- Cloudflare Account ID (${accountId}) is correct\n- AI Search instance name (${aiSearchInstanceId}) exists and is deployed\n- The API token has **AI Search > Edit** permissions\n- The instance is in the same account as the credentials.\n`;

  // Get submission details to include in query for better context
  const submission = await ctx.runQuery(
    (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
      .getSubmissionInternal,
    {
      submissionId: _submissionId,
    },
  );

  const repoUrl = submission?.repoUrl || 'unknown repository';
  const repoName = repoUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i)?.[2] || 'unknown';

  // Include the path prefix and repo URL in the query to ensure AI focuses on this specific submission's files
  // The path prefix format is: repos/{submissionId}/files/
  const summaryQuery = `Provide a comprehensive summary of the GitHub repository "${repoName}" (${repoUrl}). 

CRITICAL: Only analyze files that are stored in the R2 path "${r2PathPrefix}". This submission's files are located at this exact path prefix. Do NOT analyze any other files or repositories, even if they appear in the search results.

Focus on:
1. What the project does
2. Key technologies and frameworks used
3. Main features and functionality
4. Project structure overview
5. Notable patterns or architectural decisions

IMPORTANT: If you see files from other repositories (like "tanstack-start-template" or any other repo), ignore them completely. Only analyze files from the path "${r2PathPrefix}".

Keep it concise but informative (500-1000 words).`;

  // Query the AI Search endpoint to generate summary
  // Note: Cloudflare AI Search API doesn't support filters parameter
  // We'll filter results client-side by checking the path attribute
  let queryResponse: Response;
  try {
    queryResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: summaryQuery,
        model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // Optional: specify model for generation
        max_num_results: 50, // Get more documents to account for client-side filtering
        rewrite_query: false, // Don't rewrite query
        // No filters - Cloudflare API doesn't support them, we filter client-side
      }),
    });
  } catch (error) {
    console.error(`[AI Search] Query failed with error:`, error);
    throw new Error(
      `Failed to query AI Search: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }

  if (!queryResponse.ok) {
    const errorText = await queryResponse.text();

    if (
      queryResponse.status === 400 &&
      (errorText.includes('Could not route') || errorText.includes('No route for that URI'))
    ) {
      const detailedError = `[AI Search] API Routing Error (400):
      Endpoint: ${queryUrl}
      Instance ID: ${aiSearchInstanceId}
      Account ID: ${accountId}
      Error: ${errorText}
      
      This typically means:
      1. The AI Search instance name "${aiSearchInstanceId}" is incorrect
      2. The instance doesn't exist in this account
      3. The API endpoint format has changed
      
      Verify in Cloudflare Dashboard:
      - Go to AI > Search
      - Check the exact instance name
      - Ensure it matches CLOUDFLARE_AI_SEARCH_INSTANCE_ID exactly`;

      console.error(detailedError);
      return configurationSummary(
        `Cloudflare returned "Could not route" error (400). The AI Search instance name "${aiSearchInstanceId}" may be incorrect. Check your CLOUDFLARE_AI_SEARCH_INSTANCE_ID environment variable matches the instance name exactly. Error details: ${errorText}`,
      );
    }

    // If filtering by path isn't supported, try without filter
    if (queryResponse.status === 400) {
      // Retry without filter - we'll filter results manually if needed
      const retryResponse = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: summaryQuery,
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          max_num_results: 50, // Get more to account for filtering
          rewrite_query: false,
        }),
      });

      if (!retryResponse.ok) {
        const retryErrorText = await retryResponse.text();

        if (
          retryResponse.status === 400 &&
          (retryErrorText.includes('Could not route') ||
            retryErrorText.includes('No route for that URI'))
        ) {
          return configurationSummary(
            'Cloudflare returned "No route" for the AI Search endpoint when retrying without filters. Double-check the instance slug and account ID.',
          );
        }

        throw new Error(`AI Search query error: ${retryResponse.statusText} - ${retryErrorText}`);
      }

      const retryData = await retryResponse.json();
      // The /ai-search endpoint returns a 'response' field with the generated summary
      const generatedSummary = retryData.response || retryData.result?.response;
      const documents = retryData.data || retryData.result?.data || [];

      // Filter documents by path prefix
      const relevantDocs = documents.filter(
        (doc: { filename?: string; attributes?: { path?: string } }) => {
          const docPath = doc.attributes?.path || doc.filename || '';
          return docPath.startsWith(r2PathPrefix);
        },
      );

      // CRITICAL: If no documents match after retry, the summary is based on WRONG files
      // DO NOT return the summary - it's analyzing the wrong repository
      if (documents.length > 0 && relevantDocs.length === 0) {
        const errorMsg = `[AI Search] CRITICAL: Retry succeeded but NO documents match path prefix!
        Path prefix: ${r2PathPrefix}
        Total documents: ${documents.length}
        Matching documents: 0
        Sample paths: ${documents
          .slice(0, 10)
          .map(
            (d: { filename?: string; attributes?: { path?: string } }) =>
              d.attributes?.path || d.filename || 'Unknown',
          )
          .join(', ')}`;

        console.error(errorMsg);
        console.error('[AI Search] REJECTING summary - it is based on wrong files');

        // Return error - DO NOT use the generatedSummary
        return `# Repository Summary: ${submissionTitle}\n\n❌ **Error**: Unable to generate accurate summary.\n\n**Problem**: Path filtering is not working. The query returned ${documents.length} documents, but **NONE** match the expected path prefix for this submission.\n\n**Expected path prefix**: \`${r2PathPrefix}\`\n**Repository URL**: ${repoUrl}\n\n**Sample paths returned** (from other repositories):\n${documents
          .slice(0, 10)
          .map(
            (d: { filename?: string; attributes?: { path?: string } }, idx: number) =>
              `${idx + 1}. ${d.attributes?.path || d.filename || 'Unknown'}`,
          )
          .join(
            '\n',
          )}\n\n**This means**: The AI summary is being generated from files in OTHER repositories, not from this submission.\n\n**Solution**: Cloudflare AI Search path filtering is not working correctly. Check Convex logs for details.`;
      }

      const summary = generatedSummary
        ? `# Repository Summary: ${submissionTitle}\n\n${generatedSummary}`
        : `Repository summary for ${submissionTitle}. Analyzed ${relevantDocs.length} files.`;

      return summary;
    } else {
      throw new Error(`AI Search query error: ${queryResponse.statusText} - ${errorText}`);
    }
  }

  const queryData = await queryResponse.json();

  // The /ai-search endpoint returns a 'response' field with the AI-generated summary
  // Format: { response: "generated summary", data: [...documents], search_query: "..." }
  const generatedSummary = queryData.response || queryData.result?.response;
  const documents = queryData.data || queryData.result?.data || [];

  // CRITICAL: Validate documents FIRST before using the AI-generated summary
  // The AI summary is generated based on ALL documents returned, so if filtering failed,
  // the summary will be about the wrong repository
  const relevantDocs = documents.filter(
    (doc: { filename?: string; attributes?: { path?: string }; path?: string }) => {
      // Try multiple possible path locations
      const docPath = doc.attributes?.path || doc.path || doc.filename || '';

      // Check if path starts with our prefix (full R2 key)
      if (docPath.startsWith(r2PathPrefix)) {
        return true;
      }

      return false;
    },
  );

  // CRITICAL CHECK: If we have documents but NONE match the path prefix,
  // the AI-generated summary is based on WRONG files - DO NOT USE IT
  if (documents.length > 0 && relevantDocs.length === 0) {
    const errorMessage = `[AI Search] CRITICAL ERROR: Path filtering failed!
    Expected prefix: ${r2PathPrefix}
    Got ${documents.length} documents, but NONE match the prefix.
    This means the AI summary is analyzing the WRONG repository.
    Sample paths: ${documents
      .slice(0, 10)
      .map(
        (d: { filename?: string; attributes?: { path?: string }; path?: string }) =>
          d.attributes?.path || d.path || d.filename || 'Unknown',
      )
      .join(', ')}`;

    console.error(errorMessage);
    console.error('[AI Search] REJECTING AI-generated summary - it is based on wrong files');

    // Return an error - DO NOT use the generatedSummary
    return `# Repository Summary: ${submissionTitle}\n\n❌ **Error**: Unable to generate accurate summary.\n\n**Problem**: Cloudflare AI Search path filtering is not working. The system retrieved ${documents.length} documents, but **NONE** match the expected path prefix for this submission.\n\n**Expected path prefix**: \`${r2PathPrefix}\`\n**Repository URL**: ${repoUrl}\n\n**Sample paths returned** (these are from OTHER repositories, not this submission):\n${documents
      .slice(0, 10)
      .map(
        (d: { filename?: string; attributes?: { path?: string }; path?: string }, idx: number) =>
          `${idx + 1}. ${d.attributes?.path || d.path || d.filename || 'Unknown'}`,
      )
      .join(
        '\n',
      )}\n\n**This means**: The AI summary you might have seen was generated from files in OTHER repositories (possibly the hackathon app itself), not from the submission repository.\n\n**Next Steps**:\n1. Check Convex logs for detailed debugging information\n2. Verify Cloudflare AI Search path filtering is working\n3. Check if files are indexed with correct path prefixes\n4. Consider using the diagnostic function: \`diagnoseAISearchPaths\``;
  }

  // If we have NO documents at all, files might not be indexed yet
  if (documents.length === 0) {
    return `# Repository Summary: ${submissionTitle}\n\nFiles are still being indexed by Cloudflare AI Search. Please try again in a few moments.`;
  }

  const summary = generatedSummary
    ? `# Repository Summary: ${submissionTitle}\n\n${generatedSummary}`
    : `# Repository Summary: ${submissionTitle}\n\n` +
      `Analyzed ${relevantDocs.length} files from this repository. ` +
      `Key files: ${relevantDocs
        .slice(0, 5)
        .map((d: { filename?: string; attributes?: { path?: string }; path?: string }) => {
          const path = d.attributes?.path || d.path || d.filename || 'Unknown';
          // Remove the path prefix for cleaner display
          return path.startsWith(r2PathPrefix) ? path.slice(r2PathPrefix.length) : path;
        })
        .join(', ')}.`;

  return summary;
}

/**
 * Diagnostic action to check what paths AI Search is returning for a submission
 * This helps debug path filtering issues
 */
export const diagnoseAISearchPaths = internalAction({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (
    ctx: ActionCtx,
    args: { submissionId: Id<'submissions'> },
  ): Promise<{
    error?: string;
    r2PathPrefix: string | null;
    repoUrl?: string;
    totalDocumentsReturned?: number;
    matchingDocuments?: number;
    samplePaths?: Array<{
      filename?: string;
      attributesPath?: string;
      path?: string;
      fullDoc: unknown;
    }>;
    allPaths?: string[];
    pathFilteringWorking?: boolean;
  }> => {
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

    if (!submission.source?.r2Key) {
      return {
        error: 'No R2 files uploaded for this submission',
        r2PathPrefix: null,
      };
    }

    const r2PathPrefix: string = submission.source.r2Key;
    const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;

    if (!aiSearchInstanceId || !accountId || !apiToken) {
      throw new Error('Cloudflare AI Search not configured');
    }

    // Correct endpoint format: /autorag/rags/{instance_name}/ai-search
    const queryUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/ai-search`;

    // Make a test query to see what paths are returned
    const testResponse: Response = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `files in ${r2PathPrefix}`,
        max_num_results: 10,
        filters: {
          path: {
            prefix: r2PathPrefix,
          },
        },
      }),
    });

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      return {
        error: `Query failed: ${testResponse.status} - ${errorText}`,
        r2PathPrefix,
      };
    }

    const data = (await testResponse.json()) as {
      data?: Array<{
        filename?: string;
        attributes?: { path?: string };
        path?: string;
      }>;
      result?: {
        data?: Array<{
          filename?: string;
          attributes?: { path?: string };
          path?: string;
        }>;
      };
    };
    const documents: Array<{
      filename?: string;
      attributes?: { path?: string };
      path?: string;
    }> = (data.data || data.result?.data || []) as Array<{
      filename?: string;
      attributes?: { path?: string };
      path?: string;
    }>;

    // Extract all paths from documents
    type DocPath = {
      filename?: string;
      attributesPath?: string;
      path?: string;
      fullDoc: unknown;
    };
    const paths: DocPath[] = documents.map(
      (doc: { filename?: string; attributes?: { path?: string }; path?: string }) => {
        return {
          filename: doc.filename,
          attributesPath: doc.attributes?.path,
          path: doc.path,
          fullDoc: doc,
        };
      },
    );

    // Check how many match the prefix
    const matchingPaths = paths.filter((p: DocPath) => {
      const docPath = p.attributesPath || p.path || p.filename || '';
      return docPath.startsWith(r2PathPrefix);
    });

    return {
      r2PathPrefix,
      repoUrl: submission.repoUrl,
      totalDocumentsReturned: documents.length,
      matchingDocuments: matchingPaths.length,
      samplePaths: paths.slice(0, 10),
      allPaths: paths.map((p: DocPath) => p.attributesPath || p.path || p.filename || 'Unknown'),
      pathFilteringWorking: matchingPaths.length > 0 || documents.length === 0,
    };
  },
});

/**
 * Helper function to generate repo summary (download/upload if needed, then schedule indexing check)
 * Extracted so it can be called from both generateRepoSummary and processSubmission
 */
async function generateRepoSummaryHelper(
  ctx: ActionCtx,
  args: { submissionId: Id<'submissions'> },
): Promise<{ scheduled: boolean }> {
  // Check if repo has been uploaded
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

  // If repo hasn't been uploaded, do it now using the helper function
  if (!submission.source?.r2Key) {
    await downloadAndUploadRepoHelper(ctx, {
      submissionId: args.submissionId,
    });
  }

  // Schedule the internal action to check indexing and generate summary
  await ctx.scheduler.runAfter(
    0,
    (
      internal.submissionsActions.aiSummary as unknown as {
        checkIndexingAndGenerateSummary: CheckIndexingAndGenerateSummaryRef;
      }
    ).checkIndexingAndGenerateSummary,
    {
      submissionId: args.submissionId,
      attempt: 0,
    },
  );

  return { scheduled: true };
}

/**
 * Public action wrapper for generating repository summary
 * Handles download/upload if needed, then schedules the internal polling action to check indexing status
 * This combines download/upload and summary scheduling in one action to avoid cross-action calls
 */
export const generateRepoSummary = action({
  args: {
    submissionId: v.id('submissions'),
    forceRegenerate: v.optional(v.boolean()), // If true, regenerate even if summary exists
  },
  handler: async (ctx, args) => {
    // If forceRegenerate is true, clear the existing summary first
    if (args.forceRegenerate) {
      const submission = await ctx.runQuery(
        (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
          .getSubmissionInternal,
        {
          submissionId: args.submissionId,
        },
      );

      if (submission) {
        // Clear the existing summary
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
            }
          ).updateSubmissionSourceInternal,
          {
            submissionId: args.submissionId,
            aiSummary: undefined, // Clear the summary
            summarizedAt: undefined,
          },
        );
      }
    }

    return await generateRepoSummaryHelper(ctx, { submissionId: args.submissionId });
  },
});
