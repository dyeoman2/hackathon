import { Loader2 } from 'lucide-react';
import { Field } from '~/components/ui/field';

type ProcessingState = 'downloading' | 'uploading' | 'indexing' | 'generating' | 'complete';

interface SubmissionAIReviewProps {
  summary: string | undefined;
  isReviewing: boolean;
  inFlight: boolean | undefined;
  error: string | null;
  rateLimitRetryAfter: number | null;
  processingState?: ProcessingState;
}

function getProcessingMessage(state: ProcessingState): { title: string; description: string } {
  switch (state) {
    case 'downloading':
      return {
        title: 'Downloading Repository',
        description: 'Downloading repository from GitHub...',
      };
    case 'uploading':
      return {
        title: 'Uploading to Cloudflare R2',
        description: 'Uploading repository files to Cloudflare R2 storage...',
      };
    case 'indexing':
      return {
        title: 'Indexing with Cloudflare AI Search',
        description: 'Indexing repository files for AI search. This may take a minute...',
      };
    case 'generating':
      return {
        title: 'Generating AI Summary',
        description: 'Generating AI summary and score. This may take a minute...',
      };
    case 'complete':
      return {
        title: 'Processing Complete',
        description: 'Repository processing is complete.',
      };
    default:
      return {
        title: 'Processing',
        description: 'Processing repository...',
      };
  }
}

export function SubmissionAIReview({
  summary,
  isReviewing,
  inFlight,
  error,
  rateLimitRetryAfter,
  processingState,
}: SubmissionAIReviewProps) {
  // Show processing state if automatic processing is in progress
  const isProcessing =
    processingState && processingState !== 'complete' && !summary && !isReviewing && !inFlight;

  return (
    <div className="space-y-4">
      {rateLimitRetryAfter && (
        <p className="text-sm text-muted-foreground text-center">
          Rate limit: Please wait {Math.ceil(rateLimitRetryAfter / 1000)} seconds before running
          another review.
        </p>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {(isReviewing || inFlight) && (
        <div className="rounded-md border bg-muted/50 p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm font-medium mb-1">Running AI Review</p>
          <p className="text-xs text-muted-foreground">
            Analyzing submission... This may take a minute.
          </p>
        </div>
      )}

      {isProcessing && processingState && (
        <div className="rounded-md border bg-muted/50 p-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
          <p className="text-sm font-medium mb-1">{getProcessingMessage(processingState).title}</p>
          <p className="text-xs text-muted-foreground">
            {getProcessingMessage(processingState).description}
          </p>
        </div>
      )}

      {summary && !isReviewing && !inFlight && (
        <Field>
          <div className="rounded-md border bg-muted/50 p-4">
            <p className="text-sm whitespace-pre-wrap">{summary}</p>
          </div>
        </Field>
      )}

      {!summary && !isReviewing && !inFlight && !isProcessing && (
        <div className="rounded-md border bg-muted/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI review available yet. Click "Run AI Review" to generate one.
          </p>
        </div>
      )}
    </div>
  );
}
