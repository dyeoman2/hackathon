import type { Doc } from '@convex/_generated/dataModel';
import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { ProcessingLoader } from '~/components/ui/processing-loader';

interface SubmissionScoringProps {
  submission: Doc<'submissions'>;
}

export function SubmissionScoring({ submission }: SubmissionScoringProps) {
  const score = submission.ai?.score;
  const processingState = submission.source?.processingState;
  const inFlight = submission.ai?.inFlight;
  const scoreGenerationStarted = !!submission.ai?.scoreGenerationStartedAt;
  const scoreGenerationCompleted = !!submission.ai?.scoreGenerationCompletedAt;

  // Show processing state if automatic processing is in progress (same states as Repo Chat)
  const isProcessing = processingState && processingState !== 'complete';

  // Show scoring-specific loading if score generation has started but not completed
  const isScoringInProgress = scoreGenerationStarted && !scoreGenerationCompleted;

  // Show loading if either processing is in progress or scoring is in progress
  const showLoading = isProcessing || isScoringInProgress || inFlight;

  const getProcessingMessage = (state: string | undefined) => {
    switch (state) {
      case 'downloading':
        return {
          title: 'Downloading Repository',
          description: 'Downloading repository files from GitHub...',
        };
      case 'indexing':
        return {
          title: 'Indexing Repository',
          description:
            'Indexing repository files in Cloudflare AI Search. This may take a minute...',
        };
      case 'generating':
        return {
          title: 'Generating Score',
          description: 'Generating AI score from repository files...',
        };
      default:
        return {
          title: 'Generating Score',
          description: 'Generating AI score from repository files...',
        };
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring</CardTitle>
        <CardDescription>AI-generated score based on submission quality</CardDescription>
      </CardHeader>
      <CardContent>
        {showLoading ? (
          <ProcessingLoader
            title={getProcessingMessage(processingState).title}
            description={getProcessingMessage(processingState).description}
          />
        ) : score !== undefined ? (
          <Badge variant="default" className="text-base px-3 py-1">
            AI Score: {score.toFixed(1)} / 10
          </Badge>
        ) : (
          <p className="text-sm text-muted-foreground">
            The score will automatically be generated when the repository finished up uploading to
            R2 and being indexed in AI Search.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
