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

  const isClosed = new Date(submissionDeadline).getTime() < Date.now();

  return (
    <Badge variant={isClosed ? 'secondary' : 'default'} className={className}>
      {formatTimeRemaining(submissionDeadline)}
    </Badge>
  );
}

