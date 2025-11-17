'use node';

import Firecrawl from '@mendable/firecrawl-js';
import { v } from 'convex/values';
import { api } from './_generated/api';
import type { ActionCtx } from './_generated/server';
import { guarded } from './authz/guardFactory';
import { validateSafeUrl } from './urlValidation';
import type { VibeAppsProject } from './vibeApps';

export interface VibeProject {
  name: string;
  creator: string | null;
  vibeappsUrl: string;
  githubUrl: string | null;
  websiteUrl: string | null;
  videoUrl: string | null;
  isActive: boolean;
}

// Helper function to get the Firecrawl API key from environment
function getFirecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY ?? '';
}

// Helper function to normalize creator name by removing "by " prefix if present
function normalizeCreatorName(creator: string | undefined | null): string | undefined {
  if (!creator) {
    return undefined;
  }
  const trimmed = creator.trim();
  // Remove "by " prefix (case-insensitive) if present
  const normalized = trimmed.replace(/^by\s+/i, '').trim();
  return normalized || undefined;
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

    // Validate URL to prevent SSRF attacks
    const urlValidation = await validateSafeUrl(args.url);
    if (!urlValidation.isValid) {
      return {
        success: false as const,
        url: args.url,
        error: urlValidation.error || 'Invalid URL',
        markdown: null,
        json: null,
      };
    }

    try {
      // Initialize Firecrawl client with longer timeout
      const firecrawl = new Firecrawl({
        apiKey,
        timeoutMs: 120000, // 2 minutes timeout instead of default 60 seconds
      });

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

export const processPastedUrls = guarded.action(
  'vibe-apps.admin',
  {
    urls: v.array(v.string()),
  },
  async (ctx, args, _role): Promise<VibeProject[]> => {
    const apiKey = getFirecrawlApiKey();

    if (!apiKey || apiKey.length === 0) {
      throw new Error('Firecrawl API key is not configured');
    }

    try {
      // Get existing projects from database
      const existingProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      const normalizeUrl = (url: string) => url.split('#')[0];
      const existingUrls = new Set(
        existingProjects.map((p: VibeAppsProject) => normalizeUrl(p.vibeappsUrl)),
      );

      console.log(`Found ${existingProjects.length} existing projects in database`);

      // Filter and validate the pasted URLs
      const validUrls: string[] = [];
      for (const url of args.urls) {
        const trimmedUrl = url.trim();
        if (!trimmedUrl) continue;

        // Validate URL format and safety
        const urlValidation = await validateSafeUrl(trimmedUrl);
        if (!urlValidation.isValid) {
          console.log(`Skipping invalid URL: ${trimmedUrl} - ${urlValidation.error}`);
          continue;
        }

        // Check if it's a vibeapps URL
        if (!trimmedUrl.startsWith('https://vibeapps.dev/s/')) {
          console.log(`Skipping non-vibeapps URL: ${trimmedUrl}`);
          continue;
        }

        validUrls.push(normalizeUrl(trimmedUrl));
      }

      // Remove duplicates and filter out existing URLs
      const uniqueUrls = [...new Set(validUrls)];
      const newUrls = uniqueUrls.filter((url) => !existingUrls.has(url));

      console.log(`Processing ${newUrls.length} new URLs out of ${uniqueUrls.length} valid URLs`);

      // Initialize Firecrawl client with longer timeout
      const firecrawl = new Firecrawl({
        apiKey,
        timeoutMs: 120000, // 2 minutes timeout instead of default 60 seconds
      });

      // Process each new URL
      for (const url of newUrls) {
        try {
          // Extract project name from URL slug
          const slugMatch = url.match(/\/s\/([^/]+)/);
          let name = 'Unknown Project';
          if (slugMatch) {
            name = slugMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
          }

          console.log(`Processing project: ${name} (${url})`);

          // Scrape the individual vibeapps URL to get additional information
          const projectResult = await firecrawl.scrape(url, {
            formats: [
              {
                type: 'json',
                schema: {
                  type: 'object',
                  properties: {
                    creator: {
                      type: 'string',
                      description: 'The project creator/team name (e.g., "by Hamza Tekin")',
                    },
                    websiteUrl: {
                      type: 'string',
                      description: 'The main website/demo URL from Project Links & Tags section',
                    },
                    videoUrl: {
                      type: 'string',
                      description: 'YouTube video URL from Project Links & Tags section',
                    },
                    githubUrl: {
                      type: 'string',
                      description: 'GitHub repository URL from Project Links & Tags section',
                    },
                  },
                },
                prompt:
                  'Extract information from this vibeapps.dev project page: 1) The creator/team name (look for text like "by [Name]" near the top of the page), 2) The website/demo URL from the "Project Links & Tags" section, 3) Any YouTube video URL from the "Project Links & Tags" section, 4) The GitHub repository URL from the "Project Links & Tags" section. Focus on the main website/demo link (usually the first link in Project Links & Tags), YouTube video links, and GitHub repository links.',
              },
            ],
            onlyMainContent: true, // Focus on main content for better extraction
            waitFor: 15000, // Increased wait time for JS-heavy content
            maxAge: 0, // Bypass cache for fresh data (0 = no caching)
          });

          let websiteUrl: string | undefined;
          let videoUrl: string | undefined;
          let extractedGithubUrl: string | undefined;
          let extractedCreator: string | undefined;

          if (projectResult?.json) {
            const projectJson = projectResult.json as Record<string, unknown>;
            websiteUrl = (projectJson.websiteUrl as string | undefined)?.trim();
            videoUrl = (projectJson.videoUrl as string | undefined)?.trim();
            extractedGithubUrl = (projectJson.githubUrl as string | undefined)?.trim();
            extractedCreator = normalizeCreatorName(projectJson.creator as string | undefined);
          }

          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: extractedCreator || undefined,
            vibeappsUrl: url,
            githubUrl: extractedGithubUrl || undefined,
            websiteUrl: websiteUrl || undefined,
            videoUrl: videoUrl || undefined,
          });

          console.log(`Successfully processed: ${name}`);
        } catch (error) {
          console.error(`Failed to process URL ${url}:`, error);

          // Still store the project but without extracted URLs
          const slugMatch = url.match(/\/s\/([^/]+)/);
          let name = 'Unknown Project';
          if (slugMatch) {
            name = slugMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
          }

          // Check if it's a timeout error - still create the project but log it
          const isTimeout =
            error instanceof Error &&
            (error.message.includes('timeout') || error.message.includes('ETIMEDOUT'));

          if (isTimeout) {
            console.log(`Timeout processing ${url} - creating basic project entry`);
          }

          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: undefined,
            vibeappsUrl: url,
            githubUrl: undefined,
            websiteUrl: undefined,
            videoUrl: undefined,
          });
        }
      }

      // Return all projects from database (existing + newly processed)
      const finalProjects = await ctx.runQuery(api.vibeApps.getAllVibeAppsProjects);
      console.log(`Returning ${finalProjects.length} total projects from database`);

      return finalProjects.map((p: VibeAppsProject) => ({
        name: p.name,
        creator: p.creator || null,
        vibeappsUrl: p.vibeappsUrl,
        githubUrl: p.githubUrl || null,
        websiteUrl: p.websiteUrl || null,
        videoUrl: p.videoUrl || null,
        isActive: p.isActive ?? true, // Default to true for backward compatibility
      }));
    } catch (error) {
      // Handle SDK errors gracefully
      const errorMessage = error instanceof Error ? error.message : 'Failed to process pasted URLs';

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
      const existingUrls = new Set(
        existingProjects.map((p: VibeAppsProject) => normalizeUrl(p.vibeappsUrl)),
      );

      console.log(`Found ${existingProjects.length} existing projects in database`);

      // Initialize Firecrawl client
      const firecrawl = new Firecrawl({ apiKey });

      // Step 1: Scrape main page to get project info and vibeapps URLs
      console.log('Step 1: Scraping main vibeapps.dev page...');

      // Scrape the page to get links directly from Firecrawl
      // Note: Firecrawl cannot click "Load More" buttons, so we get initially visible projects only
      const pageResult = await firecrawl.scrape('https://vibeapps.dev/tag/tanstackstart', {
        formats: ['links'], // Get all links directly from Firecrawl
        onlyMainContent: false,
        waitFor: 15000, // Increased wait time for JS-heavy content
        maxAge: 0, // Bypass cache for fresh data (0 = no caching)
      });

      // Get all links directly from Firecrawl
      const allLinks = pageResult?.links || [];

      // Filter for vibeapps project URLs
      const uniqueUrls = allLinks
        .filter((link: string) => link.startsWith('https://vibeapps.dev/s/'))
        .map((link: string) => link.split('#')[0]) // Remove fragments
        .filter((link: string, index: number, arr: string[]) => arr.indexOf(link) === index); // Deduplicate

      console.log(`Found ${uniqueUrls.length} unique vibeapps.dev/s/ URLs from links extraction`);

      // Create projects from the URLs found
      const markdownProjects: Array<Record<string, unknown>> = [];

      for (const url of uniqueUrls) {
        // Extract project name from URL slug
        const slugMatch = url.match(/\/s\/([^/]+)/);
        let name = 'Unknown Project';
        if (slugMatch) {
          name = slugMatch[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
        }

        markdownProjects.push({
          name,
          creator: null, // Links format doesn't include creator/GitHub info
          vibeappsUrl: url,
          githubUrl: null, // Links format doesn't include GitHub URLs
          description: null,
          tags: [],
        });
      }

      console.log(`Created ${markdownProjects.length} projects from links extraction`);

      // Now try JSON extraction as well - use simpler schema
      const mainResult = await firecrawl.scrape('https://vibeapps.dev/tag/tanstackstart', {
        formats: [
          {
            type: 'json',
            schema: {
              type: 'object',
              properties: {
                projects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      vibeappsUrl: { type: 'string' },
                    },
                    required: ['name', 'vibeappsUrl'],
                  },
                },
              },
              required: ['projects'],
            },
            prompt: 'Extract project names and their vibeapps.dev URLs from this page.',
          },
        ],
        maxAge: 0, // Bypass cache for fresh data (0 = no caching)
      });

      if (!mainResult) {
        throw new Error('No data returned from main page scrape');
      }

      // Extract projects from main page JSON
      const mainJsonData = mainResult.json as Record<string, unknown> | undefined;
      const jsonProjects =
        (mainJsonData?.projects as Array<Record<string, unknown>> | undefined) ?? [];

      console.log(`Found ${jsonProjects.length} projects on main page via JSON extraction`);

      // Combine JSON projects with markdown projects
      // Normalize URLs by removing fragments for consistent comparison
      const jsonUrls = new Set(jsonProjects.map((p) => normalizeUrl(p.vibeappsUrl as string)));
      const combinedProjects = [
        ...jsonProjects,
        ...markdownProjects.filter((p) => !jsonUrls.has(normalizeUrl(p.vibeappsUrl as string))),
      ];

      console.log(`Total projects after combining JSON and markdown: ${combinedProjects.length}`);

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
        const creator = normalizeCreatorName(project.creator as string | undefined);
        const vibeappsUrl = (project.vibeappsUrl as string | undefined)?.trim();
        const githubUrl = (project.githubUrl as string | undefined)?.trim();

        if (!name || !vibeappsUrl) {
          console.log(`Skipping project: missing name or vibeappsUrl`);
          continue;
        }

        try {
          // Extract URLs from the "Project Links & Tags" section
          const projectResult = await firecrawl.scrape(vibeappsUrl, {
            formats: [
              {
                type: 'json',
                schema: {
                  type: 'object',
                  properties: {
                    creator: {
                      type: 'string',
                      description: 'The project creator/team name (e.g., "by Hamza Tekin")',
                    },
                    websiteUrl: {
                      type: 'string',
                      description: 'The main website/demo URL from Project Links & Tags section',
                    },
                    videoUrl: {
                      type: 'string',
                      description: 'YouTube video URL from Project Links & Tags section',
                    },
                    githubUrl: {
                      type: 'string',
                      description: 'GitHub repository URL from Project Links & Tags section',
                    },
                  },
                },
                prompt:
                  'Extract information from this vibeapps.dev project page: 1) The creator/team name (look for text like "by [Name]" near the top of the page), 2) The website/demo URL from the "Project Links & Tags" section, 3) Any YouTube video URL from the "Project Links & Tags" section, 4) The GitHub repository URL from the "Project Links & Tags" section. Focus on the main website/demo link (usually the first link in Project Links & Tags), YouTube video links, and GitHub repository links.',
              },
            ],
            onlyMainContent: true, // Focus on main content for better extraction
            waitFor: 15000, // Increased wait time for JS-heavy content
            maxAge: 0, // Bypass cache for fresh data (0 = no caching)
          });

          let websiteUrl: string | undefined;
          let videoUrl: string | undefined;
          let extractedGithubUrl: string | undefined;
          let extractedCreator: string | undefined;

          if (projectResult?.json) {
            const projectJson = projectResult.json as Record<string, unknown>;
            websiteUrl = (projectJson.websiteUrl as string | undefined)?.trim();
            videoUrl = (projectJson.videoUrl as string | undefined)?.trim();
            extractedGithubUrl = (projectJson.githubUrl as string | undefined)?.trim();
            extractedCreator = normalizeCreatorName(projectJson.creator as string | undefined);
          }

          // Use extracted creator if available, otherwise use the one from main page
          const finalCreator = normalizeCreatorName(extractedCreator || creator);
          // Use extracted GitHub URL if we didn't get one from the main page
          const finalGithubUrl = githubUrl || extractedGithubUrl;

          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: finalCreator || undefined,
            vibeappsUrl,
            githubUrl: finalGithubUrl || undefined,
            websiteUrl: websiteUrl || undefined,
            videoUrl: videoUrl || undefined,
          });
        } catch {
          // Still store the project but without extracted URLs
          await ctx.runMutation(api.vibeApps.upsertVibeAppsProject, {
            name,
            creator: normalizeCreatorName(creator) || undefined, // Use original creator from main page in catch block
            vibeappsUrl,
            githubUrl: githubUrl || undefined,
            websiteUrl: undefined,
            videoUrl: undefined,
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
        videoUrl: p.videoUrl || null,
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
