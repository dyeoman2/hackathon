import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { HackathonActionsMenu } from '~/features/hackathons/components/HackathonActionsMenu';
import { HackathonSettingsModal } from '~/features/hackathons/components/HackathonSettingsModal';
import { HackathonTimeBadge } from '~/features/hackathons/components/HackathonTimeBadge';
import { InviteJudgeModal } from '~/features/hackathons/components/InviteJudgeModal';
import { SubmissionsList } from '~/features/hackathons/components/SubmissionsList';
import { VotingStatusBanner } from '~/features/hackathons/components/VotingStatusBanner';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

const paymentStatusSearchSchema = z.object({
  payment: z.enum(['success', 'cancelled', 'failed']).optional(),
});

export const Route = createFileRoute('/app/h/$id')({
  component: HackathonWorkspaceComponent,
  errorComponent: DashboardErrorBoundary,
  validateSearch: paymentStatusSearchSchema,
});

function HackathonWorkspaceComponent() {
  usePerformanceMonitoring('HackathonWorkspace');
  const router = useRouter();
  const location = useLocation();
  const toast = useToast();
  const { id } = Route.useParams();
  const { payment } = Route.useSearch();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId: id as Id<'hackathons'> });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isInviteJudgeModalOpen, setIsInviteJudgeModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const paymentHandledRef = useRef<string | undefined>(undefined);

  const deleteHackathon = useMutation(api.hackathons.deleteHackathon);
  const seedHackathonSubmissions = useAction(api.submissions.seedHackathonSubmissions);
  const { isAdmin: isSiteAdmin } = useAuth();

  // Check if we're on a nested route (like /judges) - must be called before early returns
  const isNestedRoute = useMemo(
    () => location.pathname !== `/app/h/${id}`,
    [location.pathname, id],
  );

  // Memoize permission check to avoid recalculation on every render - must be called before early returns
  const canEdit = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  const canManageJudges = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  const canDelete = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  const handleSeedSubmissions = async () => {
    if (!hackathon) return;

    try {
      // Parse the YAML data from Untitled-1.yaml
      const submissionsData = [
        {
          repoUrl: 'https://github.com/brenelz/live-olympic-hockey-draft',
          siteUrl: 'https://live-olympic-hockey-draft.netlify.app/',
          team: 'Brenelz',
          title: 'Live Olympic Hockey Draft',
        },
        {
          repoUrl: 'https://github.com/somayaj/stockit',
          siteUrl: 'https://stockit-1762128572.netlify.app/',
          team: 'Somayaj',
          title: 'Stockit',
        },
        {
          repoUrl: 'https://github.com/JealousGx/EventFlow',
          siteUrl: 'https://eventflow.foundersignal.app/',
          team: 'JealousGx',
          title: 'EventFlow',
        },
      ];

      toast.showToast('Creating submissions with 10-second delays between each...', 'info');

      const result = await seedHackathonSubmissions({
        hackathonId: id as Id<'hackathons'>,
        submissions: submissionsData,
      });

      if (result.success) {
        toast.showToast(result.message, 'success');
      } else {
        toast.showToast(result.message, 'error');
      }
    } catch (error) {
      console.error('Failed to seed submissions:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to seed submissions',
        'error',
      );
    }
  };

  useEffect(() => {
    if (!payment || paymentHandledRef.current === payment) {
      return;
    }

    paymentHandledRef.current = payment;

    void router.navigate({
      to: '/app/h/$id',
      params: { id },
      replace: true,
    });

    if (payment === 'success') {
      toast.showToast(
        'Payment completed successfully! Credits have been added to your account.',
        'success',
      );
    } else {
      toast.showToast('Payment was cancelled or failed. Please try again.', 'error');
    }
  }, [payment, router, id, toast]);

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
                canEdit={canEdit}
                canManageJudges={canManageJudges}
                canDelete={canDelete}
                isSiteAdmin={isSiteAdmin}
                onEdit={() => setIsSettingsModalOpen(true)}
                onManageJudges={() => {
                  void router.navigate({
                    to: '/app/h/$id/judges',
                    params: { id },
                  });
                }}
                onInviteJudge={() => setIsInviteJudgeModalOpen(true)}
                onDelete={() => setIsDeleteDialogOpen(true)}
                onSeedSubmissions={handleSeedSubmissions}
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
