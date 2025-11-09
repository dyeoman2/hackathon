import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ArrowLeft, Mail, Plus } from 'lucide-react';
import { useState } from 'react';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { SimpleTooltip } from '~/components/ui/simple-tooltip';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import { InviteJudgeModal } from '~/features/hackathons/components/InviteJudgeModal';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/h/$id/judges')({
  component: JudgeManagementComponent,
});

function JudgeManagementComponent() {
  usePerformanceMonitoring('JudgeManagement');
  const router = useRouter();
  const { id } = Route.useParams();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId: id as Id<'hackathons'> });
  const memberships = useQuery(api.hackathons.getHackathonMemberships, {
    hackathonId: id as Id<'hackathons'>,
  });
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  if (hackathon === undefined || memberships === undefined) {
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

  const activeMemberships = memberships.filter((m) => m.status === 'active');
  const invitedMemberships = memberships.filter((m) => m.status === 'invited');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Judge Management"
        description={hackathon.title}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void router.navigate({
                  to: '/app/h/$id',
                  params: { id },
                });
              }}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button onClick={() => setIsInviteModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Invite Judge
            </Button>
          </div>
        }
      />

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-4">Active Judges</h2>
          {activeMemberships.length === 0 ? (
            <div className="rounded-md border bg-card p-8 text-center">
              <p className="text-muted-foreground">No active judges yet.</p>
            </div>
          ) : (
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeMemberships.map((membership) => (
                    <TableRow key={membership._id}>
                      <TableCell>{membership.userName || '—'}</TableCell>
                      <TableCell>
                        {membership.userEmail || membership.invitedEmail || '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{membership.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">Active</Badge>
                      </TableCell>
                      <TableCell>{new Date(membership.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        {membership.role === 'owner' ? (
                          <SimpleTooltip content="The hackathon owner cannot be removed. Transfer ownership to another member first.">
                            <Button variant="ghost" size="sm" disabled>
                              Remove
                            </Button>
                          </SimpleTooltip>
                        ) : (
                          <Button variant="ghost" size="sm">
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Pending Invites</h2>
          {invitedMemberships.length === 0 ? (
            <div className="rounded-md border bg-card p-8 text-center">
              <p className="text-muted-foreground">No pending invites.</p>
            </div>
          ) : (
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Invited</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitedMemberships.map((membership) => (
                    <TableRow key={membership._id}>
                      <TableCell>{membership.userName || '—'}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          {membership.invitedEmail || '—'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{membership.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning">Invited</Badge>
                      </TableCell>
                      <TableCell>{new Date(membership.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="mr-2">
                          Resend
                        </Button>
                        <Button variant="ghost" size="sm">
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>

      <InviteJudgeModal
        hackathonId={id as Id<'hackathons'>}
        open={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
      />
    </div>
  );
}
