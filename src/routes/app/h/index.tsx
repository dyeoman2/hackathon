import { api } from '@convex/_generated/api';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '~/components/PageHeader';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { NewHackathonModal } from '~/features/hackathons/components/NewHackathonModal';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/h/')({
  component: HackathonListComponent,
});

function HackathonListComponent() {
  usePerformanceMonitoring('HackathonList');
  const router = useRouter();
  const hackathons = useQuery(api.hackathons.listHackathons, {});
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Auto-open modal if no hackathons
  useEffect(() => {
    if (hackathons !== undefined && hackathons.length === 0 && !isModalOpen) {
      setIsModalOpen(true);
    }
  }, [hackathons, isModalOpen]);

  if (hackathons === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Hackathons"
          description="Manage your hackathon events"
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

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'owner':
        return 'default';
      case 'admin':
        return 'secondary';
      case 'judge':
        return 'outline';
      default:
        return 'outline';
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hackathons"
        description="Manage your hackathon events"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" />
            New Hackathon
          </Button>
        }
      />

      {hackathons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-muted-foreground mb-4 text-center">
              You don't have any hackathons yet. Create your first one to get started!
            </p>
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Hackathon
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
                  to: '/app/h/$id',
                  params: { id: hackathon._id },
                });
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <CardTitle className="line-clamp-2">{hackathon.title}</CardTitle>
                  <Badge variant={getRoleBadgeVariant(hackathon.role)}>{hackathon.role}</Badge>
                </div>
                {hackathon.description && (
                  <CardDescription className="line-clamp-2 mt-2">
                    {hackathon.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Created {new Date(hackathon.createdAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NewHackathonModal open={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </div>
  );
}
