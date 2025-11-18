import { Autumn } from '@useautumn/convex';
import type { FunctionReference } from 'convex/server';
import { v } from 'convex/values';
import { FREE_SUBMISSION_LIMIT } from '../src/features/hackathons/constants';
import { getAutumnCreditFeatureId } from '../src/lib/server/env.server';
import { calculateAverageRating, extractRatingValues } from '../src/lib/shared/rating-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';
import { AUTUMN_NOT_CONFIGURED_ERROR, autumn, isAutumnConfigured } from './autumn';
import { requireHackathonRole } from './hackathons';
import { markProcessingErrorWithFallback } from './submissionsActions/processingError';
import { validateSafeUrl } from './urlValidation';

const submissionsInternalApi = internal as unknown as {
  submissions: {
    getSubmissionCreationContext: FunctionReference<'query', 'internal'>;
    getSubmissionInternal: FunctionReference<'query', 'internal'>;
    getSubmissionWithAccessInternal: FunctionReference<'query', 'internal'>;
    createSubmissionInternal: FunctionReference<'mutation', 'internal'>;
    getSubmissionsForMigration: FunctionReference<'query', 'internal'>;
    migrateSubmissionUrl: FunctionReference<'mutation', 'internal'>;
  };
};

const PROCESSING_MONITOR_DELAY_MS = 5 * 60 * 1000;

type SchedulerContext = {
  scheduler: {
    runAfter: (
      delayMs: number,
      fn: FunctionReference<'action', 'internal'>,
      args: Record<string, unknown>,
    ) => Promise<unknown>;
  };
};

async function assertHttpUrl(value: string, fieldName: 'siteUrl' | 'videoUrl'): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const validation = await validateSafeUrl(trimmed);
  if (!validation.isValid) {
    throw new Error(`${fieldName}: ${validation.error}`);
  }
}

async function scheduleProcessingWatchdog(ctx: SchedulerContext, submissionId: Id<'submissions'>) {
  try {
    await ctx.scheduler.runAfter(
      PROCESSING_MONITOR_DELAY_MS,
      internal.submissionsActions.repoProcessing.monitorSubmissionProcessing,
      {
        submissionId,
        attempt: 0,
      },
    );
  } catch (error) {
    console.error('Failed to schedule processing watchdog:', error);
  }
}

// Status transitions are now unrestricted - any status can transition to any other status

/**
 * Get public submission data (no authentication required)
 *
 * This query provides basic submission information for public viewing.
 */
/**
 * List public submissions by hackathon (no authentication required)
 *
 * This query provides basic submission information for public viewing,
 * allowing potential contestants to see existing submissions and get inspired.
 */
export const listPublicSubmissions = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId_createdAt', (q) => q.eq('hackathonId', args.hackathonId))
      .order('desc') // Newest first
      .collect();

    // Return submissions without private data like ratings, but include source for summaries
    return submissions.map((submission) => ({
      _id: submission._id,
      title: submission.title,
      team: submission.team,
      repoUrl: submission.repoUrl,
      siteUrl: submission.siteUrl,
      videoUrl: submission.videoUrl,
      screenshots: submission.screenshots,
      source: submission.source, // Include source for AI summaries and processing state
      createdAt: submission.createdAt,
    }));
  },
});

/**
 * List submissions by hackathon
 *
 * ACCESS CONTROL: This query intentionally returns an empty array `[]` for unauthenticated
 * users or users without active membership instead of throwing an error. This allows:
 * 1. Client components to render empty states gracefully without error boundaries
 * 2. Smooth UX when users navigate while signed out or without access
 * 3. Avoid error boundary triggers for expected authorization failures
 *
 * This is a deliberate design choice for better UX. The client should check for empty
 * arrays and render appropriate UI (sign-in prompt, "no access" message, etc.).
 */
export const listByHackathon = query({
  args: {
    hackathonId: v.id('hackathons'),
    ratingFilter: v.optional(v.union(v.literal('all'), v.literal('rated'), v.literal('unrated'))),
  },
  handler: async (ctx, args) => {
    // Don't throw error if unauthenticated - just return empty array
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);
    if (!authUser) {
      return [];
    }

    const userId = assertUserId(authUser, 'User ID not found');

    // Check membership
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (!membership || membership.status !== 'active') {
      return [];
    }

    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId_createdAt', (q) => q.eq('hackathonId', args.hackathonId))
      .order('desc') // Newest first
      .collect();

    // Get all ratings for these submissions
    const allRatings = await ctx.db
      .query('ratings')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Build a map of ratings by submission ID
    const ratingsBySubmission = new Map<
      string,
      { myRating: number | null; averageRating: number }
    >();

    for (const submission of submissions) {
      const submissionRatings = allRatings.filter((r) => r.submissionId === submission._id);
      const myRating = submissionRatings.find((r) => r.userId === userId)?.rating ?? null;
      const ratingValues = extractRatingValues(submissionRatings);
      const averageRating = calculateAverageRating(ratingValues);

      ratingsBySubmission.set(submission._id, { myRating, averageRating });
    }

    // Add rating data to each submission
    let filteredSubmissions = submissions.map((submission) => ({
      ...submission,
      myRating: ratingsBySubmission.get(submission._id)?.myRating ?? null,
      averageRating: ratingsBySubmission.get(submission._id)?.averageRating ?? 0,
    }));

    // Apply rating filter if specified
    if (args.ratingFilter) {
      filteredSubmissions = filteredSubmissions.filter((submission) => {
        const hasRating = submission.myRating !== null && submission.myRating !== undefined;

        switch (args.ratingFilter) {
          case 'rated':
            return hasRating;
          case 'unrated':
            return !hasRating;
          default:
            return true;
        }
      });
    }

    return filteredSubmissions;
  },
});

/**
 * Get single submission
 *
 * ACCESS CONTROL: This query intentionally returns `null` for unauthenticated users or
 * users without active membership instead of throwing an error. This allows:
 * 1. Client components to handle "not found" vs "no access" states gracefully
 * 2. Smooth UX when users navigate while signed out or without access
 * 3. Avoid error boundary triggers for expected authorization failures
 *
 * This is a deliberate design choice for better UX. The client should check for `null`
 * and render appropriate UI (sign-in prompt, "not found" message, etc.).
 */
export const getSubmission = query({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    // Don't throw error if unauthenticated - just return null
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'User ID not found');

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      return null;
    }

    // Check membership
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', submission.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (!membership || membership.status !== 'active') {
      return null;
    }

    // Get ratings for this submission
    const allRatings = await ctx.db
      .query('ratings')
      .withIndex('by_submissionId', (q) => q.eq('submissionId', args.submissionId))
      .collect();

    const myRating = allRatings.find((r) => r.userId === userId)?.rating ?? null;
    const ratingValues = extractRatingValues(allRatings);
    const averageRating = calculateAverageRating(ratingValues);

    return {
      ...submission,
      myRating,
      averageRating,
    };
  },
});

export const getSubmissionWithAccessInternal = internalQuery({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'User ID not found');
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      return null;
    }

    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', submission.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (!membership || membership.status !== 'active') {
      return null;
    }

    return submission;
  },
});

export const getSubmissionCreationContext = internalQuery({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    const { hackathon, userId, role } = await requireHackathonRole(ctx, args.hackathonId, [
      'owner',
      'admin',
      'judge',
      'contestant',
    ]);

    if (hackathon.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline) {
      throw new Error('Cannot create submissions for hackathons that have ended');
    }

    const totalSubmissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    return {
      userId,
      role,
      hackathonOwnerUserId: hackathon.ownerUserId,
      freeSubmissionsRemaining: Math.max(FREE_SUBMISSION_LIMIT - totalSubmissions.length, 0),
    };
  },
});

/**
 * Create submission in hackathon
 */
export const createSubmissionInternal = internalMutation({
  args: {
    hackathonId: v.id('hackathons'),
    userId: v.string(),
    title: v.string(),
    team: v.string(),
    repoUrl: v.string(),
    siteUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    usingPaidCredit: v.boolean(),
  },
  handler: async (ctx, args) => {
    // Check membership - any active member can create submissions
    const { hackathon, role } = await requireHackathonRole(ctx, args.hackathonId, [
      'owner',
      'admin',
      'judge',
      'contestant',
    ]);

    // Check if hackathon has ended
    if (hackathon.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline) {
      throw new Error('Cannot create submissions for hackathons that have ended');
    }

    // Check if user has admin privileges (owner/admin) - they can bypass credit limits
    const hasAdminPrivileges = role === 'owner' || role === 'admin';

    if (!hasAdminPrivileges) {
      // Only apply credit checks for non-admin users
      const existingSubmissions = await ctx.db
        .query('submissions')
        .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
        .collect();
      const totalSubmissions = existingSubmissions.length;
      const freeSubmissionsRemaining = Math.max(FREE_SUBMISSION_LIMIT - totalSubmissions, 0);
      const requiresPaidCredits = freeSubmissionsRemaining <= 0;

      if (requiresPaidCredits && !args.usingPaidCredit) {
        throw new Error('No free submissions remaining for this hackathon.');
      }
    }

    const now = Date.now();

    const submissionId = await ctx.db.insert('submissions', {
      hackathonId: args.hackathonId,
      userId: args.userId,
      title: args.title.trim(),
      team: args.team.trim(),
      repoUrl: args.repoUrl.trim(),
      siteUrl: args.siteUrl?.trim(),
      videoUrl: args.videoUrl?.trim(),
      source: {
        processingState: 'downloading', // Start with downloading state
      },
      createdAt: now,
      updatedAt: now,
    });

    // Trigger automatic processing: download repo and generate summary
    // Note: We schedule processSubmission which will handle the processing
    // processSubmission is an internal action that can be scheduled
    // Screenshot capture will be triggered during repo upload (in downloadAndUploadRepoHelper)
    try {
      await ctx.scheduler.runAfter(0, internal.submissions.processSubmission, {
        submissionId,
      });
      await scheduleProcessingWatchdog(ctx, submissionId);
    } catch (error) {
      console.error('Failed to schedule submission processing:', error);
      // Mark as errored so the UI shows retry controls instead of spinning forever
      await ctx.db.patch(submissionId, {
        source: {
          processingState: 'error',
          processingError:
            'Failed to start repository processing. Click "Retry Processing" to try again.',
        },
        updatedAt: Date.now(),
      });
      // Don't throw - submission creation should succeed even if scheduling fails
    }

    return { submissionId };
  },
});

export const createSubmission = action({
  args: {
    hackathonId: v.id('hackathons'),
    title: v.string(),
    team: v.string(),
    repoUrl: v.string(),
    siteUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate URLs if provided
    if (args.siteUrl) {
      await assertHttpUrl(args.siteUrl, 'siteUrl');
    }

    if (args.videoUrl) {
      await assertHttpUrl(args.videoUrl, 'videoUrl');
    }
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // Check membership using internal query
    const membership = await ctx.runQuery(internal.hackathons.getMembershipInternal, {
      hackathonId: args.hackathonId,
      userId,
    });

    if (
      !membership ||
      membership.status !== 'active' ||
      !['owner', 'admin', 'judge', 'contestant'].includes(membership.role)
    ) {
      throw new Error('Access denied');
    }

    const role = membership.role;

    // Get hackathon using internal query
    const hackathon = await ctx.runQuery(internal.hackathons.getHackathonInternal, {
      hackathonId: args.hackathonId,
    });

    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    if (hackathon.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline) {
      throw new Error('Cannot create submissions for hackathons that have ended');
    }

    // Get submission creation context using internal query
    const context = await ctx.runQuery(
      submissionsInternalApi.submissions.getSubmissionCreationContext,
      {
        hackathonId: args.hackathonId,
      },
    );

    const hackathonOwnerUserId = hackathon.ownerUserId;
    const freeSubmissionsRemaining = context.freeSubmissionsRemaining;

    // Allow contestants to create submissions
    // Note: Hackathon deadline check is already done in getSubmissionCreationContext for all roles

    const requiresPaidCredits = freeSubmissionsRemaining <= 0;
    let usingPaidCredit = false;

    // When paid credits are required, check credits for owners/admins
    // For judges and contestants, check the hackathon owner's credits instead
    if (requiresPaidCredits) {
      if (role === 'judge' || role === 'contestant') {
        // Judges need to verify the owner has credits before creating submissions
        if (!isAutumnConfigured()) {
          throw new Error(
            `${AUTUMN_NOT_CONFIGURED_ERROR.message} The hackathon owner has run out of submission credits. Please contact them to purchase more credits.`,
          );
        }

        // Create a temporary Autumn instance that identifies as the owner
        const ownerAutumn = new Autumn(components.autumn, {
          secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
          identify: async () => {
            return {
              customerId: hackathonOwnerUserId,
              customerData: {},
            };
          },
        });

        // Call the Autumn instance method directly instead of the Convex action
        // This avoids calling Convex functions from within other Convex functions
        const ownerCheckResult = await ownerAutumn.check(ctx, {
          featureId: getAutumnCreditFeatureId(),
        });

        if (ownerCheckResult.error) {
          throw new Error(
            ownerCheckResult.error.message ??
              'Unable to verify hackathon owner credit balance. Please try again or contact the hackathon owner.',
          );
        }

        if (!ownerCheckResult.data?.allowed) {
          throw new Error(
            'The hackathon owner has run out of submission credits. Please contact them to purchase more credits before creating submissions.',
          );
        }

        // Owner has credits, allow submission (but don't charge the judge)
        usingPaidCredit = true;
      } else {
        // Owners and admins must have credits to create paid submissions
        if (!isAutumnConfigured()) {
          throw new Error(
            `${AUTUMN_NOT_CONFIGURED_ERROR.message} This hackathon has run out of submission credits. Please purchase more credits to continue.`,
          );
        }

        const checkResult = await autumn.check(ctx, {
          featureId: getAutumnCreditFeatureId(),
        });

        if (checkResult.error) {
          throw new Error(
            checkResult.error.message ??
              'Unable to verify credit balance. Please try again or purchase credits.',
          );
        }

        if (!checkResult.data?.allowed) {
          throw new Error(
            'You have run out of submission credits. Please purchase more credits to continue.',
          );
        }

        usingPaidCredit = true;
      }
    }

    const result = await ctx.runMutation(
      submissionsInternalApi.submissions.createSubmissionInternal,
      {
        hackathonId: args.hackathonId,
        userId: userId,
        title: args.title,
        team: args.team,
        repoUrl: args.repoUrl,
        siteUrl: args.siteUrl,
        videoUrl: args.videoUrl,
        usingPaidCredit,
      },
    );

    if (usingPaidCredit) {
      // Track usage against the owner's account (whether created by owner/admin, judge, or contestant)
      try {
        // Create a temporary Autumn instance that identifies as the owner for tracking
        const ownerAutumn = new Autumn(components.autumn, {
          secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
          identify: async () => {
            return {
              customerId: hackathonOwnerUserId,
              customerData: {},
            };
          },
        });

        const ownerAutumnApi = ownerAutumn.api();
        // The track method is a registered action that uses our custom identify function
        // biome-ignore lint/suspicious/noExplicitAny: Autumn API methods are registered actions that TypeScript doesn't recognize as callable, but they work at runtime
        const trackMethod = ownerAutumnApi.track as any;
        const trackResult = await trackMethod(ctx, {
          featureId: getAutumnCreditFeatureId(),
          value: 1,
          properties: {
            resource: 'hackathon_submission',
            hackathonId: args.hackathonId,
            submissionId: result.submissionId,
            createdByUserId: userId,
            createdByRole: role,
            hackathonOwnerUserId, // Track which hackathon owner this relates to
          },
        });

        if (trackResult && 'error' in trackResult && trackResult.error) {
          console.warn('Failed to track Autumn usage for hackathon submission', trackResult.error);
        }
      } catch (error) {
        console.warn('Autumn tracking failed for hackathon submission', error);
      }
    }

    return result;
  },
});

/**
 * Check hackathon owner's credits
 * Used by judges and contestants to verify if the owner has credits before creating submissions
 */
export const checkOwnerCredits = action({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // Check if user has access to this hackathon
    const membership = await ctx.runQuery(internal.hackathons.getMembershipInternal, {
      hackathonId: args.hackathonId,
      userId,
    });

    if (
      !membership ||
      membership.status !== 'active' ||
      !['judge', 'contestant'].includes(membership.role)
    ) {
      throw new Error('Access denied');
    }

    // Get hackathon to get owner info
    const hackathon = await ctx.runQuery(internal.hackathons.getHackathonInternal, {
      hackathonId: args.hackathonId,
    });

    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    const hackathonOwnerUserId = hackathon.ownerUserId;

    if (!isAutumnConfigured()) {
      return {
        error: {
          message: AUTUMN_NOT_CONFIGURED_ERROR.message,
          code: AUTUMN_NOT_CONFIGURED_ERROR.code,
        },
        data: null,
      };
    }

    // Create a temporary Autumn instance that identifies as the owner
    // The identify function receives the action context but we override it to use owner's userId
    type AuthCtx = Parameters<typeof authComponent.getAuthUser>[0];
    const ownerAutumn = new Autumn(components.autumn, {
      secretKey: process.env.AUTUMN_SECRET_KEY ?? '',
      identify: async (_ctx: AuthCtx) => {
        // Return owner's userId as customerId (ignore the context, use owner's ID)
        return {
          customerId: hackathonOwnerUserId,
          customerData: {},
        };
      },
    });

    try {
      // Call the Autumn instance method directly instead of the Convex action
      // This avoids calling Convex functions from within other Convex functions
      const checkResult = await ownerAutumn.check(ctx, {
        featureId: getAutumnCreditFeatureId(),
      });

      return checkResult;
    } catch (error) {
      console.error('Failed to check owner credits - exception thrown:', error);
      return {
        error: {
          message:
            error instanceof Error
              ? error.message
              : 'Unable to verify hackathon owner credit balance. Please try again or contact the hackathon owner.',
          code: 'CHECK_FAILED',
        },
        data: null,
      };
    }
  },
});

/**
 * Retry submission processing from the beginning
 * Resets processing state and triggers the full processing workflow
 */
export const retrySubmissionProcessing = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // Get submission and verify access through the internal query
    const submission = await ctx.runQuery(internal.submissions.getSubmissionInternal, {
      submissionId: args.submissionId,
    });
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership - any active member can retry processing
    const membership = await ctx.runQuery(internal.hackathons.getMembershipInternal, {
      hackathonId: submission.hackathonId,
      userId,
    });

    if (!membership || membership.status !== 'active') {
      throw new Error('Access denied');
    }

    // Only owners, admins, and judges can retry processing
    if (!['owner', 'admin', 'judge'].includes(membership.role)) {
      throw new Error('Insufficient permissions to retry processing');
    }

    // Reset processing state to start fresh
    await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
      submissionId: args.submissionId,
      processingState: 'downloading',
      // Clear any previous processing timestamps to start fresh
      uploadStartedAt: undefined,
      uploadCompletedAt: undefined,
      aiSearchSyncStartedAt: undefined,
      aiSearchSyncCompletedAt: undefined,
      aiSearchSyncJobId: undefined,
      screenshotCaptureStartedAt: undefined,
      screenshotCaptureCompletedAt: undefined,
      readmeFetchedAt: undefined,
      summaryGenerationStartedAt: undefined,
      summaryGenerationCompletedAt: undefined,
      // Clear any existing summary that might be from failed processing
      aiSummary: undefined,
      summarizedAt: undefined,
    });

    // Clear screenshots separately since they're not part of the source object
    await ctx.runMutation(internal.submissions.clearScreenshots, {
      submissionId: args.submissionId,
    });

    // Trigger the full processing workflow
    try {
      await ctx.scheduler.runAfter(0, internal.submissions.processSubmission, {
        submissionId: args.submissionId,
      });
      await scheduleProcessingWatchdog(ctx, args.submissionId);
    } catch (error) {
      console.error('Failed to schedule retry processing:', error);
      await markProcessingErrorWithFallback(
        ctx,
        args.submissionId,
        'Failed to restart repository processing. Please try again.',
      );
      throw new Error('Failed to retry processing. Please try again.');
    }

    return { success: true };
  },
});

/**
 * Allow clients to manually refresh the Cloudflare AI Search indexing status
 * Useful when the dashboard shows a completed sync but our submission is still marked as indexing
 */
export const refreshSubmissionIndexingStatus = action({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    const userId = assertUserId(authUser, 'User ID not found');

    // Get submission using internal query
    const submission = await ctx.runQuery(
      submissionsInternalApi.submissions.getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership using internal query
    const membership = await ctx.runQuery(internal.hackathons.getMembershipInternal, {
      hackathonId: submission.hackathonId,
      userId,
    });

    if (!membership || membership.status !== 'active') {
      throw new Error('Access denied');
    }

    const source = submission.source;
    const needsRefresh =
      (source?.processingState === 'indexing' && !!source?.r2Key) ||
      (source?.processingState === 'complete' && !source?.aiSearchSyncCompletedAt);

    if (!needsRefresh) {
      console.log(
        '[RefreshIndexing] Skipping refresh because submission is not waiting on AI Search',
        {
          submissionId: args.submissionId,
          processingState: source?.processingState,
          aiSearchSyncCompletedAt: source?.aiSearchSyncCompletedAt ?? null,
        },
      );
      return {
        alreadyComplete: source?.processingState === 'complete',
        aiSearchSyncCompletedAt: source?.aiSearchSyncCompletedAt ?? null,
      };
    }

    console.log('[RefreshIndexing] Triggering Cloudflare status refresh', {
      submissionId: args.submissionId,
      processingState: source?.processingState,
      aiSearchSyncCompletedAt: source?.aiSearchSyncCompletedAt ?? null,
      r2Key: source?.r2Key ?? null,
      uploadedAt: source?.uploadedAt ?? null,
    });
    try {
      // Simplified manual refresh - check Cloudflare AI Search status once
      // Use the submission already retrieved above
      if (!submission?.source?.r2Key) {
        throw new Error('Submission repository files not uploaded yet');
      }

      // Get AI Search configuration
      const aiSearchInstanceId = process.env.CLOUDFLARE_AI_SEARCH_INSTANCE_ID;
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;

      if (!aiSearchInstanceId || !accountId || !apiToken) {
        throw new Error('Cloudflare AI Search not configured');
      }

      // Check if files are indexed in Cloudflare AI Search
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/vectorize/indexes/${aiSearchInstanceId}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: 'test query to check if index is ready',
            topK: 1,
            returnValues: false,
            returnMetadata: false,
          }),
        },
      );

      const isIndexed = response.ok;

      if (isIndexed && submission.source?.processingState !== 'complete') {
        // Mark as complete and record sync completion time
        await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
          submissionId: args.submissionId,
          processingState: 'complete',
          aiSearchSyncCompletedAt: Date.now(),
        });
      }
    } catch (error) {
      console.warn(
        'Failed to refresh submission indexing status:',
        error instanceof Error ? error.message : error,
      );
      throw new Error('Failed to refresh Cloudflare AI Search status. Please try again.');
    }

    let updatedSubmission = await ctx.runQuery(
      submissionsInternalApi.submissions.getSubmissionInternal,
      {
        submissionId: args.submissionId,
      },
    );

    if (
      updatedSubmission?.source?.processingState === 'complete' &&
      !updatedSubmission.source.aiSearchSyncCompletedAt
    ) {
      const fallbackTimestamp = Date.now();
      console.warn(
        '[RefreshIndexing] Submission marked complete without aiSearchSyncCompletedAt - recording fallback timestamp',
        {
          submissionId: args.submissionId,
          fallbackTimestamp,
        },
      );
      await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
        submissionId: args.submissionId,
        aiSearchSyncCompletedAt: fallbackTimestamp,
      });
      updatedSubmission = await ctx.runQuery(
        submissionsInternalApi.submissions.getSubmissionInternal,
        {
          submissionId: args.submissionId,
        },
      );
    }

    console.log('[RefreshIndexing] Completed status refresh', {
      submissionId: args.submissionId,
      newProcessingState: updatedSubmission?.source?.processingState ?? null,
      newAiSearchSyncCompletedAt: updatedSubmission?.source?.aiSearchSyncCompletedAt ?? null,
    });

    return {
      processingState: updatedSubmission?.source?.processingState ?? null,
      aiSearchSyncCompletedAt: updatedSubmission?.source?.aiSearchSyncCompletedAt ?? null,
    };
  },
});

/**
 * Internal action to process submission
 * Called automatically when a submission is created and triggers the heavy Node action
 */
export const processSubmission = internalAction({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    try {
      // Get submission to check if it has a siteUrl
      const submission = await ctx.runQuery(internal.submissions.getSubmissionInternal, {
        submissionId: args.submissionId,
      });

      // Fetch README (runs in parallel, doesn't block)
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.submissionsActions.repoProcessing.fetchReadmeFromGitHub,
          {
            submissionId: args.submissionId,
          },
        );
      } catch (error) {
        console.warn(`Failed to schedule README fetch:`, error);
        // Don't fail - README fetch is optional
      }

      // Trigger repo download/upload (but don't generate AI Search summary automatically)
      // AI Search summary is only generated when user clicks "Full Summary" button
      // Early summary (README + screenshots) will be generated automatically when README/repo/screenshots are ready
      try {
        // Schedule repo processing asynchronously so it runs in parallel with README fetch and screenshots
        await ctx.scheduler.runAfter(
          0,
          internal.submissionsActions.repoProcessing.downloadAndUploadRepoInternal,
          {
            submissionId: args.submissionId,
          },
        );
      } catch (error) {
        console.error(
          `Failed to schedule repo processing for submission ${args.submissionId}:`,
          error,
        );
        await markProcessingErrorWithFallback(
          ctx,
          args.submissionId,
          'Failed to start repository processing. Click "Retry Processing" to try again.',
        );
        return;
      }

      // Trigger screenshot capture if siteUrl is provided (runs in parallel with README fetch and repo upload)
      if (submission?.siteUrl?.trim()) {
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
            `Failed to schedule screenshot capture for submission ${args.submissionId}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error(`Failed to process submission ${args.submissionId}:`, error);
      // Don't throw - we want submission creation to succeed even if processing fails
    }
  },
});

/**
 * Update submission metadata
 */
export const updateSubmission = mutation({
  args: {
    submissionId: v.id('submissions'),
    title: v.optional(v.string()),
    team: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    siteUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    manualSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate URLs if provided
    if (args.siteUrl) {
      await assertHttpUrl(args.siteUrl, 'siteUrl');
    }

    if (args.videoUrl) {
      await assertHttpUrl(args.videoUrl, 'videoUrl');
    }

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership and ownership
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // Allow if user has admin/owner role OR is the submission owner
    const hasRole = await requireHackathonRole(ctx, submission.hackathonId, [
      'owner',
      'admin',
    ]).catch(() => null);
    const isOwner = submission.userId === userId;

    if (!hasRole && !isOwner) {
      throw new Error('Insufficient permissions. You can only edit your own submissions.');
    }

    const updateData: {
      title?: string;
      team?: string;
      repoUrl?: string;
      siteUrl?: string;
      videoUrl?: string;
      manualSummary?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) {
      updateData.title = args.title.trim();
    }
    if (args.team !== undefined) {
      updateData.team = args.team.trim();
    }
    if (args.repoUrl !== undefined) {
      updateData.repoUrl = args.repoUrl.trim();
    }
    if (args.siteUrl !== undefined) {
      updateData.siteUrl = args.siteUrl.trim();
    }
    if (args.videoUrl !== undefined) {
      updateData.videoUrl = args.videoUrl.trim();
    }
    if (args.manualSummary !== undefined) {
      updateData.manualSummary = args.manualSummary.trim();
    }

    await ctx.db.patch(args.submissionId, updateData);

    // Trigger screenshot capture if siteUrl was added or updated
    // Note: If repo upload is in progress, screenshot will also be captured during upload
    // This ensures we capture even if repo was already uploaded
    if (args.siteUrl?.trim()) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.submissionsActions.screenshot.captureScreenshotInternal,
          {
            submissionId: args.submissionId,
          },
        );
      } catch (error) {
        console.error('Failed to schedule screenshot capture:', error);
        // Don't throw - submission update should succeed even if scheduling fails
      }
    }

    return { success: true };
  },
});

/**
 * Delete submission (owner/admin only)
 * Also deletes associated R2 files automatically
 */
export const deleteSubmission = mutation({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership and ownership
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // Allow if user has admin/owner role OR is the submission owner
    const hasRole = await requireHackathonRole(ctx, submission.hackathonId, [
      'owner',
      'admin',
    ]).catch(() => null);
    const isOwner = submission.userId === userId;

    if (!hasRole && !isOwner) {
      throw new Error('Insufficient permissions. You can only delete your own submissions.');
    }

    // Delete all R2 files for this submission (fire and forget - don't block deletion if R2 deletion fails)
    // Use the broader prefix to clean up both files and screenshots
    const r2PathPrefix = `repos/${args.submissionId}`;
    await ctx.scheduler.runAfter(
      0,
      internal.submissionsActions.r2Cleanup.deleteSubmissionR2FilesAction,
      {
        r2PathPrefix,
      },
    );

    // Delete the submission
    await ctx.db.delete(args.submissionId);

    return { success: true };
  },
});

/**
 * Update AI summary results
 * Requires hackathon membership (owner/admin/judge)
 */
export const updateSubmissionAI = mutation({
  args: {
    submissionId: v.id('submissions'),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership - only owners, admins, and judges can update AI data
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin', 'judge']);

    const aiData = {
      ...submission.ai,
      summary: args.summary ?? submission.ai?.summary,
      lastReviewedAt: args.summary ? Date.now() : submission.ai?.lastReviewedAt,
    };

    await ctx.db.patch(args.submissionId, {
      ai: aiData,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Internal mutation to update AI summary results (no auth check)
 */
export const updateSubmissionAIInternal = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    summary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const aiData = {
      ...submission.ai,
      summary: args.summary ?? submission.ai?.summary,
      lastReviewedAt: args.summary ? Date.now() : submission.ai?.lastReviewedAt,
    };

    await ctx.db.patch(args.submissionId, {
      ai: aiData,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update submission source (R2 key, upload status, AI summary)
 * Requires hackathon membership (owner/admin/judge)
 */
export const updateSubmissionSource = mutation({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.optional(v.string()),
    uploadedAt: v.optional(v.number()),
    aiSummary: v.optional(v.string()),
    summarizedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership - only owners, admins, and judges can update source data
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin', 'judge']);

    const sourceData = {
      ...submission.source,
      r2Key: args.r2Key ?? submission.source?.r2Key,
      uploadedAt: args.uploadedAt ?? submission.source?.uploadedAt,
      aiSummary: args.aiSummary ?? submission.source?.aiSummary,
      summarizedAt: args.summarizedAt ?? submission.source?.summarizedAt,
    };

    await ctx.db.patch(args.submissionId, {
      source: sourceData,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Internal query to get submission (used by actions)
 */
export const getSubmissionInternal = internalQuery({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.submissionId);
  },
});

/**
 * Internal mutation to update submission source (used by actions)
 */
export const updateSubmissionSourceInternal = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.optional(v.string()),
    uploadedAt: v.optional(v.number()),
    uploadStartedAt: v.optional(v.number()),
    uploadCompletedAt: v.optional(v.number()),
    aiSearchSyncStartedAt: v.optional(v.number()),
    aiSearchSyncCompletedAt: v.optional(v.number()),
    aiSearchSyncJobId: v.optional(v.string()),
    aiSummary: v.optional(v.string()),
    summarizedAt: v.optional(v.number()),
    summaryGenerationStartedAt: v.optional(v.number()),
    summaryGenerationCompletedAt: v.optional(v.number()),
    screenshotCaptureStartedAt: v.optional(v.number()),
    screenshotCaptureCompletedAt: v.optional(v.number()),
    readme: v.optional(v.string()),
    readmeFilename: v.optional(v.string()),
    readmeFetchedAt: v.optional(v.number()),
    processingState: v.optional(
      v.union(
        v.literal('downloading'),
        v.literal('uploading'),
        v.literal('indexing'),
        v.literal('generating'),
        v.literal('complete'),
        v.literal('error'),
      ),
    ),
    processingError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const sourceData = {
      ...submission.source,
      r2Key: args.r2Key ?? submission.source?.r2Key,
      uploadedAt: args.uploadedAt ?? submission.source?.uploadedAt,
      uploadStartedAt: args.uploadStartedAt ?? submission.source?.uploadStartedAt,
      uploadCompletedAt: args.uploadCompletedAt ?? submission.source?.uploadCompletedAt,
      aiSearchSyncStartedAt: args.aiSearchSyncStartedAt ?? submission.source?.aiSearchSyncStartedAt,
      aiSearchSyncCompletedAt:
        args.aiSearchSyncCompletedAt ?? submission.source?.aiSearchSyncCompletedAt,
      aiSearchSyncJobId: args.aiSearchSyncJobId ?? submission.source?.aiSearchSyncJobId,
      aiSummary: args.aiSummary ?? submission.source?.aiSummary,
      summarizedAt: args.summarizedAt ?? submission.source?.summarizedAt,
      summaryGenerationStartedAt:
        args.summaryGenerationStartedAt ?? submission.source?.summaryGenerationStartedAt,
      summaryGenerationCompletedAt:
        args.summaryGenerationCompletedAt ?? submission.source?.summaryGenerationCompletedAt,
      screenshotCaptureStartedAt:
        args.screenshotCaptureStartedAt ?? submission.source?.screenshotCaptureStartedAt,
      screenshotCaptureCompletedAt:
        args.screenshotCaptureCompletedAt ?? submission.source?.screenshotCaptureCompletedAt,
      readme: args.readme ?? submission.source?.readme,
      readmeFilename: args.readmeFilename ?? submission.source?.readmeFilename,
      readmeFetchedAt: args.readmeFetchedAt ?? submission.source?.readmeFetchedAt,
      processingState: args.processingState ?? submission.source?.processingState,
      // Clear processingError if explicitly set to empty string, otherwise keep existing or use new value
      processingError:
        args.processingError !== undefined
          ? args.processingError === ''
            ? undefined
            : args.processingError
          : submission.source?.processingError,
    };

    await ctx.db.patch(args.submissionId, {
      source: sourceData,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Minimal internal mutation to mark a submission's processing state as errored.
 * Used as a fallback when updateSubmissionSourceInternal fails in actions.
 */
export const markProcessingErrorInternal = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    processingError: v.string(),
    processingState: v.optional(
      v.union(
        v.literal('downloading'),
        v.literal('uploading'),
        v.literal('indexing'),
        v.literal('generating'),
        v.literal('complete'),
        v.literal('error'),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const nextSource = {
      ...submission.source,
      processingState: args.processingState ?? 'error',
      processingError: args.processingError,
    };

    await ctx.db.patch(args.submissionId, {
      source: nextSource,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Add screenshot to submission (internal mutation)
 */
export const addScreenshot = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    screenshot: v.object({
      r2Key: v.string(),
      url: v.string(),
      capturedAt: v.number(),
      pageUrl: v.optional(v.string()),
      pageName: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const screenshots = submission.screenshots || [];
    screenshots.push(args.screenshot);

    await ctx.db.patch(args.submissionId, {
      screenshots,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Add multiple screenshots to submission atomically (internal mutation)
 * This is more efficient than calling addScreenshot multiple times
 */
export const addScreenshots = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    screenshots: v.array(
      v.object({
        r2Key: v.string(),
        url: v.string(),
        capturedAt: v.number(),
        pageUrl: v.optional(v.string()),
        pageName: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const existingScreenshots = submission.screenshots || [];
    const allScreenshots = [...existingScreenshots, ...args.screenshots];

    await ctx.db.patch(args.submissionId, {
      screenshots: allScreenshots,
      updatedAt: Date.now(),
    });

    return { success: true, added: args.screenshots.length };
  },
});

/**
 * Clear all screenshots from submission (internal mutation)
 * Used when retrying processing to start fresh
 */
export const clearScreenshots = internalMutation({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    await ctx.db.patch(args.submissionId, {
      screenshots: [],
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Remove screenshot from submission (public mutation for optimistic updates)
 */
export const removeScreenshot = mutation({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.string(),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership - only owners, admins, and judges can delete screenshots
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin', 'judge']);

    // Verify the screenshot exists
    const screenshots = submission.screenshots || [];
    const screenshot = screenshots.find((s) => s.r2Key === args.r2Key);
    if (!screenshot) {
      throw new Error('Screenshot not found');
    }

    const filteredScreenshots = screenshots.filter((s) => s.r2Key !== args.r2Key);

    await ctx.db.patch(args.submissionId, {
      screenshots: filteredScreenshots,
      updatedAt: Date.now(),
    });

    // Delete the screenshot from R2 storage (fire and forget)
    try {
      await ctx.scheduler.runAfter(
        0,
        internal.submissionsActions.screenshot.deleteScreenshotFromR2Internal,
        {
          r2Key: args.r2Key,
        },
      );
    } catch (error) {
      console.error('Failed to schedule R2 screenshot deletion:', error);
      // Don't throw - screenshot removal should succeed even if R2 deletion fails
    }

    return { success: true };
  },
});

/**
 * Remove screenshot from submission (internal mutation - kept for backward compatibility)
 */
export const removeScreenshotInternal = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    r2Key: v.string(),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const screenshots = submission.screenshots || [];
    const filteredScreenshots = screenshots.filter((s) => s.r2Key !== args.r2Key);

    await ctx.db.patch(args.submissionId, {
      screenshots: filteredScreenshots,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Upsert rating for submission
 * Requires owner/admin/judge role
 */
export const upsertRating = mutation({
  args: {
    submissionId: v.id('submissions'),
    rating: v.number(),
  },
  handler: async (ctx, args) => {
    // Validate rating is between 0 and 10
    if (args.rating < 0 || args.rating > 10) {
      throw new Error('Rating must be between 0 and 10');
    }

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Get hackathon to check if voting is closed
    const hackathon = await ctx.db.get(submission.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if voting is closed
    if (hackathon.votingClosedAt) {
      throw new Error('Voting has ended. No new ratings can be submitted.');
    }

    // Check membership - only owners, admins, and judges can rate
    const { userId } = await requireHackathonRole(ctx, submission.hackathonId, [
      'owner',
      'admin',
      'judge',
    ]);

    const now = Date.now();

    // Check if rating already exists
    const existingRating = await ctx.db
      .query('ratings')
      .withIndex('by_userId_submissionId', (q) =>
        q.eq('userId', userId).eq('submissionId', args.submissionId),
      )
      .first();

    if (existingRating) {
      // Update existing rating
      await ctx.db.patch(existingRating._id, {
        rating: args.rating,
        updatedAt: now,
      });
      return { ratingId: existingRating._id };
    }

    // Create new rating
    const ratingId = await ctx.db.insert('ratings', {
      submissionId: args.submissionId,
      hackathonId: submission.hackathonId,
      userId,
      rating: args.rating,
      createdAt: now,
      updatedAt: now,
    });

    return { ratingId };
  },
});

/**
 * Get current user's rating for a submission
 *
 * ACCESS CONTROL: Returns null if user is not authenticated or doesn't have access
 */
export const getUserRating = query({
  args: {
    submissionId: v.id('submissions'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'User ID not found');

    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      return null;
    }

    // Check membership
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', submission.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (!membership || membership.status !== 'active') {
      return null;
    }

    // Get user's rating
    const rating = await ctx.db
      .query('ratings')
      .withIndex('by_userId_submissionId', (q) =>
        q.eq('userId', userId).eq('submissionId', args.submissionId),
      )
      .first();

    return rating;
  },
});

/**
 * Migrate existing submissions from youtubeUrl to videoUrl field
 * This should be run once after updating the schema to support both fields
 */
export const migrateYoutubeUrlToVideoUrl = guarded.action('user.write', {}, async (ctx) => {
  // Query all submissions that have youtubeUrl but not videoUrl
  const submissionsWithYoutubeUrl = await ctx.runQuery(
    internal.submissions.getSubmissionsForMigration,
    {},
  );

  console.log(`Found ${submissionsWithYoutubeUrl.length} submissions with youtubeUrl to migrate`);

  let migrated = 0;
  let errors = 0;

  for (const submission of submissionsWithYoutubeUrl) {
    try {
      // Skip if videoUrl already exists (already migrated)
      if (submission.videoUrl) {
        console.log(`Skipping submission ${submission._id} - already has videoUrl`);
        continue;
      }

      // Migrate youtubeUrl to videoUrl using internal mutation
      if (submission.youtubeUrl) {
        await ctx.runMutation(internal.submissions.migrateSubmissionUrl, {
          submissionId: submission._id,
          youtubeUrl: submission.youtubeUrl,
        });
      }

      migrated++;
      console.log(`Migrated submission ${submission._id}: ${submission.title}`);
    } catch (error) {
      console.error(`Failed to migrate submission ${submission._id}:`, error);
      errors++;
    }
  }

  return {
    success: errors === 0,
    message: `Migration complete: ${migrated} submissions migrated, ${errors} errors`,
    migrated,
    errors,
  };
});

/**
 * Internal query to get submissions that need migration
 */
export const getSubmissionsForMigration = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('submissions')
      .filter((q) => q.neq(q.field('youtubeUrl'), undefined))
      .collect();
  },
});

/**
 * Internal mutation to migrate a single submission's URL
 */
export const migrateSubmissionUrl = internalMutation({
  args: {
    submissionId: v.id('submissions'),
    youtubeUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Skip if already migrated
    if (submission.videoUrl) {
      return;
    }

    // Migrate youtubeUrl to videoUrl
    await ctx.db.patch(args.submissionId, {
      videoUrl: args.youtubeUrl,
      youtubeUrl: undefined, // Remove the old field
    });
  },
});

/**
 * Seed hackathon with submissions (admin only)
 * Creates multiple submissions from provided data with 5-second delays between each
 */
export const seedHackathonSubmissions = guarded.action(
  'user.write',
  {
    hackathonId: v.id('hackathons'),
    submissions: v.array(
      v.object({
        repoUrl: v.string(),
        siteUrl: v.optional(v.string()),
        videoUrl: v.optional(v.string()),
        team: v.string(),
        title: v.string(),
      }),
    ),
  },
  async (ctx, args, _role) => {
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }
    const userId = assertUserId(authUser, 'User ID not found');

    // For actions, we need to check access via query since actions don't have direct db access
    const hackathon = await ctx.runQuery(internal.hackathons.getHackathonInternal, {
      hackathonId: args.hackathonId,
    });

    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Note: Admin role check is already handled by the guarded wrapper using 'user.write' capability

    const results = [];
    const errors = [];

    for (let i = 0; i < args.submissions.length; i++) {
      const submissionData = args.submissions[i];

      try {
        // Create submission using internal mutation (bypasses credit checks for admin seeding)
        const result = await ctx.runMutation(
          submissionsInternalApi.submissions.createSubmissionInternal,
          {
            hackathonId: args.hackathonId,
            userId,
            title: submissionData.title,
            team: submissionData.team,
            repoUrl: submissionData.repoUrl,
            siteUrl: submissionData.siteUrl,
            videoUrl: submissionData.videoUrl,
            usingPaidCredit: false, // Admin seeding doesn't consume credits
          },
        );

        results.push({
          index: i,
          submissionId: result.submissionId,
          title: submissionData.title,
          team: submissionData.team,
        });

        console.log(
          `Created submission ${i + 1}/${args.submissions.length}: ${submissionData.title}`,
        );

        // Wait 5 seconds before creating the next submission (except for the last one)
        if (i < args.submissions.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Failed to create submission ${i + 1}: ${submissionData.title}`, error);
        errors.push({
          index: i,
          title: submissionData.title,
          team: submissionData.team,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      success: errors.length === 0,
      message: `Created ${results.length} submissions${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
      results,
      errors,
    };
  },
);
