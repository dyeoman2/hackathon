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
  hackathonTitle: string;
  revealState: RevealState;
  submissions: RankedSubmission[];
  isPresenter: boolean;
  revealSync: ReturnType<typeof useRevealSync>;
}

export function RevealStage({
  hackathonId,
  hackathonTitle,
  revealState,
  submissions,
  isPresenter,
  revealSync,
}: RevealStageProps) {
  const { phase } = revealSync;
  const stageRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, enterFullscreen, exitFullscreen } = useFullscreen(stageRef);
  const [buttonsVisible, setButtonsVisible] = useState(true);
  const fadeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPhaseRef = useRef(phase);
  let content: ReactNode;

  // Reset button visibility when phase changes
  useEffect(() => {
    if (previousPhaseRef.current !== phase) {
      previousPhaseRef.current = phase;
      setButtonsVisible(true);
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
        fadeTimeoutRef.current = null;
      }
    }
  }, [phase]);

  // Fade out buttons after 5 seconds
  useEffect(() => {
    if (!buttonsVisible) return;

    fadeTimeoutRef.current = setTimeout(() => {
      setButtonsVisible(false);
    }, 5000);

    return () => {
      if (fadeTimeoutRef.current) {
        clearTimeout(fadeTimeoutRef.current);
      }
    };
  }, [buttonsVisible]);

  // Show buttons when scrolling near top
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY || document.documentElement.scrollTop;
      // Show buttons if scrolled within 100px of top
      if (scrollY < 100) {
        setButtonsVisible(true);
        // Reset the fade timer
        if (fadeTimeoutRef.current) {
          clearTimeout(fadeTimeoutRef.current);
        }
        fadeTimeoutRef.current = setTimeout(() => {
          setButtonsVisible(false);
        }, 5000);
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (isFullscreen) {
      void exitFullscreen();
    } else {
      void enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  if (phase === 'idle') {
    content = (
      <div className="flex min-h-screen flex-col items-center justify-center space-y-8 p-8">
        <div className="text-center space-y-4">
          <h1 className="text-5xl font-bold text-white">{hackathonTitle}</h1>
          <p className="text-xl text-slate-300">Final Results Reveal</p>
        </div>

        {isPresenter ? (
          <div className="space-y-4 text-center">
            <Button
              size="lg"
              onClick={revealSync.startReveal}
              disabled={revealSync.isStarting}
              className="text-lg px-8 py-6 bg-purple-600 hover:bg-purple-700"
            >
              {revealSync.isStarting ? 'Starting...' : 'Start Reveal Sequence'}
            </Button>
            <p className="text-sm text-slate-400">Only you can see this button</p>
          </div>
        ) : (
          <div className="text-center space-y-2">
            <p className="text-slate-300">Waiting for presenter to start...</p>
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse delay-75" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse delay-150" />
            </div>
          </div>
        )}
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
      className="relative min-h-screen bg-linear-to-br from-slate-950 via-purple-950 to-slate-950"
    >
      {content}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Container div with pointer-events-none, actual interactions are on child elements */}
      <div
        className={`fixed top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-none transition-opacity duration-500 ${
          buttonsVisible ? 'opacity-100' : 'opacity-0 hover:opacity-100'
        }`}
        onMouseEnter={() => setButtonsVisible(true)}
        onMouseLeave={() => {
          // Don't immediately fade on mouse leave, wait 5 seconds
          if (fadeTimeoutRef.current) {
            clearTimeout(fadeTimeoutRef.current);
          }
          fadeTimeoutRef.current = setTimeout(() => {
            setButtonsVisible(false);
          }, 5000);
        }}
      >
        <div className="pointer-events-auto">
          <BackButton hackathonId={hackathonId} />
        </div>
        <div className="pointer-events-auto">
          <FullscreenToggle isFullscreen={isFullscreen} onToggle={handleToggleFullscreen} />
        </div>
      </div>
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
      to: '/app/h/$id',
      params: { id: hackathonId },
    });
  }, [navigate, hackathonId]);

  return (
    <div className="pointer-events-auto">
      <Button
        variant="outline"
        size="sm"
        onClick={handleBack}
        className="border-purple-400/70 bg-slate-800/50 text-purple-100 hover:bg-purple-500/20 hover:border-purple-400 hover:text-white font-medium"
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
      className="border-purple-400/70 bg-slate-800/50 text-purple-100 hover:bg-purple-500/20 hover:border-purple-400 hover:text-white font-medium"
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
