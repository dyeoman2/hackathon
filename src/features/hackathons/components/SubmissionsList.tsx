import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
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
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { NewSubmissionModal } from './NewSubmissionModal';

interface SubmissionsListProps {
  hackathonId: Id<'hackathons'>;
}

export function SubmissionsList({ hackathonId }: SubmissionsListProps) {
  const toast = useToast();
  const router = useRouter();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });
  const submissions = useQuery(api.submissions.listByHackathon, { hackathonId });

  const deleteSubmissionOptimistic = useOptimisticMutation(api.submissions.deleteSubmission, {
    onSuccess: () => {
      toast.showToast('Submission deleted successfully', 'success');
    },
    onError: (error) => {
      console.error('Failed to delete submission:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete submission',
        'error',
      );
    },
  });

  const [isNewSubmissionModalOpen, setIsNewSubmissionModalOpen] = useState(false);
  const [submissionToDelete, setSubmissionToDelete] = useState<Id<'submissions'> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleViewSubmission = (submissionId: Id<'submissions'>) => {
    void router.navigate({
      to: '/app/h/$id/submissions/$submissionId',
      params: { id: hackathonId, submissionId },
    });
  };

  // Memoize permission checks to avoid recalculation on every render
  const canDelete = useMemo(
    () => hackathon?.role === 'owner' || hackathon?.role === 'admin',
    [hackathon?.role],
  );

  const hasEnded = useMemo(
    () =>
      !!(hackathon?.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline),
    [hackathon?.dates?.submissionDeadline],
  );

  const handleDelete = async () => {
    if (!submissionToDelete) return;

    setIsDeleting(true);
    try {
      // Optimistic mutation - Convex automatically removes from cache and handles rollback on error
      await deleteSubmissionOptimistic({ submissionId: submissionToDelete });
      setSubmissionToDelete(null);
    } catch {
      // Error handling is done in the onError callback
    } finally {
      setIsDeleting(false);
    }
  };

  if (submissions === undefined) {
    return (
      <div className="rounded-md border bg-card">
        <div className="p-4">
          <Skeleton className="h-8 w-full mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold">Submissions</h2>
        <Button
          onClick={() => setIsNewSubmissionModalOpen(true)}
          className="w-full sm:w-auto"
          disabled={hasEnded}
          title={
            hasEnded
              ? 'Cannot add submissions to hackathons that are no longer accepting submissions'
              : undefined
          }
        >
          <Plus className="h-4 w-4" />
          New Submission
        </Button>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {hasEnded
              ? 'This hackathon is no longer accepting submissions. No new submissions can be added.'
              : 'No submissions yet.'}
          </p>
          <Button
            onClick={() => setIsNewSubmissionModalOpen(true)}
            disabled={hasEnded}
            title={
              hasEnded
                ? 'Cannot add submissions to hackathons that are no longer accepting submissions'
                : undefined
            }
          >
            <Plus className="h-4 w-4" />
            Add Submission
          </Button>
        </div>
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>My Rating</TableHead>
                <TableHead>Overall Rating</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((submission) => (
                <TableRow
                  key={submission._id}
                  className="cursor-pointer"
                  onClick={() => handleViewSubmission(submission._id)}
                >
                  <TableCell className="font-medium">{submission.title}</TableCell>
                  <TableCell>{submission.team}</TableCell>
                  <TableCell>
                    {submission.myRating !== null && submission.myRating !== undefined ? (
                      <Badge variant="default">{submission.myRating.toFixed(1)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {submission.averageRating !== null && submission.averageRating !== undefined ? (
                      <Badge variant="outline">{submission.averageRating.toFixed(1)}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(submission.createdAt).toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewSubmission(submission._id);
                        }}
                      >
                        View
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSubmissionToDelete(submission._id);
                          }}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <NewSubmissionModal
        hackathonId={hackathonId}
        open={isNewSubmissionModalOpen}
        onClose={() => setIsNewSubmissionModalOpen(false)}
      />

      {submissionToDelete && (
        <DeleteConfirmationDialog
          open={submissionToDelete !== null}
          onClose={() => setSubmissionToDelete(null)}
          title="Delete Submission"
          description="Are you sure you want to delete this submission? This action cannot be undone."
          deleteText="Delete Submission"
          isDeleting={isDeleting}
          onConfirm={handleDelete}
          variant="danger"
        />
      )}
    </div>
  );
}
