'use node';

import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';
import { action, internalAction } from '../_generated/server';
import { checkAISearchJobStatus, downloadAndUploadRepoHelper } from './repoProcessing';
import type {
  CheckIndexingAndGenerateSummaryRef,
  GenerateSubmissionReviewInternalRef,
  GetHackathonInternalRef,
  GetSubmissionInternalRef,
  UpdateSubmissionAIInternalRef,
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
    forceRegenerate: v.optional(v.boolean()), // If true, regenerate even if summary exists
  },
  handler: async (ctx, args) => {
    try {
      const maxAttempts = 60; // Maximum 60 attempts (2 minutes total)
      // Exponential backoff: start with 3 seconds, increase gradually
      const pollIntervalMs = Math.min(3000 + args.attempt * 500, 10000); // 3s to 10s max

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

      // Early exit: If summary and score already exist and we're not forcing regeneration, we're done
      // Check if processing is already complete to avoid unnecessary retries
      // This prevents the function from continuing to retry after completion
      // BUT: If forceRegenerate is true, always regenerate regardless of existing summary
      const hasSummary = !!submission.source?.aiSummary;
      const hasScore = submission.ai?.score !== undefined;
      const isComplete = submission.source?.processingState === 'complete';

      if (hasSummary && hasScore && isComplete && !args.forceRegenerate) {
        console.log(
          `[AI Search] Submission ${args.submissionId} already has summary and score - skipping (attempt ${args.attempt})`,
        );
        return; // Already complete, don't reschedule (unless forcing regeneration)
      }

      // If forcing regeneration, clear existing summary and score first
      if (args.forceRegenerate && (hasSummary || hasScore)) {
        console.log(
          `[AI Search] Force regenerating summary for submission ${args.submissionId} - clearing existing summary and score`,
        );
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
            }
          ).updateSubmissionSourceInternal,
          {
            submissionId: args.submissionId,
            aiSummary: undefined,
            summarizedAt: undefined,
            summaryGenerationStartedAt: undefined,
            summaryGenerationCompletedAt: undefined,
            processingState: 'indexing', // Reset to indexing state
          },
        );
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionAIInternal: UpdateSubmissionAIInternalRef;
            }
          ).updateSubmissionAIInternal,
          {
            submissionId: args.submissionId,
            summary: undefined,
            score: undefined,
            scoreGenerationStartedAt: undefined,
            scoreGenerationCompletedAt: undefined,
          },
        );
      }

      // Also check if we have summary but are still in generating state
      // This can happen if score generation failed but summary succeeded
      // In this case, we should still try to generate the score, but not re-generate the summary
      if (hasSummary && !hasScore && isComplete) {
        console.log(
          `[AI Search] Submission ${args.submissionId} has summary but no score - will attempt score generation`,
        );
        // Continue to score generation section below
      } else if (hasSummary && hasScore && !isComplete) {
        // Summary and score exist but state isn't marked complete - fix the state
        console.log(
          `[AI Search] Submission ${args.submissionId} has summary and score but state not complete - fixing state`,
        );
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
            }
          ).updateSubmissionSourceInternal,
          {
            submissionId: args.submissionId,
            processingState: 'complete',
          },
        );
        return; // State fixed, we're done
      } else if (hasSummary && !hasScore && !isComplete) {
        // Has summary but no score and not complete - continue to generate score
        console.log(
          `[AI Search] Submission ${args.submissionId} has summary but no score - will generate score`,
        );
        // Continue to score generation section below
      }

      // If repo hasn't been uploaded, do it now (same file, can call helper directly)
      if (!submission.source?.r2Key) {
        await downloadAndUploadRepoHelper(ctx, {
          submissionId: args.submissionId,
        });

        // After upload, wait longer for files to be indexed by Cloudflare AI Search
        // AI Search indexing can take 10-30 seconds after R2 upload
        if (args.attempt === 0) {
          // First attempt after upload, wait longer before checking indexing
          await ctx.scheduler.runAfter(
            15000, // Wait 15 seconds for files to be indexed
            (
              internal.submissionsActions.aiSummary as unknown as {
                checkIndexingAndGenerateSummary: CheckIndexingAndGenerateSummaryRef;
              }
            ).checkIndexingAndGenerateSummary,
            {
              submissionId: args.submissionId,
              attempt: 1, // Start at attempt 1 after initial wait
              forceRegenerate: args.forceRegenerate ?? false,
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
      const uploadedAt = submission.source?.uploadedAt || 0;
      const timeSinceUpload = Date.now() - uploadedAt;

      // Log timing information for debugging
      console.log(
        `[AI Search] Checking indexing for submission ${args.submissionId}, attempt ${args.attempt}/${maxAttempts}`,
      );
      console.log(
        `[AI Search] Files uploaded ${Math.round(timeSinceUpload / 1000)}s ago, path prefix: ${r2PathPrefix}`,
      );

      // If files were just uploaded (less than 20 seconds ago), wait longer
      // Cloudflare AI Search indexing can take 20-60 seconds after R2 upload
      if (timeSinceUpload > 0 && timeSinceUpload < 20000 && args.attempt < 5) {
        console.log(
          `[AI Search] Files uploaded recently (${Math.round(timeSinceUpload / 1000)}s ago), waiting longer before checking indexing...`,
        );
        await ctx.scheduler.runAfter(
          Math.max(20000 - timeSinceUpload, 5000), // Wait until at least 20s have passed
          (
            internal.submissionsActions.aiSummary as unknown as {
              checkIndexingAndGenerateSummary: CheckIndexingAndGenerateSummaryRef;
            }
          ).checkIndexingAndGenerateSummary,
          {
            submissionId: args.submissionId,
            attempt: args.attempt + 1,
            forceRegenerate: args.forceRegenerate ?? false,
          },
        );
        return;
      }

      // Set processing state to indexing if not already set
      if (submission.source?.processingState !== 'indexing') {
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
            }
          ).updateSubmissionSourceInternal,
          {
            submissionId: args.submissionId,
            processingState: 'indexing',
          },
        );
      }

      // Check if files are indexed by checking job status first, then falling back to querying documents
      let indexed = false;

      // First, try to check job status if we have a job_id
      if (submission.source?.aiSearchSyncJobId) {
        const jobStatus = await checkAISearchJobStatus(ctx, submission.source.aiSearchSyncJobId);
        console.log(
          `[AI Search] Job ${submission.source.aiSearchSyncJobId} status: ${jobStatus || 'unknown'}`,
        );

        if (jobStatus === 'completed') {
          console.log(`[AI Search] Sync job completed - files should be indexed`);
          indexed = true;
          // Record sync completion time
          await ctx.runMutation(
            (
              internal.submissions as unknown as {
                updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
              }
            ).updateSubmissionSourceInternal,
            {
              submissionId: args.submissionId,
              aiSearchSyncCompletedAt: Date.now(),
            },
          );
        } else if (jobStatus === 'failed') {
          console.warn(`[AI Search] Sync job failed - will try querying documents as fallback`);
          // Continue to document query fallback below
        } else if (jobStatus === 'running' || jobStatus === 'pending') {
          console.log(
            `[AI Search] Sync job still ${jobStatus} - waiting for completion (attempt ${args.attempt})`,
          );
          // Job is still running, don't mark as indexed yet
          indexed = false;
        } else {
          // Job not found or status unknown - fall back to document query
          console.log(
            `[AI Search] Job status unknown or not found - falling back to document query`,
          );
        }
      }

      // If job status check didn't confirm indexing, fall back to querying documents
      // This handles cases where:
      // - No job_id was stored (older submissions)
      // - Job status check failed
      // - Job completed but we want to verify documents are actually indexed
      if (!indexed) {
        // If enough time has passed since upload (5+ minutes), assume indexing is complete
        // This handles cases where AI Search is indexed but our query detection isn't working
        const MIN_TIME_FOR_INDEXING = 5 * 60 * 1000; // 5 minutes
        if (timeSinceUpload > MIN_TIME_FOR_INDEXING && args.attempt >= 10) {
          console.log(
            `[AI Search] Files uploaded ${Math.round(timeSinceUpload / 1000)}s ago (${Math.round(timeSinceUpload / 60000)} minutes). Assuming indexing is complete and proceeding.`,
          );
          indexed = true;
        } else {
          try {
            // Correct endpoint format: /autorag/rags/{instance_name}/ai-search
            const testQueryUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/autorag/rags/${aiSearchInstanceId}/ai-search`;

            // First, try a query WITHOUT filters to see what paths are actually stored
            // This helps diagnose if the filter format is wrong or paths are stored differently
            const testResponseWithoutFilter = await fetch(testQueryUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: `files in ${r2PathPrefix}`,
                max_num_results: 100, // Get more results to check paths
              }),
            });

            if (testResponseWithoutFilter.ok) {
              const testDataNoFilter = await testResponseWithoutFilter.json();
              const testDocsNoFilter = testDataNoFilter.data || testDataNoFilter.result?.data || [];

              // Log sample paths for debugging
              if (testDocsNoFilter.length > 0) {
                const samplePaths = testDocsNoFilter
                  .slice(0, 10)
                  .map(
                    (d: { filename?: string; attributes?: { path?: string }; path?: string }) => {
                      return {
                        path: d.attributes?.path || d.path || d.filename || 'Unknown',
                        fullDoc: d,
                      };
                    },
                  );
                console.log(
                  `[AI Search] Sample paths from unfiltered query (${testDocsNoFilter.length} total docs):`,
                  samplePaths.map((p: { path: string }) => p.path),
                );
              }

              // Check if any documents match our path prefix
              const matchingDocsNoFilter = testDocsNoFilter.filter(
                (doc: { filename?: string; attributes?: { path?: string }; path?: string }) => {
                  const docPath = doc.attributes?.path || doc.path || doc.filename || '';
                  return docPath.startsWith(r2PathPrefix);
                },
              );

              if (matchingDocsNoFilter.length > 0) {
                console.log(
                  `[AI Search] Found ${matchingDocsNoFilter.length} matching documents (out of ${testDocsNoFilter.length} total) for path prefix ${r2PathPrefix}`,
                );
                indexed = true;
              } else if (testDocsNoFilter.length > 0) {
                // Documents exist but none match - log for debugging
                console.warn(
                  `[AI Search] Query returned ${testDocsNoFilter.length} documents but none match path prefix ${r2PathPrefix}`,
                );
                console.warn(
                  `  Sample paths:`,
                  testDocsNoFilter
                    .slice(0, 5)
                    .map(
                      (d: { filename?: string; attributes?: { path?: string }; path?: string }) =>
                        d.attributes?.path || d.path || d.filename || 'Unknown',
                    ),
                );

                // If enough time has passed, proceed anyway (files might be indexed but path format differs)
                if (timeSinceUpload > 3 * 60 * 1000) {
                  // 3 minutes
                  console.log(
                    `[AI Search] Files uploaded ${Math.round(timeSinceUpload / 1000)}s ago. Proceeding despite path mismatch - files may be indexed with different path format.`,
                  );
                  indexed = true;
                }
              }
            }

            // Also try with filters (in case they work)
            if (!indexed) {
              const testResponse = await fetch(testQueryUrl, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  query: `files in path ${r2PathPrefix} submission ${args.submissionId}`,
                  max_num_results: 50,
                  filters: {
                    key: 'path',
                    type: 'gte',
                    value: r2PathPrefix,
                  },
                }),
              });

              if (testResponse.ok) {
                const testData = await testResponse.json();
                const testDocs = testData.data || testData.result?.data || [];
                const matchingDocs = testDocs.filter(
                  (doc: { filename?: string; attributes?: { path?: string }; path?: string }) => {
                    const docPath = doc.attributes?.path || doc.path || doc.filename || '';
                    return docPath.startsWith(r2PathPrefix);
                  },
                );

                if (matchingDocs.length > 0) {
                  indexed = true;
                }
              } else {
                const errorText = await testResponse.text();
                console.error(
                  `[AI Search] Filtered query failed: ${testResponse.status} - ${errorText}`,
                );

                // If it's a routing error, this is a configuration issue
                if (
                  testResponse.status === 400 &&
                  (errorText.includes('Could not route') ||
                    errorText.includes('No route for that URI'))
                ) {
                  console.error(
                    `[AI Search] CRITICAL: API routing error - instance "${aiSearchInstanceId}" not found or endpoint incorrect`,
                  );
                  throw new Error(
                    `AI Search instance routing error: The instance "${aiSearchInstanceId}" may not exist or the API endpoint is incorrect. Check CLOUDFLARE_AI_SEARCH_INSTANCE_ID. Error: ${errorText}`,
                  );
                }
              }
            }
          } catch (error) {
            // If query fails with routing error, throw it (don't retry)
            if (error instanceof Error && error.message.includes('routing error')) {
              throw error;
            }

            // For other errors, log but continue
            console.warn(
              `[AI Search] Query error (attempt ${args.attempt}):`,
              error instanceof Error ? error.message : String(error),
            );
          }
        }
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
              forceRegenerate: args.forceRegenerate ?? false,
            },
          );
          return; // Exit early, will be called again by scheduler
        } else {
          // Max attempts reached - log warning but proceed anyway
          console.warn(
            `Indexing status unclear for submission ${args.submissionId} after ${maxAttempts} attempts. Proceeding with summary generation.`,
          );
          // Mark sync as completed even though we're not sure - at least we tried
          await ctx.runMutation(
            (
              internal.submissions as unknown as {
                updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
              }
            ).updateSubmissionSourceInternal,
            {
              submissionId: args.submissionId,
              aiSearchSyncCompletedAt: Date.now(),
            },
          );
        }
      } else {
        // Files are indexed - record sync completion time
        await ctx.runMutation(
          (
            internal.submissions as unknown as {
              updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
            }
          ).updateSubmissionSourceInternal,
          {
            submissionId: args.submissionId,
            aiSearchSyncCompletedAt: Date.now(),
          },
        );
      }

      // Files are indexed (or we've given up waiting) - proceed with summary generation
      // Generate AI Search summary (will replace early summary if one exists)
      // The AI Search summary is more comprehensive as it analyzes all repository files
      let summary: string;
      const hasEarlySummary = hasSummary && submission.source?.aiSummary;

      if (hasEarlySummary) {
        console.log(
          `[AI Search] Submission ${args.submissionId} has early summary - generating comprehensive AI Search summary to replace it`,
        );
      }

      // Set processing state to generating and record summary generation start time
      const summaryGenerationStartedAt = Date.now();
      await ctx.runMutation(
        (
          internal.submissions as unknown as {
            updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
          }
        ).updateSubmissionSourceInternal,
        {
          submissionId: args.submissionId,
          processingState: 'generating',
          summaryGenerationStartedAt,
        },
      );

      summary = await generateSummaryOnceReady(
        ctx,
        args.submissionId,
        r2PathPrefix,
        aiSearchInstanceId,
        accountId,
        apiToken,
        submission.title,
      );

      // Update submission with summary and record completion time
      const summaryGenerationCompletedAt = Date.now();
      await ctx.runMutation(
        (
          internal.submissions as unknown as {
            updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
          }
        ).updateSubmissionSourceInternal,
        {
          submissionId: args.submissionId,
          aiSummary: summary,
          summarizedAt: summaryGenerationCompletedAt,
          summaryGenerationCompletedAt,
          processingState: 'generating', // Keep as generating while we generate the review
        },
      );

      // Automatically generate AI review (score) after summary is complete
      // Only generate score if it doesn't already exist
      if (!hasScore) {
        try {
          // Get hackathon to get rubric
          const hackathon = await ctx.runQuery(
            (internal.hackathons as unknown as { getHackathonInternal: GetHackathonInternalRef })
              .getHackathonInternal,
            {
              hackathonId: submission.hackathonId,
            },
          );

          if (hackathon) {
            // Automatically generate AI review (score) after summary is complete
            // Call the review generation action - it will handle AI reservation
            // Note: This requires auth, but for automated processes we'll handle errors gracefully
            const scoreGenerationStartedAt = Date.now();
            try {
              // Record score generation start time
              await ctx.runMutation(
                (
                  internal.submissions as unknown as {
                    updateSubmissionAIInternal: UpdateSubmissionAIInternalRef;
                  }
                ).updateSubmissionAIInternal,
                {
                  submissionId: args.submissionId,
                  scoreGenerationStartedAt,
                },
              );

              const reviewResult = await ctx.runAction(
                (
                  internal.cloudflareAi as unknown as {
                    generateSubmissionReviewInternal: GenerateSubmissionReviewInternalRef;
                  }
                ).generateSubmissionReviewInternal,
                {
                  submissionId: args.submissionId,
                  submissionTitle: submission.title,
                  team: submission.team,
                  repoUrl: submission.repoUrl,
                  siteUrl: submission.siteUrl ?? undefined,
                  repoSummary: summary,
                  rubric: hackathon.rubric ?? 'No rubric provided',
                },
              );

              // Update submission with review results and record completion time
              const scoreGenerationCompletedAt = Date.now();
              await ctx.runMutation(
                (
                  internal.submissions as unknown as {
                    updateSubmissionAIInternal: UpdateSubmissionAIInternalRef;
                  }
                ).updateSubmissionAIInternal,
                {
                  submissionId: args.submissionId,
                  summary: reviewResult.summary,
                  score: reviewResult.score ?? undefined,
                  scoreGenerationCompletedAt,
                },
              );
            } catch (reviewError) {
              // If review generation fails (e.g., auth issues), log but don't fail the whole process
              // The review can be generated manually later via the UI
              console.warn(
                `[AI Review] Could not auto-generate review for submission ${args.submissionId}. Error:`,
                reviewError instanceof Error ? reviewError.message : String(reviewError),
              );
            }
          } else {
            console.log(
              `[AI Review] Hackathon not found for submission ${args.submissionId} - skipping score generation`,
            );
          }
        } catch (reviewError) {
          // Log error but don't fail the whole process
          // The review can be generated manually later via the UI
          console.warn(
            `[AI Review] Error getting hackathon or generating review for submission ${args.submissionId}:`,
            reviewError instanceof Error ? reviewError.message : String(reviewError),
          );
          // Continue to mark as complete even if review generation failed
        }
      } else {
        console.log(
          `[AI Review] Submission ${args.submissionId} already has score - skipping generation`,
        );
      }

      // Set processing state to complete
      await ctx.runMutation(
        (
          internal.submissions as unknown as {
            updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
          }
        ).updateSubmissionSourceInternal,
        {
          submissionId: args.submissionId,
          processingState: 'complete',
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
  // Use server-side filters to only query documents from this submission's folder
  // API docs: https://developers.cloudflare.com/api/resources/autorag/
  // Filters format: { key: "path", type: "gte", value: "path/prefix/" }
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
        max_num_results: 50,
        rewrite_query: false, // Don't rewrite query
        filters: {
          key: 'path', // Filter by path attribute
          type: 'gte', // Greater than or equal (matches paths starting with prefix)
          value: r2PathPrefix, // Only include documents from this submission's folder
        },
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

    // If filtering fails, try alternative filter formats or without filter as fallback
    if (queryResponse.status === 400) {
      // Try alternative filter format: using "attributes.path" instead of "path"
      let retryResponse: Response;
      try {
        retryResponse = await fetch(queryUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: summaryQuery,
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            max_num_results: 50,
            rewrite_query: false,
            filters: {
              key: 'attributes.path', // Try attributes.path if path doesn't work
              type: 'gte',
              value: r2PathPrefix,
            },
          }),
        });
      } catch {
        // If that fails, try without filter as last resort (fallback to client-side filtering)
        retryResponse = await fetch(queryUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: summaryQuery,
            model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            max_num_results: 50,
            rewrite_query: false,
            // No filters - fallback to client-side filtering
          }),
        });
      }

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
    // Use server-side filters per API docs: https://developers.cloudflare.com/api/resources/autorag/
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
          key: 'path', // Filter by path attribute per API docs
          type: 'gte', // Greater than or equal (matches paths starting with prefix)
          value: r2PathPrefix, // Only include documents from this submission's folder
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
 * Helper function to get R2 credentials
 */
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

/**
 * Extract README content from R2 files
 * Looks for README.md, README.txt, README, or similar files
 */
async function extractReadmeFromR2(
  r2PathPrefix: string,
): Promise<{ content: string; filename: string } | null> {
  const r2Creds = getR2Credentials();

  const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2Creds.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Creds.r2AccessKeyId,
      secretAccessKey: r2Creds.r2SecretAccessKey,
    },
  });

  // List all files in the submission's R2 prefix
  const listCommand = new ListObjectsV2Command({
    Bucket: r2Creds.r2BucketName,
    Prefix: r2PathPrefix,
  });

  const listResponse = await s3Client.send(listCommand);
  const objects = listResponse.Contents || [];

  // Look for README files (case-insensitive, various extensions)
  // Prioritize root-level README, but also check subdirectories
  const readmePatterns = [/^readme\.md$/i, /^readme\.txt$/i, /^readme$/i, /^readme\.markdown$/i];

  // Sort objects to prioritize root-level README files
  const sortedObjects = [...objects].sort((a, b) => {
    if (!a.Key || !b.Key) return 0;
    const aPath = a.Key.replace(r2PathPrefix, '');
    const bPath = b.Key.replace(r2PathPrefix, '');
    const aDepth = aPath.split('/').length;
    const bDepth = bPath.split('/').length;
    return aDepth - bDepth; // Prefer files with fewer path segments (closer to root)
  });

  for (const obj of sortedObjects) {
    if (!obj.Key) continue;

    // Extract filename from R2 key (remove prefix)
    const relativePath = obj.Key.replace(r2PathPrefix, '');
    const filename = relativePath.split('/').pop() || '';

    // Check if this matches a README pattern
    if (readmePatterns.some((pattern) => pattern.test(filename))) {
      try {
        // Download the README file
        const getCommand = new GetObjectCommand({
          Bucket: r2Creds.r2BucketName,
          Key: obj.Key,
        });

        const getResponse = await s3Client.send(getCommand);
        const content = await getResponse.Body?.transformToString();

        if (content) {
          return { content, filename };
        }
      } catch (error) {
        console.warn(`Failed to read README file ${obj.Key}:`, error);
        // Continue to next file
      }
    }
  }

  return null;
}

/**
 * Generate early summary using AI Gateway/Workers with README + screenshots
 * This provides a fast summary before AI Search indexing completes
 */
async function generateEarlySummaryWithAI(
  ctx: ActionCtx,
  submissionId: Id<'submissions'>,
  submissionTitle: string,
  repoUrl: string,
  r2PathPrefix: string | undefined,
): Promise<string> {
  // Import Cloudflare AI helper dynamically to avoid circular dependencies
  // (generateEarlySummaryWithGateway is imported later when needed)

  // Get submission to access screenshots and stored README
  const submission = await ctx.runQuery(
    (internal.submissions as unknown as { getSubmissionInternal: GetSubmissionInternalRef })
      .getSubmissionInternal,
    {
      submissionId,
    },
  );

  if (!submission) {
    throw new Error('Submission not found');
  }

  // Use stored README if available (fetched from GitHub), otherwise try to extract from R2
  let readmeContent: string | null = null;
  let readmeFilename: string | null = null;

  // Prefer stored README (fetched directly from GitHub)
  if (submission.source?.readme) {
    readmeContent = submission.source.readme;
    readmeFilename = submission.source.readmeFilename || 'README.md';
    console.log(
      `[Early Summary] Using stored README (${readmeFilename}) for submission ${submissionId}`,
    );
  } else if (r2PathPrefix) {
    // Fallback to extracting from R2 if stored README not available
    try {
      const readmeResult = await extractReadmeFromR2(r2PathPrefix);
      if (readmeResult) {
        readmeContent = readmeResult.content;
        readmeFilename = readmeResult.filename;
        console.log(
          `[Early Summary] Extracted README from R2 (${readmeFilename}) for submission ${submissionId}`,
        );
      }
    } catch (error) {
      console.warn(
        `[Early Summary] Failed to extract README from R2 for submission ${submissionId}:`,
        error instanceof Error ? error.message : String(error),
      );
      // Continue without README
    }
  }

  // Get screenshots
  const screenshots = submission.screenshots || [];
  const screenshotUrls = screenshots
    .map((s) => s.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);

  // Build prompt with README and screenshots
  const repoName = repoUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i)?.[2] || 'unknown';

  let prompt = `You are an expert hackathon judge analyzing a submission. Generate a comprehensive summary of this project based on the available information.\n\n`;
  prompt += `**Project Details:**\n`;
  prompt += `- Title: ${submissionTitle}\n`;
  prompt += `- Repository: ${repoUrl}\n`;
  prompt += `- Repository Name: ${repoName}\n`;

  if (readmeContent) {
    prompt += `\n**GitHub README (${readmeFilename}):**\n\`\`\`\n${readmeContent.slice(0, 8000)}\n\`\`\`\n`;
    // Limit README to 8000 chars to avoid token limits
  } else {
    prompt += `\n**Note:** No README file was found in the repository.\n`;
  }

  if (screenshotUrls.length > 0) {
    prompt += `\n**Live Site Screenshots:**\n`;
    prompt += `The project has ${screenshotUrls.length} screenshot(s) of the live site:\n`;
    screenshotUrls.forEach((url, idx) => {
      prompt += `${idx + 1}. ${url}\n`;
    });
    prompt += `\nThese screenshots show the actual user interface and functionality of the application.\n`;
  } else {
    prompt += `\n**Note:** No screenshots of the live site are available.\n`;
  }

  prompt += `\n**Your Task:**\n`;
  prompt += `Generate a concise summary with these three fields as JSON:\n\n`;
  prompt += `1. mainPurpose: Brief description (2-3 sentences max)\n`;
  prompt += `2. keyTechnologiesAndFrameworks: Markdown bullet list (max 8 items, keep descriptions short)\n`;
  prompt += `3. mainFeaturesAndFunctionality: Markdown bullet list of key features (max 10 items, keep descriptions short)\n\n`;
  prompt += `Keep responses concise to fit within token limits. Be specific and reference README/screenshots.\n`;

  try {
    // Import the structured output helper
    const { generateEarlySummaryWithGateway } = await import('../cloudflareAi');

    // Generate structured summary using AI Gateway with Google AI Studio Gemini Flash Lite (ensures all sections are present)
    // Uses Provider Keys configured in AI Gateway dashboard
    const result = await generateEarlySummaryWithGateway(prompt, {
      useGoogleAI: true,
      geminiModel: 'models/gemini-flash-lite-latest',
    });

    // Format the structured output as markdown
    const summary = `${result.summary.mainPurpose}\n\n**Main Features and Functionality:**\n\n${result.summary.mainFeaturesAndFunctionality}\n\n**Key Technologies and Frameworks:**\n\n${result.summary.keyTechnologiesAndFrameworks}`;

    console.log(`[Early Summary] Generated structured summary with all three sections`);
    console.log(`[Early Summary] Finish reason: ${result.finishReason}`);

    return summary;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to generate summary with AI Gateway';

    console.error(`[Early Summary] AI Gateway error for submission ${submissionId}:`, errorMessage);
    console.error(`[Early Summary] Full error:`, error);

    // Try fallback to text generation if structured output fails
    try {
      console.log(`[Early Summary] Attempting fallback to text generation...`);
      const { generateWithGatewayHelper } = await import('../cloudflareAi');
      const fallbackResult = await generateWithGatewayHelper(prompt, 'llama');

      // Try to parse the text response as JSON or extract sections
      const text = fallbackResult.response;

      // Check if it's already in the right format
      if (
        text.includes('**Key Technologies and Frameworks:**') &&
        text.includes('**Main Features and Functionality:**')
      ) {
        console.log(`[Early Summary] Fallback text generation produced valid format`);
        // Strip "**Main Purpose:**" if present since we don't want that label
        const cleanedText = text.replace(/^\*\*Main Purpose:\*\*\s*\n\n?/i, '');
        return cleanedText;
      }

      // If not, return error message
      throw new Error('Fallback text generation did not produce expected format');
    } catch (fallbackError) {
      console.error(`[Early Summary] Fallback also failed:`, fallbackError);

      // Return a fallback summary with the three sections
      return `Unable to generate summary due to error: ${errorMessage}. The full repository summary will be available once Cloudflare AI Search finishes indexing the repository files.\n\n**Main Features and Functionality:**\n\nInformation not available.\n\n**Key Technologies and Frameworks:**\n\nInformation not available.`;
    }
  }
}

/**
 * Helper function to generate early summary (extracted so it can be called from both internal and public actions)
 */
async function generateEarlySummaryHelper(
  ctx: ActionCtx,
  args: { submissionId: Id<'submissions'>; forceRegenerate?: boolean },
): Promise<{
  success: boolean;
  skipped?: boolean;
  summary?: string;
  error?: string;
  reason?: string;
}> {
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

  // Check if summary already exists (skip only if not forcing regeneration)
  if (submission.source?.aiSummary && !args.forceRegenerate) {
    console.log(`[Early Summary] Submission ${args.submissionId} already has a summary - skipping`);
    return { success: true, skipped: true };
  }

  // If forcing regeneration, clear existing summary first
  if (args.forceRegenerate && submission.source?.aiSummary) {
    console.log(
      `[Early Summary] Force regenerating early summary for submission ${args.submissionId} - clearing existing summary`,
    );
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        aiSummary: undefined,
        summarizedAt: undefined,
        summaryGenerationStartedAt: undefined,
        summaryGenerationCompletedAt: undefined,
      },
    );
  }

  // Check if we have at least README (stored or in R2) or screenshots to work with
  const hasStoredReadme = !!submission.source?.readme;
  const hasR2Files = !!submission.source?.r2Key;
  const hasScreenshots = (submission.screenshots?.length ?? 0) > 0;

  if (!hasStoredReadme && !hasR2Files && !hasScreenshots) {
    console.log(
      `[Early Summary] Submission ${args.submissionId} has no README or screenshots yet - skipping`,
    );
    return { success: false, reason: 'No README or screenshots available' };
  }

  try {
    // Set processing state to generating
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        processingState: 'generating',
        summaryGenerationStartedAt: Date.now(),
      },
    );

    // Generate early summary
    const summary = await generateEarlySummaryWithAI(
      ctx,
      args.submissionId,
      submission.title,
      submission.repoUrl,
      submission.source?.r2Key,
    );

    // Update submission with early summary
    const summaryGenerationCompletedAt = Date.now();
    await ctx.runMutation(
      (
        internal.submissions as unknown as {
          updateSubmissionSourceInternal: UpdateSubmissionSourceInternalRef;
        }
      ).updateSubmissionSourceInternal,
      {
        submissionId: args.submissionId,
        aiSummary: summary,
        summarizedAt: summaryGenerationCompletedAt,
        summaryGenerationCompletedAt,
        processingState: 'indexing', // Back to indexing while waiting for AI Search
      },
    );

    console.log(
      `[Early Summary] Generated early summary for submission ${args.submissionId} using README + screenshots`,
    );

    return { success: true, summary };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to generate early summary';

    console.error(`[Early Summary] Error for submission ${args.submissionId}:`, errorMessage);

    // Don't throw - allow AI Search summary to be generated later
    return { success: false, error: errorMessage };
  }
}

/**
 * Generate early summary using README + screenshots (before AI Search indexing completes)
 * This provides immediate feedback while waiting for full repository indexing
 */
export const generateEarlySummary = internalAction({
  args: {
    submissionId: v.id('submissions'),
    forceRegenerate: v.optional(v.boolean()), // If true, regenerate even if summary exists
  },
  handler: async (ctx, args) => {
    return await generateEarlySummaryHelper(ctx, args);
  },
});

/**
 * Helper function to generate repo summary (download/upload if needed, then schedule indexing check)
 * Extracted so it can be called from both generateRepoSummary and processSubmission
 */
async function generateRepoSummaryHelper(
  ctx: ActionCtx,
  args: { submissionId: Id<'submissions'>; forceRegenerate?: boolean },
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
      forceRegenerate: args.forceRegenerate ?? false,
    },
  );

  return { scheduled: true };
}

/**
 * Public action wrapper for generating early summary (README + screenshots)
 * This provides fast summary generation without waiting for AI Search indexing
 */
export const generateEarlySummaryPublic = action({
  args: {
    submissionId: v.id('submissions'),
    forceRegenerate: v.optional(v.boolean()), // If true, regenerate even if summary exists
  },
  handler: async (ctx, args) => {
    return await generateEarlySummaryHelper(ctx, {
      submissionId: args.submissionId,
      forceRegenerate: args.forceRegenerate ?? false,
    });
  },
});

/**
 * Public action wrapper for generating repository summary using AI Search
 * Handles download/upload if needed, then schedules the internal polling action to check indexing status
 * This combines download/upload and summary scheduling in one action to avoid cross-action calls
 * Uses Cloudflare AI Search to analyze all repository files for comprehensive summary
 */
export const generateRepoSummary = action({
  args: {
    submissionId: v.id('submissions'),
    forceRegenerate: v.optional(v.boolean()), // If true, regenerate even if summary exists
  },
  handler: async (ctx, args) => {
    return await generateRepoSummaryHelper(ctx, {
      submissionId: args.submissionId,
      forceRegenerate: args.forceRegenerate ?? false,
    });
  },
});
