import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { validateSafeUrl } from './urlValidation';

export type VibeAppsProject = {
  _id: string;
  _creationTime: number;
  name: string;
  creator?: string;
  vibeappsUrl: string;
  githubUrl?: string;
  websiteUrl?: string;
  videoUrl?: string;
  // Temporary field during migration
  youtubeUrl?: string;
  isActive: boolean;
  lastScrapedAt: number;
  createdAt: number;
  updatedAt: number;
};

async function assertSafeUrl(value: string, fieldName: string): Promise<void> {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const validation = await validateSafeUrl(trimmed);
  if (!validation.isValid) {
    throw new Error(`${fieldName}: ${validation.error}`);
  }
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

// Query to get all vibeapps projects
export const getAllVibeAppsProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('vibeAppsProjects').order('desc').collect();
  },
});

// Mutation to upsert a project
export const upsertVibeAppsProject = mutation({
  args: {
    name: v.string(),
    creator: v.optional(v.string()),
    vibeappsUrl: v.string(),
    githubUrl: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Validate URLs to prevent SSRF attacks
    if (args.websiteUrl) {
      await assertSafeUrl(args.websiteUrl, 'websiteUrl');
    }
    if (args.videoUrl) {
      await assertSafeUrl(args.videoUrl, 'videoUrl');
    }

    const existing = await ctx.db
      .query('vibeAppsProjects')
      .withIndex('by_vibeappsUrl', (q) => q.eq('vibeappsUrl', args.vibeappsUrl))
      .first();

    const now = Date.now();
    const normalizedCreator = normalizeCreatorName(args.creator);

    if (existing) {
      // Update existing project
      await ctx.db.patch(existing._id, {
        name: args.name,
        creator: normalizedCreator,
        githubUrl: args.githubUrl,
        websiteUrl: args.websiteUrl,
        videoUrl: args.videoUrl,
        lastScrapedAt: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new project - defaults to active
      return await ctx.db.insert('vibeAppsProjects', {
        name: args.name,
        creator: normalizedCreator,
        vibeappsUrl: args.vibeappsUrl,
        githubUrl: args.githubUrl,
        websiteUrl: args.websiteUrl,
        videoUrl: args.videoUrl,
        isActive: true, // New projects default to active
        lastScrapedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

// Mutation to update an existing project
export const updateVibeAppsProject = mutation({
  args: {
    id: v.id('vibeAppsProjects'),
    name: v.string(),
    creator: v.optional(v.string()),
    githubUrl: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { id, ...updateFields } = args;

    // Validate URLs to prevent SSRF attacks
    if (updateFields.websiteUrl) {
      await assertSafeUrl(updateFields.websiteUrl, 'websiteUrl');
    }
    if (updateFields.videoUrl) {
      await assertSafeUrl(updateFields.videoUrl, 'videoUrl');
    }

    // Verify the project exists
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error('Project not found');
    }

    // Normalize creator name if provided
    const normalizedCreator = updateFields.creator
      ? normalizeCreatorName(updateFields.creator)
      : updateFields.creator;

    // Update the project
    await ctx.db.patch(id, {
      ...updateFields,
      creator: normalizedCreator,
      updatedAt: Date.now(),
    });

    return id;
  },
});

// Mutation to delete a project
export const deleteVibeAppsProject = mutation({
  args: {
    id: v.id('vibeAppsProjects'),
  },
  handler: async (ctx, args) => {
    // Verify the project exists
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new Error('Project not found');
    }

    // Delete the project
    await ctx.db.delete(args.id);

    return args.id;
  },
});

/**
 * Migrate existing vibeApps projects from youtubeUrl to videoUrl field
 */
export const migrateVibeAppsYoutubeUrlToVideoUrl = mutation({
  args: {},
  handler: async (ctx) => {
    // Query all projects that have youtubeUrl but not videoUrl
    const projectsWithYoutubeUrl = await ctx.db
      .query('vibeAppsProjects')
      .filter((q) => q.neq(q.field('youtubeUrl'), undefined))
      .collect();

    console.log(
      `Found ${projectsWithYoutubeUrl.length} vibeApps projects with youtubeUrl to migrate`,
    );

    let migrated = 0;
    let errors = 0;

    for (const project of projectsWithYoutubeUrl) {
      try {
        // Skip if videoUrl already exists (already migrated)
        if (project.videoUrl) {
          console.log(`Skipping project ${project._id} - already has videoUrl`);
          continue;
        }

        // Migrate youtubeUrl to videoUrl
        if (project.youtubeUrl) {
          await ctx.db.patch(project._id, {
            videoUrl: project.youtubeUrl,
            youtubeUrl: undefined, // Remove the old field
            updatedAt: Date.now(),
          });
        }

        migrated++;
        console.log(`Migrated project ${project._id}: ${project.name}`);
      } catch (error) {
        console.error(`Failed to migrate project ${project._id}:`, error);
        errors++;
      }
    }

    return {
      success: errors === 0,
      message: `Migration complete: ${migrated} projects migrated, ${errors} errors`,
      migrated,
      errors,
    };
  },
});
