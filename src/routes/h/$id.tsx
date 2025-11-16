import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { HackathonActionsMenu } from '~/features/hackathons/components/HackathonActionsMenu';
import { HackathonSettingsModal } from '~/features/hackathons/components/HackathonSettingsModal';
import { HackathonTimeBadge } from '~/features/hackathons/components/HackathonTimeBadge';
import { InviteJudgeModal } from '~/features/hackathons/components/InviteJudgeModal';
import { ShareButton } from '~/features/hackathons/components/ShareButton';
import { SubmissionsList } from '~/features/hackathons/components/SubmissionsList';
import { VotingStatusBanner } from '~/features/hackathons/components/VotingStatusBanner';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

const hackathonSearchSchema = z.object({
  payment: z.enum(['success', 'cancelled', 'failed']).optional(),
  newSubmission: z
    .union([z.string(), z.boolean()])
    .transform((val) => String(val))
    .optional(),
});

export const Route = createFileRoute('/h/$id')({
  component: HackathonPageComponent,
  errorComponent: DashboardErrorBoundary,
  validateSearch: hackathonSearchSchema,
});

function HackathonPageComponent() {
  usePerformanceMonitoring('HackathonPage');
  const router = useRouter();
  const location = useLocation();
  const toast = useToast();
  const { id } = Route.useParams();
  const { payment, newSubmission } = Route.useSearch();
  const { isAuthenticated } = useAuth();

  // Use different queries based on authentication
  const authenticatedHackathon = useQuery(
    api.hackathons.getHackathon,
    isAuthenticated ? { hackathonId: id as Id<'hackathons'> } : 'skip',
  );
  const publicHackathon = useQuery(api.hackathons.getPublicHackathon, {
    hackathonId: id as Id<'hackathons'>,
  });

  const hackathon = authenticatedHackathon || publicHackathon;
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isInviteJudgeModalOpen, setIsInviteJudgeModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isLeaveDialogOpen, setIsLeaveDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isNewSubmissionModalOpen, setIsNewSubmissionModalOpen] = useState(
    newSubmission === 'true',
  );
  const paymentHandledRef = useRef<string | undefined>(undefined);
  const newSubmissionHandledRef = useRef(false);

  const deleteHackathon = useMutation(api.hackathons.deleteHackathon);
  const seedHackathonSubmissions = useAction(api.submissions.seedHackathonSubmissions);
  const joinHackathon = useMutation(api.hackathons.joinHackathon);
  const leaveHackathon = useMutation(api.hackathons.leaveHackathon);
  const { isAdmin: isSiteAdmin } = useAuth();

  // Check if we're on a nested route (like /judges) - must be called before early returns
  const isNestedRoute = useMemo(() => location.pathname !== `/h/${id}`, [location.pathname, id]);

  // Permission checks - null for unauthenticated users
  const canEdit = useMemo(
    () =>
      isAuthenticated &&
      (authenticatedHackathon?.role === 'owner' || authenticatedHackathon?.role === 'admin'),
    [isAuthenticated, authenticatedHackathon?.role],
  );

  const canManageJudges = useMemo(
    () =>
      isAuthenticated &&
      (authenticatedHackathon?.role === 'owner' || authenticatedHackathon?.role === 'admin'),
    [isAuthenticated, authenticatedHackathon?.role],
  );

  const canDelete = useMemo(
    () =>
      isAuthenticated &&
      (authenticatedHackathon?.role === 'owner' || authenticatedHackathon?.role === 'admin'),
    [isAuthenticated, authenticatedHackathon?.role],
  );

  // Owners cannot leave their own hackathon
  const canLeave = useMemo(
    () =>
      isAuthenticated &&
      authenticatedHackathon?.role !== 'owner' &&
      authenticatedHackathon?.role !== undefined,
    [isAuthenticated, authenticatedHackathon?.role],
  );

  // Check if hackathon is open (submission deadline hasn't passed)
  const isHackathonOpen = useMemo(() => {
    if (!hackathon?.dates?.submissionDeadline) {
      return true; // No deadline means always open
    }
    return new Date(hackathon.dates.submissionDeadline).getTime() > Date.now();
  }, [hackathon?.dates?.submissionDeadline]);

  // Check if authenticated user is already a member
  const isUserMember = useMemo(() => {
    return isAuthenticated && authenticatedHackathon !== null;
  }, [isAuthenticated, authenticatedHackathon]);

  // Show join button if authenticated, not a member, and hackathon is open
  const canJoin = useMemo(() => {
    return isAuthenticated && !isUserMember && isHackathonOpen;
  }, [isAuthenticated, isUserMember, isHackathonOpen]);

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
      to: '/h/$id',
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

  // Handle newSubmission query param - join hackathon and open modal
  useEffect(() => {
    // Only run if we have the necessary state loaded
    if (hackathon === undefined) return; // Still loading hackathon
    if (newSubmission === 'true' && !newSubmissionHandledRef.current) {
      newSubmissionHandledRef.current = true;

      const handleNewSubmissionFlow = async () => {
        try {
          // If user is authenticated but not a member, join them first
          if (isAuthenticated && !isUserMember && canJoin) {
            await joinHackathon({
              hackathonId: id as Id<'hackathons'>,
            });
            toast.showToast('Successfully joined the hackathon!', 'success');
            // Refresh the page to show the updated membership status
            await router.invalidate();

            // Wait a bit for the membership to propagate to Convex queries
            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          // Open the new submission modal
          setIsNewSubmissionModalOpen(true);
        } catch (error) {
          console.error('Failed to join hackathon:', error);
          toast.showToast(
            error instanceof Error ? error.message : 'Failed to join hackathon',
            'error',
          );
        } finally {
          // Clear the query param after processing
          void router.navigate({
            to: '/h/$id',
            params: { id },
            replace: true,
          });
        }
      };

      void handleNewSubmissionFlow();
    }
  }, [
    newSubmission,
    hackathon,
    router,
    id,
    isAuthenticated,
    isUserMember,
    canJoin,
    joinHackathon,
    toast,
  ]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteHackathon({ hackathonId: id as Id<'hackathons'> });
      toast.showToast('Hackathon deleted successfully', 'success');
      void router.navigate({ to: '/h' });
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

  const handleJoinHackathon = async () => {
    try {
      await joinHackathon({
        hackathonId: id as Id<'hackathons'>,
      });
      toast.showToast('Successfully joined the hackathon!', 'success');
      // Refresh the page to show the updated membership status
      await router.invalidate();

      // Wait for the membership to propagate to Convex queries
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Open the new submission modal
      setIsNewSubmissionModalOpen(true);
    } catch (error) {
      console.error('Failed to join hackathon:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to join hackathon', 'error');
    }
  };

  const handleLeaveHackathon = async () => {
    setIsLeaving(true);
    try {
      const result = await leaveHackathon({
        hackathonId: id as Id<'hackathons'>,
      });
      toast.showToast(
        `Successfully left the hackathon. ${result.submissionsDeleted} submission(s) removed.`,
        'success',
      );
      // Navigate to the hackathons list page
      void router.navigate({ to: '/h' });
    } catch (error) {
      console.error('Failed to leave hackathon:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to leave hackathon',
        'error',
      );
    } finally {
      setIsLeaving(false);
      setIsLeaveDialogOpen(false);
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
              <div className="flex items-center gap-2">
                {canEdit && <ShareButton hackathonId={id} />}
                {isUserMember && (
                  <HackathonActionsMenu
                    canEdit={canEdit}
                    canManageJudges={canManageJudges}
                    canDelete={canDelete}
                    canLeave={canLeave}
                    isSiteAdmin={isSiteAdmin}
                    onEdit={() => setIsSettingsModalOpen(true)}
                    onManageJudges={() => {
                      void router.navigate({
                        to: '/h/$id/judges',
                        params: { id },
                      });
                    }}
                    onInviteJudge={() => setIsInviteJudgeModalOpen(true)}
                    onLeave={() => setIsLeaveDialogOpen(true)}
                    onDelete={() => setIsDeleteDialogOpen(true)}
                    onSeedSubmissions={handleSeedSubmissions}
                  />
                )}
                {!isAuthenticated && (
                  <Button
                    onClick={() =>
                      router.navigate({
                        to: '/register',
                        search: { redirect: `/h/${id}?newSubmission=true` },
                      })
                    }
                  >
                    Join Hackathon
                  </Button>
                )}
                {canJoin && <Button onClick={handleJoinHackathon}>Join Hackathon</Button>}
              </div>
            }
          />
          {isAuthenticated && authenticatedHackathon && (
            <VotingStatusBanner
              hackathonId={id as Id<'hackathons'>}
              hackathonRole={authenticatedHackathon.role}
            />
          )}
        </>
      )}

      {isNestedRoute ? (
        <Outlet />
      ) : (
        <SubmissionsList
          hackathonId={id as Id<'hackathons'>}
          hackathon={hackathon}
          isAuthenticated={isAuthenticated}
          userRole={authenticatedHackathon?.role}
          isNewSubmissionModalOpen={isNewSubmissionModalOpen}
          onNewSubmissionModalOpen={() => setIsNewSubmissionModalOpen(true)}
          onNewSubmissionModalClose={() => setIsNewSubmissionModalOpen(false)}
        />
      )}

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

      <DeleteConfirmationDialog
        open={isLeaveDialogOpen}
        onClose={() => setIsLeaveDialogOpen(false)}
        title="Leave Hackathon"
        description={`Are you sure you want to leave "${hackathon?.title}"? This will permanently remove all your submissions and cannot be undone.`}
        deleteText="Leave Hackathon"
        isDeleting={isLeaving}
        onConfirm={handleLeaveHackathon}
        variant="danger"
      />
    </div>
  );
}
