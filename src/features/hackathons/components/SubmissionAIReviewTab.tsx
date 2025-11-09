import type { Doc } from '@convex/_generated/dataModel';
import { Loader2 } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Field, FieldLabel } from '~/components/ui/field';
import { useAIReply } from '../hooks/useAIReply';

interface SubmissionAIReviewTabProps {
  submission: Doc<'submissions'>;
}

export function SubmissionAIReviewTab({ submission }: SubmissionAIReviewTabProps) {
  const { review, isReviewing, error, rateLimitRetryAfter } = useAIReply(submission._id);

  const handleRunReview = async () => {
    await review();
  };

  const canRunReview = !submission.ai?.inFlight && !isReviewing;

  return (
    <div className="space-y-4">
      {submission.ai?.summary && (
        <Field>
          <FieldLabel>AI Summary</FieldLabel>
          <div className="rounded-md border bg-muted/50 p-4">
            <p className="text-sm whitespace-pre-wrap">{submission.ai.summary}</p>
          </div>
        </Field>
      )}

      {submission.ai?.score !== undefined && (
        <Field>
          <FieldLabel>AI Score</FieldLabel>
          <div>
            <Badge variant="default" className="text-lg">
              {submission.ai.score.toFixed(1)} / 10
            </Badge>
          </div>
        </Field>
      )}

      {submission.ai?.lastReviewedAt && (
        <Field>
          <FieldLabel>Last Reviewed</FieldLabel>
          <p className="text-sm">{new Date(submission.ai.lastReviewedAt).toLocaleString()}</p>
        </Field>
      )}

      <div className="pt-4 border-t">
        <Button
          onClick={handleRunReview}
          disabled={!canRunReview || !!rateLimitRetryAfter}
          className="w-full"
        >
          {isReviewing || submission.ai?.inFlight ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Running Review...
            </>
          ) : (
            'Run AI Review'
          )}
        </Button>

        {rateLimitRetryAfter && (
          <p className="text-sm text-muted-foreground mt-2 text-center">
            Rate limit: Please wait {Math.ceil(rateLimitRetryAfter / 1000)} seconds before running
            another review.
          </p>
        )}

        {error && (
          <div className="mt-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {isReviewing && (
          <div className="mt-4 rounded-md border bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">Reviewing submission...</p>
          </div>
        )}
      </div>
    </div>
  );
}
