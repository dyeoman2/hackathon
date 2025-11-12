import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Settings, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { HackathonSettingsModal } from '~/features/hackathons/components/HackathonSettingsModal';
import { SubmissionsList } from '~/features/hackathons/components/SubmissionsList';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/h/$id')({
  component: HackathonWorkspaceComponent,
  errorComponent: DashboardErrorBoundary,
});

function HackathonWorkspaceComponent() {
  usePerformanceMonitoring('HackathonWorkspace');
  const router = useRouter();
  const location = useLocation();
  const { id } = Route.useParams();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId: id as Id<'hackathons'> });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  // Check if we're on a nested route (like /judges) - must be called before early returns
  const isNestedRoute = useMemo(
    () => location.pathname !== `/app/h/${id}`,
    [location.pathname, id],
  );

  // Memoize permission check to avoid recalculation on every render - must be called before early returns
  const canManageJudges = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  if (hackathon === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="" description={<Skeleton className="h-4 w-96" />} />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (hackathon === null) {
    return <NotFound />;
  }

  return (
    <div className="space-y-6">
      {!isNestedRoute && (
        <PageHeader
          title={hackathon.title}
          description={hackathon.description}
          actions={
            <div className="flex gap-2">
              {canManageJudges && (
                <Button
                  variant="outline"
                  onClick={() => {
                    void router.navigate({
                      to: '/app/h/$id/judges',
                      params: { id },
                    });
                  }}
                >
                  <Users className="h-4 w-4" />
                  Manage Judges
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsSettingsModalOpen(true)}>
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </div>
          }
        />
      )}

      {isNestedRoute ? <Outlet /> : <SubmissionsList hackathonId={id as Id<'hackathons'>} />}

      <HackathonSettingsModal
        hackathonId={id as Id<'hackathons'>}
        open={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />
    </div>
  );
}
