import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ChevronDown, Maximize, Minimize } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';

interface PresenterControlsProps {
  phase: string;
  hackathonId: Id<'hackathons'>;
  onRestart: () => Promise<void>;
  onAdvance?: () => Promise<void>;
  onGoBack?: () => Promise<void>;
  isRestarting: boolean;
  isAdvancing?: boolean;
  isGoingBack?: boolean;
  canAdvance?: boolean;
  canGoBack?: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function PresenterControls({
  phase,
  hackathonId,
  onRestart,
  onAdvance,
  onGoBack,
  isRestarting,
  isAdvancing,
  isGoingBack,
  canAdvance,
  canGoBack,
  isFullscreen,
  onToggleFullscreen,
}: PresenterControlsProps) {
  // In tally phase, show expanded by default; otherwise show collapsed
  const [isCollapsed, setIsCollapsed] = useState(phase !== 'tally');
  const navigate = useNavigate();
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPhaseRef = useRef(phase);
  const manuallyExpandedRef = useRef(false);

  // Reset collapse state when phase changes
  useEffect(() => {
    if (previousPhaseRef.current !== phase) {
      previousPhaseRef.current = phase;
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      // In tally phase, show expanded; otherwise show collapsed
      setIsCollapsed(phase !== 'tally');
      // Reset manual expansion flag on phase change
      manuallyExpandedRef.current = false;
    }
  }, [phase]);

  // Auto-collapse after 5 seconds, but only if not manually expanded
  useEffect(() => {
    if (isCollapsed) return;
    if (manuallyExpandedRef.current) return; // Don't auto-collapse if manually expanded

    // Clear any existing timeout
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
    }

    // Set new timeout
    collapseTimeoutRef.current = setTimeout(() => {
      setIsCollapsed(true);
    }, 5000);

    return () => {
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
      }
    };
  }, [isCollapsed]);

  const handleExpand = () => {
    setIsCollapsed(false);
    manuallyExpandedRef.current = true; // Mark as manually expanded
    // Clear timer when manually expanded
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const handleCollapse = () => {
    setIsCollapsed(true);
  };

  // Mark as manually expanded and clear timer when any button is clicked
  const markManuallyExpanded = () => {
    manuallyExpandedRef.current = true;
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  };

  const handleBackToHackathon = () => {
    markManuallyExpanded();
    void navigate({
      to: '/h/$id',
      params: { id: hackathonId },
    });
  };

  const handleToggleFullscreen = () => {
    markManuallyExpanded();
    onToggleFullscreen();
  };

  const handleGoBack = () => {
    if (!onGoBack || !canGoBack || isGoingBack) return;
    markManuallyExpanded();
    void onGoBack();
  };

  const handleAdvance = () => {
    if (!onAdvance || !canAdvance || isAdvancing) return;
    markManuallyExpanded();
    void onAdvance();
  };

  const handleRestart = () => {
    if (isRestarting) return;
    markManuallyExpanded();
    void onRestart();
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="fixed bottom-6 right-6 w-14 h-14 bg-slate-900/95 backdrop-blur-sm border-2 border-primary/50 rounded-full z-50 shadow-2xl shadow-primary/20 flex items-center justify-center hover:bg-slate-800/95 transition-all duration-200 group"
        aria-label="Show presenter controls"
      >
        <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
        <div className="absolute inset-0 rounded-full bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 bg-slate-900/95 backdrop-blur-sm border-2 border-primary/50 rounded-lg p-4 space-y-3 z-50 shadow-2xl shadow-primary/20 min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <p className="text-xs font-semibold text-primary/90 uppercase tracking-wide">
            Presenter Controls
          </p>
        </div>
        <button
          type="button"
          onClick={handleCollapse}
          className="p-1 rounded hover:bg-slate-800/50 transition-colors"
          aria-label="Hide presenter controls"
        >
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      {/* Phase indicator */}
      <div className="text-xs text-slate-400 pb-2 border-b border-slate-700">
        Current: <span className="text-white font-mono">{phase}</span>
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleBackToHackathon}
          variant="outline"
          className="flex-1 border-primary/70 bg-slate-800/50 text-primary/90 hover:bg-primary/20 hover:border-primary/60 hover:text-white font-medium"
          size="sm"
        >
          <ArrowLeft className="h-3 w-3 mr-1.5" />
          Hackathon
        </Button>
        <Button
          onClick={handleToggleFullscreen}
          variant="outline"
          className="flex-1 border-primary/70 bg-slate-800/50 text-primary/90 hover:bg-primary/20 hover:border-primary/60 hover:text-white font-medium"
          size="sm"
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
      </div>

      {/* Back button (always visible, disabled when can't go back) */}
      {onGoBack && (
        <Button
          onClick={handleGoBack}
          disabled={!canGoBack || isGoingBack}
          variant="outline"
          className={`w-full ${
            canGoBack
              ? 'border-primary/60 text-primary/80 hover:bg-primary/20 hover:border-primary/70'
              : 'border-slate-600/30 text-slate-500 cursor-not-allowed opacity-50'
          }`}
          size="sm"
        >
          {isGoingBack ? 'Going back...' : 'Back'}
        </Button>
      )}

      {/* Advance button (if applicable) */}
      {canAdvance && onAdvance && (
        <Button
          onClick={handleAdvance}
          disabled={isAdvancing}
          className="w-full bg-primary hover:bg-primary/90"
          size="sm"
        >
          {isAdvancing ? 'Advancing...' : 'Next'}
        </Button>
      )}

      {/* Restart button (always available) */}
      <Button
        onClick={handleRestart}
        disabled={isRestarting}
        variant="outline"
        className="w-full"
        size="sm"
      >
        {isRestarting ? 'Restarting...' : 'Restart Reveal'}
      </Button>
    </div>
  );
}
