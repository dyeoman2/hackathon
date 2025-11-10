import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useRouter } from '@tanstack/react-router';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
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
import { NewSubmissionModal } from './NewSubmissionModal';

interface SubmissionsListProps {
  hackathonId: Id<'hackathons'>;
}

export function SubmissionsList({ hackathonId }: SubmissionsListProps) {
  const toast = useToast();
  const router = useRouter();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });
  const submissions = useQuery(api.submissions.listByHackathon, { hackathonId });
  const updateStatus = useMutation(api.submissions.updateSubmissionStatus);
  const deleteSubmission = useMutation(api.submissions.deleteSubmission);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isNewSubmissionModalOpen, setIsNewSubmissionModalOpen] = useState(false);
  const [submissionToDelete, setSubmissionToDelete] = useState<Id<'submissions'> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleViewSubmission = (submissionId: Id<'submissions'>) => {
    void router.navigate({
      to: '/app/h/$id/submissions/$submissionId',
      params: { id: hackathonId, submissionId },
    });
  };

  const handleStatusChange = async (
    submissionId: Id<'submissions'>,
    newStatus: 'submitted' | 'review' | 'shortlist' | 'winner' | 'rejected',
  ) => {
    setIsUpdatingStatus(submissionId);
    try {
      await updateStatus({ submissionId, status: newStatus });
      toast.showToast('Submission status has been updated successfully.', 'success');
    } catch (error) {
      console.error('Failed to update status:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to update status', 'error');
    } finally {
      setIsUpdatingStatus(null);
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'winner':
        return 'default';
      case 'shortlist':
        return 'secondary';
      case 'review':
        return 'info';
      case 'submitted':
        return 'light-purple'; // Purple to differentiate from Review
      case 'rejected':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const canDelete = hackathon?.role === 'owner' || hackathon?.role === 'admin';

  const handleDelete = async () => {
    if (!submissionToDelete) return;

    setIsDeleting(true);
    try {
      await deleteSubmission({ submissionId: submissionToDelete });
      toast.showToast('Submission deleted successfully', 'success');
      setSubmissionToDelete(null);
    } catch (error) {
      console.error('Failed to delete submission:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete submission',
        'error',
      );
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
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Submissions</h2>
        <Button onClick={() => setIsNewSubmissionModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Submission
        </Button>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">No submissions yet.</p>
          <Button onClick={() => setIsNewSubmissionModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
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
                <TableHead>Status</TableHead>
                <TableHead>AI Score</TableHead>
                <TableHead>Created</TableHead>
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
                    <Select
                      value={submission.status}
                      onValueChange={(value) => {
                        handleStatusChange(
                          submission._id,
                          value as 'submitted' | 'review' | 'shortlist' | 'winner' | 'rejected',
                        );
                      }}
                      disabled={isUpdatingStatus === submission._id}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                        <SelectItem value="shortlist">Shortlist</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                        <SelectItem value="winner">Winner</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {submission.ai?.score !== undefined ? (
                      <Badge variant={getStatusBadgeVariant(submission.status)}>
                        {submission.ai.score.toFixed(1)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>{new Date(submission.createdAt).toLocaleDateString()}</TableCell>
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
