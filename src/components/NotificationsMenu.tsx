import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Bell, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Skeleton } from '~/components/ui/skeleton';
import { useToast } from '~/components/ui/toast';
import { useAuthState } from '~/features/auth/hooks/useAuthState';

type InviteAction = 'accept' | 'decline';

export function NotificationsMenu() {
  const { isAuthenticated } = useAuthState();
  const toast = useToast();

  const invitations = useQuery(
    api.hackathons.listPendingInvitesForUser,
    isAuthenticated ? {} : 'skip',
  );

  const acceptInvite = useMutation(api.hackathons.acceptPendingInvite);
  const declineInvite = useMutation(api.hackathons.declinePendingInvite);

  const [pendingActions, setPendingActions] = useState<
    Partial<Record<Id<'memberships'>, InviteAction>>
  >({});

  const invitationList = invitations ?? [];
  const isLoadingInvites = isAuthenticated && invitations === undefined;
  const hasNotifications = invitationList.length > 0;

  const pendingInvitationIds = useMemo(
    () => new Set(Object.keys(pendingActions) as Id<'memberships'>[]),
    [pendingActions],
  );

  if (!isAuthenticated) {
    return null;
  }

  const setActionPending = (membershipId: Id<'memberships'>, action: InviteAction) => {
    setPendingActions((previous) => ({
      ...previous,
      [membershipId]: action,
    }));
  };

  const clearActionPending = (membershipId: Id<'memberships'>) => {
    setPendingActions((previous) => {
      const next = { ...previous };
      delete next[membershipId];
      return next;
    });
  };

  const handleAccept = (membershipId: Id<'memberships'>, hackathonTitle: string) => {
    setActionPending(membershipId, 'accept');
    void acceptInvite({ membershipId })
      .then(() => {
        toast.showToast(`Joined ${hackathonTitle}`, 'success');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to accept invite';
        toast.showToast(message, 'error');
      })
      .finally(() => {
        clearActionPending(membershipId);
      });
  };

  const handleDecline = (membershipId: Id<'memberships'>, hackathonTitle: string) => {
    setActionPending(membershipId, 'decline');
    void declineInvite({ membershipId })
      .then(() => {
        toast.showToast(`Declined invite to ${hackathonTitle}`, 'info');
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Failed to decline invite';
        toast.showToast(message, 'error');
      })
      .finally(() => {
        clearActionPending(membershipId);
      });
  };

  const renderInvitations = () => {
    if (isLoadingInvites) {
      return (
        <div className="space-y-3 px-3 py-2">
          <div className="space-y-2 rounded-md border p-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        </div>
      );
    }

    if (invitationList.length === 0) {
      return (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          No notifications right now
        </div>
      );
    }

    return (
      <div className="max-h-96 space-y-2 overflow-y-auto px-3 py-2">
        {invitationList.map((invite) => {
          const isAccepting = pendingActions[invite.membershipId] === 'accept';
          const isDeclining = pendingActions[invite.membershipId] === 'decline';
          const isBusy =
            isAccepting || isDeclining || pendingInvitationIds.has(invite.membershipId);

          return (
            <div key={invite.membershipId} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold leading-none">{invite.hackathonTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    Invited as {invite.role}
                    {invite.invitedByName ? ` by ${invite.invitedByName}` : ''}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    void handleAccept(invite.membershipId, invite.hackathonTitle);
                  }}
                  disabled={isDeclining || isBusy}
                >
                  {isAccepting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    'Accept'
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    void handleDecline(invite.membershipId, invite.hackathonTitle);
                  }}
                  disabled={isAccepting || isBusy}
                >
                  {isDeclining ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Rejecting...
                    </>
                  ) : (
                    'Reject'
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-4 w-4" />
          {hasNotifications ? (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {invitationList.length}
            </span>
          ) : null}
          <span className="sr-only">Open notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        {renderInvitations()}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
