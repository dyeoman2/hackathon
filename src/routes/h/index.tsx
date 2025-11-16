import { api } from '@convex/_generated/api';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { HackathonTimeBadge } from '~/features/hackathons/components/HackathonTimeBadge';
import { NewHackathonModal } from '~/features/hackathons/components/NewHackathonModal';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/h/')({
  component: HackathonListComponent,
});

function HackathonListComponent() {
  usePerformanceMonitoring('HackathonList');
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  // Always show all public hackathons to everyone
  const allPublicHackathons = useQuery(api.hackathons.listPublicHackathons, {});
  // Get user's hackathons (with role information) when authenticated
  const userHackathons = useQuery(
    api.hackathons.listHackathons,
    isAuthenticated ? {} : 'skip',
  );
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Auto-open modal only for authenticated users when there are no hackathons at all
  useEffect(() => {
    if (isAuthenticated && allPublicHackathons !== undefined && allPublicHackathons.length === 0) {
      setIsModalOpen(true);
    }
  }, [allPublicHackathons, isAuthenticated]);

  const handleCreateHackathon = () => {
    if (isAuthenticated) {
      setIsModalOpen(true);
    } else {
      router.navigate({
        to: '/register',
        search: { redirect: '/h' },
      });
    }
  };

  if (allPublicHackathons === undefined || (isAuthenticated && userHackathons === undefined)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Hackathons"
          description="Discover and join hackathon events"
          actions={<Skeleton className="h-10 w-32" />}
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Filter hackathons into "my hackathons" and "other hackathons"
  const myHackathons = userHackathons || [];
  const myHackathonIds = new Set(myHackathons.map((h) => h._id));
  const otherHackathons = allPublicHackathons.filter((h) => !myHackathonIds.has(h._id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hackathons"
        description="Discover and join hackathon events"
        actions={
          <Button onClick={handleCreateHackathon}>
            <Plus className="h-4 w-4" />
            {isAuthenticated ? 'New Hackathon' : 'Create Hackathon'}
          </Button>
        }
      />

      {allPublicHackathons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4 text-center">
              No hackathons available yet. Be the first to create one!
            </p>
            <Button onClick={handleCreateHackathon}>
              <Plus className="h-4 w-4" />
              {isAuthenticated ? 'Create Hackathon' : 'Start Your Hackathon'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* My Hackathons section - only show if authenticated and has hackathons */}
          {isAuthenticated && myHackathons.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">My Hackathons</h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {myHackathons.map((hackathon) => (
                  <Card
                    key={hackathon._id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() => {
                      void router.navigate({
                        to: '/h/$id',
                        params: { id: hackathon._id },
                      });
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="wrap-break-word leading-normal flex-1">
                          {hackathon.title}
                        </CardTitle>
                        <HackathonTimeBadge
                          submissionDeadline={hackathon.dates?.submissionDeadline}
                          className="shrink-0"
                        />
                      </div>
                      {hackathon.description && (
                        <CardDescription className="line-clamp-2 mt-2">
                          {hackathon.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Other Hackathons section - only show if there are other hackathons */}
          {otherHackathons.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold">
                {isAuthenticated && myHackathons.length > 0 ? 'Other Hackathons' : 'Hackathons'}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {otherHackathons.map((hackathon) => (
                  <Card
                    key={hackathon._id}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() => {
                      void router.navigate({
                        to: '/h/$id',
                        params: { id: hackathon._id },
                      });
                    }}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="wrap-break-word leading-normal flex-1">
                          {hackathon.title}
                        </CardTitle>
                        <HackathonTimeBadge
                          submissionDeadline={hackathon.dates?.submissionDeadline}
                          className="shrink-0"
                        />
                      </div>
                      {hackathon.description && (
                        <CardDescription className="line-clamp-2 mt-2">
                          {hackathon.description}
                        </CardDescription>
                      )}
                    </CardHeader>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {isAuthenticated && (
        <NewHackathonModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}
