'use server';

import { createServerFn } from '@tanstack/react-start';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { VibeProject } from '../../convex/firecrawl';

const convex = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL ?? '');

export const fetchVibeAppsProjects = createServerFn({
  method: 'GET',
}).handler(async (): Promise<VibeProject[]> => {
  return convex.action(api.firecrawl.getVibeAppsProjects, {});
});
