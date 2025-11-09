import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createAuth } from '@convex/auth';
import { setupFetchClient } from '@convex-dev/better-auth/react-start';
import { createFileRoute } from '@tanstack/react-router';
import { getCookie } from '@tanstack/react-start/server';

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
              await fetchAction((api.submissions as any).downloadAndUploadRepo, {
                submissionId: sid as Id<'submissions'>,
              });
            }

            // Check if AI summary exists, trigger AI Search summary generation if not
            if (!submission.source?.aiSummary) {
              await fetchAction((api.submissions as any).generateRepoSummary, {
                submissionId: sid as Id<'submissions'>,
              });
            }

            // Get updated submission with summary
            const updatedSubmission = await fetchQuery(api.submissions.getSubmission, {
              submissionId: sid as Id<'submissions'>,
            });

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

            // Stream AI review via Cloudflare Gateway
            // TODO: Implement streaming with Cloudflare AI Gateway
            // For now, return a placeholder response
            const _reviewPrompt = `Review this hackathon submission based on the following rubric:

Rubric:
${updatedHackathon.rubric}

Repository Summary:
${updatedSubmission.source.aiSummary}

Submission Details:
- Title: ${updatedSubmission.title}
- Team: ${updatedSubmission.team}
- Repository: ${updatedSubmission.repoUrl}
${updatedSubmission.siteUrl ? `- Site: ${updatedSubmission.siteUrl}` : ''}

Please provide:
1. A detailed review summary
2. A score from 0-10 based on the rubric

Respond in JSON format: { "score": number, "summary": string }`;

            // TODO: Call Cloudflare AI Gateway streaming endpoint
            // This is a placeholder - actual implementation will stream markdown tokens
            const reviewResult = {
              score: 7.5,
              summary: 'This is a placeholder review. Implement Cloudflare AI Gateway streaming.',
            };

            // Parse and persist results
            await fetchMutation(api.submissions.updateSubmissionAI, {
              submissionId: sid as Id<'submissions'>,
              summary: reviewResult.summary,
              score: reviewResult.score,
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
