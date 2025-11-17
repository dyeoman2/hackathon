import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

export type VibeAppsProject = {
  _id: string;
  _creationTime: number;
  name: string;
  creator?: string;
  vibeappsUrl: string;
  githubUrl?: string;
  websiteUrl?: string;
  youtubeUrl?: string;
  isActive: boolean;
  lastScrapedAt: number;
  createdAt: number;
  updatedAt: number;
};

// Query to get all vibeapps projects
export const getAllVibeAppsProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query('vibeAppsProjects').collect();
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
    youtubeUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('vibeAppsProjects')
      .withIndex('by_vibeappsUrl', (q) => q.eq('vibeappsUrl', args.vibeappsUrl))
      .first();

    const now = Date.now();

    if (existing) {
      // Update existing project
      await ctx.db.patch(existing._id, {
        name: args.name,
        creator: args.creator,
        githubUrl: args.githubUrl,
        websiteUrl: args.websiteUrl,
        youtubeUrl: args.youtubeUrl,
        lastScrapedAt: now,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new project - defaults to active
      return await ctx.db.insert('vibeAppsProjects', {
        name: args.name,
        creator: args.creator,
        vibeappsUrl: args.vibeappsUrl,
        githubUrl: args.githubUrl,
        websiteUrl: args.websiteUrl,
        youtubeUrl: args.youtubeUrl,
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
    youtubeUrl: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { id, ...updateFields } = args;

    // Verify the project exists
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error('Project not found');
    }

    // Update the project
    await ctx.db.patch(id, {
      ...updateFields,
      updatedAt: Date.now(),
    });

    return id;
  },
});
