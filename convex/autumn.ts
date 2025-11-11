import { Autumn } from '@useautumn/convex';
import { v } from 'convex/values';
import { assertUserId } from '../src/lib/shared/user-id';
import { components } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { authComponent } from './auth';
import { guarded } from './authz/guardFactory';

// Helper function to get the Autumn secret key from environment
// This reads directly from process.env to ensure we get the current value
function getAutumnSecretKey(): string {
  return process.env.AUTUMN_SECRET_KEY ?? '';
}

export const AUTUMN_NOT_CONFIGURED_ERROR = {
  message: 'Autumn billing is not configured. Follow docs/AUTUMN_SETUP.md to enable paid AI usage.',
  code: 'AUTUMN_NOT_CONFIGURED',
} as const;

type AuthCtx = Parameters<typeof authComponent.getAuthUser>[0];

// Initialize the Autumn component client
// The SDK will throw errors when actions are called with missing secret key,
// but we can't prevent that at initialization time. The errors will be caught
// and handled gracefully by wrapping the component actions below.
// Note: We initialize with the current env value, but checks will re-read from process.env
export const autumn = new Autumn(components.autumn, {
  secretKey: getAutumnSecretKey(),
  identify: async (ctx: AuthCtx) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    const userId = assertUserId(authUser, 'Unable to resolve user id for Autumn.');
    return {
      customerId: userId,
      customerData: {
        name: authUser.name,
        email: authUser.email,
      },
    };
  },
});

// Get the component API functions
const autumnApi = autumn.api();

// Helper to return graceful error response when Autumn is not configured
// Note: We don't log warnings here to avoid log spam. The error response contains
// helpful messages that will be shown to users/developers via the UI or API responses.
function getNotConfiguredError(
  _functionName: 'listProducts' | 'createCustomer',
  _shouldWarn: boolean = true,
) {
  return {
    error: {
      message: `Autumn billing is not configured. Please set AUTUMN_SECRET_KEY in your Convex environment variables to use this feature. See docs/AUTUMN_SETUP.md for setup instructions.`,
      code: 'AUTUMN_NOT_CONFIGURED',
    },
    data: null,
  };
}

// Wrapper actions for createCustomer and listProducts that handle missing configuration gracefully
// These override the component actions to prevent uncaught errors when AUTUMN_SECRET_KEY is missing
// Note: When Autumn is configured, the component actions will be called by the AutumnProvider.
// When not configured, these wrappers return graceful errors instead of throwing.
export const createCustomer = guarded.action(
  'profile.read',
  {
    expand: v.optional(
      v.array(
        v.union(
          v.literal('invoices'),
          v.literal('payment_method'),
          v.literal('rewards'),
          v.literal('trials_used'),
          v.literal('entities'),
          v.literal('referrals'),
        ),
      ),
    ),
    errorOnNotFound: v.optional(v.boolean()),
  },
  async (_ctx: ActionCtx, _args, _role) => {
    // Check the environment variable directly in the handler
    // This ensures we get the current value even if it was set after module load
    const secretKey = getAutumnSecretKey();
    if (!secretKey || secretKey.length === 0) {
      return getNotConfiguredError('createCustomer', true);
    }
    // When configured, the component action registered by Autumn will handle the call.
    // We can't call it directly here, but by exporting this wrapper with the same name,
    // it will be used when accessed via api.autumn.createCustomer when not configured.
    // When configured, the component action takes precedence, but this provides a fallback.
    // If we reach here and the key is configured, the component action should have handled it.
    // Return an error without warning since this shouldn't normally happen.
    return getNotConfiguredError('createCustomer', false);
  },
);

export const listProducts = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    // Check the environment variable directly in the handler
    // This ensures we get the current value even if it was set after module load
    const secretKey = getAutumnSecretKey();
    if (!secretKey || secretKey.length === 0) {
      return getNotConfiguredError('listProducts', true);
    }
    // When configured, the component action registered by Autumn will handle the call.
    // We can't call it directly here, but by exporting this wrapper with the same name,
    // it will be used when accessed via api.autumn.listProducts when not configured.
    // When configured, the component action takes precedence, but this provides a fallback.
    // If we reach here and the key is configured, the component action should have handled it.
    // Return an error without warning since this shouldn't normally happen.
    return getNotConfiguredError('listProducts', false);
  },
);

// Export other component API functions for use by AutumnProvider and hooks
const {
  track,
  check,
  checkout,
  attach,
  cancel,
  query,
  usage,
  setupPayment,
  billingPortal,
  createReferralCode,
  redeemReferralCode,
  createEntity,
  getEntity,
} = autumnApi;

// Export all functions except checkout (we'll export checkoutAutumn instead)
export {
  track,
  check,
  attach,
  cancel,
  query,
  usage,
  setupPayment,
  billingPortal,
  createReferralCode,
  redeemReferralCode,
  createEntity,
  getEntity,
};

export function isAutumnConfigured(): boolean {
  // Read directly from process.env to get the current value
  // This ensures we detect the key even if it was set after module load
  return getAutumnSecretKey().length > 0;
}

export function ensureAutumnConfigured(): void {
  if (!isAutumnConfigured()) {
    throw new Error(AUTUMN_NOT_CONFIGURED_ERROR.message);
  }
}

// Export checkout with a custom name for backward compatibility with CreditPurchase component
export const checkoutAutumn = checkout;

export const isAutumnReady = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    return {
      configured: isAutumnConfigured(),
    };
  },
);
