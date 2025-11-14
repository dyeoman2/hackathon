import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { useMemo, useState } from 'react';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { HackathonActionsMenu } from '~/features/hackathons/components/HackathonActionsMenu';
import { HackathonSettingsModal } from '~/features/hackathons/components/HackathonSettingsModal';
import { HackathonTimeBadge } from '~/features/hackathons/components/HackathonTimeBadge';
import { InviteJudgeModal } from '~/features/hackathons/components/InviteJudgeModal';
import { SubmissionsList } from '~/features/hackathons/components/SubmissionsList';
import { VotingStatusBanner } from '~/features/hackathons/components/VotingStatusBanner';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/h/$id')({
  component: HackathonWorkspaceComponent,
  errorComponent: DashboardErrorBoundary,
});

function HackathonWorkspaceComponent() {
  usePerformanceMonitoring('HackathonWorkspace');
  const router = useRouter();
  const location = useLocation();
  const toast = useToast();
  const { id } = Route.useParams();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId: id as Id<'hackathons'> });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isInviteJudgeModalOpen, setIsInviteJudgeModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteHackathon = useMutation(api.hackathons.deleteHackathon);
  const reopenVoting = useMutation(api.hackathons.reopenVoting);

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

  const canDelete = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteHackathon({ hackathonId: id as Id<'hackathons'> });
      toast.showToast('Hackathon deleted successfully', 'success');
      void router.navigate({ to: '/app/h' });
    } catch (error) {
      console.error('Failed to delete hackathon:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete hackathon',
        'error',
      );
    } finally {
      setIsDeleting(false);
      setIsDeleteDialogOpen(false);
    }
  };

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
            actions={
              <HackathonActionsMenu
                canManageJudges={canManageJudges}
                canDelete={canDelete}
                isVotingClosed={!!hackathon.votingClosedAt}
                onEdit={() => setIsSettingsModalOpen(true)}
                onManageJudges={() => {
                  void router.navigate({
                    to: '/app/h/$id/judges',
                    params: { id },
                  });
                }}
                onInviteJudge={() => setIsInviteJudgeModalOpen(true)}
                onReopenVoting={() => {
                  const confirmed = window.confirm(
                    'Are you sure you want to reopen voting? This will allow judges to submit and change their ratings again.',
                  );
                  if (confirmed) {
                    reopenVoting({ hackathonId: id as Id<'hackathons'> })
                      .then(() => {
                        toast.showToast('Voting reopened successfully', 'success');
                      })
                      .catch((error) => {
                        console.error('Failed to reopen voting:', error);
                        toast.showToast(
                          error instanceof Error ? error.message : 'Failed to reopen voting',
                          'error',
                        );
                      });
                  }
                }}
                onDelete={() => setIsDeleteDialogOpen(true)}
              />
            }
          />
          <VotingStatusBanner hackathonId={id as Id<'hackathons'>} hackathonRole={hackathon.role} />
        </>
      )}

      {isNestedRoute ? <Outlet /> : <SubmissionsList hackathonId={id as Id<'hackathons'>} />}

      <HackathonSettingsModal
        hackathonId={id as Id<'hackathons'>}
        open={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      <InviteJudgeModal
        hackathonId={id as Id<'hackathons'>}
        open={isInviteJudgeModalOpen}
        onClose={() => setIsInviteJudgeModalOpen(false)}
      />

      <DeleteConfirmationDialog
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        title="Delete Hackathon"
        description={`Are you sure you want to delete "${hackathon?.title}"? This will permanently remove the hackathon and all its submissions. This action cannot be undone.`}
        deleteText="Delete Hackathon"
        isDeleting={isDeleting}
        onConfirm={handleDelete}
        variant="danger"
      />
    </div>
  );
}
