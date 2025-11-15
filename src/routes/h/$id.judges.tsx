import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
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
import { useToast } from '~/components/ui/toast';
import { InviteJudgeModal } from '~/features/hackathons/components/InviteJudgeModal';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/h/$id/judges')({
  component: JudgeManagementComponent,
});

function JudgeManagementComponent() {
  usePerformanceMonitoring('JudgeManagement');
  const router = useRouter();
  const { id } = Route.useParams();
  const toast = useToast();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId: id as Id<'hackathons'> });
  const memberships = useQuery(api.hackathons.getHackathonMemberships, {
    hackathonId: id as Id<'hackathons'>,
  });
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [resendingId, setResendingId] = useState<Id<'memberships'> | null>(null);
  const [revokingId, setRevokingId] = useState<Id<'memberships'> | null>(null);
  const [removingId, setRemovingId] = useState<Id<'memberships'> | null>(null);

  const resendInvite = useMutation(api.hackathons.resendInvite);
  const revokeInvite = useMutation(api.hackathons.revokeInvite);
  const removeJudge = useMutation(api.hackathons.removeJudge);

  const capitalizeRole = (role: string) => {
    return role.charAt(0).toUpperCase() + role.slice(1);
  };

  const getRoleBadgeStyle = (role: string) => {
    switch (role) {
      case 'owner':
        return 'border-red-200/70 bg-red-50 text-red-700 *:data-[slot=alert-description]:text-red-700/90 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-100 dark:*:data-[slot=alert-description]:text-red-100/80';
      case 'admin':
        return 'border-purple-200/70 bg-purple-50 text-purple-700 *:data-[slot=alert-description]:text-purple-700/90 dark:border-purple-500/40 dark:bg-purple-500/15 dark:text-purple-100 dark:*:data-[slot=alert-description]:text-purple-100/80';
      case 'judge':
        return 'border-blue-200/70 bg-blue-50 text-blue-700 *:data-[slot=alert-description]:text-blue-700/90 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-100 dark:*:data-[slot=alert-description]:text-blue-100/80';
      default:
        return 'border-gray-200/70 bg-gray-50 text-gray-700 *:data-[slot=alert-description]:text-gray-700/90 dark:border-gray-500/40 dark:bg-gray-500/15 dark:text-gray-100 dark:*:data-[slot=alert-description]:text-gray-100/80';
    }
  };

  const handleResend = async (membershipId: Id<'memberships'>) => {
    setResendingId(membershipId);
    try {
      await resendInvite({ membershipId, appUrl: window.location.origin });
      toast.showToast('Invite resent successfully!', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to resend invite', 'error');
    } finally {
      setResendingId(null);
    }
  };

  const handleRevoke = async (membershipId: Id<'memberships'>) => {
    setRevokingId(membershipId);
    try {
      await revokeInvite({ membershipId });
      toast.showToast('Invite revoked successfully', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to revoke invite', 'error');
    } finally {
      setRevokingId(null);
    }
  };

  const handleRemove = async (membershipId: Id<'memberships'>) => {
    setRemovingId(membershipId);
    try {
      await removeJudge({ membershipId });
      toast.showToast('Judge removed successfully', 'success');
    } catch (error) {
      toast.showToast(error instanceof Error ? error.message : 'Failed to remove judge', 'error');
    } finally {
      setRemovingId(null);
    }
  };

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
      <div className="flex items-center gap-4 mb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void router.navigate({
              to: '/h/$id',
              params: { id },
            });
          }}
          className="-ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      <PageHeader
        title="Judges"
        description={hackathon.title}
        actions={
          <Button onClick={() => setIsInviteModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Invite Judge
          </Button>
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
                        <Badge variant="outline" className={getRoleBadgeStyle(membership.role)}>
                          {capitalizeRole(membership.role)}
                        </Badge>
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemove(membership._id)}
                            disabled={removingId === membership._id}
                          >
                            {removingId === membership._id ? 'Removing...' : 'Remove'}
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
                        <Badge variant="outline" className={getRoleBadgeStyle(membership.role)}>
                          {capitalizeRole(membership.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="warning">Invited</Badge>
                      </TableCell>
                      <TableCell>{new Date(membership.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mr-2"
                          onClick={() => handleResend(membership._id)}
                          disabled={resendingId === membership._id || revokingId === membership._id}
                        >
                          {resendingId === membership._id ? 'Resending...' : 'Resend'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(membership._id)}
                          disabled={resendingId === membership._id || revokingId === membership._id}
                        >
                          {revokingId === membership._id ? 'Revoking...' : 'Revoke'}
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
