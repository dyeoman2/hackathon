import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireHackathonRole } from './hackathons';

// Emoji scale matching the rating slider (0-10)
const EMOJI_SCALE = ['💀', '😬', '🥴', '🫠', '😅', '🙂', '🔥', '🚀', '🤯', '👑'];

// Valid phase types
type RevealPhase =
  | 'idle'
  | 'countdown'
  | 'tally'
  | 'podiumReady'
  | 'reveal3rd'
  | 'reveal2nd'
  | 'reveal1st'
  | 'complete'; // Legacy phase for backwards compatibility

// Phase transition map for validation
const PHASE_TRANSITIONS: Record<RevealPhase, RevealPhase[]> = {
  idle: ['tally'],
  countdown: ['tally'], // Keep for backwards compatibility
  tally: ['podiumReady'],
  podiumReady: ['reveal3rd'],
  reveal3rd: ['reveal2nd'],
  reveal2nd: ['reveal1st'],
  reveal1st: [], // End of reveal sequence - use resetReveal to go back to idle
  complete: [], // Legacy complete phase - no transitions allowed
};

// Reverse phase transition map for going backwards
const REVERSE_PHASE_TRANSITIONS: Record<RevealPhase, RevealPhase | null> = {
  idle: null, // Cannot go back from idle
  countdown: null, // Keep for backwards compatibility
  tally: 'idle',
  podiumReady: 'tally',
  reveal3rd: 'podiumReady',
  reveal2nd: 'reveal3rd',
  reveal1st: 'reveal2nd',
  complete: 'reveal1st', // Legacy complete phase goes back to reveal1st
};

/**
 * Get reveal state for a hackathon
 *
 * Returns null for unauthorized users to allow graceful handling
 */
export const getRevealState = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Check if user has access to this hackathon
    try {
      await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin', 'judge']);
    } catch {
      return null;
    }

    // Get or create reveal state
    const revealState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    // Return existing state or default idle state
    if (revealState) {
      return revealState;
    }

    // Return default idle state (not persisted yet)
    return {
      hackathonId: args.hackathonId,
      phase: 'idle' as const,
      startedAt: undefined,
      revealedRanks: [],
      controlledBy: undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
});

/**
 * Get submissions sorted by average rating for reveal sequence
 *
 * Returns null for unauthorized users
 */
export const getRevealSubmissions = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Check if user has access to this hackathon
    try {
      await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin', 'judge']);
    } catch {
      return null;
    }

    // Get all submissions for this hackathon
    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Get all ratings for this hackathon
    const allRatings = await ctx.db
      .query('ratings')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Build ratings data for each submission
    const submissionsWithRatings = submissions.map((submission) => {
      const submissionRatings = allRatings.filter((r) => r.submissionId === submission._id);

      // Calculate average rating
      const averageRating =
        submissionRatings.length > 0
          ? submissionRatings.reduce((sum, r) => sum + r.rating, 0) / submissionRatings.length
          : 0;

      // Map ratings to emojis
      const emojiVotes = submissionRatings.map((r) => EMOJI_SCALE[r.rating] ?? '🙂');

      return {
        _id: submission._id,
        title: submission.title,
        team: submission.team,
        repoUrl: submission.repoUrl,
        siteUrl: submission.siteUrl,
        screenshots: submission.screenshots,
        averageRating,
        ratingCount: submissionRatings.length,
        emojiVotes,
      };
    });

    // Sort by average rating (highest first)
    const sorted = submissionsWithRatings.sort((a, b) => b.averageRating - a.averageRating);

    // Add rank to each submission
    return sorted.map((submission, index) => ({
      ...submission,
      rank: index + 1,
    }));
  },
});

/**
 * Start or reset the reveal sequence
 *
 * Only owner/admin can control reveals
 */
export const startReveal = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can start reveals
    const { userId } = await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const now = Date.now();

    // Check if reveal state exists
    const existingState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    if (existingState) {
      // Update existing state - don't set startedAt yet, wait for user to click "Tally the Votes"
      await ctx.db.patch(existingState._id, {
        phase: 'tally',
        startedAt: undefined,
        revealedRanks: [],
        controlledBy: userId,
        updatedAt: now,
      });
      return existingState._id;
    }

    // Create new reveal state - don't set startedAt yet, wait for user to click "Tally the Votes"
    const revealStateId = await ctx.db.insert('revealState', {
      hackathonId: args.hackathonId,
      phase: 'tally',
      startedAt: undefined,
      revealedRanks: [],
      controlledBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return revealStateId;
  },
});

/**
 * Start the tallying timer
 *
 * Only owner/admin can start tallying
 */
export const startTallying = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can start tallying
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const revealState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    if (!revealState) {
      throw new Error('Reveal not started');
    }

    if (revealState.phase !== 'tally') {
      throw new Error('Can only start tallying when in tally phase');
    }

    const now = Date.now();

    // Start the timer by setting startedAt
    await ctx.db.patch(revealState._id, {
      startedAt: now,
      updatedAt: now,
    });

    return { startedAt: now };
  },
});

/**
 * Advance to the next phase in the reveal sequence
 *
 * Only owner/admin can advance phases
 */
export const advanceReveal = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can advance reveals
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const revealState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    if (!revealState) {
      throw new Error('Reveal not started');
    }

    const currentPhase = revealState.phase;
    const allowedNextPhases = PHASE_TRANSITIONS[currentPhase];

    if (!allowedNextPhases || allowedNextPhases.length === 0) {
      throw new Error(`Cannot advance from phase: ${currentPhase}`);
    }

    // Determine next phase
    const nextPhase = allowedNextPhases[0];

    // Update revealed ranks if revealing a podium position
    const newRevealedRanks = [...revealState.revealedRanks];
    if (nextPhase === 'reveal3rd') {
      newRevealedRanks.push(3);
    } else if (nextPhase === 'reveal2nd') {
      newRevealedRanks.push(2);
    } else if (nextPhase === 'reveal1st') {
      newRevealedRanks.push(1);
    }

    const now = Date.now();

    // Update reveal state
    await ctx.db.patch(revealState._id, {
      phase: nextPhase,
      startedAt: now,
      revealedRanks: newRevealedRanks,
      updatedAt: now,
    });

    return { phase: nextPhase, revealedRanks: newRevealedRanks };
  },
});

/**
 * Go back to the previous phase in the reveal sequence
 *
 * Only owner/admin can go back phases
 */
export const goBackReveal = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can go back reveals
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const revealState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    if (!revealState) {
      throw new Error('Reveal not started');
    }

    const currentPhase = revealState.phase;
    const previousPhase = REVERSE_PHASE_TRANSITIONS[currentPhase];

    if (previousPhase === null) {
      throw new Error(`Cannot go back from phase: ${currentPhase}`);
    }

    // Update revealed ranks if going back from a podium position
    const newRevealedRanks = [...revealState.revealedRanks];
    if (currentPhase === 'reveal2nd') {
      // Remove the 2nd place rank
      const index = newRevealedRanks.indexOf(2);
      if (index > -1) newRevealedRanks.splice(index, 1);
    } else if (currentPhase === 'reveal1st') {
      // Remove the 1st place rank
      const index = newRevealedRanks.indexOf(1);
      if (index > -1) newRevealedRanks.splice(index, 1);
    } else if (currentPhase === 'reveal3rd') {
      // Remove the 3rd place rank
      const index = newRevealedRanks.indexOf(3);
      if (index > -1) newRevealedRanks.splice(index, 1);
    }

    const now = Date.now();

    // Update reveal state
    await ctx.db.patch(revealState._id, {
      phase: previousPhase,
      startedAt: previousPhase === 'idle' ? undefined : now,
      revealedRanks: newRevealedRanks,
      updatedAt: now,
    });

    return { phase: previousPhase, revealedRanks: newRevealedRanks };
  },
});

/**
 * Reset reveal to idle state for testing
 *
 * Only owner/admin can reset. Handles legacy 'complete' phase.
 */
export const resetReveal = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can reset reveals
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const revealState = await ctx.db
      .query('revealState')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .first();

    if (!revealState) {
      // No state to reset
      return null;
    }

    const now = Date.now();

    // Reset to idle state - works for any phase including legacy 'complete'
    await ctx.db.patch(revealState._id, {
      phase: 'idle',
      startedAt: undefined,
      revealedRanks: [],
      controlledBy: undefined,
      updatedAt: now,
    });

    return revealState._id;
  },
});
