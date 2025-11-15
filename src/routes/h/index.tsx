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
  const hackathons = useQuery(api.hackathons.listPublicHackathons, {});
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Auto-open modal only for authenticated users when there are no hackathons at all
  useEffect(() => {
    if (isAuthenticated && hackathons !== undefined && hackathons.length === 0) {
      setIsModalOpen(true);
    }
  }, [hackathons, isAuthenticated]);

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

  if (hackathons === undefined) {
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

      {hackathons.length === 0 ? (
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hackathons.map((hackathon) => (
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
                    className="flex-shrink-0"
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
      )}

      {isAuthenticated && (
        <NewHackathonModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
      )}
    </div>
  );
}
