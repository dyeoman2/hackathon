import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '~/components/ui/toast';

type RevealPhase =
  | 'idle'
  | 'countdown'
  | 'tally'
  | 'podiumReady'
  | 'reveal3rd'
  | 'reveal2nd'
  | 'reveal1st'
  | 'complete'; // Legacy phase for backwards compatibility

interface RevealState {
  hackathonId: Id<'hackathons'>;
  phase: RevealPhase;
  startedAt?: number;
  revealedRanks: number[];
  controlledBy?: string;
  createdAt: number;
  updatedAt: number;
  _id?: Id<'revealState'>;
}

interface UseRevealSyncReturn {
  // Current phase and timing
  phase: RevealPhase;
  timeRemaining: number; // milliseconds remaining for timed phases
  canAdvance: boolean; // whether manual advance is allowed
  canGoBack: boolean; // whether going back is allowed

  // Control actions
  startReveal: () => Promise<void>;
  advancePhase: () => Promise<void>;
  goBackPhase: () => Promise<void>;
  resetReveal: () => Promise<void>;

  // Loading states
  isStarting: boolean;
  isAdvancing: boolean;
  isGoingBack: boolean;
  isResetting: boolean;
}

const PHASE_DURATION_MS = 10000; // 10 seconds for countdown and tally

/**
 * Hook for managing reveal sequence state and synchronization
 *
 * Handles automatic phase transitions for timed phases (countdown, tally)
 * and provides manual controls for presenter
 */
export function useRevealSync(
  hackathonId: Id<'hackathons'>,
  revealState: RevealState | null,
): UseRevealSyncReturn {
  const toast = useToast();

  // Mutations
  const startRevealMutation = useMutation(api.reveal.startReveal);
  const advanceRevealMutation = useMutation(api.reveal.advanceReveal);
  const goBackRevealMutation = useMutation(api.reveal.goBackReveal);
  const resetRevealMutation = useMutation(api.reveal.resetReveal);

  // Loading states
  const [isStarting, setIsStarting] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [isGoingBack, setIsGoingBack] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  // Time remaining for current phase
  const [timeRemaining, setTimeRemaining] = useState(0);

  const phase = revealState?.phase ?? 'idle';
  const startedAt = revealState?.startedAt;

  // Calculate time remaining for timed phases
  useEffect(() => {
    if (startedAt === undefined || (phase !== 'countdown' && phase !== 'tally')) {
      setTimeRemaining(0);
      return;
    }

    // Calculate initial remaining time
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, PHASE_DURATION_MS - elapsed);

    setTimeRemaining(remaining);

    if (remaining === 0) {
      return;
    }

    // Update every 100ms for smooth countdown
    const interval = setInterval(() => {
      const newElapsed = Date.now() - startedAt;
      const newRemaining = Math.max(0, PHASE_DURATION_MS - newElapsed);
      setTimeRemaining(newRemaining);
    }, 100);

    return () => clearInterval(interval);
  }, [phase, startedAt]);

  // Auto-advance for timed phases when time expires
  useEffect(() => {
    if (timeRemaining === 0 && (phase === 'countdown' || phase === 'tally')) {
      // Small delay to ensure smooth transition
      const timeout = setTimeout(() => {
        advanceRevealMutation({ hackathonId }).catch((error) => {
          console.error('Auto-advance failed:', error);
          toast.showToast('Failed to advance phase automatically', 'error');
        });
      }, 500);

      return () => clearTimeout(timeout);
    }
  }, [timeRemaining, phase, hackathonId, advanceRevealMutation, toast]);

  // Start reveal
  const startReveal = useCallback(async () => {
    setIsStarting(true);
    try {
      await startRevealMutation({ hackathonId });
    } catch (error) {
      console.error('Failed to start reveal:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to start reveal', 'error');
    } finally {
      setIsStarting(false);
    }
  }, [hackathonId, startRevealMutation, toast]);

  // Advance to next phase
  const advancePhase = useCallback(async () => {
    setIsAdvancing(true);
    try {
      await advanceRevealMutation({ hackathonId });
    } catch (error) {
      console.error('Failed to advance phase:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to advance phase', 'error');
    } finally {
      setIsAdvancing(false);
    }
  }, [hackathonId, advanceRevealMutation, toast]);

  // Go back to previous phase
  const goBackPhase = useCallback(async () => {
    setIsGoingBack(true);
    try {
      await goBackRevealMutation({ hackathonId });
    } catch (error) {
      console.error('Failed to go back phase:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to go back phase', 'error');
    } finally {
      setIsGoingBack(false);
    }
  }, [hackathonId, goBackRevealMutation, toast]);

  // Reset reveal
  const resetReveal = useCallback(async () => {
    setIsResetting(true);
    try {
      await resetRevealMutation({ hackathonId });
      toast.showToast('Reveal reset successfully', 'success');
    } catch (error) {
      console.error('Failed to reset reveal:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to reset reveal', 'error');
    } finally {
      setIsResetting(false);
    }
  }, [hackathonId, resetRevealMutation, toast]);

  // Determine if manual advance is allowed
  const canAdvance = phase === 'podiumReady' || phase === 'reveal3rd' || phase === 'reveal2nd';

  // Determine if going back is allowed (all phases except idle)
  const canGoBack = phase !== 'idle';

  return {
    phase,
    timeRemaining,
    canAdvance,
    canGoBack,
    startReveal,
    advancePhase,
    goBackPhase,
    resetReveal,
    isStarting,
    isAdvancing,
    isGoingBack,
    isResetting,
  };
}
