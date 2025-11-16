import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';

type HackathonRole = 'owner' | 'admin' | 'judge' | 'contestant';

interface RequireHackathonRoleResult {
  userId: string;
  role: HackathonRole;
  hackathon: {
    _id: Id<'hackathons'>;
    ownerUserId: string;
    title: string;
    description?: string;
    dates?: {
      start?: number;
      submissionDeadline?: number;
    };
    createdAt: number;
    updatedAt: number;
  };
  membership: {
    _id: Id<'memberships'>;
    hackathonId: Id<'hackathons'>;
    userId?: string;
    invitedEmail?: string;
    role: HackathonRole;
    status: 'invited' | 'active';
    tokenHash?: string;
    tokenExpiresAt?: number;
    invitedByUserId?: string;
    createdAt: number;
  };
}

/**
 * Require hackathon role helper
 * Gets current user from auth context, queries membership, validates role
 * Returns user, role, hackathon, and membership
 * Throws if unauthorized or hackathon not found
 */
export async function requireHackathonRole(
  ctx: QueryCtx | MutationCtx,
  hackathonId: Id<'hackathons'>,
  allowedRoles: HackathonRole[],
): Promise<RequireHackathonRoleResult> {
  // Get current user
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Authentication required');
  }

  const userId = assertUserId(authUser, 'User ID not found');

  // Get hackathon
  const hackathon = await ctx.db.get(hackathonId);
  if (!hackathon) {
    throw new Error('Hackathon not found');
  }

  // Get membership for user + hackathon
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_hackathonId', (q) => q.eq('hackathonId', hackathonId))
    .filter((q) => q.eq(q.field('userId'), userId))
    .first();

  if (!membership) {
    throw new Error('Not a member of this hackathon');
  }

  if (membership.status !== 'active') {
    throw new Error('Membership is not active');
  }

  // Validate role
  if (!allowedRoles.includes(membership.role)) {
    throw new Error(`Insufficient permissions. Required: ${allowedRoles.join(' or ')}`);
  }

  return {
    userId,
    role: membership.role,
    hackathon,
    membership,
  };
}

/**
 * List hackathons for current user
 * Returns owned + judging hackathons with role badges
 *
 * ACCESS CONTROL: This query intentionally returns an empty array `[]` for unauthenticated
 * users instead of throwing an error. This allows:
 * 1. Client components to render empty states gracefully without error boundaries
 * 2. Smooth UX when users navigate while signed out
 * 3. Avoid error boundary triggers for expected authentication failures
 *
 * This is a deliberate design choice for better UX. The client should check for empty
 * arrays and render appropriate UI (sign-in prompt, "no hackathons" message, etc.).
 */
export const listHackathons = query({
  args: {},
  handler: async (ctx) => {
    // Don't throw error if unauthenticated - just return empty array
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);
    if (!authUser) {
      return [];
    }

    const userId = assertUserId(authUser, 'User ID not found');

    // Get all memberships for this user
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('status'), 'active'))
      .collect();

    // Get hackathons for these memberships
    const hackathons = await Promise.all(
      memberships.map(async (membership) => {
        const hackathon = await ctx.db.get(membership.hackathonId);
        if (!hackathon) {
          return null;
        }
        return {
          ...hackathon,
          role: membership.role,
        };
      }),
    );

    // Filter out nulls and sort by createdAt descending (newest first)
    return hackathons
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * List all public hackathons (no authentication required)
 *
 * This allows anyone to discover and browse available hackathons
 */
export const listPublicHackathons = query({
  args: {},
  handler: async (ctx) => {
    const hackathons = await ctx.db
      .query('hackathons')
      .withIndex('by_createdAt', (q) => q)
      .order('desc') // Newest first
      .collect();

    // Return only public fields
    return hackathons.map((hackathon) => ({
      _id: hackathon._id,
      title: hackathon.title,
      description: hackathon.description,
      dates: hackathon.dates,
      createdAt: hackathon.createdAt,
      updatedAt: hackathon.updatedAt,
    }));
  },
});

/**
 * Get public hackathon data (no authentication required)
 *
 * This query provides basic hackathon information for public viewing,
 * allowing potential contestants to discover and learn about hackathons.
 */
export const getPublicHackathon = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      return null;
    }

    // Return only public fields - no sensitive data like ownerUserId
    return {
      _id: hackathon._id,
      title: hackathon.title,
      description: hackathon.description,
      dates: hackathon.dates,
      createdAt: hackathon.createdAt,
      updatedAt: hackathon.updatedAt,
    };
  },
});

/**
 * Get single hackathon with membership check
 *
 * ACCESS CONTROL: This query intentionally returns `null` for unauthenticated users or
 * users without active membership instead of throwing an error. This allows:
 * 1. Client components to handle "not found" vs "no access" states gracefully
 * 2. Smooth UX when users navigate while signed out or without access
 * 3. Avoid error boundary triggers for expected authorization failures
 *
 * This is a deliberate design choice for better UX. The client should check for `null`
 * and render appropriate UI (sign-in prompt, "no access" message, etc.).
 */
export const getHackathon = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Don't throw error if unauthenticated - just return null
    const authUser = await authComponent.getAuthUser(ctx).catch(() => null);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'User ID not found');

    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      return null;
    }

    // Check membership
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (!membership || membership.status !== 'active') {
      return null;
    }

    return {
      ...hackathon,
      role: membership.role,
    };
  },
});

/**
 * Create a contestant membership for a user in a hackathon
 * Called during registration when users register from a public hackathon page
 */
export const createContestantMembership = mutation({
  args: {
    hackathonId: v.id('hackathons'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify the hackathon exists
    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if membership already exists
    const existingMembership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), args.userId))
      .first();

    if (existingMembership) {
      // Already a member, just return
      return { success: true };
    }

    // Create contestant membership
    await ctx.db.insert('memberships', {
      hackathonId: args.hackathonId,
      userId: args.userId,
      role: 'contestant',
      status: 'active',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Join a hackathon as a contestant (for authenticated users)
 * Checks if the hackathon is still open before allowing join
 */
export const joinHackathon = mutation({
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

    // Verify the hackathon exists
    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if hackathon is still open (submission deadline hasn't passed)
    if (hackathon.dates?.submissionDeadline) {
      const now = Date.now();
      if (hackathon.dates.submissionDeadline <= now) {
        throw new Error('This hackathon is closed for new participants');
      }
    }

    // Check if membership already exists
    const existingMembership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .first();

    if (existingMembership) {
      // Already a member, just return
      return { success: true };
    }

    // Create contestant membership
    await ctx.db.insert('memberships', {
      hackathonId: args.hackathonId,
      userId,
      role: 'contestant',
      status: 'active',
      createdAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Get all memberships for a hackathon (owner/admin only)
 * Includes user emails for active memberships
 */
export const getHackathonMemberships = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    // Fetch user emails for active memberships with userId
    const activeUserIds = memberships
      .filter((m) => m.status === 'active' && m.userId)
      .map((m) => m.userId)
      .filter((id): id is string => id !== undefined);

    const userEmailsById = new Map<string, string>();
    const userNamesById = new Map<string, string>();
    if (activeUserIds.length > 0) {
      const remainingIds = new Set(activeUserIds);
      let cursor: string | null = null;
      let iterations = 0;
      const maxIterations = 100; // Safety limit

      try {
        while (remainingIds.size > 0 && iterations < maxIterations) {
          iterations++;
          const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'user',
            paginationOpts: {
              cursor,
              numItems: 1000,
              id: 0,
            },
          });

          const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
          const { page, continueCursor, isDone } = normalized;

          for (const authUser of page) {
            try {
              const authUserId = assertUserId(authUser, 'Better Auth user missing id');
              if (remainingIds.has(authUserId)) {
                userEmailsById.set(authUserId, authUser.email);
                userNamesById.set(authUserId, authUser.name || '');
                remainingIds.delete(authUserId);
              }
            } catch {
              // Ignore malformed user docs
            }
          }

          // Check if we should continue
          if (isDone || !continueCursor || page.length === 0) {
            break;
          }

          cursor = continueCursor;
        }
      } catch (error) {
        console.error('Failed to fetch Better Auth users by IDs:', error);
        // Continue with partial results
      }
    }

    // Return memberships with email and name information
    return memberships.map((membership) => ({
      ...membership,
      userEmail: membership.userId ? userEmailsById.get(membership.userId) || null : null,
      userName: membership.userId ? userNamesById.get(membership.userId) || null : null,
    }));
  },
});

/**
 * Create hackathon + owner membership
 */
export const createHackathon = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    dates: v.optional(
      v.object({
        start: v.optional(v.number()),
        submissionDeadline: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    const userId = assertUserId(authUser, 'User ID not found');
    const now = Date.now();

    // Create hackathon
    const hackathonId = await ctx.db.insert('hackathons', {
      ownerUserId: userId,
      title: args.title.trim(),
      description: args.description?.trim(),
      dates: args.dates,
      createdAt: now,
      updatedAt: now,
    });

    // Create owner membership
    await ctx.db.insert('memberships', {
      hackathonId,
      userId,
      role: 'owner',
      status: 'active',
      createdAt: now,
    });

    return { hackathonId };
  },
});

/**
 * Update hackathon (owner/admin only)
 */
export const updateHackathon = mutation({
  args: {
    hackathonId: v.id('hackathons'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    dates: v.optional(
      v.object({
        start: v.optional(v.number()),
        submissionDeadline: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    // Get the current hackathon to check voting status
    const currentHackathon = await ctx.db.get(args.hackathonId);
    if (!currentHackathon) {
      throw new Error('Hackathon not found');
    }

    const updateData: {
      title?: string;
      description?: string;
      dates?: {
        start?: number;
        submissionDeadline: number;
      };
      votingClosedAt?: undefined;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) {
      updateData.title = args.title.trim();
    }
    if (args.description !== undefined) {
      updateData.description = args.description.trim();
    }
    if (args.dates !== undefined) {
      updateData.dates = args.dates;

      // Check if we should reopen voting
      // If voting is closed and the new submission deadline is in the future, reopen voting
      const now = Date.now();
      const newDeadline = args.dates.submissionDeadline;
      const isDeadlineInFuture = newDeadline > now;
      const isVotingClosed = currentHackathon.votingClosedAt !== undefined;

      if (isVotingClosed && isDeadlineInFuture) {
        updateData.votingClosedAt = undefined;
      }
    }

    await ctx.db.patch(args.hackathonId, updateData);

    return { success: true };
  },
});

/**
 * Delete hackathon (owner/admin only)
 */
export const deleteHackathon = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    // Note: We allow deletion even if this is the only owner, since they're explicitly choosing to delete

    // Hard delete hackathon and all related data
    // Note: In production, you might want to soft delete
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    for (const membership of memberships) {
      await ctx.db.delete(membership._id);
    }

    // Delete submissions and their R2 files
    const submissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .collect();

    for (const submission of submissions) {
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

      await ctx.db.delete(submission._id);
    }

    await ctx.db.delete(args.hackathonId);

    return { success: true };
  },
});

/**
 * Invite judge to hackathon
 */
export const inviteJudge = mutation({
  args: {
    hackathonId: v.id('hackathons'),
    email: v.string(),
    role: v.union(v.literal('admin'), v.literal('judge')),
    appUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if email already has membership
    const existingMembership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('invitedEmail'), args.email))
      .first();

    if (existingMembership) {
      throw new Error('User already invited or is a member');
    }

    // Generate invite token
    // Create membership first to get ID for token
    const now = Date.now();
    const tokenExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    // Create membership with invited status (temporary, will update with token)
    const membershipId = await ctx.db.insert('memberships', {
      hackathonId: args.hackathonId,
      invitedEmail: args.email,
      role: args.role,
      status: 'invited',
      tokenExpiresAt,
      invitedByUserId: userId,
      createdAt: now,
    });

    // Generate token that includes membership ID for lookup
    const inviteTokenSecret =
      process.env.INVITE_TOKEN_SECRET || 'default-secret-change-in-production';
    const token = `${membershipId}-${args.hackathonId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const tokenHash = await hashToken(token, inviteTokenSecret);

    // Update membership with token hash
    await ctx.db.patch(membershipId, {
      tokenHash,
    });

    // Get inviter name from Better Auth
    let inviterName = 'Hackathon Team';
    try {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      const { page } = normalized;

      for (const authUser of page) {
        try {
          const authUserId = assertUserId(authUser, 'Better Auth user missing id');
          if (authUserId === userId) {
            inviterName = authUser.name || authUser.email || 'Hackathon Team';
            break;
          }
        } catch {
          // Continue searching
        }
      }
    } catch (error) {
      console.error('Failed to fetch inviter name:', error);
      // Continue with default name
    }

    // Schedule email to be sent (same pattern as password reset)
    await ctx.scheduler.runAfter(0, internal.emails.sendJudgeInviteEmailMutation, {
      email: args.email,
      hackathonTitle: hackathon.title,
      role: args.role,
      inviterName,
      inviteToken: token,
      appUrl: args.appUrl,
    });

    return { success: true, membershipId };
  },
});

/**
 * Resend invite to judge
 */
export const resendInvite = mutation({
  args: {
    membershipId: v.id('memberships'),
    appUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new Error('Membership not found');
    }

    // Check permissions and get current user
    const { userId } = await requireHackathonRole(ctx, membership.hackathonId, ['owner', 'admin']);

    if (membership.status !== 'invited') {
      throw new Error('Can only resend invites for pending invitations');
    }

    if (!membership.invitedEmail) {
      throw new Error('Membership missing invited email');
    }

    // Validate role (invites can only be for admin or judge, not owner)
    if (membership.role !== 'admin' && membership.role !== 'judge') {
      throw new Error('Can only resend invites for admin or judge roles');
    }

    // Get hackathon for email content
    const hackathon = await ctx.db.get(membership.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Generate new token
    const tokenExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    const inviteTokenSecret =
      process.env.INVITE_TOKEN_SECRET || 'default-secret-change-in-production';
    const token = `${membership._id}-${membership.hackathonId}-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    const tokenHash = await hashToken(token, inviteTokenSecret);

    // Update membership with new token
    await ctx.db.patch(args.membershipId, {
      tokenHash,
      tokenExpiresAt,
    });

    // Get current user name from Better Auth
    let inviterName = 'Hackathon Team';
    try {
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1,
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      const { page } = normalized;

      for (const authUser of page) {
        try {
          const authUserId = assertUserId(authUser, 'Better Auth user missing id');
          if (authUserId === userId) {
            inviterName = authUser.name || authUser.email || 'Hackathon Team';
            break;
          }
        } catch {
          // Continue searching
        }
      }
    } catch (error) {
      console.error('Failed to fetch inviter name:', error);
      // Continue with default name
    }

    // Schedule email to be sent (same pattern as password reset)
    await ctx.scheduler.runAfter(0, internal.emails.sendJudgeInviteEmailMutation, {
      email: membership.invitedEmail,
      hackathonTitle: hackathon.title,
      role: membership.role,
      inviterName,
      inviteToken: token,
      appUrl: args.appUrl,
    });

    return { success: true };
  },
});

/**
 * Revoke invite (delete pending membership)
 */
export const revokeInvite = mutation({
  args: {
    membershipId: v.id('memberships'),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new Error('Membership not found');
    }

    // Check permissions
    await requireHackathonRole(ctx, membership.hackathonId, ['owner', 'admin']);

    if (membership.status !== 'invited') {
      throw new Error('Can only revoke pending invitations');
    }

    // Delete the membership
    await ctx.db.delete(args.membershipId);

    return { success: true };
  },
});

/**
 * Remove active judge/admin from hackathon
 * Only owner/admin can remove judges, cannot remove owner role, cannot remove yourself
 */
export const removeJudge = mutation({
  args: {
    membershipId: v.id('memberships'),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);
    if (!membership) {
      throw new Error('Membership not found');
    }

    // Check permissions - only owner/admin can remove judges
    const { userId } = await requireHackathonRole(ctx, membership.hackathonId, ['owner', 'admin']);

    if (membership.status !== 'active') {
      throw new Error('Can only remove active members');
    }

    if (membership.role === 'owner') {
      throw new Error('Cannot remove the hackathon owner');
    }

    // Cannot remove yourself
    if (membership.userId === userId) {
      throw new Error('Cannot remove yourself from the hackathon');
    }

    // Delete the membership
    await ctx.db.delete(args.membershipId);

    return { success: true };
  },
});

/**
 * Simple token hashing function (using Web Crypto API available in Convex)
 */
async function hashToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token + secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseInviteToken(token: string): {
  membershipId: Id<'memberships'>;
  hackathonId: Id<'hackathons'>;
} | null {
  const parts = token.split('-');
  if (parts.length < 4) {
    return null;
  }

  const [rawMembershipId, rawHackathonId] = parts;
  if (!rawMembershipId || !rawHackathonId) {
    return null;
  }

  return {
    membershipId: rawMembershipId as Id<'memberships'>,
    hackathonId: rawHackathonId as Id<'hackathons'>,
  };
}

async function findMembershipForInvite(
  ctx: QueryCtx | MutationCtx,
  token: string,
  tokenHash: string,
): Promise<Doc<'memberships'> | null> {
  const parsedToken = parseInviteToken(token);
  let membership: Doc<'memberships'> | null = null;

  if (parsedToken) {
    membership = await ctx.db.get(parsedToken.membershipId);

    if (membership?.hackathonId !== parsedToken.hackathonId) {
      membership = null;
    } else if (membership?.tokenHash !== tokenHash) {
      membership = null;
    }
  }

  if (!membership) {
    membership = await ctx.db
      .query('memberships')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first();
  }

  return membership;
}

/**
 * Validate invite token (returns membership info if valid)
 */
// Simple test query to check if Convex is working
export const testQuery = query({
  args: {},
  handler: async (_ctx) => {
    console.log('testQuery called - Convex is working!');
    return { message: 'Convex is working', timestamp: Date.now() };
  },
});

export const validateInviteToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    console.log('validateInviteToken called with token:', args.token);

    // Hash the provided token to compare with stored hash
    const inviteTokenSecret =
      process.env.INVITE_TOKEN_SECRET || 'default-secret-change-in-production';
    console.log('Using token secret:', inviteTokenSecret ? 'configured' : 'default');

    const tokenHash = await hashToken(args.token, inviteTokenSecret);
    console.log('Generated token hash:', tokenHash);

    const membership = await findMembershipForInvite(ctx, args.token, tokenHash);

    console.log('Membership found:', membership ? 'YES' : 'NO');
    if (membership) {
      console.log('Membership details:', {
        id: membership._id,
        status: membership.status,
        tokenExpiresAt: membership.tokenExpiresAt,
        invitedEmail: membership.invitedEmail,
      });
    }

    if (!membership) {
      return { status: 'invalid' as const };
    }

    if (membership.status !== 'invited') {
      return { status: 'used' as const };
    }

    if (membership.tokenExpiresAt && membership.tokenExpiresAt < Date.now()) {
      return { status: 'expired' as const };
    }

    // Get hackathon info
    const hackathon = await ctx.db.get(membership.hackathonId);
    if (!hackathon) {
      return { status: 'invalid' as const };
    }

    // Get inviter info from Better Auth
    let inviterName = 'Hackathon Owner'; // Default fallback
    if (membership.invitedByUserId) {
      try {
        // Query for the specific user by ID
        const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
          model: 'user',
          paginationOpts: {
            cursor: null,
            numItems: 1000,
            id: 0,
          },
        });

        const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
        const { page } = normalized;

        // Find the user with matching ID
        const authUser = page.find((user) => {
          try {
            const userId = assertUserId(user, 'Better Auth user missing id');
            return userId === membership.invitedByUserId;
          } catch {
            return false;
          }
        });

        if (authUser?.name) {
          inviterName = authUser.name;
        }
      } catch (error) {
        console.error('Error fetching inviter info:', error);
        // Keep default fallback
      }
    }

    return {
      status: 'valid' as const,
      hackathonId: membership.hackathonId,
      hackathonTitle: hackathon.title,
      inviterName: inviterName || 'Hackathon Owner',
      membershipId: membership._id,
      invitedEmail: membership.invitedEmail,
    };
  },
});

/**
 * Accept invite - updates membership to active, sets userId, clears token
 */
export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Authentication required');
    }

    const userId = assertUserId(authUser, 'User ID not found');

    // Hash the provided token to compare with stored hash
    const inviteTokenSecret =
      process.env.INVITE_TOKEN_SECRET || 'default-secret-change-in-production';
    const tokenHash = await hashToken(args.token, inviteTokenSecret);

    // Find membership by token hash
    let membership = await findMembershipForInvite(ctx, args.token, tokenHash);

    if (!membership) {
      const parsedToken = parseInviteToken(args.token);
      if (parsedToken) {
        const membershipById = await ctx.db.get(parsedToken.membershipId);
        if (membershipById?.hackathonId === parsedToken.hackathonId) {
          membership = membershipById;
        }
      }
    }

    if (!membership) {
      throw new Error('Invalid invite token');
    }

    if (membership.status !== 'invited') {
      if (membership.status === 'active' && membership.userId === userId) {
        return { hackathonId: membership.hackathonId };
      }

      throw new Error('Invite already used');
    }

    if (membership.tokenExpiresAt && membership.tokenExpiresAt < Date.now()) {
      throw new Error('Invite token expired');
    }

    // Validate that the authenticated user's email matches the invited email (case-insensitive)
    if (
      membership.invitedEmail &&
      authUser.email &&
      authUser.email.toLowerCase() !== membership.invitedEmail.toLowerCase()
    ) {
      throw new Error('This invite is for a different email address');
    }

    // Update membership to active
    await ctx.db.patch(membership._id, {
      userId,
      status: 'active',
      tokenHash: undefined,
      tokenExpiresAt: undefined,
    });

    return { hackathonId: membership.hackathonId };
  },
});

/**
 * Internal query to get hackathon (no auth check)
 */
/**
 * Get membership for a user and hackathon (internal query for use in actions)
 */
export const getMembershipInternal = internalQuery({
  args: {
    hackathonId: v.id('hackathons'),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), args.userId))
      .first();

    return membership;
  },
});

export const getHackathonInternal = internalQuery({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.hackathonId);
  },
});

/**
 * Close voting and start reveal
 * Only owner/admin can close voting
 */
export const closeVotingAndStartReveal = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Only owner/admin can close voting
    const { userId } = await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if voting is already closed
    if (hackathon.votingClosedAt) {
      throw new Error('Voting is already closed');
    }

    const now = Date.now();

    // Close voting
    await ctx.db.patch(args.hackathonId, {
      votingClosedAt: now,
      updatedAt: now,
    });

    // Start reveal (create or update reveal state)
    // Duplicate the startReveal logic here since we can't call mutations from mutations
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
    } else {
      // Create new reveal state - don't set startedAt yet, wait for user to click "Tally the Votes"
      await ctx.db.insert('revealState', {
        hackathonId: args.hackathonId,
        phase: 'tally',
        startedAt: undefined,
        revealedRanks: [],
        controlledBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { votingClosedAt: now };
  },
});

/**
 * Reopen voting
 * Only owner/admin can reopen voting
 */
export const reopenVoting = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const hackathon = await ctx.db.get(args.hackathonId);
    if (!hackathon) {
      throw new Error('Hackathon not found');
    }

    // Check if voting is actually closed
    if (!hackathon.votingClosedAt) {
      throw new Error('Voting is not closed');
    }

    const now = Date.now();

    // Reopen voting by removing the votingClosedAt timestamp
    await ctx.db.patch(args.hackathonId, {
      votingClosedAt: undefined,
      updatedAt: now,
    });

    return { success: true };
  },
});

/**
 * Leave hackathon (any active member)
 * Removes all user submissions and membership from the hackathon
 */
export const leaveHackathon = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    // Get current user and verify membership
    const { userId, membership } = await requireHackathonRole(ctx, args.hackathonId, [
      'owner',
      'admin',
      'judge',
      'contestant',
    ]);

    // Cannot leave if you're the only owner
    if (membership.role === 'owner') {
      // Check if there are other owners
      const otherOwners = await ctx.db
        .query('memberships')
        .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
        .filter((q) => q.eq(q.field('role'), 'owner'))
        .filter((q) => q.neq(q.field('userId'), userId))
        .collect();

      if (otherOwners.length === 0) {
        throw new Error(
          'Cannot leave hackathon as the only owner. Transfer ownership first or delete the hackathon.',
        );
      }
    }

    // Find all submissions by this user in this hackathon
    const userSubmissions = await ctx.db
      .query('submissions')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('userId'), userId))
      .collect();

    // Delete all user submissions (this will also clean up R2 files via scheduler)
    for (const submission of userSubmissions) {
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

      await ctx.db.delete(submission._id);
    }

    // Delete the membership
    await ctx.db.delete(membership._id);

    return { success: true, submissionsDeleted: userSubmissions.length };
  },
});

/**
 * Migration mutation to set submission deadlines for existing hackathons
 * This is a one-time migration that can be called by admins
 */
export const migrateSubmissionDeadlines = mutation({
  args: {},
  handler: async (ctx) => {
    // This is a one-time migration - in production, you might want to add admin checks
    // For now, we'll allow anyone to run it since it's a data migration

    const hackathons = await ctx.db.query('hackathons').collect();

    if (hackathons.length === 0) {
      return { message: 'No hackathons found.' };
    }

    console.log(
      `Found ${hackathons.length} hackathons. Checking for missing submission deadlines...`,
    );

    const now = Date.now();
    let updatedCount = 0;

    for (const hackathon of hackathons) {
      // Check if the hackathon has dates and a submission deadline
      if (!hackathon.dates?.submissionDeadline) {
        console.log(`Updating hackathon "${hackathon.title}" (ID: ${hackathon._id})`);

        // Update the hackathon with the current timestamp as submission deadline
        await ctx.db.patch(hackathon._id, {
          dates: {
            start: hackathon.dates?.start,
            submissionDeadline: now,
          },
          updatedAt: now,
        });

        updatedCount++;
      }
    }

    if (updatedCount === 0) {
      return { message: 'All hackathons already have submission deadlines set.' };
    } else {
      return {
        message: `Successfully updated ${updatedCount} hackathon(s) with submission deadline set to now.`,
      };
    }
  },
});
