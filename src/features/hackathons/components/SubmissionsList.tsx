import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ExternalLink, Eye, EyeOff, Github, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { NewSubmissionModal } from './NewSubmissionModal';

interface SubmissionsListProps {
  hackathonId: Id<'hackathons'>;
}

export function SubmissionsList({ hackathonId }: SubmissionsListProps) {
  const toast = useToast();
  const router = useRouter();
  const [showOnlyUnrated, setShowOnlyUnrated] = useState(false);
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });
  const allSubmissions = useQuery(api.submissions.listByHackathon, {
    hackathonId,
    ratingFilter: 'all',
  });

  // Filter client-side for instant toggle without re-fetching
  const submissions = useMemo(() => {
    if (!allSubmissions) return undefined;
    if (!showOnlyUnrated) return allSubmissions;
    return allSubmissions.filter(
      (submission) => submission.myRating === null || submission.myRating === undefined,
    );
  }, [allSubmissions, showOnlyUnrated]);

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

  const hasEnded = useMemo(
    () =>
      !!(hackathon?.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline),
    [hackathon?.dates?.submissionDeadline],
  );

  // Calculate rating statistics
  const ratingStats = useMemo(() => {
    if (!allSubmissions) return { total: 0, rated: 0, unrated: 0 };

    const rated = allSubmissions.filter(
      (submission) => submission.myRating !== null && submission.myRating !== undefined,
    ).length;
    const unrated = allSubmissions.length - rated;

    return {
      total: allSubmissions.length,
      rated,
      unrated,
    };
  }, [allSubmissions]);

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
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold">Submissions</h2>
            {(hackathon?.role === 'judge' || hackathon?.role === 'owner' || hackathon?.role === 'admin') && ratingStats.total > 0 && ratingStats.unrated > 0 && (
              <Button
                variant={showOnlyUnrated ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setShowOnlyUnrated(!showOnlyUnrated)}
                className="gap-2"
              >
                {showOnlyUnrated ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    Show All ({ratingStats.total})
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    Show Unrated ({ratingStats.unrated})
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
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
            {showOnlyUnrated
              ? 'All submissions have been rated! 🎉'
              : hasEnded
                ? 'This hackathon is no longer accepting submissions. No new submissions can be added.'
                : 'No submissions yet.'}
          </p>
          {!showOnlyUnrated && (
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
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {submissions.map((submission) => {
            // Get homepage screenshot (first screenshot is sorted to be homepage)
            const homepageScreenshot = submission.screenshots?.[0];

            return (
              <Card
                key={submission._id}
                className="relative cursor-pointer transition-shadow hover:shadow-md overflow-hidden group aspect-[16/9]"
                onClick={() => handleViewSubmission(submission._id)}
              >
                {/* Screenshot background - full card */}
                {homepageScreenshot ? (
                  <>
                    <img
                      src={homepageScreenshot.url}
                      alt={submission.title}
                      className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  </>
                ) : (
                  <>
                    <div className="absolute inset-0 bg-gradient-to-br from-muted via-muted/80 to-muted/60">
                      {/* Placeholder pattern */}
                      <div className="absolute inset-0 opacity-10">
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.1) 10px, rgba(0,0,0,0.1) 20px)`,
                          }}
                        />
                      </div>
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  </>
                )}

                {/* Rating badge in top right */}
                <div className="absolute top-2 right-2 z-10">
                  {submission.myRating !== null && submission.myRating !== undefined ? (
                    <Badge
                      variant="default"
                      className="backdrop-blur-sm bg-primary/90 text-primary-foreground shadow-lg"
                    >
                      {submission.myRating.toFixed(1)}
                    </Badge>
                  ) : (
                    <Badge
                      variant="warning"
                      className="bg-orange-500/90 dark:bg-orange-500/90 text-white shadow-lg border-0"
                    >
                      Unrated
                    </Badge>
                  )}
                </div>

                {/* Title and team at bottom */}
                <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
                  <div className="flex items-end justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle
                        className={`mb-1 line-clamp-2 ${homepageScreenshot ? 'text-white' : 'text-foreground'}`}
                      >
                        {submission.title}
                      </CardTitle>
                      <CardDescription
                        className={homepageScreenshot ? 'text-white/80' : 'text-muted-foreground'}
                      >
                        {submission.team}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {submission.repoUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(submission.repoUrl, '_blank', 'noopener,noreferrer');
                          }}
                          className={`h-8 w-8 p-0 backdrop-blur-sm ${
                            homepageScreenshot
                              ? 'text-white hover:bg-white/20 bg-black/30'
                              : 'text-muted-foreground hover:bg-background/20 bg-background/50'
                          }`}
                          title="View on GitHub"
                        >
                          <Github className="h-4 w-4" />
                        </Button>
                      )}
                      {submission.siteUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(submission.siteUrl, '_blank', 'noopener,noreferrer');
                          }}
                          className={`h-8 w-8 p-0 backdrop-blur-sm ${
                            homepageScreenshot
                              ? 'text-white hover:bg-white/20 bg-black/30'
                              : 'text-muted-foreground hover:bg-background/20 bg-background/50'
                          }`}
                          title="View live site"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NewSubmissionModal
        hackathonId={hackathonId}
        open={isNewSubmissionModalOpen}
        onClose={() => setIsNewSubmissionModalOpen(false)}
        totalSubmissions={submissions.length}
        userRole={hackathon?.role || 'judge'}
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
