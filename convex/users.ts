import { v } from 'convex/values';
import {
  type BetterAuthAdapterUserDoc,
  normalizeAdapterFindManyResult,
} from '../src/lib/server/better-auth/adapter-utils';
import { assertUserId } from '../src/lib/shared/user-id';
import { api, components } from './_generated/api';
import { action, internalQuery, mutation, query } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';

/**
 * Check if there are any users in the system (for determining first admin)
 * Queries Better Auth's user table directly for accurate count.
 *
 * ACCESS CONTROL: This query is intentionally unguarded (no authentication required)
 * because it must be callable:
 * 1. During bootstrap flows when no users exist yet (first user signup)
 * 2. By health check endpoints that run before authentication
 * 3. By registration flows that need to determine if this is the first user
 *
 * This is safe because it only returns aggregate counts, not sensitive user data.
 * If you need user-specific data, use `getCurrentUserProfile` which requires auth.
 */
export const getUserCount = query({
  args: {},
  handler: async (ctx) => {
    // Use Better Auth component's findMany query to get all users
    let allUsers: BetterAuthAdapterUserDoc[] = [];
    try {
      // Query all users using component's findMany query
      const rawResult: unknown = await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'user',
        paginationOpts: {
          cursor: null,
          numItems: 1000, // Get all users (assuming less than 1000 for user count)
          id: 0,
        },
      });

      const normalized = normalizeAdapterFindManyResult<BetterAuthAdapterUserDoc>(rawResult);
      allUsers = normalized.page;
    } catch (error) {
      console.error('Failed to query Better Auth users:', error);
      allUsers = [];
    }

    const totalUsers = allUsers.length;
    const isFirstUser = totalUsers === 0;

    return {
      totalUsers,
      isFirstUser,
    };
  },
});

/**
 * Create a new user profile with default "user" role
 * Used during user registration - no special permissions needed
 */
export const createUserProfile = mutation({
  args: {
    userId: v.string(), // Better Auth user ID
  },
  handler: async (ctx, args) => {
    // Check if profile already exists (idempotent)
    const existingProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (existingProfile) {
      // Profile already exists, nothing to do
      return { success: true, existed: true };
    }

    const now = Date.now();

    // Create new profile with default "user" role
    await ctx.db.insert('userProfiles', {
      userId: args.userId,
      role: 'user',
      createdAt: now,
      updatedAt: now,
    });

    return { success: true, existed: false };
  },
});

/**
 * Ensure at least one admin exists by promoting the first user if needed
 * This runs after user profile creation during registration
 */
export const ensureFirstAdmin = action({
  args: {
    userId: v.string(), // The user who just registered
  },
  handler: async (ctx, args) => {
    // Check if any admin users exist
    const existingAdmins = await ctx.runQuery(api.users.getAdminCount, {});

    if (existingAdmins.count === 0) {
      // No admins exist, promote this user to admin
      await ctx.runMutation(api.users.setUserRole, {
        userId: args.userId,
        role: 'admin',
        allowBootstrap: true,
      });
      return { promoted: true };
    }

    return { promoted: false };
  },
});

/**
 * Set user role (admin-only operation)
 * Used by admins to promote/demote existing users
 */
export const setUserRole = guarded.mutation(
  'user.write', // Admin-only capability
  {
    userId: v.string(), // Better Auth user ID
    role: v.union(v.literal('user'), v.literal('admin')), // Enforced enum
  },
  async (ctx, args) => {
    // This function now requires admin privileges and only updates existing profiles

    // Check if profile exists
    const existingProfile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!existingProfile) {
      throw new Error('User profile not found');
    }

    // Update the role
    const now = Date.now();
    await ctx.db.patch(existingProfile._id, {
      role: args.role,
      updatedAt: now,
    });

    return { success: true };
  },
);

/**
 * Update current user's profile (name, phoneNumber)
 * Uses Better Auth component adapter's updateMany mutation
 * Only allows users to update their own profile.
 *
 * Authorization is enforced by Better Auth's `getAuthUser`, so this remains a
 * plain mutation rather than `guarded.mutation('profile.write', ...)`.
 */
export const updateCurrentUserProfile = mutation({
  args: {
    name: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current user
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('User not authenticated');
    }

    const userId = assertUserId(authUser, 'User ID not found in auth user');

    // Build update object - only include fields that are provided
    const updateData: {
      name?: string;
      phoneNumber?: string | null;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) {
      updateData.name = args.name.trim();
    }

    if (args.phoneNumber !== undefined) {
      updateData.phoneNumber = args.phoneNumber || null;
    }

    // Use Better Auth component adapter's updateMany mutation
    await ctx.runMutation(components.betterAuth.adapter.updateMany, {
      input: {
        model: 'user',
        update: updateData,
        where: [
          {
            field: '_id',
            operator: 'eq',
            value: userId,
          },
        ],
      },
      paginationOpts: {
        cursor: null,
        numItems: 1, // Only updating one user
        id: 0, // Not used but required
      },
    });

    return { success: true };
  },
});

/**
 * Get user profile by user ID
 * Internal-only so profiles can't be fetched directly from clients
 */
export const getUserProfile = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
  },
});

/**
 * Get current user profile (Better Auth user data + app-specific role).
 *
 * ACCESS CONTROL: This query intentionally returns `null` for unauthenticated callers
 * instead of throwing an error. This allows:
 * 1. Client hooks (like `useAuth`) to handle signed-out state gracefully
 * 2. Conditional rendering based on authentication status without error boundaries
 * 3. Smooth transitions when users sign in/out without triggering errors
 *
 * This is a deliberate design choice for better UX. The client should check for `null`
 * and render appropriate UI (login prompt, loading state, etc.) rather than relying
 * on error boundaries.
 */
export const getAdminCount = query({
  args: {},
  handler: async (ctx) => {
    const adminProfiles = await ctx.db
      .query('userProfiles')
      .filter((q) => q.eq(q.field('role'), 'admin'))
      .collect();

    return { count: adminProfiles.length };
  },
});

export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    // Get Better Auth user via authComponent
    // Note: This should be cached by Convex since we're in an authenticated context
    let authUser: unknown;
    try {
      authUser = await authComponent.getAuthUser(ctx);
    } catch {
      // Better Auth throws "Unauthenticated" error when session is invalid
      // Return null to allow conditional usage in useAuth hook
      return null;
    }

    if (!authUser) {
      // Return null instead of throwing to allow conditional usage in useAuth hook
      return null;
    }

    // Better Auth Convex adapter returns the Convex document with _id
    const userId = assertUserId(authUser, 'User ID not found in auth user');

    // Get role from userProfiles - this is a fast indexed query
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();

    // Convert Better Auth timestamps (ISO strings or numbers) to Unix timestamps
    const authUserTyped = authUser as {
      createdAt?: string | number;
      updatedAt?: string | number;
      email?: string;
      name?: string;
      phoneNumber?: string;
      emailVerified?: boolean;
    };
    const createdAt = authUserTyped.createdAt
      ? typeof authUserTyped.createdAt === 'string'
        ? new Date(authUserTyped.createdAt).getTime()
        : authUserTyped.createdAt
      : Date.now();
    const updatedAt = authUserTyped.updatedAt
      ? typeof authUserTyped.updatedAt === 'string'
        ? new Date(authUserTyped.updatedAt).getTime()
        : authUserTyped.updatedAt
      : Date.now();

    return {
      id: userId, // Better Auth user ID
      email: authUserTyped.email || '',
      name: authUserTyped.name || null,
      phoneNumber: authUserTyped.phoneNumber || null,
      role: profile?.role || 'user', // Default to 'user' if no profile exists
      emailVerified: authUserTyped.emailVerified || false,
      createdAt,
      updatedAt,
    };
  },
});

/**
 * Update user role (for admin operations)
 * SECURITY: Requires authenticated admin caller
 */
export const updateUserRole = guarded.mutation(
  'user.write',
  {
    userId: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')), // Enforced enum
  },
  async (ctx, args, _role) => {
    // Role validation is now handled by the Convex schema enum

    // Update role in userProfiles
    const profile = await ctx.db
      .query('userProfiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    if (!profile) {
      throw new Error('User profile not found');
    }

    await ctx.db.patch(profile._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
);
