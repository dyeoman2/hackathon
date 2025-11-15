import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect } from 'react';
import { RevealStage } from '~/features/reveal/components/RevealStage';
import { useRevealSync } from '~/features/reveal/hooks/useRevealSync';

export const Route = createFileRoute('/h/$id/reveal')({
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

  // Auto-start reveal if requested OR if in preview mode (voting not closed)
  useEffect(() => {
    if (!revealState || !hackathon || revealSync.isStarting || revealState.phase !== 'idle') {
      return;
    }

    const isPresenter = hackathon.role === 'owner' || hackathon.role === 'admin';
    if (!isPresenter) {
      return;
    }

    // Auto-start if autostart is requested OR if voting is not closed (preview mode)
    const shouldAutoStart = search.autostart || !hackathon.votingClosedAt;

    if (shouldAutoStart) {
      void revealSync.startReveal();
    }
  }, [search.autostart, revealState, hackathon, revealSync]);

  // Loading state - check for undefined (still loading)
  if (hackathon === undefined || revealState === undefined || submissions === undefined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-primary/60 via-slate-950 to-primary/30" />
    );
  }

  // Access denied
  if (hackathon === null || revealState === null || submissions === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-primary/60 via-slate-950 to-primary/30">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-3xl font-bold text-white">Access Denied</h1>
          <p className="text-slate-300">You don't have permission to view this reveal sequence.</p>
        </div>
      </div>
    );
  }

  // Check if user is presenter (owner/admin)
  const isPresenter = hackathon.role === 'owner' || hackathon.role === 'admin';

  // Check if in preview mode (voting not closed)
  const isPreviewMode = !hackathon.votingClosedAt;

  // Show nothing if in idle phase and preview mode (while auto-starting) or while starting
  if ((revealState.phase === 'idle' && isPreviewMode) || revealSync.isStarting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-primary/60 via-slate-950 to-primary/30" />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-primary/60 via-slate-950 to-primary/30">
      <RevealStage
        hackathonId={hackathonId}
        revealState={revealState}
        submissions={submissions}
        isPresenter={isPresenter}
        revealSync={revealSync}
      />
    </div>
  );
}
