import { assertUserId } from '../src/lib/shared/user-id';
import { query } from './_generated/server';
import { authComponent } from './auth';

/**
 * Get dashboard statistics (admin only)
 * Returns user stats
 * OPTIMIZED: Uses userProfiles table for counts
 *
 * ACCESS CONTROL: This query intentionally returns `null` for unauthenticated or non-admin
 * users instead of throwing an error. This allows the client to:
 * 1. Render a friendly fallback UI instead of hitting the route error boundary
 * 2. Handle navigation gracefully when users sign out (no error thrown)
 * 3. Avoid error boundary triggers for expected authorization failures
 *
 * This is a deliberate design choice for better UX. If you need strict authorization
 * enforcement, use `guarded.query('dashboard.read', ...)` instead.
 */
export const getDashboardData = query({
  args: {},
  handler: async (ctx) => {
    // ✅ Handle unauthenticated users gracefully - return null instead of throwing
    // This prevents errors when users navigate to dashboard after sign out
    const currentUser = await authComponent.getAuthUser(ctx);
    if (!currentUser) {
      return null;
    }

    const currentUserId = assertUserId(currentUser, 'User ID not found');

    const currentProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', currentUserId))
      .first();

    if (currentProfile?.role !== 'admin') {
      return null;
    }

    const now = Date.now();
    const profiles = await ctx.db.query('userProfiles').collect();
    const totalUsers = profiles.length;
    const activeUsers = totalUsers; // TODO: Implement proper active user logic

    return {
      status: 'success' as const,
      stats: {
        totalUsers,
        activeUsers,
        lastUpdated: new Date(now).toISOString() as string & { __brand: 'IsoDateString' },
      },
      activity: [],
    };
  },
});
