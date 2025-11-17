'use node';

import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import { api } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { action } from './_generated/server';
import { guarded } from './authz/guardFactory';
import type { VibeAppsProject } from './vibeApps';

export interface VibeProject {
  name: string;
  creator: string | null;
  vibeappsUrl: string;
  githubUrl: string | null;
  websiteUrl: string | null;
  isActive: boolean;
}

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

export const getVibeAppsProjects = action({
  args: {}, // no args needed
  handler: async (ctx): Promise<VibeProject[]> => {
    const apiKey = getFirecrawlApiKey();

    if (!apiKey || apiKey.length === 0) {
      throw new Error('Firecrawl API key is not configured');
    }

    try {
      // Get existing projects from database
      const existingProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      const existingUrls = new Set(existingProjects.map((p: VibeAppsProject) => p.vibeappsUrl));

      console.log(`Found ${existingProjects.length} existing projects in database`);

      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Step 1: Scrape main page to get project info and vibeapps URLs
      console.log('Step 1: Scraping main vibeapps.dev page...');
      const mainPageSchema = {
        type: 'object',
        properties: {
          projects: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the project as shown on vibeapps.dev',
                },
                creator: {
                  type: 'string',
                  description: 'Display name or handle of the creator of the project',
                },
                vibeappsUrl: {
                  type: 'string',
                  description:
                    'URL of the project page on vibeapps.dev (e.g., https://vibeapps.dev/app/project-name)',
                },
                githubUrl: {
                  type: 'string',
                  description: 'GitHub repository URL for the project, if available on main page',
                },
              },
              required: ['name', 'vibeappsUrl'],
            },
          },
        },
        required: ['projects'],
      };

      const mainResult = await firecrawl.scrape('https://vibeapps.dev/tag/tanstackstart', {
        formats: [
          {
            type: 'json',
            schema: mainPageSchema,
            prompt:
              'Extract all projects listed on the vibeapps.dev homepage. ' +
              'For each project, capture: ' +
              'name (project name), ' +
              'creator (person or team), ' +
              'vibeappsUrl (the URL to the individual project page on vibeapps.dev), ' +
              'githubUrl (GitHub repo link if available on the main page).',
          },
        ],
      });

      if (!mainResult) {
        throw new Error('No data returned from main page scrape');
      }

      // Extract projects from main page
      const mainJsonData = mainResult.json as Record<string, unknown> | undefined;
      const rawProjects =
        (mainJsonData?.projects as Array<Record<string, unknown>> | undefined) ?? [];

      console.log(`Found ${rawProjects.length} projects on main page`);

      // Step 2: Filter out projects we already have in the database
      const newProjects = rawProjects.filter((project) => {
        const vibeappsUrl = (project.vibeappsUrl as string | undefined)?.trim();
        return vibeappsUrl && !existingUrls.has(vibeappsUrl);
      });

      console.log(`${newProjects.length} new projects to scrape`);

      // Step 3: For each new project, scrape the individual vibeapps URL to get website URL

      for (const project of newProjects) {
        const name = (project.name as string | undefined)?.trim();
        const creator = (project.creator as string | undefined)?.trim();
        const vibeappsUrl = (project.vibeappsUrl as string | undefined)?.trim();
        const githubUrl = (project.githubUrl as string | undefined)?.trim();

        if (!name || !vibeappsUrl) {
          console.log(`Skipping project: missing name or vibeappsUrl`);
          continue;
        }

        console.log(`Scraping ${vibeappsUrl} for website URL...`);

        try {
          // Define schema for individual project page
          const projectPageSchema = {
            type: 'object',
            properties: {
              websiteUrl: {
                type: 'string',
                description: 'The actual website/demo URL from the Project Links & Tags section',
              },
            },
          };

          const projectResult = await firecrawl.scrape(vibeappsUrl, {
            formats: [
              {
                type: 'json',
                schema: projectPageSchema,
                prompt:
                  'Extract the website/demo URL from the "Project Links & Tags" section of this vibeapps.dev project page. ' +
                  'Look for links in sections like "Project Links", "Links & Tags", or similar. ' +
                  'Return the main website/demo URL that users would visit to see the actual project.',
              },
            ],
          });

          let websiteUrl = null;
          if (projectResult?.json) {
            const projectJson = projectResult.json as Record<string, unknown>;
            websiteUrl = (projectJson.websiteUrl as string | undefined)?.trim() || null;
          }

          // Store the project in the database
          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: creator || undefined,
            vibeappsUrl,
            githubUrl: githubUrl || undefined,
            websiteUrl: websiteUrl || undefined,
          });
        } catch (projectError) {
          console.log(`Failed to scrape ${vibeappsUrl}:`, projectError);
          // Still store the project but without website URL
          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: creator || undefined,
            vibeappsUrl,
            githubUrl: githubUrl || undefined,
            websiteUrl: undefined,
          });
        }
      }

      // Return all projects from database (existing + newly scraped)
      const allProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      console.log(`Returning ${allProjects.length} total projects from database`);

      return allProjects.map((p: VibeAppsProject) => ({
        name: p.name,
        creator: p.creator || null,
        vibeappsUrl: p.vibeappsUrl,
        githubUrl: p.githubUrl || null,
        websiteUrl: p.websiteUrl || null,
        isActive: p.isActive ?? true, // Default to true for backward compatibility
      }));
    } catch (error) {
      // Handle SDK errors gracefully
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to extract projects from Firecrawl';

      // Check if it's a configuration error
      if (
        errorMessage.includes('API key') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('401')
      ) {
        throw new Error('Firecrawl API key is not configured properly');
      }

      throw new Error(errorMessage);
    }
  },
});
