import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Maximize, Minimize } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { useFullscreen } from '../hooks/useFullscreen';
import type { useRevealSync } from '../hooks/useRevealSync';
import { CountdownPhase } from './CountdownPhase';
import { PodiumPhase } from './PodiumPhase';
import { PresenterControls } from './PresenterControls';
import { TallyPhase } from './TallyPhase';

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

interface RankedSubmission {
  _id: Id<'submissions'>;
  title: string;
  team: string;
  repoUrl: string;
  siteUrl?: string;
  screenshots?: Array<{
    r2Key: string;
    url: string;
    capturedAt: number;
    pageUrl?: string;
    pageName?: string;
  }>;
  averageRating: number;
  ratingCount: number;
  emojiVotes: string[];
  rank: number;
}

interface RevealStageProps {
  hackathonId: Id<'hackathons'>;
  revealState: RevealState;
  submissions: RankedSubmission[];
  isPresenter: boolean;
  revealSync: ReturnType<typeof useRevealSync>;
}

export function RevealStage({
  hackathonId,
  revealState,
  submissions,
  isPresenter,
  revealSync,
}: RevealStageProps) {
  const { phase } = revealSync;
  const stageRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enterFullscreen, exitFullscreen } = useFullscreen(stageRef);
  // Hide buttons by default when entering podium phases (reveal stage) or idle phase
  const isPodiumPhase =
    phase === 'podiumReady' ||
    phase === 'reveal3rd' ||
    phase === 'reveal2nd' ||
    phase === 'reveal1st';
  const isIdlePhase = phase === 'idle';
  const [buttonsVisible, setButtonsVisible] = useState(!isPodiumPhase && !isIdlePhase);
  const [isHovering, setIsHovering] = useState(false);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPhaseRef = useRef(phase);
  let content: ReactNode;

  // Reset button visibility when phase changes
  useEffect(() => {
    if (previousPhaseRef.current !== phase) {
      previousPhaseRef.current = phase;
      // Hide buttons when entering podium phases or idle phase, show them for other phases
      const isPodium =
        phase === 'podiumReady' ||
        phase === 'reveal3rd' ||
        phase === 'reveal2nd' ||
        phase === 'reveal1st';
      const isIdle = phase === 'idle';
      setButtonsVisible(!isPodium && !isIdle);
      setIsHovering(false);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    }
  }, [phase]);

  // Fade out buttons after 5 seconds, but only if not hovering
  useEffect(() => {
    if (!buttonsVisible || isHovering) return;

    fadeTimeoutRef.current = setTimeout(() => {
      setButtonsVisible(false);
    }, 5000);

    return () => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, [buttonsVisible, isHovering]);

  // Show buttons when scrolling near top (only for non-podium phases)
  useEffect(() => {
    const handleScroll = () => {
      // Don't show buttons on scroll for podium phases - they should only appear on hover
      if (isPodiumPhase) return;

      const scrollY = window.scrollY || document.documentElement.scrollTop;
      // Show buttons if scrolled within 100px of top
      if (scrollY < 100) {
        setButtonsVisible(true);
        // Reset the fade timer only if not hovering
        if (!isHovering) {
          if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
          }
          fadeTimeoutRef.current = setTimeout(() => {
            setButtonsVisible(false);
          }, 5000);
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [isHovering, isPodiumPhase]);

  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  if (phase === 'idle') {
    // Show loading state while transitioning from idle
    content = (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-4 text-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-300">Loading reveal...</p>
        </div>
      </div>
    );
  } else if (phase === 'countdown') {
    content = (
      <>
        <CountdownPhase
          submissions={submissions}
          timeRemaining={revealSync.timeRemaining}
          isPresenter={isPresenter}
        />
        {isPresenter && (
          <PresenterControls
            phase={phase}
            hackathonId={hackathonId}
            onRestart={revealSync.startReveal}
            onGoBack={revealSync.goBackPhase}
            isRestarting={revealSync.isStarting}
            isGoingBack={revealSync.isGoingBack}
            canGoBack={revealSync.canGoBack}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
          />
        )}
      </>
    );
  } else if (phase === 'tally') {
    content = (
      <>
        <TallyPhase
          submissions={submissions}
          timeRemaining={revealSync.timeRemaining}
          isPresenter={isPresenter}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
          onStartTallying={revealSync.startTallying}
        />
        {isPresenter && (
          <PresenterControls
            phase={phase}
            hackathonId={hackathonId}
            onRestart={revealSync.startReveal}
            onGoBack={revealSync.goBackPhase}
            isRestarting={revealSync.isStarting}
            isGoingBack={revealSync.isGoingBack}
            canGoBack={revealSync.canGoBack}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
          />
        )}
      </>
    );
  } else if (
    phase === 'podiumReady' ||
    phase === 'reveal3rd' ||
    phase === 'reveal2nd' ||
    phase === 'reveal1st'
  ) {
    content = (
      <>
        <PodiumPhase
          hackathonId={hackathonId}
          submissions={submissions}
          phase={phase}
          revealedRanks={revealState.revealedRanks}
          isPresenter={isPresenter}
          onReveal={revealSync.advancePhase}
        />
        {isPresenter && (
          <PresenterControls
            phase={phase}
            hackathonId={hackathonId}
            onRestart={revealSync.startReveal}
            onAdvance={revealSync.advancePhase}
            onGoBack={revealSync.goBackPhase}
            isRestarting={revealSync.isStarting}
            isAdvancing={revealSync.isAdvancing}
            isGoingBack={revealSync.isGoingBack}
            canAdvance={revealSync.canAdvance}
            canGoBack={revealSync.canGoBack}
            isFullscreen={isFullscreen}
            onToggleFullscreen={handleToggleFullscreen}
          />
        )}
      </>
    );
  } else {
    content = (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-white">Unknown phase: {phase}</p>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="relative min-h-screen bg-linear-to-br from-slate-950 via-primary/60 via-slate-950 to-primary/30"
    >
      {/* Radial gradient overlay for more vibrancy */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 0% 0%, oklch(var(--primary) / 0.4) 0%, transparent 60%)',
        }}
      />
      {content}
      {/* Only render buttons when not in idle phase */}
      {!isIdlePhase && (
        /* biome-ignore lint/a11y/noStaticElementInteractions: Container div with pointer-events-none, actual interactions are on child elements */
        <div
          className={`fixed top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none transition-opacity duration-500 ${
            buttonsVisible ? 'opacity-100' : 'opacity-0'
          }`}
          onMouseEnter={() => {
            setIsHovering(true);
            setButtonsVisible(true);
            // Clear any pending fade timeout when hovering
            if (fadeTimeoutRef.current) {
              clearTimeout(fadeTimeoutRef.current);
              fadeTimeoutRef.current = null;
            }
          }}
          onMouseLeave={() => {
            setIsHovering(false);
            // For podium phases, hide immediately on mouse leave
            // For other phases, start fade timer after mouse leaves
            if (isPodiumPhase) {
              setButtonsVisible(false);
            } else {
              if (fadeTimeoutRef.current) {
                clearTimeout(fadeTimeoutRef.current);
              }
              fadeTimeoutRef.current = setTimeout(() => {
                setButtonsVisible(false);
              }, 5000);
            }
          }}
        >
          <div className="pointer-events-auto">
            <BackButton hackathonId={hackathonId} />
          </div>
          <div className="pointer-events-auto">
            <FullscreenToggle isFullscreen={isFullscreen} onToggle={handleToggleFullscreen} />
          </div>
        </div>
      )}
    </div>
  );
}

interface BackButtonProps {
  hackathonId: Id<'hackathons'>;
}

function BackButton({ hackathonId }: BackButtonProps) {
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    void navigate({
      to: '/h/$id',
      params: { id: hackathonId },
    });
  }, [navigate, hackathonId]);

  return (
    <div className="pointer-events-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={handleBack}
        className="border-primary/70 bg-slate-800/50 text-primary/90 hover:bg-primary/20 hover:border-primary/60 hover:text-white font-medium"
      >
        <ArrowLeft className="h-3 w-3 mr-1.5" />
        Back
      </Button>
    </div>
  );
}

interface FullscreenToggleProps {
  isFullscreen: boolean;
  onToggle: () => void;
}

function FullscreenToggle({ isFullscreen, onToggle }: FullscreenToggleProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onToggle}
      className="border-primary/70 bg-slate-800/50 text-primary/90 hover:bg-primary/20 hover:border-primary/60 hover:text-white font-medium"
    >
      {isFullscreen ? (
        <>
          <Minimize className="h-3 w-3 mr-1.5" />
          Exit Fullscreen
        </>
      ) : (
        <>
          <Maximize className="h-3 w-3 mr-1.5" />
          Fullscreen
        </>
      )}
    </Button>
  );
}
