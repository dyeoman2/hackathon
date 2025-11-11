'use node';

import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import type { ActionCtx } from './_generated/server';
import { guarded } from './authz/guardFactory';

// Helper function to get the Firecrawl API key from environment
function getFirecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY ?? '';
}

// Helper to return graceful error response when Firecrawl is not configured
// Note: We don't log warnings here to avoid log spam. The error response contains
// helpful messages that will be shown to users/developers via the UI or API responses.
function getNotConfiguredError(url: string, _warnType: 'missing' | 'invalid' = 'missing') {
  return {
    success: false as const,
    url,
    error:
      'Firecrawl API key is not configured. Please set FIRECRAWL_API_KEY in your Convex environment variables to use this feature. See docs/FIRECRAWL_SETUP.md for setup instructions.',
    markdown: null,
    json: null,
  };
}

export const isFirecrawlConfigured = guarded.action(
  'profile.read',
  {},
  async (_ctx: ActionCtx, _args, _role) => {
    const apiKey = getFirecrawlApiKey();
    return {
      configured: apiKey.length > 0,
    };
  },
);

export const extractWithFirecrawl = guarded.action(
  'profile.read',
  {
    url: v.string(),
  },
  async (_ctx: ActionCtx, args, _role) => {
    const apiKey = getFirecrawlApiKey();

    if (!apiKey || apiKey.length === 0) {
      return getNotConfiguredError(args.url, 'missing');
    }

    try {
      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Use the scrape method from the SDK
      // JSON format must be specified as an object with type, schema, etc.
      const result = await firecrawl.scrape(args.url, {
        formats: [
          'markdown',
          {
            type: 'json',
            schema: {},
          },
        ],
      });

      // The SDK's scrape method returns a Document directly
      if (!result) {
        throw new Error('No data returned from Firecrawl');
      }

      return {
        success: true as const,
        url: args.url,
        markdown: result.markdown || '',
        json: result.json || null,
      };
    } catch (error) {
      // Handle SDK errors gracefully
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to extract content from Firecrawl';

      // Check if it's a configuration error
      if (
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401')
      ) {
        return getNotConfiguredError(args.url, 'invalid');
      }

      throw new Error(errorMessage);
    }
  },
);
