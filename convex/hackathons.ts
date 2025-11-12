import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { components, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';

type HackathonRole = 'owner' | 'admin' | 'judge';

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
      end?: number;
    };
    rubric: string;
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
    const authUser = await authComponent.getAuthUser(ctx);
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

    return hackathons.filter((h): h is NonNullable<typeof h> => h !== null);
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
 * and render appropriate UI (sign-in prompt, "not found" message, etc.).
 */
export const getHackathon = query({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
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
        end: v.optional(v.number()),
      }),
    ),
    rubric: v.string(),
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
      rubric: args.rubric.trim(),
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
        end: v.optional(v.number()),
      }),
    ),
    rubric: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner', 'admin']);

    const updateData: {
      title?: string;
      description?: string;
      dates?: {
        start?: number;
        end?: number;
      };
      rubric?: string;
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
    }
    if (args.rubric !== undefined) {
      updateData.rubric = args.rubric.trim();
    }

    await ctx.db.patch(args.hackathonId, updateData);

    return { success: true };
  },
});

/**
 * Delete hackathon (owner only, enforce at least one owner)
 */
export const deleteHackathon = mutation({
  args: {
    hackathonId: v.id('hackathons'),
  },
  handler: async (ctx, args) => {
    await requireHackathonRole(ctx, args.hackathonId, ['owner']);

    // Check for other owners
    const ownerMemberships = await ctx.db
      .query('memberships')
      .withIndex('by_hackathonId', (q) => q.eq('hackathonId', args.hackathonId))
      .filter((q) => q.eq(q.field('role'), 'owner'))
      .filter((q) => q.eq(q.field('status'), 'active'))
      .collect();

    if (ownerMemberships.length <= 1) {
      throw new Error('Cannot delete hackathon: must have at least one owner');
    }

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
 * Simple token hashing function (using Web Crypto API available in Convex)
 */
async function hashToken(token: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token + secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate invite token (returns membership info if valid)
 */
export const validateInviteToken = query({
  args: {
    token: v.string(),
  },
  handler: async (ctx, args) => {
    // Hash the provided token to compare with stored hash
    const inviteTokenSecret =
      process.env.INVITE_TOKEN_SECRET || 'default-secret-change-in-production';
    const tokenHash = await hashToken(args.token, inviteTokenSecret);

    // Find membership by token hash
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first();

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

    // Get inviter info (simplified - just use name from userId if available)
    // For full user info, would need to query Better Auth adapter findMany
    const inviterName = membership.invitedByUserId ? 'Hackathon Owner' : null;

    return {
      status: 'valid' as const,
      hackathonTitle: hackathon.title,
      inviterName: inviterName || 'Hackathon Owner',
      membershipId: membership._id,
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
    const membership = await ctx.db
      .query('memberships')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first();

    if (!membership) {
      throw new Error('Invalid invite token');
    }

    if (membership.status !== 'invited') {
      throw new Error('Invite already used');
    }

    if (membership.tokenExpiresAt && membership.tokenExpiresAt < Date.now()) {
      throw new Error('Invite token expired');
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
