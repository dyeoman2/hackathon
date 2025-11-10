import { Badge } from '~/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

interface SubmissionScoringProps {
  score: number | undefined;
}

export function SubmissionScoring({ score }: SubmissionScoringProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Scoring</CardTitle>
        <CardDescription>AI-generated score based on submission quality</CardDescription>
      </CardHeader>
      <CardContent>
        {score !== undefined ? (
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
