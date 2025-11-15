import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useRouter } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { AlertCircle, CheckCircle2, Eye, RefreshCw, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { useToast } from '~/components/ui/toast';
import { useRevealSync } from '~/features/reveal/hooks/useRevealSync';

interface VotingStatusBannerProps {
  hackathonId: Id<'hackathons'>;
  hackathonRole?: 'owner' | 'admin' | 'judge' | 'contestant' | null;
}

export function VotingStatusBanner({ hackathonId, hackathonRole }: VotingStatusBannerProps) {
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });
  const revealState = useQuery(api.reveal.getRevealState, { hackathonId });
  const closeVoting = useMutation(api.hackathons.closeVotingAndStartReveal);
  const reopenVoting = useMutation(api.hackathons.reopenVoting);
  const revealSync = useRevealSync(hackathonId, revealState ?? null);
  const router = useRouter();
  const toast = useToast();
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);

  if (hackathon === undefined) {
    return null;
  }

  if (hackathon === null) {
    return null;
  }

  const isSubmissionsClosed =
    hackathon.dates?.submissionDeadline && Date.now() > hackathon.dates.submissionDeadline;
  const isVotingClosed = !!hackathon.votingClosedAt;
  const isAdminOrOwner = hackathonRole === 'owner' || hackathonRole === 'admin';

  // Show nothing if submissions are still open
  if (!isSubmissionsClosed && !isVotingClosed) {
    return null;
  }

  // Show options when voting is closed (only for admins/owners)
  if (isVotingClosed && isAdminOrOwner) {
    const handleStartReveal = async () => {
      try {
        await revealSync.startReveal();
        void router.navigate({
          to: '/app/h/$id/reveal',
          params: { id: hackathonId },
          search: { autostart: false },
        });
      } catch (error) {
        console.error('Failed to start reveal:', error);
        toast.showToast(error instanceof Error ? error.message : 'Failed to start reveal', 'error');
      }
    };

    const handleReopenVotingClick = () => {
      setIsReopenModalOpen(true);
    };

    const handleReopenVotingConfirm = async () => {
      try {
        await reopenVoting({ hackathonId });
        toast.showToast('Voting reopened successfully', 'success');
        setIsReopenModalOpen(false);
      } catch (error) {
        console.error('Failed to reopen voting:', error);
        toast.showToast(
          error instanceof Error ? error.message : 'Failed to reopen voting',
          'error',
        );
      }
    };

    return (
      <>
        <Alert>
          <Trophy className="h-4 w-4" />
          <AlertTitle>Voting is closed</AlertTitle>
          <AlertDescription className="space-y-4">
            <span>
              Voting has been closed for this hackathon. You can start the reveal to show results
              and announce winners, or reopen voting if judges need to continue rating submissions.
            </span>
            <div className="flex items-center gap-2">
              <Button onClick={handleStartReveal} className="shrink-0">
                <Trophy className="h-4 w-4" />
                Start Reveal
              </Button>
              <Button onClick={handleReopenVotingClick} variant="secondary" className="shrink-0">
                <RefreshCw className="h-4 w-4" />
                Reopen Voting
              </Button>
            </div>
          </AlertDescription>
        </Alert>
        <Dialog open={isReopenModalOpen} onOpenChange={setIsReopenModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reopen Voting</DialogTitle>
              <DialogDescription>
                Are you sure you want to reopen voting? This will allow judges to submit and change
                their ratings again.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsReopenModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleReopenVotingConfirm}>Reopen Voting</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Show voting closed message for non-admin users
  if (isVotingClosed) {
    return (
      <Alert>
        <Trophy className="h-4 w-4" />
        <AlertTitle>Voting has ended</AlertTitle>
        <AlertDescription>
          Voting for this hackathon has closed. No new ratings can be submitted. You can view the
          results in the reveal page.
        </AlertDescription>
      </Alert>
    );
  }

  // Show submissions closed message for judges
  if (isSubmissionsClosed && !isAdminOrOwner) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Submissions closed</AlertTitle>
        <AlertDescription>
          The submission deadline has passed. No new submissions can be added to this hackathon.
        </AlertDescription>
      </Alert>
    );
  }

  // Show admin prompt to close voting
  if (isSubmissionsClosed && isAdminOrOwner && !isVotingClosed) {
    const handleCloseVoting = async () => {
      try {
        await closeVoting({ hackathonId });
        // The closeVoting mutation already starts the reveal, so we just need to navigate
        void router.navigate({
          to: '/app/h/$id/reveal',
          params: { id: hackathonId },
          search: { autostart: false },
        });
      } catch (error) {
        console.error('Failed to close voting:', error);
        toast.showToast(error instanceof Error ? error.message : 'Failed to close voting', 'error');
      }
    };

    const handlePreviewReveal = async () => {
      try {
        await revealSync.startReveal();
        void router.navigate({
          to: '/app/h/$id/reveal',
          params: { id: hackathonId },
          search: { autostart: false },
        });
      } catch (error) {
        console.error('Failed to start reveal:', error);
        toast.showToast(error instanceof Error ? error.message : 'Failed to start reveal', 'error');
      }
    };

    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>Ready to close voting?</AlertTitle>
        <AlertDescription className="space-y-4">
          <span>
            Submissions are closed and voting is open for judges. We suggest you do a reveal to show
            the final rankings and announce winners in a fun way.
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={handlePreviewReveal} variant="secondary" className="shrink-0">
              <Eye className="h-4 w-4" />
              Preview Reveal
            </Button>
            <Button onClick={handleCloseVoting} className="shrink-0">
              <Trophy className="h-4 w-4" />
              Close Voting & Start Reveal
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
