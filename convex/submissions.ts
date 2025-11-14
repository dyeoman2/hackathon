import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { internal } from './_generated/api';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import { authComponent } from './auth';
import { requireHackathonRole } from './hackathons';

// Status transitions are now unrestricted - any status can transition to any other status

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
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
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
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Get all ratings for these submissions
    const allRatings = await ctx.db
      .query('ratings')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Build a map of ratings by submission ID
    const ratingsBySubmission = new Map<
      string,
      { myRating: number | null; averageRating: number | null }
    >();

    for (const submission of submissions) {
      const submissionRatings = allRatings.filter((r) => r.submissionId === submission._id);
      const myRating = submissionRatings.find((r) => r.userId === userId)?.rating ?? null;
      const averageRating =
        submissionRatings.length > 0
          ? submissionRatings.reduce((sum, r) => sum + r.rating, 0) / submissionRatings.length
          : null;

      ratingsBySubmission.set(submission._id, { myRating, averageRating });
    }

    // Add rating data to each submission
    return submissions.map((submission) => ({
      ...submission,
      myRating: ratingsBySubmission.get(submission._id)?.myRating ?? null,
      averageRating: ratingsBySubmission.get(submission._id)?.averageRating ?? null,
    }));
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

    // Get ratings for this submission
    const allRatings = await ctx.db
      .query('ratings')
      .withIndex('by_submissionId', (q) => q.eq('submissionId', args.submissionId))
      .collect();

    const myRating = allRatings.find((r) => r.userId === userId)?.rating ?? null;
    const averageRating =
      allRatings.length > 0
        ? allRatings.reduce((sum, r) => sum + r.rating, 0) / allRatings.length
        : null;

    return {
      ...submission,
      myRating,
      averageRating,
    };
  },
});

/**
 * Create submission in hackathon
 */
export const createSubmission = mutation({
  args: {
    hackathonId: v.id('hackathons'),
    title: v.string(),
    team: v.string(),
    repoUrl: v.string(),
    siteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check membership - any active member can create submissions
    const { hackathon } = await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin', 'judge']);

    // Check if hackathon has ended
    if (hackathon.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline) {
      throw new Error('Cannot create submissions for hackathons that have ended');
    }

    const now = Date.now();

    const submissionId = await ctx.db.insert('submissions', {
      hackathonId: args.hackathonId,
      title: args.title.trim(),
      team: args.team.trim(),
      repoUrl: args.repoUrl.trim(),
      siteUrl: args.siteUrl?.trim(),
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
    } catch (error) {
      console.error('Failed to schedule submission processing:', error);
      // Don't throw - submission creation should succeed even if scheduling fails
    }

    return { submissionId };
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
      // Fetch README first (runs in parallel, doesn't block)
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
      // Early summary (README + screenshots) will be generated automatically when screenshots are captured
      try {
        // Use the internal action (no auth required for automated processes)
        await ctx.runAction(
          internal.submissionsActions.repoProcessing.downloadAndUploadRepoInternal,
          {
            submissionId: args.submissionId,
          },
        );
      } catch (error) {
        console.error(`Failed to download/upload repo for submission ${args.submissionId}:`, error);
        // Don't throw - submission creation should succeed even if repo processing fails
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
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin', 'judge']);

    const updateData: {
      title?: string;
      team?: string;
      repoUrl?: string;
      siteUrl?: string;
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

    // Check membership - only owners and admins can delete submissions
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin']);

    // Delete R2 files if they exist (fire and forget - don't block deletion if R2 deletion fails)
    const r2PathPrefix = submission.source?.r2Key;
    if (r2PathPrefix) {
      // Schedule R2 deletion to run immediately after mutation completes
      await ctx.scheduler.runAfter(
        0,
        internal.submissionsActions.r2Cleanup.deleteSubmissionR2FilesAction,
        {
          r2PathPrefix,
        },
      );
    }

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
      ),
    ),
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
    };

    await ctx.db.patch(args.submissionId, {
      source: sourceData,
      updatedAt: Date.now(),
    });

    return { success: true };
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
