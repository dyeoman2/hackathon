import { Loader2 } from 'lucide-react';
import { Field } from '~/components/ui/field';

interface SubmissionAIReviewProps {
  summary: string | undefined;
  isReviewing: boolean;
  inFlight: boolean | undefined;
  error: string | null;
  rateLimitRetryAfter: number | null;
}

export function SubmissionAIReview({
  summary,
  isReviewing,
  inFlight,
  error,
  rateLimitRetryAfter,
}: SubmissionAIReviewProps) {
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

      {summary && !isReviewing && !inFlight && (
        <Field>
          <div className="rounded-md border bg-muted/50 p-4">
            <p className="text-sm whitespace-pre-wrap">{summary}</p>
          </div>
        </Field>
      )}

      {!summary && !isReviewing && !inFlight && (
        <div className="rounded-md border bg-muted/50 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No AI review available yet. Click "Run AI Review" to generate one.
          </p>
        </div>
      )}
    </div>
  );
}

