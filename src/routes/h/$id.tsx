import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { useEffect, useMemo } from 'react';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { HackathonTimeBadge } from '~/features/hackathons/components/HackathonTimeBadge';
import { PublicHackathonActions } from '~/features/hackathons/components/PublicHackathonActions';
import { PublicSubmissionsList } from '~/features/hackathons/components/PublicSubmissionsList';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/h/$id')({
  component: PublicHackathonPage,
});

function PublicHackathonPage() {
  usePerformanceMonitoring('PublicHackathon');
  const location = useLocation();
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const hackathon = useQuery(api.hackathons.getPublicHackathon, {
    hackathonId: id as Id<'hackathons'>,
  });

  // Check if we're on a nested route (like /submissions) - must be called before early returns
  const isNestedRoute = useMemo(() => location.pathname !== `/h/${id}`, [location.pathname, id]);

  // Redirect authenticated users to full-featured page
  useEffect(() => {
    if (isAuthenticated) {
      navigate({
        to: '/app/h/$id',
        params: { id },
        replace: true,
      });
    }
  }, [isAuthenticated, navigate, id]);

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
        <>
          <PageHeader
            title={hackathon.title}
            description={hackathon.description}
            titleActions={
              <HackathonTimeBadge submissionDeadline={hackathon.dates?.submissionDeadline} />
            }
            actions={<PublicHackathonActions hackathonId={hackathon._id} />}
          />

          <PublicSubmissionsList hackathonId={hackathon._id} />
        </>
      )}

      {isNestedRoute && <Outlet />}
    </div>
  );
}
