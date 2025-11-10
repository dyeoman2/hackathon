import { Edit, Loader2, MoreVertical, Play, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

interface SubmissionActionsMenuProps {
  canEdit: boolean;
  canDelete: boolean;
  canRunReview: boolean;
  isReviewing: boolean;
  inFlight: boolean | undefined;
  rateLimitRetryAfter: number | null;
  onEdit: () => void;
  onDelete: () => void;
  onRunReview: () => void;
}

export function SubmissionActionsMenu({
  canEdit,
  canDelete,
  canRunReview,
  isReviewing,
  inFlight,
  rateLimitRetryAfter,
  onEdit,
  onDelete,
  onRunReview,
}: SubmissionActionsMenuProps) {
  const isProcessing = isReviewing || !!inFlight;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="touch-manipulation">
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Edit className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onRunReview} disabled={!canRunReview || !!rateLimitRetryAfter}>
          {isProcessing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {isProcessing ? 'Running Review...' : 'Run AI Review'}
        </DropdownMenuItem>
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

