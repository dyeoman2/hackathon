import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useRouter } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { AlertTriangle, ExternalLink, Eye, EyeOff, Github, Plus, Youtube } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { DeleteConfirmationDialog } from '~/components/ui/delete-confirmation-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { SimpleTooltip } from '~/components/ui/simple-tooltip';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { isRepoInaccessible } from '~/lib/shared/rating-utils';
import { NewSubmissionModal } from './NewSubmissionModal';

type PublicSubmission = {
  _id: Id<'submissions'>;
  title: string;
  team: string;
  repoUrl: string;
  siteUrl: string | undefined;
  videoUrl: string | undefined;
  screenshots:
    | {
        r2Key: string;
        url: string;
        capturedAt: number;
        pageUrl?: string;
        pageName?: string;
      }[]
    | undefined;
  source: Doc<'submissions'>['source'];
  createdAt: number;
};

type SubmissionWithRating = Doc<'submissions'> & {
  myRating: number | null;
  averageRating: number;
};

type SubmissionData = PublicSubmission | SubmissionWithRating;

type SortOption =
  | 'newest'
  | 'oldest'
  | 'rating-high'
  | 'rating-low'
  | 'my-rating-high'
  | 'my-rating-low';

interface SubmissionCardProps {
  submission: SubmissionData;
  isContestant: boolean;
  isAuthenticated: boolean;
  onView: (submissionId: Id<'submissions'>) => void;
}

function SubmissionCard({
  submission,
  isContestant,
  isAuthenticated,
  onView,
}: SubmissionCardProps) {
  // Get homepage screenshot (first screenshot is sorted to be homepage)
  const homepageScreenshot = submission.screenshots?.[0];

  return (
    <Card
      className="relative cursor-pointer transition-shadow hover:shadow-md overflow-hidden group aspect-video"
      onClick={() => onView(submission._id)}
    >
      {/* Screenshot background - full card */}
      {homepageScreenshot ? (
        <>
          <img
            src={homepageScreenshot.url}
            alt={submission.title}
            className="absolute inset-0 w-full h-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-linear-to-br from-muted via-muted/80 to-muted/60">
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
          <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/40 to-transparent" />
        </>
      )}

      {/* Rating badge in top right - only show for authenticated non-contestants */}
      {!isContestant && isAuthenticated && 'myRating' in submission && (
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
      )}

      {/* Title and team at bottom */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-5 z-10">
        <div className="flex items-end justify-between gap-2">
          <div className="flex-1 min-w-0 pb-0.5">
            <CardTitle
              className={`mb-1 line-clamp-2 leading-tight ${homepageScreenshot ? 'text-white' : 'text-foreground'}`}
            >
              {submission.title}
            </CardTitle>
            <CardDescription
              className={`leading-snug ${homepageScreenshot ? 'text-white/80' : 'text-muted-foreground'}`}
            >
              {submission.team}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {submission.videoUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(submission.videoUrl, '_blank', 'noopener,noreferrer');
                }}
                className={`h-8 w-8 p-0 backdrop-blur-sm ${
                  homepageScreenshot
                    ? 'text-white hover:bg-white/20 bg-black/30'
                    : 'text-muted-foreground hover:bg-background/20 bg-background/50'
                }`}
                title="Watch demo video"
              >
                <Youtube className="h-4 w-4" />
              </Button>
            )}
            {submission.repoUrl &&
              (() => {
                const isInaccessible = isRepoInaccessible(submission.source);
                const button = (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(submission.repoUrl, '_blank', 'noopener,noreferrer');
                    }}
                    className={`relative h-8 w-8 p-0 backdrop-blur-sm ${
                      homepageScreenshot
                        ? 'text-white hover:bg-white/20 bg-black/30'
                        : 'text-muted-foreground hover:bg-background/20 bg-background/50'
                    }`}
                    title={
                      isInaccessible
                        ? 'Repository may be private or does not exist'
                        : 'View on GitHub'
                    }
                  >
                    <Github className="h-4 w-4" />
                    {isInaccessible && (
                      <AlertTriangle
                        className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 z-10 ${
                          homepageScreenshot ? 'text-orange-400' : 'text-orange-500'
                        }`}
                        strokeWidth={2.5}
                      />
                    )}
                  </Button>
                );

                return isInaccessible ? (
                  <SimpleTooltip content="Repository may be private or does not exist">
                    {button}
                  </SimpleTooltip>
                ) : (
                  button
                );
              })()}
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
}

interface SubmissionsListProps {
  hackathonId: Id<'hackathons'>;
  hackathon?: {
    _id: Id<'hackathons'>;
    title: string;
    description?: string;
    dates?: {
      start?: number;
      submissionDeadline?: number;
    };
    createdAt: number;
    updatedAt: number;
  }; // Public or authenticated hackathon data
  isAuthenticated: boolean;
  userRole?: 'owner' | 'admin' | 'judge' | 'contestant';
  isNewSubmissionModalOpen?: boolean;
  onNewSubmissionModalOpen?: () => void;
  onNewSubmissionModalClose?: () => void;
}

export function SubmissionsList({
  hackathonId,
  hackathon,
  isAuthenticated,
  userRole,
  isNewSubmissionModalOpen: externalModalOpen,
  onNewSubmissionModalOpen,
  onNewSubmissionModalClose,
}: SubmissionsListProps) {
  const toast = useToast();
  const router = useRouter();
  const { user } = useAuth();
  const [showOnlyUnrated, setShowOnlyUnrated] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  // Use different queries based on authentication
  const authenticatedSubmissions = useQuery(
    api.submissions.listByHackathon,
    isAuthenticated ? { hackathonId, ratingFilter: 'all' } : 'skip',
  );
  const publicSubmissions = useQuery(
    api.submissions.listPublicSubmissions,
    { hackathonId }, // Always fetch public data
  );

  const allSubmissions =
    isAuthenticated && userRole && authenticatedSubmissions && authenticatedSubmissions.length > 0
      ? authenticatedSubmissions
      : publicSubmissions;

  // Check if user is a contestant
  const isContestant = isAuthenticated && userRole === 'contestant';

  // Filter and sort client-side for instant toggle without re-fetching (only for authenticated users)
  const submissions = useMemo(() => {
    if (!allSubmissions) return undefined;

    // Apply rating filter first
    let filtered = allSubmissions;
    if (showOnlyUnrated && isAuthenticated) {
      filtered = allSubmissions.filter(
        (submission): submission is SubmissionWithRating =>
          'myRating' in submission &&
          (submission.myRating === null || submission.myRating === undefined),
      );
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return b.createdAt - a.createdAt;
        case 'oldest':
          return a.createdAt - b.createdAt;
        case 'rating-high':
          if ('averageRating' in a && 'averageRating' in b) {
            return b.averageRating - a.averageRating;
          }
          // If one doesn't have rating, put it at the end
          if ('averageRating' in a) return -1;
          if ('averageRating' in b) return 1;
          return 0;
        case 'rating-low':
          if ('averageRating' in a && 'averageRating' in b) {
            return a.averageRating - b.averageRating;
          }
          // If one doesn't have rating, put it at the end
          if ('averageRating' in a) return -1;
          if ('averageRating' in b) return 1;
          return 0;
        case 'my-rating-high':
          if ('myRating' in a && 'myRating' in b) {
            const aHasRating = a.myRating !== null && a.myRating !== undefined;
            const bHasRating = b.myRating !== null && b.myRating !== undefined;
            // If both have ratings, sort by rating (highest first)
            if (aHasRating && bHasRating) {
              return (b.myRating ?? 0) - (a.myRating ?? 0);
            }
            // If only one has rating, put the one with rating first
            if (aHasRating && !bHasRating) return -1;
            if (!aHasRating && bHasRating) return 1;
            // If neither has rating, maintain order
            return 0;
          }
          // If one doesn't have the myRating property at all, put it at the end
          if ('myRating' in a && a.myRating !== null && a.myRating !== undefined) return -1;
          if ('myRating' in b && b.myRating !== null && b.myRating !== undefined) return 1;
          return 0;
        case 'my-rating-low':
          if ('myRating' in a && 'myRating' in b) {
            const aHasRating = a.myRating !== null && a.myRating !== undefined;
            const bHasRating = b.myRating !== null && b.myRating !== undefined;
            // If both have ratings, sort by rating (lowest first)
            if (aHasRating && bHasRating) {
              return (a.myRating ?? 0) - (b.myRating ?? 0);
            }
            // If only one has rating, put the one with rating first
            if (aHasRating && !bHasRating) return -1;
            if (!aHasRating && bHasRating) return 1;
            // If neither has rating, maintain order
            return 0;
          }
          // If one doesn't have the myRating property at all, put it at the end
          if ('myRating' in a && a.myRating !== null && a.myRating !== undefined) return -1;
          if ('myRating' in b && b.myRating !== null && b.myRating !== undefined) return 1;
          return 0;
        default:
          return b.createdAt - a.createdAt;
      }
    });

    return sorted;
  }, [allSubmissions, showOnlyUnrated, isAuthenticated, sortBy]);

  // Split submissions into user's submissions and others when authenticated
  // Only split when we have authenticated data (which includes userId)
  const { mySubmissions, otherSubmissions } = useMemo(() => {
    if (!submissions || !isAuthenticated || !user || !authenticatedSubmissions) {
      return { mySubmissions: [], otherSubmissions: submissions || [] };
    }

    const mySubs = submissions.filter(
      (submission) => 'userId' in submission && submission.userId === user.id,
    );
    const otherSubs = submissions.filter(
      (submission) => 'userId' in submission && submission.userId !== user.id,
    );

    return { mySubmissions: mySubs, otherSubmissions: otherSubs };
  }, [submissions, isAuthenticated, user, authenticatedSubmissions]);

  // Check if user has submissions to determine layout
  const hasMySubmissions = mySubmissions.length > 0;

  const deleteSubmissionOptimistic = useOptimisticMutation(api.submissions.deleteSubmission, {
    onSuccess: () => {
      toast.showToast('Submission deleted successfully', 'success');
    },
    onError: (error) => {
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete submission',
        'error',
      );
    },
  });

  const [submissionToDelete, setSubmissionToDelete] = useState<Id<'submissions'> | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Use external modal state if provided, otherwise use internal state
  const isNewSubmissionModalOpen = externalModalOpen !== undefined ? externalModalOpen : false;
  const handleModalClose = () => {
    if (onNewSubmissionModalClose) {
      onNewSubmissionModalClose();
    }
  };

  const handleViewSubmission = (submissionId: Id<'submissions'>) => {
    void router.navigate({
      to: '/h/$id/submissions/$submissionId',
      params: { id: hackathonId, submissionId },
    });
  };

  const hasEnded = useMemo(
    () =>
      !!(hackathon?.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline),
    [hackathon?.dates?.submissionDeadline],
  );

  // Determine if user can submit (only if they're a member of the hackathon)
  const canSubmit =
    isAuthenticated && userRole && ['owner', 'admin', 'judge', 'contestant'].includes(userRole);

  // Determine if user can see rating filters (judges, owners, admins)
  const canSeeRatingFilters =
    isAuthenticated && ['owner', 'admin', 'judge'].includes(userRole || '');

  // Determine if user can see aggregate rating sort options (owners, admins only)
  const canSeeAggregateRatingSort = isAuthenticated && ['owner', 'admin'].includes(userRole || '');

  // Calculate rating statistics (only for authenticated users)
  // Always use allSubmissions (unfiltered) so button shows correct counts regardless of current filter
  const ratingStats = useMemo(() => {
    if (!isAuthenticated || !allSubmissions) return { total: 0, rated: 0, unrated: 0 };

    const rated = allSubmissions.filter(
      (submission) =>
        'myRating' in submission &&
        submission.myRating !== null &&
        submission.myRating !== undefined,
    ).length;
    const unrated = allSubmissions.length - rated;

    return {
      total: allSubmissions.length,
      rated,
      unrated,
    };
  }, [allSubmissions, isAuthenticated]);

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

  // Only show main header when NOT in split view (My Submissions + Other Submissions)
  const isSplitView = hasMySubmissions && otherSubmissions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          {!isSplitView && (
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-semibold">Submissions</h2>
              {canSeeRatingFilters && (
                <>
                  {ratingStats.total > 0 && ratingStats.rated > 0 && ratingStats.unrated > 0 && (
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
                  <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
                    <SelectTrigger className="w-[180px]" size="sm">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest First</SelectItem>
                      <SelectItem value="oldest">Oldest First</SelectItem>
                      {canSeeAggregateRatingSort && (
                        <>
                          <SelectItem value="rating-high">Highest Rating</SelectItem>
                          <SelectItem value="rating-low">Lowest Rating</SelectItem>
                        </>
                      )}
                      <SelectItem value="my-rating-high">My Rating (Highest)</SelectItem>
                      <SelectItem value="my-rating-low">My Rating (Lowest)</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
            </div>
          )}
        </div>
        {canSubmit && !hasEnded && (
          <Button
            onClick={() => {
              if (onNewSubmissionModalOpen) {
                onNewSubmissionModalOpen();
              }
            }}
            className="w-full sm:w-auto"
            title="Create a new submission for this hackathon"
          >
            <Plus className="h-4 w-4" />
            New Submission
          </Button>
        )}
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">
            {showOnlyUnrated
              ? 'All submissions have been rated! 🎉'
              : hasEnded
                ? 'This hackathon is no longer accepting submissions. No new submissions can be added.'
                : isAuthenticated
                  ? 'No submissions yet. Be the first to submit!'
                  : 'No submissions yet. Sign in to submit to this hackathon!'}
          </p>
          {!showOnlyUnrated && externalModalOpen === undefined && canSubmit && !hasEnded && (
            <Button
              onClick={() => {
                // Fallback for internal modal state - should not be used in new implementation
              }}
            >
              <Plus className="h-4 w-4" />
              Add Submission
            </Button>
          )}
        </div>
      ) : hasMySubmissions && otherSubmissions.length > 0 ? (
        // Split view: My Submissions and Other Submissions
        <div className="space-y-8">
          {/* My Submissions Section */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">My Submissions</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {mySubmissions.map((submission) => (
                <SubmissionCard
                  key={submission._id}
                  submission={submission}
                  isContestant={isContestant}
                  isAuthenticated={isAuthenticated}
                  onView={handleViewSubmission}
                />
              ))}
            </div>
          </div>

          {/* Other Submissions Section */}
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">Other Submissions</h3>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {otherSubmissions.map((submission) => (
                <SubmissionCard
                  key={submission._id}
                  submission={submission}
                  isContestant={isContestant}
                  isAuthenticated={isAuthenticated}
                  onView={handleViewSubmission}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        // Single view: Submissions (only one type exists)
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {submissions.map((submission) => (
              <SubmissionCard
                key={submission._id}
                submission={submission}
                isContestant={isContestant}
                isAuthenticated={isAuthenticated}
                onView={handleViewSubmission}
              />
            ))}
          </div>
        </div>
      )}

      <NewSubmissionModal
        hackathonId={hackathonId}
        open={isNewSubmissionModalOpen}
        onClose={handleModalClose}
        totalSubmissions={submissions.length}
        userRole={userRole || 'judge'}
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
