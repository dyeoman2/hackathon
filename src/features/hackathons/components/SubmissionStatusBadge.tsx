import { Check, ChevronDown } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { cn } from '~/lib/utils';

export type SubmissionStatus = 'submitted' | 'review' | 'shortlist' | 'winner' | 'rejected';

// Helper to get status badge styling
function getStatusBadgeVariant(
  status: SubmissionStatus,
): 'outline' | 'info' | 'warning' | 'success' | 'destructive' | 'light-purple' {
  switch (status) {
    case 'submitted':
      return 'light-purple';
    case 'review':
      return 'info';
    case 'shortlist':
      return 'warning';
    case 'winner':
      return 'success';
    case 'rejected':
      return 'destructive';
  }
}

// Helper to get status dot color
function getStatusDotColor(status: SubmissionStatus): string {
  switch (status) {
    case 'submitted':
      return 'bg-purple-500';
    case 'review':
      return 'bg-blue-500';
    case 'shortlist':
      return 'bg-orange-500';
    case 'winner':
      return 'bg-emerald-500';
    case 'rejected':
      return 'bg-red-500';
  }
}

// Helper to get status background color for selected item (same as hover state)
function getStatusBgColor(status: SubmissionStatus): string {
  switch (status) {
    case 'submitted':
      return 'bg-purple-50 dark:bg-purple-500/20';
    case 'review':
      return 'bg-blue-50 dark:bg-blue-500/20';
    case 'shortlist':
      return 'bg-orange-50 dark:bg-orange-500/20';
    case 'winner':
      return 'bg-emerald-50 dark:bg-emerald-500/20';
    case 'rejected':
      return 'bg-red-50 dark:bg-red-500/20';
  }
}

// Helper to get hover/focus background color (lighter shade of dot color)
function getStatusHoverColor(status: SubmissionStatus): string {
  switch (status) {
    case 'submitted':
      return '!focus:bg-purple-50 dark:!focus:bg-purple-500/20 hover:!bg-purple-50 dark:hover:!bg-purple-500/20 !focus:text-foreground';
    case 'review':
      return '!focus:bg-blue-50 dark:!focus:bg-blue-500/20 hover:!bg-blue-50 dark:hover:!bg-blue-500/20 !focus:text-foreground';
    case 'shortlist':
      return '!focus:bg-orange-50 dark:!focus:bg-orange-500/20 hover:!bg-orange-50 dark:hover:!bg-orange-500/20 !focus:text-foreground';
    case 'winner':
      return '!focus:bg-emerald-50 dark:!focus:bg-emerald-500/20 hover:!bg-emerald-50 dark:hover:!bg-emerald-500/20 !focus:text-foreground';
    case 'rejected':
      return '!focus:bg-red-50 dark:!focus:bg-red-500/20 hover:!bg-red-50 dark:hover:!bg-red-500/20 !focus:text-foreground';
  }
}

interface SubmissionStatusBadgeProps {
  status: SubmissionStatus;
  canEdit: boolean;
  isUpdating: boolean;
  onStatusChange: (newStatus: SubmissionStatus) => void;
}

export function SubmissionStatusBadge({
  status,
  canEdit,
  isUpdating,
  onStatusChange,
}: SubmissionStatusBadgeProps) {
  if (!canEdit) {
    return (
      <Badge variant={getStatusBadgeVariant(status)}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </Badge>
    );
  }

  const statuses: SubmissionStatus[] = ['submitted', 'review', 'shortlist', 'rejected', 'winner'];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={isUpdating}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
        >
          <Badge variant={getStatusBadgeVariant(status)} className="cursor-pointer">
            {status.charAt(0).toUpperCase() + status.slice(1)}
            <ChevronDown className="h-3 w-3 ml-1" />
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {statuses.map((statusOption) => (
          <DropdownMenuItem
            key={statusOption}
            onClick={() => {
              if (status !== statusOption) {
                onStatusChange(statusOption);
              }
            }}
            className={cn(
              status === statusOption && `${getStatusBgColor(statusOption)} text-foreground`,
              status !== statusOption && getStatusHoverColor(statusOption),
            )}
          >
            <div className={`h-2 w-2 rounded-full ${getStatusDotColor(statusOption)} mr-2`} />
            <span>{statusOption.charAt(0).toUpperCase() + statusOption.slice(1)}</span>
            {status === statusOption && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

