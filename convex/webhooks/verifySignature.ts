'use node';

import { createHmac } from 'node:crypto';
import { v } from 'convex/values';
import { action } from '../_generated/server';

/**
 * Verify webhook signature using HMAC-SHA256
 * This runs in Node.js runtime to access crypto APIs
 */
export const verifyWebhookSignature = action({
  args: {
    payload: v.string(),
    signature: v.string(),
    secret: v.string(),
  },
  handler: async (_ctx, args): Promise<boolean> => {
    try {
      const hmac = createHmac('sha256', args.secret);
      hmac.update(args.payload, 'utf8');
      const computedSignature = `sha256=${hmac.digest('hex')}`;

      // Use constant-time comparison to prevent timing attacks
      return args.signature === computedSignature;
    } catch (error) {
      console.error('Error verifying webhook signature:', error);
      return false;
    }
  },
});
