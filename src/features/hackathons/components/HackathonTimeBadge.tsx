import { Badge } from '~/components/ui/badge';
import { formatTimeRemaining } from '~/lib/utils';

interface HackathonTimeBadgeProps {
  submissionDeadline: number | Date | undefined | null;
  className?: string;
}

export function HackathonTimeBadge({ submissionDeadline, className }: HackathonTimeBadgeProps) {
  if (!submissionDeadline) {
    return null;
  }

  return (
    <Badge variant="outline" className={className}>
      {formatTimeRemaining(submissionDeadline)}
    </Badge>
  );
}
