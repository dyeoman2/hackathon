import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ExternalLink, Github } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

interface PublicSubmissionsListProps {
  hackathonId: Id<'hackathons'>;
}

export function PublicSubmissionsList({ hackathonId }: PublicSubmissionsListProps) {
  usePerformanceMonitoring('PublicSubmissionsList');
  const navigate = useNavigate();

  const submissions = useQuery(api.submissions.listPublicSubmissions, {
    hackathonId,
  });

  const handleViewSubmission = (submissionId: Id<'submissions'>) => {
    navigate({
      to: '/h/$id/submissions/$submissionId',
      params: { id: hackathonId, submissionId },
    });
  };

  if (submissions === undefined) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-32" />
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
          <h2 className="text-2xl font-semibold">Submissions</h2>
          <p className="text-muted-foreground">
            {submissions.length === 0
              ? 'No submissions yet. Be the first to submit!'
              : `${submissions.length} submission${submissions.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {submissions.length === 0 ? (
        <div className="rounded-md border bg-card p-12 text-center">
          <p className="text-muted-foreground mb-4">
            No submissions yet. Be the first to submit to this hackathon!
          </p>
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
                              : ''
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
                              : ''
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
    </div>
  );
}
