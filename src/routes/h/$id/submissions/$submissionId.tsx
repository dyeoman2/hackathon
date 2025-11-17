import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';

import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { useAction, useQuery } from 'convex/react';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SiGithub } from 'react-icons/si';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { EditSubmissionModal } from '~/features/hackathons/components/EditSubmissionModal';
import { SubmissionActionsMenu } from '~/features/hackathons/components/SubmissionActionsMenu';
import { SubmissionNavigation } from '~/features/hackathons/components/SubmissionNavigation';
import { SubmissionRatingSlider } from '~/features/hackathons/components/SubmissionRatingSlider';
import { SubmissionRepoChat } from '~/features/hackathons/components/SubmissionRepoChat';
import { SubmissionRepositorySummary } from '~/features/hackathons/components/SubmissionRepositorySummary';
import { SubmissionScreenshots } from '~/features/hackathons/components/SubmissionScreenshots';
import { SubmissionTimeline } from '~/features/hackathons/components/SubmissionTimeline';
import { flushPendingSubmissionRatingsWithTimeout } from '~/features/hackathons/hooks/useSubmissionRatingQueue';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/h/$id/submissions/$submissionId')({
  component: SubmissionDetailComponent,
  errorComponent: DashboardErrorBoundary,
});

function SubmissionDetailComponent() {
  usePerformanceMonitoring('SubmissionDetail');
  const navigate = useNavigate();
  const toast = useToast();
  const { isAuthenticated, user } = useAuth();
  const { id: hackathonId, submissionId } = Route.useParams();

  // Use different queries based on authentication
  const authenticatedSubmission = useQuery(
    api.submissions.getSubmission,
    isAuthenticated ? { submissionId: submissionId as Id<'submissions'> } : 'skip',
  );
  const publicSubmission = useQuery(
    api.submissions.listPublicSubmissions,
    { hackathonId: hackathonId as Id<'hackathons'> }, // Always fetch public data
  );

  const authenticatedHackathon = useQuery(
    api.hackathons.getHackathon,
    isAuthenticated ? { hackathonId: hackathonId as Id<'hackathons'> } : 'skip',
  );
  const publicHackathon = useQuery(
    api.hackathons.getPublicHackathon,
    { hackathonId: hackathonId as Id<'hackathons'> }, // Always fetch public data
  );

  // Use authenticated data if available, otherwise public data
  const submission =
    authenticatedSubmission || publicSubmission?.find((s) => s._id === submissionId);
  const hackathon = authenticatedHackathon || publicHackathon;
  const submissions = publicSubmission; // Use public submissions for navigation for all users
  const refreshIndexingStatus = useAction(api.submissions.refreshSubmissionIndexingStatus);
  const indexingRefreshRef = useRef<Id<'submissions'> | null>(null);
  const currentSubmissionId = submission?._id as Id<'submissions'> | undefined;
  const submissionProcessingState = authenticatedSubmission?.source?.processingState;
  const submissionAiSearchSyncCompletedAt =
    authenticatedSubmission?.source?.aiSearchSyncCompletedAt;
  const submissionR2Key = authenticatedSubmission?.source?.r2Key;

  const runWithRatingFlush = useCallback((task: () => Promise<void> | void) => {
    void (async () => {
      await flushPendingSubmissionRatingsWithTimeout();
      await task();
    })();
  }, []);

  // Use optimistic mutations for better UX - Convex automatically handles cache updates and rollback
  const deleteSubmissionOptimistic = useOptimisticMutation(api.submissions.deleteSubmission, {
    onSuccess: () => {
      toast.showToast('Submission deleted successfully', 'success');
      // Navigate back to hackathon page after deletion
      runWithRatingFlush(() =>
        navigate({
          to: '/h/$id',
          params: { id: hackathonId },
        }),
      );
    },
    onError: (error) => {
      console.error('Failed to delete submission:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete submission',
        'error',
      );
    },
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Memoize permission checks to avoid recalculation on every render
  const isSubmissionOwner = useMemo(
    () =>
      isAuthenticated &&
      !!authenticatedSubmission?.userId &&
      authenticatedSubmission.userId === user?.id,
    [isAuthenticated, authenticatedSubmission?.userId, user?.id],
  );

  const canEdit = useMemo(
    () =>
      isAuthenticated &&
      (authenticatedHackathon?.role === 'owner' ||
        authenticatedHackathon?.role === 'admin' ||
        isSubmissionOwner),
    [isAuthenticated, authenticatedHackathon?.role, isSubmissionOwner],
  );
  const canDelete = useMemo(
    () =>
      isAuthenticated &&
      (authenticatedHackathon?.role === 'owner' ||
        authenticatedHackathon?.role === 'admin' ||
        isSubmissionOwner),
    [isAuthenticated, authenticatedHackathon?.role, isSubmissionOwner],
  );
  const isContestant = useMemo(
    () => authenticatedHackathon?.role === 'contestant',
    [authenticatedHackathon?.role],
  );

  // Calculate navigation indices (works for both authenticated and unauthenticated users)
  const { currentIndex, previousSubmissionId, nextSubmissionId } = useMemo(() => {
    if (!submissions || !submission) {
      return { currentIndex: -1, previousSubmissionId: null, nextSubmissionId: null };
    }

    // Use submissions in the same order as they appear in the list (newest first from Convex)
    const index = submissions.findIndex((s) => s._id === submissionId);

    if (index === -1) {
      return { currentIndex: -1, previousSubmissionId: null, nextSubmissionId: null };
    }

    return {
      currentIndex: index,
      previousSubmissionId: index > 0 ? submissions[index - 1]._id : null,
      nextSubmissionId: index < submissions.length - 1 ? submissions[index + 1]._id : null,
    };
  }, [submissions, submission, submissionId]);

  const handleBack = useCallback(() => {
    runWithRatingFlush(() =>
      navigate({
        to: '/h/$id',
        params: { id: hackathonId },
      }),
    );
  }, [runWithRatingFlush, navigate, hackathonId]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs, textareas, or when modals are open
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isEditModalOpen ||
        isDeleteDialogOpen
      ) {
        return;
      }

      // Arrow keys for navigation
      if (e.key === 'ArrowLeft' && previousSubmissionId) {
        e.preventDefault();
        runWithRatingFlush(() =>
          navigate({
            to: '/h/$id/submissions/$submissionId',
            params: { id: hackathonId, submissionId: previousSubmissionId },
          }),
        );
      } else if (e.key === 'ArrowRight' && nextSubmissionId) {
        e.preventDefault();
        runWithRatingFlush(() =>
          navigate({
            to: '/h/$id/submissions/$submissionId',
            params: { id: hackathonId, submissionId: nextSubmissionId },
          }),
        );
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    previousSubmissionId,
    nextSubmissionId,
    hackathonId,
    runWithRatingFlush,
    navigate,
    isEditModalOpen,
    isDeleteDialogOpen,
  ]);

  const handleNavigateToSubmission = useCallback(
    (targetSubmissionId: Id<'submissions'>) => {
      runWithRatingFlush(() =>
        navigate({
          to: '/h/$id/submissions/$submissionId',
          params: { id: hackathonId, submissionId: targetSubmissionId },
        }),
      );
    },
    [hackathonId, runWithRatingFlush, navigate],
  );

  useEffect(() => {
    if (!currentSubmissionId) {
      indexingRefreshRef.current = null;
      return;
    }

    const shouldRefreshIndexing =
      !!submissionR2Key &&
      ((submissionProcessingState === 'indexing' && !submissionAiSearchSyncCompletedAt) ||
        (submissionProcessingState === 'complete' && !submissionAiSearchSyncCompletedAt));

    if (shouldRefreshIndexing) {
      if (indexingRefreshRef.current === currentSubmissionId) {
        return;
      }

      indexingRefreshRef.current = currentSubmissionId;
      refreshIndexingStatus({ submissionId: currentSubmissionId })
        .then(() => {
          indexingRefreshRef.current = null;
        })
        .catch((error) => {
          console.warn('Failed to refresh submission indexing status:', error);
          indexingRefreshRef.current = null;
        });
    } else if (
      submissionProcessingState === 'complete' ||
      submissionProcessingState === 'error' ||
      submissionAiSearchSyncCompletedAt
    ) {
      indexingRefreshRef.current = null;
    }
  }, [
    currentSubmissionId,
    submissionProcessingState,
    submissionAiSearchSyncCompletedAt,
    submissionR2Key,
    refreshIndexingStatus,
  ]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // Optimistic mutation - Convex automatically removes from cache and handles rollback on error
      await deleteSubmissionOptimistic({ submissionId: submissionId as Id<'submissions'> });
      // Navigation is handled in the onSuccess callback
    } catch {
      // Error handling is done in the onError callback
    } finally {
      setIsDeleting(false);
    }
  };

  // Check loading states based on authentication
  const isLoading = isAuthenticated
    ? authenticatedSubmission === undefined || authenticatedHackathon === undefined
    : publicSubmission === undefined || publicHackathon === undefined;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-2">
          <Skeleton className="h-9 w-20" />
        </div>
        <PageHeader title="" description={<Skeleton className="h-4 w-96" />} />
        <div className="space-y-4">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (submission === null || hackathon === null) {
    return <NotFound />;
  }

  // At this point, submission and hackathon are guaranteed to be non-null
  // submissions might be undefined for authenticated users (no navigation)

  if (!submission) {
    return <NotFound />;
  }

  return (
    <div className="space-y-6">
      <SubmissionNavigation
        currentIndex={currentIndex}
        totalSubmissions={submissions?.length || 0}
        previousSubmissionId={previousSubmissionId}
        nextSubmissionId={nextSubmissionId}
        onBack={handleBack}
        onNavigateToSubmission={handleNavigateToSubmission}
      />

      <PageHeader
        title={submission.title}
        description={submission.team}
        titleActions={
          <>
            <div className="hidden sm:flex items-center gap-2 flex-wrap">
              {submission.repoUrl && (
                <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                  <a href={submission.repoUrl} target="_blank" rel="noopener noreferrer">
                    <SiGithub className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {submission.siteUrl && (
                <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                  <a href={submission.siteUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
            {(canEdit || canDelete) && (
              <div className="sm:hidden">
                <SubmissionActionsMenu
                  canEdit={canEdit}
                  canDelete={canDelete}
                  hasSiteUrl={!!submission.siteUrl}
                  isCapturingScreenshot={false}
                  onEdit={() => setIsEditModalOpen(true)}
                  onDelete={() => setIsDeleteDialogOpen(true)}
                  onCaptureScreenshot={() => {
                    // Moved to SubmissionScreenshots component
                  }}
                />
              </div>
            )}
          </>
        }
        actions={
          <div className="flex items-center justify-between gap-2 w-full sm:w-auto sm:justify-end">
            <div className="flex items-center gap-2 sm:hidden">
              {submission.repoUrl && (
                <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                  <a href={submission.repoUrl} target="_blank" rel="noopener noreferrer">
                    <SiGithub className="h-4 w-4" />
                  </a>
                </Button>
              )}
              {submission.siteUrl && (
                <Button variant="ghost" size="sm" asChild className="touch-manipulation">
                  <a href={submission.siteUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
            {(canEdit || canDelete) && (
              <div className="flex items-center gap-2">
                <div className="hidden sm:block">
                  <SubmissionActionsMenu
                    canEdit={canEdit}
                    canDelete={canDelete}
                    hasSiteUrl={!!submission.siteUrl}
                    isCapturingScreenshot={false}
                    onEdit={() => setIsEditModalOpen(true)}
                    onDelete={() => setIsDeleteDialogOpen(true)}
                    onCaptureScreenshot={() => {
                      // Moved to SubmissionScreenshots component
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        }
      />

      <div className="space-y-6">
        {!isContestant && authenticatedHackathon && (
          <SubmissionRatingSlider
            hackathonId={hackathonId as Id<'hackathons'>}
            submissionId={submissionId as Id<'submissions'>}
            hackathonRole={authenticatedHackathon.role}
          />
        )}

        <SubmissionRepositorySummary
          submission={submission as Doc<'submissions'>}
          canEdit={canEdit}
        />

        <SubmissionScreenshots submission={submission as Doc<'submissions'>} canEdit={canEdit} />

        {authenticatedSubmission && <SubmissionRepoChat submission={authenticatedSubmission} />}

        {authenticatedSubmission && <SubmissionTimeline submission={authenticatedSubmission} />}
      </div>

      {isEditModalOpen && authenticatedSubmission && (
        <EditSubmissionModal
          submission={authenticatedSubmission}
          open={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}

      {isDeleteDialogOpen && (
        <DeleteConfirmationDialog
          open={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          title="Delete Submission"
          description="Are you sure you want to delete this submission? This action cannot be undone and will also delete associated files."
          deleteText="Delete Submission"
          isDeleting={isDeleting}
          onConfirm={handleDelete}
          variant="danger"
        />
      )}
    </div>
  );
}
