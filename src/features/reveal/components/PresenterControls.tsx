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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const navigate = useNavigate();
  const collapseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousPhaseRef = useRef(phase);

  // Reset collapse timer when phase changes
  useEffect(() => {
    if (previousPhaseRef.current !== phase) {
      previousPhaseRef.current = phase;
      if (collapseTimeoutRef.current) {
        clearTimeout(collapseTimeoutRef.current);
        collapseTimeoutRef.current = null;
      }
      setIsCollapsed(false);
    }
  }, [phase]);

  // Auto-collapse after 5 seconds
  useEffect(() => {
    if (isCollapsed) return;

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
    // Reset timer when manually expanded
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
    }
  };

  const handleCollapse = () => {
    setIsCollapsed(true);
  };

  const handleBackToHackathon = () => {
    void navigate({
      to: '/app/h/$id',
      params: { id: hackathonId },
    });
  };

  if (isCollapsed) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="fixed bottom-6 right-6 w-14 h-14 bg-slate-900/95 backdrop-blur-sm border-2 border-purple-500/50 rounded-full z-50 shadow-2xl shadow-purple-500/20 flex items-center justify-center hover:bg-slate-800/95 transition-all duration-200 group"
        aria-label="Show presenter controls"
      >
        <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
        <div className="absolute inset-0 rounded-full bg-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 bg-slate-900/95 backdrop-blur-sm border-2 border-purple-500/50 rounded-lg p-4 space-y-3 z-50 shadow-2xl shadow-purple-500/20 min-w-[200px]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
          <p className="text-xs font-semibold text-purple-300 uppercase tracking-wide">
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
          className="flex-1 border-purple-400/70 bg-slate-800/50 text-purple-100 hover:bg-purple-500/20 hover:border-purple-400 hover:text-white font-medium"
          size="sm"
        >
          <ArrowLeft className="h-3 w-3 mr-1.5" />
          Hackathon
        </Button>
        <Button
          onClick={onToggleFullscreen}
          variant="outline"
          className="flex-1 border-purple-400/70 bg-slate-800/50 text-purple-100 hover:bg-purple-500/20 hover:border-purple-400 hover:text-white font-medium"
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
          onClick={onGoBack}
          disabled={!canGoBack || isGoingBack}
          variant="outline"
          className={`w-full ${
            canGoBack
              ? 'border-purple-700/60 text-purple-400 hover:bg-purple-700/20 hover:border-purple-600'
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
          onClick={onAdvance}
          disabled={isAdvancing}
          className="w-full bg-purple-600 hover:bg-purple-700"
          size="sm"
        >
          {isAdvancing ? 'Advancing...' : 'Next'}
        </Button>
      )}

      {/* Restart button (always available) */}
      <Button
        onClick={onRestart}
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
