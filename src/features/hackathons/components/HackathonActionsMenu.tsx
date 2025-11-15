import { Edit, LogOut, MoreVertical, Scale, Send, Sprout, Trash2 } from 'lucide-react';
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
  canLeave: boolean;
  isSiteAdmin: boolean;
  onEdit: () => void;
  onManageJudges: () => void;
  onInviteJudge: () => void;
  onDelete: () => void;
  onLeave: () => void;
  onSeedSubmissions: () => void;
}

export function HackathonActionsMenu({
  canEdit,
  canManageJudges,
  canDelete,
  canLeave,
  isSiteAdmin,
  onEdit,
  onManageJudges,
  onInviteJudge,
  onDelete,
  onLeave,
  onSeedSubmissions,
}: HackathonActionsMenuProps) {
  // Count visible menu items
  const visibleItemCount =
    (canEdit ? 1 : 0) +
    (canManageJudges ? 2 : 0) + // Judges and Invite Judge are both canManageJudges
    (isSiteAdmin ? 1 : 0) +
    (canLeave ? 1 : 0) +
    (canDelete ? 1 : 0);

  const hasAnyActions = visibleItemCount > 0;
  const hasMultipleItems = visibleItemCount > 1;

  // Check if we have any non-destructive actions before destructive ones
  const hasNonDestructiveActions = canEdit || canManageJudges || isSiteAdmin;

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
        {isSiteAdmin && hasMultipleItems && <DropdownMenuSeparator />}
        {isSiteAdmin && (
          <DropdownMenuItem onClick={onSeedSubmissions}>
            <Sprout className="h-4 w-4" />
            Seed Submissions
          </DropdownMenuItem>
        )}
        {(canLeave || canDelete) && hasNonDestructiveActions && <DropdownMenuSeparator />}
        {canLeave && (
          <DropdownMenuItem variant="destructive" onClick={onLeave}>
            <LogOut className="h-4 w-4" />
            Leave Hackathon
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
