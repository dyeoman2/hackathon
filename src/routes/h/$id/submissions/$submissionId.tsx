import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useEffect } from 'react';
import { SiGithub } from 'react-icons/si';
import { NotFound } from '~/components/NotFound';
import { PageHeader } from '~/components/PageHeader';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuth } from '~/features/auth/hooks/useAuth';
import { SubmissionRepositorySummary } from '~/features/hackathons/components/SubmissionRepositorySummary';
import { SubmissionScreenshots } from '~/features/hackathons/components/SubmissionScreenshots';
import { usePerformanceMonitoring } from '~/hooks/use-performance-monitoring';

export const Route = createFileRoute('/h/$id/submissions/$submissionId')({
  component: PublicSubmissionPage,
});

function PublicSubmissionPage() {
  usePerformanceMonitoring('PublicSubmission');
  const { id: hackathonId, submissionId } = Route.useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const submission = useQuery(api.submissions.getPublicSubmission, {
    submissionId: submissionId as Id<'submissions'>,
  });

  const hackathon = useQuery(api.hackathons.getPublicHackathon, {
    hackathonId: hackathonId as Id<'hackathons'>,
  });

  // Redirect authenticated users to full-featured page
  useEffect(() => {
    if (isAuthenticated) {
      navigate({
        to: '/app/h/$id/submissions/$submissionId',
        params: { id: hackathonId, submissionId },
        replace: true,
      });
    }
  }, [isAuthenticated, navigate, hackathonId, submissionId]);

  const handleBackToHackathon = () => {
    navigate({
      to: '/h/$id',
      params: { id: hackathonId },
    });
  };

  const handleRegisterToSubmit = () => {
    navigate({
      to: '/register',
      search: {
        redirect: `/app/h/${hackathonId}?newSubmission=true`,
      },
    });
  };

  if (submission === undefined || hackathon === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="" description={<Skeleton className="h-4 w-96" />} />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (submission === null || hackathon === null) {
    return <NotFound />;
  }

  return (
    <div className="space-y-6">
      {/* Back navigation matching authenticated page style */}
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="sm" onClick={handleBackToHackathon} className="-ml-2">
          <ArrowLeft className="h-4 w-4" />
          Back to {hackathon.title}
        </Button>
      </div>

      <PageHeader
        title={submission.title}
        description={`by ${submission.team}`}
        titleActions={
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
            <div className="flex items-center gap-2">
              <Button onClick={handleRegisterToSubmit}>Register & Submit Your Own</Button>
            </div>
          </div>
        }
      />

      <div className="space-y-6">
        <SubmissionRepositorySummary submission={submission} canEdit={false} />

        <SubmissionScreenshots submission={submission} canEdit={false} />
      </div>
    </div>
  );
}
