import { assertUserId } from '../src/lib/shared/user-id';
import { v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { requireHackathonRole } from './hackathons';

type SubmissionStatus = 'submitted' | 'review' | 'shortlist' | 'winner';

const ALLOWED_STATUS_TRANSITIONS: Record<SubmissionStatus, SubmissionStatus[]> = {
  submitted: ['review', 'submitted'],
  review: ['shortlist', 'review', 'submitted'],
  shortlist: ['winner', 'shortlist', 'review'],
  winner: ['winner', 'shortlist'],
};

/**
 * List submissions by hackathon
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

    return submissions;
  },
});

/**
 * Get single submission
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

    return submission;
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
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin', 'judge']);

    const now = Date.now();

    const submissionId = await ctx.db.insert('submissions', {
      hackathonId: args.hackathonId,
      title: args.title.trim(),
      team: args.team.trim(),
      repoUrl: args.repoUrl.trim(),
      siteUrl: args.siteUrl?.trim(),
      status: 'submitted',
      createdAt: now,
      updatedAt: now,
    });

    return { submissionId };
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

    return { success: true };
  },
});

/**
 * Update submission status (validates allowed transitions)
 */
export const updateSubmissionStatus = mutation({
  args: {
    submissionId: v.id('submissions'),
    status: v.union(
      v.literal('submitted'),
      v.literal('review'),
      v.literal('shortlist'),
      v.literal('winner'),
    ),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Check membership
    await requireHackathonRole(ctx, submission.hackathonId, ['owner', 'admin', 'judge']);

    // Validate transition
    const currentStatus = submission.status;
    const allowedTransitions = ALLOWED_STATUS_TRANSITIONS[currentStatus] ?? [];
    if (!allowedTransitions.includes(args.status)) {
      throw new Error(
        `Invalid status transition: ${currentStatus} → ${args.status}. Allowed: ${allowedTransitions.join(', ')}`,
      );
    }

    await ctx.db.patch(args.submissionId, {
      status: args.status,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update AI review results (clears inFlight flag)
 */
export const updateSubmissionAI = mutation({
  args: {
    submissionId: v.id('submissions'),
    summary: v.optional(v.string()),
    score: v.optional(v.number()),
    inFlight: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) {
      throw new Error('Submission not found');
    }

    const aiData = {
      ...submission.ai,
      summary: args.summary ?? submission.ai?.summary,
      score: args.score ?? submission.ai?.score,
      lastReviewedAt: args.summary || args.score ? Date.now() : submission.ai?.lastReviewedAt,
      inFlight: args.inFlight ?? false,
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
    aiSummary: v.optional(v.string()),
    summarizedAt: v.optional(v.number()),
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


