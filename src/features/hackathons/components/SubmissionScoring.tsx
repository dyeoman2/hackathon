import { Badge } from '~/components/ui/badge';

interface SubmissionScoringProps {
  score: number | undefined;
}

export function SubmissionScoring({ score }: SubmissionScoringProps) {
  return (
    <div className="pt-6 border-t space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h3 className="text-lg font-semibold">Scoring</h3>
      </div>
      {score !== undefined && (
        <Badge variant="default" className="text-base px-3 py-1">
          AI Score: {score.toFixed(1)} / 10
        </Badge>
      )}
    </div>
  );
}
