import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
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
import { SubmissionDrawer } from './SubmissionDrawer';

interface SubmissionsListProps {
  hackathonId: Id<'hackathons'>;
}

export function SubmissionsList({ hackathonId }: SubmissionsListProps) {
  const toast = useToast();
  const submissions = useQuery(api.submissions.listByHackathon, { hackathonId });
  const updateStatus = useMutation(api.submissions.updateSubmissionStatus);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<Id<'submissions'> | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isNewSubmissionModalOpen, setIsNewSubmissionModalOpen] = useState(false);

  const handleStatusChange = async (
    submissionId: Id<'submissions'>,
    newStatus: 'submitted' | 'review' | 'shortlist' | 'winner',
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
      default:
        return 'outline';
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
                  onClick={() => setSelectedSubmissionId(submission._id)}
                >
                  <TableCell className="font-medium">{submission.title}</TableCell>
                  <TableCell>{submission.team}</TableCell>
                  <TableCell>
                    <Select
                      value={submission.status}
                      onValueChange={(value) => {
                        handleStatusChange(
                          submission._id,
                          value as 'submitted' | 'review' | 'shortlist' | 'winner',
                        );
                      }}
                      disabled={isUpdatingStatus === submission._id}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                        <SelectItem value="shortlist">Shortlist</SelectItem>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSubmissionId(submission._id);
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedSubmissionId && (
        <SubmissionDrawer
          submissionId={selectedSubmissionId}
          open={selectedSubmissionId !== null}
          onClose={() => setSelectedSubmissionId(null)}
        />
      )}

      <NewSubmissionModal
        hackathonId={hackathonId}
        open={isNewSubmissionModalOpen}
        onClose={() => setIsNewSubmissionModalOpen(false)}
      />
    </div>
  );
}
