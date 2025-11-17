import { useMatch } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import React from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { api } from '../../convex/_generated/api';
import type { VibeProject } from '../../convex/firecrawl';

export function VibeAppsPage() {
  const match = useMatch({ from: '/vibe-apps' });
  const loaderData = match.loaderData as { projects: VibeProject[]; error: string | null };

  const initialProjects = loaderData?.projects ?? [];
  const initialError = loaderData?.error ?? null;

  const getVibeAppsProjects = useAction(api.firecrawl.getVibeAppsProjects);
  const [projects, setProjects] = React.useState<VibeProject[]>(initialProjects);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(initialError);

  const triggerCrawl = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const result = await getVibeAppsProjects({});
      setProjects(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error triggering crawl');
    } finally {
      setLoading(false);
    }
  }, [getVibeAppsProjects]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vibe Apps Projects"
        description="Discover amazing projects from vibeapps.dev. Click 'Refresh Projects' to get the latest updates."
        actions={
          <Button onClick={triggerCrawl} disabled={loading} variant="default">
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Crawling...
              </>
            ) : (
              'Refresh Projects'
            )}
          </Button>
        }
      />

      {error && (
        <div className="max-w-2xl mx-auto">
          <div className="bg-destructive/10 border border-destructive rounded-md p-6">
            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-medium text-destructive mb-1">
                  Error Loading Projects
                </h3>
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {projects.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Projects ({projects.length})</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.vibeappsUrl}
                className="p-4 border rounded-lg hover:shadow-md transition-shadow"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-lg">{project.name}</h3>
                    {!project.isActive && (
                      <Badge variant="secondary" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  {project.creator && (
                    <p className="text-sm text-muted-foreground">by {project.creator}</p>
                  )}
                  <div className="flex flex-col gap-1">
                    {project.vibeappsUrl && (
                      <a
                        href={project.vibeappsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-purple-600 hover:text-purple-800 underline flex items-center gap-1"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-label="VibeApps"
                        >
                          <title>VibeApps</title>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                          />
                        </svg>
                        VibeApps
                      </a>
                    )}
                    {project.githubUrl && (
                      <a
                        href={project.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 underline flex items-center gap-1"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                          aria-label="GitHub"
                        >
                          <title>GitHub</title>
                          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                        </svg>
                        GitHub
                      </a>
                    )}
                    {project.websiteUrl && (
                      <a
                        href={project.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-green-600 hover:text-green-800 underline flex items-center gap-1"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          aria-label="External link"
                        >
                          <title>External link</title>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                        Website
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
