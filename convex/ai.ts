import { v } from 'convex/values';
import { getAutumnCreditFeatureId } from '../src/lib/server/env.server';
import { assertUserId } from '../src/lib/shared/user-id';
import { internal } from './_generated/api';
import { type ActionCtx, internalMutation, internalQuery, query } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';
import { AUTUMN_NOT_CONFIGURED_ERROR, autumn, isAutumnConfigured } from './autumn';

const FREE_MESSAGE_LIMIT = 10;

type ReservationMode = 'free' | 'paid';

interface AiUsageRecord {
  userId: string;
  messagesUsed: number;
  pendingMessages: number;
  lastReservedAt?: number | null;
  lastCompletedAt?: number | null;
}

interface UsageSnapshot {
  userId: string;
  messagesUsed: number;
  pendingMessages: number;
  freeMessagesRemaining: number;
  lastReservedAt: number | null;
  lastCompletedAt: number | null;
}

type ReservationMutationResult =
  | {
      ok: true;
      usage: UsageSnapshot;
      reason?: undefined;
    }
  | {
      ok: false;
      usage: UsageSnapshot;
      reason: 'free_limit_exhausted' | 'no_pending_reservation';
    };

type AutumnCheckResult = Awaited<ReturnType<typeof autumn.check>>;

type ReserveAiMessageResult =
  | {
      allowed: true;
      freeLimit: number;
      mode: ReservationMode;
      usage: UsageSnapshot;
    }
  | {
      allowed: false;
      freeLimit: number;
      usage: UsageSnapshot;
      requiresUpgrade: boolean;
      reason:
        | 'autumn_not_configured'
        | 'autumn_check_failed'
        | 'upgrade_required'
        | 'reservation_failed'
        | 'free_limit_exhausted';
      errorMessage?: string;
      errorCode?: string;
      preview?: AutumnCheckResult extends { data: infer Data } ? Data | null : unknown;
    };

interface CompleteAiMessageResult {
  freeLimit: number;
  usage: UsageSnapshot;
  trackError: { message: string; code: string } | null;
}

type ReleaseAiMessageResult =
  | {
      released: true;
      freeLimit: number;
      usage: UsageSnapshot;
    }
  | {
      released: false;
      freeLimit: number;
      usage: UsageSnapshot;
      reason: 'no_pending_reservation' | 'reservation_failed';
    };

/**
 * Calculate usage metrics consistently across the application.
 * This ensures display calculations match limit enforcement logic.
 */
function calculateUsageMetrics(messagesUsed: number, pendingMessages: number, freeLimit: number) {
  const totalConsumed = messagesUsed + pendingMessages;
  const freeMessagesRemaining = Math.max(0, freeLimit - totalConsumed);
  const isFreeTierExhausted = totalConsumed >= freeLimit;

  return {
    messagesUsed,
    pendingMessages,
    totalConsumed,
    freeMessagesRemaining,
    isFreeTierExhausted,
    freeLimit,
  };
}

function createUsageSnapshot(
  doc: AiUsageRecord | null,
  freeLimit: number,
  fallbackUserId?: string,
): UsageSnapshot {
  const messagesUsed = doc?.messagesUsed ?? 0;
  const pendingMessages = doc?.pendingMessages ?? 0;
  const metrics = calculateUsageMetrics(messagesUsed, pendingMessages, freeLimit);

  return {
    userId: doc?.userId ?? fallbackUserId ?? '',
    messagesUsed,
    pendingMessages,
    freeMessagesRemaining: metrics.freeMessagesRemaining,
    lastReservedAt: doc?.lastReservedAt ?? null,
    lastCompletedAt: doc?.lastCompletedAt ?? null,
  };
}

const usageRecordArgs = {
  userId: v.string(),
} as const;

export const getUsageRecord = internalQuery({
  args: usageRecordArgs,
  handler: async (ctx, { userId }) => {
    const usageDoc = await ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    if (!usageDoc) {
      return null;
    }

    return {
      _id: usageDoc._id,
      userId: usageDoc.userId,
      messagesUsed: usageDoc.messagesUsed,
      pendingMessages: usageDoc.pendingMessages,
      lastReservedAt: usageDoc.lastReservedAt ?? null,
      lastCompletedAt: usageDoc.lastCompletedAt ?? null,
      createdAt: usageDoc.createdAt,
      updatedAt: usageDoc.updatedAt,
    };
  },
});

/**
 * Get current user's AI usage record (reactive)
 *
 * ACCESS CONTROL: This query intentionally returns `null` for unauthenticated callers
 * instead of throwing an error. This allows:
 * 1. Client components to check usage status without requiring authentication
 * 2. Graceful handling of signed-out state (show "sign in to see usage" instead of error)
 * 3. Avoid error boundary triggers when users navigate while signed out
 *
 * This is a deliberate design choice for better UX. The client should check for `null`
 * and render appropriate UI (sign-in prompt, usage display, etc.) accordingly.
 */
export const getCurrentUserUsage = query({
  args: {},
  handler: async (ctx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'Unable to resolve user id.');
    const usageDoc = await ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    if (!usageDoc) {
      return null;
    }

    const freeLimit = FREE_MESSAGE_LIMIT;
    const messagesUsed = usageDoc.messagesUsed ?? 0;
    const pendingMessages = usageDoc.pendingMessages ?? 0;
    const metrics = calculateUsageMetrics(messagesUsed, pendingMessages, freeLimit);

    return {
      messagesUsed,
      pendingMessages,
      freeMessagesRemaining: metrics.freeMessagesRemaining,
      freeLimit,
      lastReservedAt: usageDoc.lastReservedAt ?? null,
      lastCompletedAt: usageDoc.lastCompletedAt ?? null,
    };
  },
});

export const reserveUsage = internalMutation({
  args: {
    userId: v.string(),
    freeLimit: v.number(),
    mode: v.union(v.literal('free'), v.literal('paid')),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const usageDoc = await ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!usageDoc) {
      if (args.mode === 'free' && args.freeLimit <= 0) {
        return {
          ok: false,
          reason: 'free_limit_exhausted' as const,
          usage: createUsageSnapshot(null, args.freeLimit, args.userId),
        };
      }

      await ctx.db.insert('aiMessageUsage', {
        userId: args.userId,
        messagesUsed: 0,
        pendingMessages: 1,
        createdAt: args.timestamp,
        updatedAt: args.timestamp,
        lastReservedAt: args.timestamp,
      });

      return {
        ok: true,
        usage: {
          userId: args.userId,
          messagesUsed: 0,
          pendingMessages: 1,
          freeMessagesRemaining: Math.max(0, args.freeLimit - 1),
          lastReservedAt: args.timestamp,
          lastCompletedAt: null,
        },
      };
    }

    // Calculate total consumed (completed + pending) to check against free limit
    // This matches the display calculation for consistency
    const metrics = calculateUsageMetrics(
      usageDoc.messagesUsed,
      usageDoc.pendingMessages,
      args.freeLimit,
    );

    if (args.mode === 'free' && metrics.isFreeTierExhausted) {
      return {
        ok: false,
        reason: 'free_limit_exhausted' as const,
        usage: createUsageSnapshot(usageDoc, args.freeLimit, args.userId),
      };
    }

    const pendingMessages = usageDoc.pendingMessages + 1;

    await ctx.db.patch(usageDoc._id, {
      pendingMessages,
      updatedAt: args.timestamp,
      lastReservedAt: args.timestamp,
    });

    const updatedDoc: AiUsageRecord = {
      userId: usageDoc.userId,
      messagesUsed: usageDoc.messagesUsed,
      pendingMessages,
      lastReservedAt: args.timestamp,
      lastCompletedAt: usageDoc.lastCompletedAt,
    };

    return {
      ok: true,
      usage: createUsageSnapshot(updatedDoc, args.freeLimit, args.userId),
    };
  },
});

export const completeUsage = internalMutation({
  args: {
    userId: v.string(),
    freeLimit: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const usageDoc = await ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!usageDoc || usageDoc.pendingMessages <= 0) {
      return {
        ok: false,
        reason: 'no_pending_reservation' as const,
        usage: createUsageSnapshot(usageDoc ?? null, args.freeLimit, args.userId),
      };
    }

    const pendingMessages = usageDoc.pendingMessages - 1;
    const messagesUsed = usageDoc.messagesUsed + 1;

    await ctx.db.patch(usageDoc._id, {
      pendingMessages,
      messagesUsed,
      updatedAt: args.timestamp,
      lastCompletedAt: args.timestamp,
    });

    const updatedDoc: AiUsageRecord = {
      userId: usageDoc.userId,
      messagesUsed,
      pendingMessages,
      lastReservedAt: usageDoc.lastReservedAt,
      lastCompletedAt: args.timestamp,
    };

    return {
      ok: true,
      usage: createUsageSnapshot(updatedDoc, args.freeLimit, args.userId),
    };
  },
});

export const releaseUsage = internalMutation({
  args: {
    userId: v.string(),
    freeLimit: v.number(),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const usageDoc = await ctx.db
      .query('aiMessageUsage')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!usageDoc || usageDoc.pendingMessages <= 0) {
      return {
        ok: false,
        reason: 'no_pending_reservation' as const,
        usage: createUsageSnapshot(usageDoc ?? null, args.freeLimit, args.userId),
      };
    }

    const pendingMessages = usageDoc.pendingMessages - 1;

    await ctx.db.patch(usageDoc._id, {
      pendingMessages,
      updatedAt: args.timestamp,
    });

    const updatedDoc: AiUsageRecord = {
      userId: usageDoc.userId,
      messagesUsed: usageDoc.messagesUsed,
      pendingMessages,
      lastReservedAt: usageDoc.lastReservedAt,
      lastCompletedAt: usageDoc.lastCompletedAt,
    };

    return {
      ok: true,
      usage: createUsageSnapshot(updatedDoc, args.freeLimit, args.userId),
    };
  },
});

async function ensureAuthenticatedUser(ctx: Parameters<typeof authComponent.getAuthUser>[0]) {
  const authUser = await authComponent.getAuthUser(ctx);
  if (!authUser) {
    throw new Error('Authentication required.');
  }

  const userId = assertUserId(authUser, 'Unable to resolve user id.');
  return {
    authUser,
    userId,
  };
}

export const reserveAiMessage = guarded.action(
  'profile.read',
  {
    metadata: v.optional(
      v.object({
        provider: v.optional(v.string()),
        model: v.optional(v.string()),
      }),
    ),
  },
  async (ctx: ActionCtx, _args, _role): Promise<ReserveAiMessageResult> => {
    const { userId } = await ensureAuthenticatedUser(ctx);
    const freeLimit = FREE_MESSAGE_LIMIT;
    const timestamp = Date.now();

    let reservationMode: ReservationMode = 'free';

    let reserveResult = (await ctx.runMutation(internal.ai.reserveUsage, {
      userId,
      freeLimit,
      mode: reservationMode,
      timestamp,
    })) as ReservationMutationResult;

    if (!reserveResult.ok && reserveResult.reason === 'free_limit_exhausted') {
      reservationMode = 'paid';

      if (!isAutumnConfigured()) {
        return {
          allowed: false,
          freeLimit,
          usage: reserveResult.usage,
          requiresUpgrade: false,
          reason: 'autumn_not_configured' as const,
          errorMessage: AUTUMN_NOT_CONFIGURED_ERROR.message,
          errorCode: AUTUMN_NOT_CONFIGURED_ERROR.code,
        };
      }

      const checkResult = await autumn.check(ctx, {
        featureId: getAutumnCreditFeatureId(),
      });

      if (checkResult.error) {
        return {
          allowed: false,
          freeLimit,
          usage: reserveResult.usage,
          requiresUpgrade: true,
          reason: 'autumn_check_failed' as const,
          errorMessage: checkResult.error.message,
          errorCode: checkResult.error.code,
        };
      }

      if (!checkResult.data?.allowed) {
        return {
          allowed: false,
          freeLimit,
          usage: reserveResult.usage,
          requiresUpgrade: true,
          reason: 'upgrade_required' as const,
          preview: checkResult.data ?? null,
        };
      }

      reserveResult = (await ctx.runMutation(internal.ai.reserveUsage, {
        userId,
        freeLimit,
        mode: reservationMode,
        timestamp,
      })) as ReservationMutationResult;
    }

    if (!reserveResult.ok) {
      const reason =
        reserveResult.reason === 'free_limit_exhausted'
          ? 'free_limit_exhausted'
          : 'reservation_failed';
      return {
        allowed: false,
        freeLimit,
        usage: reserveResult.usage,
        requiresUpgrade: reservationMode === 'paid',
        reason,
      };
    }

    return {
      allowed: true,
      freeLimit,
      mode: reservationMode,
      usage: reserveResult.usage,
    };
  },
);

export const completeAiMessage = guarded.action(
  'profile.read',
  {
    mode: v.union(v.literal('free'), v.literal('paid')),
    metadata: v.optional(
      v.object({
        provider: v.optional(v.string()),
        model: v.optional(v.string()),
        totalTokens: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
  },
  async (ctx: ActionCtx, args, _role): Promise<CompleteAiMessageResult> => {
    const { userId } = await ensureAuthenticatedUser(ctx);
    const timestamp = Date.now();

    const completeResult = (await ctx.runMutation(internal.ai.completeUsage, {
      userId,
      freeLimit: FREE_MESSAGE_LIMIT,
      timestamp,
    })) as ReservationMutationResult;

    if (!completeResult.ok) {
      throw new Error('No pending AI usage reservation found to complete.');
    }

    let trackError: { message: string; code: string } | null = null;

    if (args.mode === 'paid') {
      if (!isAutumnConfigured()) {
        trackError = AUTUMN_NOT_CONFIGURED_ERROR;
      } else {
        const properties: Record<string, unknown> = {};
        if (args.metadata?.provider) {
          properties.provider = args.metadata.provider;
        }
        if (args.metadata?.model) {
          properties.model = args.metadata.model;
        }
        if (typeof args.metadata?.totalTokens === 'number') {
          properties.totalTokens = args.metadata.totalTokens;
        }
        if (typeof args.metadata?.inputTokens === 'number') {
          properties.inputTokens = args.metadata.inputTokens;
        }
        if (typeof args.metadata?.outputTokens === 'number') {
          properties.outputTokens = args.metadata.outputTokens;
        }

        const trackResult = await autumn.track(ctx, {
          featureId: getAutumnCreditFeatureId(),
          value: 1,
          ...(Object.keys(properties).length > 0 ? { properties } : {}),
        });

        if (trackResult && 'error' in trackResult && trackResult.error) {
          trackError = trackResult.error;
        }
      }
    }

    return {
      freeLimit: FREE_MESSAGE_LIMIT,
      usage: completeResult.usage,
      trackError,
    };
  },
);

export const releaseAiMessage = guarded.action(
  'profile.read',
  {},
  async (ctx: ActionCtx, _args, _role): Promise<ReleaseAiMessageResult> => {
    const { userId } = await ensureAuthenticatedUser(ctx);
    const timestamp = Date.now();

    const releaseResult = (await ctx.runMutation(internal.ai.releaseUsage, {
      userId,
      freeLimit: FREE_MESSAGE_LIMIT,
      timestamp,
    })) as ReservationMutationResult;

    if (!releaseResult.ok) {
      const releaseReason =
        releaseResult.reason === 'no_pending_reservation'
          ? releaseResult.reason
          : 'reservation_failed';
      return {
        released: false,
        reason: releaseReason,
        freeLimit: FREE_MESSAGE_LIMIT,
        usage: releaseResult.usage,
      };
    }

    return {
      released: true,
      freeLimit: FREE_MESSAGE_LIMIT,
      usage: releaseResult.usage,
    };
  },
);
