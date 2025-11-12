import { Edit, MoreVertical, Trash2 } from 'lucide-react';
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
  hasSiteUrl: boolean;
  isCapturingScreenshot: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCaptureScreenshot: () => void;
}

export function SubmissionActionsMenu({
  canEdit,
  canDelete,
  hasSiteUrl: _hasSiteUrl,
  isCapturingScreenshot: _isCapturingScreenshot,
  onEdit,
  onDelete,
  onCaptureScreenshot: _onCaptureScreenshot,
}: SubmissionActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="touch-manipulation">
          <MoreVertical className="h-4 w-4" />
          <span className="sr-only">Actions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canEdit && (
          <DropdownMenuItem onClick={onEdit}>
            <Edit className="h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
