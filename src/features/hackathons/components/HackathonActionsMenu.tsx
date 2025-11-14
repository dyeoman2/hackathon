import { Edit, MoreVertical, Scale, Send, Trash2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

interface HackathonActionsMenuProps {
  canEdit: boolean;
  canManageJudges: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onManageJudges: () => void;
  onInviteJudge: () => void;
  onDelete: () => void;
}

export function HackathonActionsMenu({
  canEdit,
  canManageJudges,
  canDelete,
  onEdit,
  onManageJudges,
  onInviteJudge,
  onDelete,
}: HackathonActionsMenuProps) {
  const hasAnyActions = canEdit || canManageJudges || canDelete;

  if (!hasAnyActions) {
    return null;
  }

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
            <Edit className="h-4 w-4" />
            Edit
          </DropdownMenuItem>
        )}
        {canManageJudges && (
          <DropdownMenuItem onClick={onManageJudges}>
            <Scale className="h-4 w-4" />
            Judges
          </DropdownMenuItem>
        )}
        {canManageJudges && (
          <DropdownMenuItem onClick={onInviteJudge}>
            <Send className="h-4 w-4" />
            Invite Judge
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
