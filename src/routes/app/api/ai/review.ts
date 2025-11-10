import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { getCookie } from '@tanstack/react-start/server';
import type { FunctionReference } from 'convex/server';

// Type definitions for action references (until Convex regenerates types)
type DownloadAndUploadRepoRef = FunctionReference<
  'action',
  'public',
  { submissionId: Id<'submissions'> },
  { r2Key: string; uploadedAt: number }
>;

type GenerateRepoSummaryRef = FunctionReference<
  'action',
  'public',
  { submissionId: Id<'submissions'>; forceRegenerate?: boolean },
  { scheduled: boolean }
>;

type GenerateSubmissionReviewRef = FunctionReference<
  'action',
  'public',
  {
    submissionId: Id<'submissions'>;
    submissionTitle: string;
    team: string;
    repoUrl: string;
    siteUrl?: string | null;
    repoSummary: string;
    rubric: string;
  },
  { score: number | null; summary: string }
>;

export const Route = createFileRoute('/app/api/ai/review')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json();
          const { sid } = body;

          if (!sid || typeof sid !== 'string') {
            return new Response(
              JSON.stringify({
                code: 'INVALID_INPUT',
                message: 'Missing or invalid submission ID',
              }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Setup Convex fetch client for authenticated operations
          const { fetchQuery, fetchMutation, fetchAction } = await setupFetchClient(
            createAuth,
            getCookie,
          );

          const pollSubmissionSummary = async (
            submissionId: Id<'submissions'>,
            timeoutMs: number = 120_000,
            intervalMs: number = 2_000,
          ) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
              const current = await fetchQuery(api.submissions.getSubmission, {
                submissionId,
              });

              if (current?.source?.aiSummary) {
                return current;
              }

              await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }

            return null;
          };

          // Get submission to check hackathon access
          const submission = await fetchQuery(api.submissions.getSubmission, {
            submissionId: sid as Id<'submissions'>,
          });

          if (!submission) {
            return new Response(
              JSON.stringify({ code: 'NOT_FOUND', message: 'Submission not found' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Get hackathon to check membership
          const hackathon = await fetchQuery(api.hackathons.getHackathon, {
            hackathonId: submission.hackathonId,
          });

          if (!hackathon) {
            return new Response(
              JSON.stringify({ code: 'NOT_FOUND', message: 'Hackathon not found' }),
              {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Check if submission already has in-flight review
          if (submission.ai?.inFlight) {
            return new Response(
              JSON.stringify({
                code: 'IN_FLIGHT',
                message: 'AI review is already in progress',
              }),
              {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          }

          // Set in-flight lock
          await fetchMutation(api.submissions.updateSubmissionAI, {
            submissionId: sid as Id<'submissions'>,
            inFlight: true,
          });

          try {
            // Check if R2 object exists, trigger GitHub clone + R2 upload if not
            if (!submission.source?.r2Key) {
              await fetchAction(
                (
                  api.submissionsActions.repoProcessing as unknown as {
                    downloadAndUploadRepo: DownloadAndUploadRepoRef;
                  }
                ).downloadAndUploadRepo,
                {
                  submissionId: sid as Id<'submissions'>,
                },
              );
            }

            // Always regenerate the summary when "Run AI review" is clicked
            // This ensures fresh summaries and scores each time
            console.log(
              `[AI Review] Triggering summary generation for submission ${sid}. Has existing summary: ${!!submission.source?.aiSummary}`,
            );
            await fetchAction(
              (
                api.submissionsActions.aiSummary as unknown as {
                  generateRepoSummary: GenerateRepoSummaryRef;
                }
              ).generateRepoSummary,
              {
                submissionId: sid as Id<'submissions'>,
                forceRegenerate: true, // Always force regenerate to get fresh summary
              },
            );

            // Get updated submission with summary (poll until ready)
            // Always poll since we're regenerating the summary
            const updatedSubmission = await pollSubmissionSummary(sid as Id<'submissions'>);

            if (!updatedSubmission?.source?.aiSummary) {
              throw new Error('Failed to generate repository summary');
            }

            // Get hackathon rubric
            const updatedHackathon = await fetchQuery(api.hackathons.getHackathon, {
              hackathonId: submission.hackathonId,
            });

            if (!updatedHackathon) {
              throw new Error('Hackathon not found');
            }

            const reviewResult = await fetchAction(
              (
                api.cloudflareAi as unknown as {
                  generateSubmissionReview: GenerateSubmissionReviewRef;
                }
              ).generateSubmissionReview,
              {
                submissionId: sid as Id<'submissions'>,
                submissionTitle: submission.title,
                team: submission.team,
                repoUrl: submission.repoUrl,
                siteUrl: submission.siteUrl ?? undefined,
                repoSummary: updatedSubmission.source.aiSummary,
                rubric: updatedHackathon.rubric ?? 'No rubric provided',
              },
            );

            if (!reviewResult.summary) {
              throw new Error('AI review did not return a summary');
            }

            // Parse and persist results
            await fetchMutation(api.submissions.updateSubmissionAI, {
              submissionId: sid as Id<'submissions'>,
              summary: reviewResult.summary,
              score: reviewResult.score ?? undefined,
              inFlight: false,
            });

            return new Response(
              JSON.stringify({ score: reviewResult.score, summary: reviewResult.summary }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
              },
            );
          } catch (error) {
            // Clear in-flight lock on error
            await fetchMutation(api.submissions.updateSubmissionAI, {
              submissionId: sid as Id<'submissions'>,
              inFlight: false,
            }).catch(() => {
              // Ignore errors when clearing lock
            });

            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorCode =
              errorMessage.includes('rate limit') || errorMessage.includes('RATE_LIMIT')
                ? 'RATE_LIMIT'
                : errorMessage.includes('NO_R2')
                  ? 'NO_R2_OBJECT'
                  : errorMessage.includes('NO_SUMMARY')
                    ? 'NO_SUMMARY'
                    : 'AI_FAIL';

            return new Response(JSON.stringify({ code: errorCode, message: errorMessage }), {
              status: errorCode === 'RATE_LIMIT' ? 429 : 500,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (error) {
          return new Response(
            JSON.stringify({
              code: 'SERVER_ERROR',
              message: error instanceof Error ? error.message : 'Internal server error',
            }),
            {
              status: 500,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }
      },
    },
  },
});
