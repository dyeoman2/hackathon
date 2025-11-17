import { createFileRoute } from '@tanstack/react-router';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { VibeAppsProject } from '../../convex/vibeApps';
import { VibeAppsPage } from '../components/VibeAppsPage';

const convex = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL ?? '');

export const Route = createFileRoute('/vibe-apps')({
  loader: async () => {
    try {
      // Only load existing projects from database, don't trigger scraping
      const rawProjects = await convex.query(api.vibeApps.getAllVibeAppsProjects);

      // Transform database objects to VibeProject interface
      const projects = rawProjects.map((p: VibeAppsProject) => ({
        name: p.name,
        creator: p.creator || null,
        vibeappsUrl: p.vibeappsUrl,
        githubUrl: p.githubUrl || null,
        websiteUrl: p.websiteUrl || null,
        isActive: p.isActive ?? true, // Default to true for backward compatibility
      }));

      return { projects, error: null };
    } catch (error) {
      return {
        projects: [],
        error: error instanceof Error ? error.message : 'Failed to load projects',
      };
    }
  },
  component: VibeAppsPage,
});
