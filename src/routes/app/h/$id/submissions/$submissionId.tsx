import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ExternalLink } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SiGithub } from 'react-icons/si';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { EditSubmissionModal } from '~/features/hackathons/components/EditSubmissionModal';
import { SubmissionActionsMenu } from '~/features/hackathons/components/SubmissionActionsMenu';
import { SubmissionAIReview } from '~/features/hackathons/components/SubmissionAIReview';
import { SubmissionNavigation } from '~/features/hackathons/components/SubmissionNavigation';
import { SubmissionScoring } from '~/features/hackathons/components/SubmissionScoring';
import { SubmissionScreenshots } from '~/features/hackathons/components/SubmissionScreenshots';
import {
  type SubmissionStatus,
  SubmissionStatusBadge,
} from '~/features/hackathons/components/SubmissionStatusBadge';
import { SubmissionTimeline } from '~/features/hackathons/components/SubmissionTimeline';
import { useAIReply } from '~/features/hackathons/hooks/useAIReply';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/app/h/$id/submissions/$submissionId')({
  component: SubmissionDetailComponent,
  errorComponent: DashboardErrorBoundary,
});

function SubmissionDetailComponent() {
  usePerformanceMonitoring('SubmissionDetail');
  const navigate = useNavigate();
  const toast = useToast();
  const { id: hackathonId, submissionId } = Route.useParams();
  const submission = useQuery(api.submissions.getSubmission, {
    submissionId: submissionId as Id<'submissions'>,
  });
  const hackathon = useQuery(api.hackathons.getHackathon, {
    hackathonId: hackathonId as Id<'hackathons'>,
  });
  const submissions = useQuery(api.submissions.listByHackathon, {
    hackathonId: hackathonId as Id<'hackathons'>,
  });
  const { review, isReviewing, error, rateLimitRetryAfter } = useAIReply(
    submissionId as Id<'submissions'>,
  );

  // Use optimistic mutations for better UX - Convex automatically handles cache updates and rollback
  const deleteSubmissionOptimistic = useOptimisticMutation(api.submissions.deleteSubmission, {
    onSuccess: () => {
      toast.showToast('Submission deleted successfully', 'success');
      // Navigate back to hackathon page after deletion
      void navigate({
        to: '/app/h/$id',
        params: { id: hackathonId },
      });
    },
    onError: (error) => {
      console.error('Failed to delete submission:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete submission',
        'error',
      );
    },
  });

  const updateStatusOptimistic = useOptimisticMutation(api.submissions.updateSubmissionStatus, {
    onSuccess: () => {
      toast.showToast('Submission status updated successfully', 'success');
    },
    onError: (error) => {
      console.error('Failed to update status:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to update status', 'error');
    },
  });

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Memoize permission checks to avoid recalculation on every render
  const canEdit = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin' || hackathon?.role === 'judge',
    [hackathon?.role],
  );
  const canDelete = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  // Calculate navigation indices
  const { currentIndex, previousSubmissionId, nextSubmissionId } = useMemo(() => {
    if (!submissions || !submission) {
      return { currentIndex: -1, previousSubmissionId: null, nextSubmissionId: null };
    }

    const sortedSubmissions = [...submissions].sort((a, b) => a.createdAt - b.createdAt);
    const index = sortedSubmissions.findIndex((s) => s._id === submissionId);

    return {
      currentIndex: index,
      previousSubmissionId: index > 0 ? sortedSubmissions[index - 1]._id : null,
      nextSubmissionId:
        index < sortedSubmissions.length - 1 ? sortedSubmissions[index + 1]._id : null,
    };
  }, [submissions, submission, submissionId]);

  const canRunReview = useMemo(
    () => submission && !submission.ai?.inFlight && !isReviewing,
    [submission, isReviewing],
  );

  const handleBack = useCallback(() => {
    void navigate({
      to: '/app/h/$id',
      params: { id: hackathonId },
    });
  }, [navigate, hackathonId]);

  const handleRunReview = useCallback(async () => {
    await review();
  }, [review]);

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
        void navigate({
          to: '/app/h/$id/submissions/$submissionId',
          params: { id: hackathonId, submissionId: previousSubmissionId },
        });
      } else if (e.key === 'ArrowRight' && nextSubmissionId) {
        e.preventDefault();
        void navigate({
          to: '/app/h/$id/submissions/$submissionId',
          params: { id: hackathonId, submissionId: nextSubmissionId },
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    previousSubmissionId,
    nextSubmissionId,
    hackathonId,
    navigate,
    isEditModalOpen,
    isDeleteDialogOpen,
  ]);

  const handleStatusChange = async (newStatus: SubmissionStatus) => {
    setIsUpdatingStatus(true);
    try {
      // Optimistic mutation - Convex automatically updates cache and handles rollback on error
      await updateStatusOptimistic({
        submissionId: submissionId as Id<'submissions'>,
        status: newStatus,
      });
    } catch {
      // Error handling is done in the onError callback
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleNavigateToSubmission = (targetSubmissionId: Id<'submissions'>) => {
    void navigate({
      to: '/app/h/$id/submissions/$submissionId',
      params: { id: hackathonId, submissionId: targetSubmissionId },
    });
  };

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

  if (submission === undefined || hackathon === undefined || submissions === undefined) {
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

  return (
    <div className="space-y-6">
      <SubmissionNavigation
        currentIndex={currentIndex}
        totalSubmissions={submissions.length}
        previousSubmissionId={previousSubmissionId}
        nextSubmissionId={nextSubmissionId}
        onBack={handleBack}
        onNavigateToSubmission={handleNavigateToSubmission}
      />

      <PageHeader
        title={submission.title}
        description={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild className="touch-manipulation">
              <a href={submission.repoUrl} target="_blank" rel="noopener noreferrer">
                <SiGithub className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Repository</span>
              </a>
            </Button>
            {submission.siteUrl && (
              <Button variant="outline" size="sm" asChild className="touch-manipulation">
                <a href={submission.siteUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Live Site</span>
                </a>
              </Button>
            )}
          </div>
        }
        descriptionClassName="text-foreground"
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <SubmissionStatusBadge
              status={submission.status}
              canEdit={canEdit}
              isUpdating={isUpdatingStatus}
              onStatusChange={handleStatusChange}
            />
            <SubmissionActionsMenu
              canEdit={canEdit}
              canDelete={canDelete}
              canRunReview={!!canRunReview}
              isReviewing={isReviewing}
              inFlight={submission.ai?.inFlight}
              rateLimitRetryAfter={rateLimitRetryAfter}
              hasSiteUrl={!!submission.siteUrl}
              isCapturingScreenshot={false}
              onEdit={() => setIsEditModalOpen(true)}
              onDelete={() => setIsDeleteDialogOpen(true)}
              onRunReview={handleRunReview}
              onCaptureScreenshot={() => {
                // Moved to SubmissionScreenshots component
              }}
            />
          </div>
        }
      />

      <div className="space-y-6">
        <SubmissionAIReview
          summary={submission.ai?.summary}
          isReviewing={isReviewing}
          inFlight={submission.ai?.inFlight}
          error={error}
          rateLimitRetryAfter={rateLimitRetryAfter}
          processingState={submission.source?.processingState}
        />

        <SubmissionScoring score={submission.ai?.score} />

        <SubmissionScreenshots submission={submission} canEdit={canEdit} />

        <SubmissionTimeline submission={submission} />
      </div>

      {isEditModalOpen && submission && (
        <EditSubmissionModal
          submission={submission}
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
