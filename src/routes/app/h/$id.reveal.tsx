import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { Skeleton } from '~/components/ui/skeleton';
import { RevealStage } from '~/features/reveal/components/RevealStage';
import { useRevealSync } from '~/features/reveal/hooks/useRevealSync';

export const Route = createFileRoute('/app/h/$id/reveal')({
  component: RevealPageComponent,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      autostart: search.autostart === true || search.autostart === 'true',
    };
  },
});

function RevealPageComponent() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const hackathonId = id as Id<'hackathons'>;

  // Get hackathon data to check role
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });

  // Get reveal state and submissions
  const revealState = useQuery(api.reveal.getRevealState, { hackathonId });
  const submissions = useQuery(api.reveal.getRevealSubmissions, { hackathonId });

  // Real-time sync hook for phase management (must be called before any early returns)
  const revealSync = useRevealSync(hackathonId, revealState ?? null);

  // Auto-start reveal if requested
  useEffect(() => {
    if (
      !search.autostart ||
      !revealState ||
      !hackathon?.role ||
      revealSync.isStarting ||
      revealState.phase !== 'idle'
    ) {
      return;
    }

    const isPresenter = hackathon.role === 'owner' || hackathon.role === 'admin';
    if (!isPresenter) {
      return;
    }

    void revealSync.startReveal();
  }, [search.autostart, revealState, hackathon?.role, revealSync]);

  // Loading state - check for undefined (still loading)
  if (hackathon === undefined || revealState === undefined || submissions === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
        <div className="space-y-4 text-center">
          <Skeleton className="mx-auto h-8 w-64" />
          <Skeleton className="mx-auto h-4 w-48" />
        </div>
      </div>
    );
  }

  // Access denied
  if (hackathon === null || revealState === null || submissions === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-3xl font-bold text-white">Access Denied</h1>
          <p className="text-slate-300">You don't have permission to view this reveal sequence.</p>
        </div>
      </div>
    );
  }

  // Check if user is presenter (owner/admin)
  const isPresenter = hackathon.role === 'owner' || hackathon.role === 'admin';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950">
      <RevealStage
        hackathonId={hackathonId}
        hackathonTitle={hackathon.title}
        revealState={revealState}
        submissions={submissions}
        isPresenter={isPresenter}
        revealSync={revealSync}
      />
    </div>
  );
}
