'use node';

import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import { api } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { guarded } from './authz/guardFactory';
import type { VibeAppsProject } from './vibeApps';

export interface VibeProject {
  name: string;
  creator: string | null;
  vibeappsUrl: string;
  githubUrl: string | null;
  websiteUrl: string | null;
  youtubeUrl: string | null;
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

export const getVibeAppsProjects = guarded.action(
  'vibe-apps.admin',
  {}, // no args needed
  async (ctx, _args, _role): Promise<VibeProject[]> => {
    const apiKey = getFirecrawlApiKey();

    if (!apiKey || apiKey.length === 0) {
      throw new Error('Firecrawl API key is not configured');
    }

    try {
      // Get existing projects from database
      const existingProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      const normalizeUrl = (url: string) => url.split('#')[0];
      const existingUrls = new Set(existingProjects.map((p: VibeAppsProject) => normalizeUrl(p.vibeappsUrl)));

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
                  description: 'GitHub repository URL for the project, if available on the page',
                },
                description: {
                  type: 'string',
                  description: 'Short description of the project if available',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags associated with the project',
                },
              },
              required: ['name', 'vibeappsUrl'],
            },
          },
        },
        required: ['projects'],
      };

      // First try to scrape just the markdown to get complete content
      const markdownResult = await firecrawl.scrape('https://vibeapps.dev/tag/tanstackstart', {
        formats: ['markdown'],
      });

      const markdownContent = markdownResult?.markdown || '';

      // Extract projects from markdown by parsing sections

      // Create projects from markdown extraction
      const markdownProjects: Array<Record<string, unknown>> = [];

      // Split markdown by project sections (## headings)
      const projectSections = markdownContent.split(/^## /m);

      for (const section of projectSections) {
        if (!section.trim()) continue;

        // Extract project name from heading
        const nameMatch = section.match(/^\[([^\]]+)\]/);
        if (!nameMatch) continue;

        const name = nameMatch[1];

        // Extract URL from this section (clean URL without fragments)
        const sectionUrlMatch = section.match(/https:\/\/vibeapps\.dev\/s\/[^)\s]+/);
        if (!sectionUrlMatch) continue;

        const vibeappsUrl = sectionUrlMatch[0].split('#')[0]; // Remove any fragments

        // Extract creator (usually appears as "by [Creator Name]")
        const creatorMatch = section.match(/by ([^\n]+)/);
        const creator = creatorMatch ? creatorMatch[1].trim() : null;

        // Extract GitHub URL if present
        const githubMatch = section.match(/https:\/\/github\.com\/[^\s)]+/);
        const githubUrl = githubMatch ? githubMatch[0] : null;

        markdownProjects.push({
          name,
          creator,
          vibeappsUrl,
          githubUrl,
          description: null,
          tags: [],
        });
      }

      console.log(`Parsed ${markdownProjects.length} projects from markdown sections`);

      // Now try JSON extraction as well
      const mainResult = await firecrawl.scrape('https://vibeapps.dev/tag/tanstackstart', {
        formats: [
          'markdown',
          {
            type: 'json',
            schema: mainPageSchema,
            prompt:
              'Extract ALL projects listed on this vibeapps.dev tag page (https://vibeapps.dev/tag/tanstackstart). ' +
              'Look for project cards, listings, or entries that show individual projects. ' +
              'For each project, capture: ' +
              'name (project name as displayed), ' +
              'creator (person or team name/handle), ' +
              'vibeappsUrl (the URL to the individual project page on vibeapps.dev, usually /s/project-name), ' +
              'githubUrl (GitHub repository URL if shown), ' +
              'description (project description if available), ' +
              'tags (any tags or categories associated with the project). ' +
              'Make sure to find ALL projects on the page, including any that might be in different sections or layouts.',
          },
        ],
      });

      if (!mainResult) {
        throw new Error('No data returned from main page scrape');
      }

      // Extract projects from main page JSON
      const mainJsonData = mainResult.json as Record<string, unknown> | undefined;
      const jsonProjects =
        (mainJsonData?.projects as Array<Record<string, unknown>> | undefined) ?? [];

      console.log(`Found ${jsonProjects.length} projects on main page via JSON extraction`);
      console.log(
        `JSON markdown preview (first 500 chars): ${mainResult.markdown?.substring(0, 500)}...`,
      );

      // Combine JSON projects with markdown projects
      // Normalize URLs by removing fragments for consistent comparison
      const jsonUrls = new Set(jsonProjects.map((p) => normalizeUrl(p.vibeappsUrl as string)));
      const combinedProjects = [
        ...jsonProjects,
        ...markdownProjects.filter((p) => !jsonUrls.has(normalizeUrl(p.vibeappsUrl as string))),
      ];

      console.log(`Total projects after combining JSON and markdown: ${combinedProjects.length}`);

      // Log some details about the projects found
      if (combinedProjects.length > 0) {
        console.log('Sample projects found:');
        combinedProjects.slice(0, 5).forEach((project, index) => {
          console.log(
            `  ${index + 1}. ${project.name} by ${project.creator} - ${project.vibeappsUrl}`,
          );
        });
      }

      const allProjects = combinedProjects;

      // Step 2: Filter out projects we already have in the database
      const newProjects = allProjects.filter((project) => {
        const vibeappsUrl = (project.vibeappsUrl as string | undefined)?.trim();
        return vibeappsUrl && !existingUrls.has(normalizeUrl(vibeappsUrl));
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
              youtubeUrl: {
                type: 'string',
                description: 'YouTube video URL from the Project Links & Tags section',
              },
            },
          };

          const projectResult = await firecrawl.scrape(vibeappsUrl, {
            formats: [
              {
                type: 'json',
                schema: projectPageSchema,
                prompt:
                  'Extract the website/demo URL and YouTube video URL from the "Project Links & Tags" section of this vibeapps.dev project page. ' +
                  'Look for links in sections like "Project Links", "Links & Tags", or similar. ' +
                  'Return the main website/demo URL that users would visit to see the actual project, and any YouTube video URL if present.',
              },
            ],
          });

          let websiteUrl = null;
          let youtubeUrl = null;
          if (projectResult?.json) {
            const projectJson = projectResult.json as Record<string, unknown>;
            websiteUrl = (projectJson.websiteUrl as string | undefined)?.trim() || null;
            youtubeUrl = (projectJson.youtubeUrl as string | undefined)?.trim() || null;
          }

          // Store the project in the database
          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: creator || undefined,
            vibeappsUrl,
            githubUrl: githubUrl || undefined,
            websiteUrl: websiteUrl || undefined,
            youtubeUrl: youtubeUrl || undefined,
          });
        } catch (projectError) {
          console.log(`Failed to scrape ${vibeappsUrl}:`, projectError);
          // Still store the project but without website URL or youtube URL
          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: creator || undefined,
            vibeappsUrl,
            githubUrl: githubUrl || undefined,
            websiteUrl: undefined,
            youtubeUrl: undefined,
          });
        }
      }

      // Return all projects from database (existing + newly scraped)
      const finalProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      console.log(`Returning ${finalProjects.length} total projects from database`);

      return finalProjects.map((p: VibeAppsProject) => ({
        name: p.name,
        creator: p.creator || null,
        vibeappsUrl: p.vibeappsUrl,
        githubUrl: p.githubUrl || null,
        websiteUrl: p.websiteUrl || null,
        youtubeUrl: p.youtubeUrl || null,
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
);
