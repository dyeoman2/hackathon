import type { Id } from '@convex/_generated/dataModel';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { SiGithub } from 'react-icons/si';

interface RankedSubmission {
  _id: Id<'submissions'>;
  title: string;
  team: string;
  repoUrl: string;
  siteUrl?: string;
  screenshots?: Array<{
    url: string;
  }>;
  averageRating: number;
  ratingCount: number;
  emojiVotes: string[];
  rank: number;
}

type PodiumPhaseType = 'podiumReady' | 'reveal3rd' | 'reveal2nd' | 'reveal1st';

interface PodiumPhaseProps {
  hackathonId: Id<'hackathons'>;
  submissions: RankedSubmission[];
  phase: PodiumPhaseType;
  revealedRanks: number[];
  isPresenter: boolean;
  onReveal: () => Promise<void>;
}

export function PodiumPhase({
  hackathonId,
  submissions,
  phase,
  revealedRanks,
  isPresenter,
  onReveal,
}: PodiumPhaseProps) {
  const [celebratingRank, setCelebratingRank] = useState<number | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [otherSubmissionsRevealed, setOtherSubmissionsRevealed] = useState(false);
  const [showFieldReveal, setShowFieldReveal] = useState(false);
  const [animatingRank, setAnimatingRank] = useState<number | null>(null);
  const confettiDataRef = useRef<
    Array<{ id: string; left: number; delay: number; duration: number; color?: string }>
  >([]);
  const confettiTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const confettiCleanupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingConfettiRankRef = useRef<number | null>(null);

  // Get top 3 submissions
  const top3 = submissions.slice(0, 3);
  const first = top3[0];
  const second = top3[1];
  const third = top3[2];

  // Remaining submissions
  const remaining = submissions.slice(3);

  // Check what can be revealed next
  const canReveal3rd = phase === 'podiumReady' && !revealedRanks.includes(3);
  const canReveal2nd = phase === 'reveal3rd' && revealedRanks.includes(3);
  const canReveal1st = phase === 'reveal2nd' && revealedRanks.includes(2);
  const nextRank = canReveal3rd ? 3 : canReveal2nd ? 2 : canReveal1st ? 1 : null;
  const [highlightRank, setHighlightRank] = useState<number | null>(nextRank);
  const previousNextRankRef = useRef<number | null>(nextRank);

  const handleReveal = async () => {
    // Determine which rank is being revealed - capture values at call time
    let rank: number | null = null;
    if (canReveal3rd) {
      rank = 3;
    } else if (canReveal2nd) {
      rank = 2;
    } else if (canReveal1st) {
      rank = 1;
    }

    if (rank) {
      // Store rank in ref to persist across re-renders
      pendingConfettiRankRef.current = rank;

      // Clear any existing confetti timeout
      if (confettiTimeoutRef.current) {
        clearTimeout(confettiTimeoutRef.current);
        confettiTimeoutRef.current = null;
      }

      // Generate confetti data once
      confettiDataRef.current = Array.from({ length: 50 }, (_, i) => ({
        id: `confetti-${rank}-${i}-${Date.now()}`,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 4 + Math.random() * 2,
      }));
      // Set celebrating rank to show message, start podium animation
      setCelebratingRank(rank);
      setAnimatingRank(rank);
      // Delay confetti start to allow message to appear first
      setShowConfetti(false);
      // Store rank in a closure to ensure it's available when timeout fires
      const rankForConfetti = rank;
      const confettiDataSnapshot = [...confettiDataRef.current]; // Snapshot confetti data
      confettiTimeoutRef.current = setTimeout(() => {
        // Always use the closure value first, then fall back to ref
        // This ensures we always have the rank even if refs are cleared
        const storedRank = rankForConfetti ?? pendingConfettiRankRef.current;

        // Always restore confetti data from snapshot if needed
        if (confettiDataRef.current.length === 0 && confettiDataSnapshot.length > 0) {
          confettiDataRef.current = confettiDataSnapshot;
        }

        // Regenerate confetti data if somehow both are empty (shouldn't happen, but safety)
        if (confettiDataRef.current.length === 0 && storedRank !== null) {
          confettiDataRef.current = Array.from({ length: 50 }, (_, i) => ({
            id: `confetti-${storedRank}-${i}-${Date.now()}`,
            left: Math.random() * 100,
            delay: Math.random() * 0.5,
            duration: 4 + Math.random() * 2,
          }));
        }

        // Always show confetti if we have a rank
        if (storedRank !== null) {
          // Clear any existing cleanup timeout
          if (confettiCleanupTimeoutRef.current) {
            clearTimeout(confettiCleanupTimeoutRef.current);
            confettiCleanupTimeoutRef.current = null;
          }

          // Update refs to ensure consistency
          pendingConfettiRankRef.current = storedRank;
          setCelebratingRank(storedRank);
          setShowConfetti(true);

          // Set cleanup timeout from when confetti actually starts showing
          // Confetti max duration is 6s, max particle delay is 0.5s
          // So wait 7000ms from when confetti starts showing
          confettiCleanupTimeoutRef.current = setTimeout(() => {
            setCelebratingRank(null);
            setShowConfetti(false);
            setAnimatingRank(null);
            confettiDataRef.current = [];
            pendingConfettiRankRef.current = null;
            confettiCleanupTimeoutRef.current = null;
          }, 7000); // Wait for all confetti particles to finish (6.5s max duration)
        }
        confettiTimeoutRef.current = null;
      }, 800); // 800ms delay to let message appear first
    }

    await onReveal();
  };

  const handleRevealField = () => {
    // Generate confetti for "The Field" reveal - paper confetti pieces with random colors
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#FFA07A',
      '#98D8C8',
      '#F7DC6F',
      '#BB8FCE',
      '#85C1E2',
    ];
    confettiDataRef.current = Array.from({ length: 50 }, (_, i) => {
      return {
        id: `confetti-field-${i}-${Date.now()}`,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 4 + Math.random() * 2,
        color: colors[Math.floor(Math.random() * colors.length)],
        xDrift: Math.random() * 200 - 100,
        initialRotation: Math.random() * 360,
      };
    });
    // Use a special value (0) to indicate field reveal
    setCelebratingRank(0);
    setShowConfetti(false);
    setTimeout(() => {
      setShowConfetti(true);
    }, 800); // 800ms delay to let reveal happen first

    setOtherSubmissionsRevealed(true);

    // Clear celebration after animation
    setTimeout(() => {
      setCelebratingRank(null);
      setShowConfetti(false);
      confettiDataRef.current = [];
    }, 6000);
  };

  const isRevealed = (rank: number) => revealedRanks.includes(rank);

  // Cleanup confetti timeouts on unmount
  useEffect(() => {
    return () => {
      if (confettiTimeoutRef.current) {
        clearTimeout(confettiTimeoutRef.current);
        confettiTimeoutRef.current = null;
      }
      if (confettiCleanupTimeoutRef.current) {
        clearTimeout(confettiCleanupTimeoutRef.current);
        confettiCleanupTimeoutRef.current = null;
      }
    };
  }, []);

  // Ensure confetti shows if we have a pending rank but state was reset
  // This is a safety net for when state gets cleared unexpectedly
  // IMPORTANT: Only runs when confetti is NOT currently showing to avoid interference
  useEffect(() => {
    // Don't interfere if confetti is currently showing or about to show
    if (showConfetti || celebratingRank !== null || confettiTimeoutRef.current) {
      return;
    }

    const hasPendingRank = pendingConfettiRankRef.current !== null;
    const hasConfettiData = confettiDataRef.current.length > 0;

    // Only restore if we're in a bad state (pending rank but no state/timeout)
    if (hasPendingRank) {
      const storedRank = pendingConfettiRankRef.current;

      // Regenerate confetti data if it was cleared
      if (!hasConfettiData && storedRank !== null) {
        confettiDataRef.current = Array.from({ length: 50 }, (_, i) => ({
          id: `confetti-${storedRank}-${i}-${Date.now()}`,
          left: Math.random() * 100,
          delay: Math.random() * 0.5,
          duration: 4 + Math.random() * 2,
        }));
      }

      // If we have a pending rank but state was cleared, restore it
      if (storedRank !== null && confettiDataRef.current.length > 0) {
        setCelebratingRank(storedRank);
        setAnimatingRank(storedRank);
        // Restart confetti timeout
        setShowConfetti(false);
        confettiTimeoutRef.current = setTimeout(() => {
          // Always show confetti if we still have the rank
          if (pendingConfettiRankRef.current === storedRank && confettiDataRef.current.length > 0) {
            setCelebratingRank(storedRank);
            setShowConfetti(true);

            // Set cleanup timeout from when confetti starts showing
            // Clear any existing cleanup timeout first
            if (confettiCleanupTimeoutRef.current) {
              clearTimeout(confettiCleanupTimeoutRef.current);
            }
            confettiCleanupTimeoutRef.current = setTimeout(() => {
              setCelebratingRank(null);
              setShowConfetti(false);
              setAnimatingRank(null);
              confettiDataRef.current = [];
              pendingConfettiRankRef.current = null;
              confettiCleanupTimeoutRef.current = null;
            }, 7000);
          }
          confettiTimeoutRef.current = null;
        }, 800);
      }
    }
  }, [celebratingRank, showConfetti]);

  useEffect(() => {
    if (!revealedRanks.includes(1)) {
      setOtherSubmissionsRevealed(false);
      setShowFieldReveal(false);
    } else {
      // When 1st place is revealed, wait for confetti to finish before showing "Tap to Reveal"
      setShowFieldReveal(false);
      const timeout = setTimeout(() => {
        setShowFieldReveal(true);
      }, 6000); // Same timing as podium reveals - wait for confetti to finish

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [revealedRanks]);

  useEffect(() => {
    if (nextRank === null) {
      previousNextRankRef.current = null;
      setHighlightRank(null);
      return;
    }

    if (previousNextRankRef.current === null) {
      previousNextRankRef.current = nextRank;
      setHighlightRank(nextRank);
      return;
    }

    previousNextRankRef.current = nextRank;
    // For podiumReady phase, highlight immediately. For reveal phases, wait for confetti to finish.
    if (phase === 'podiumReady') {
      setHighlightRank(nextRank);
      return;
    } else {
      setHighlightRank(null);
      // Confetti starts at 800ms delay, max duration is 6s, max particle delay is 0.5s
      // So confetti finishes at: 800ms + 500ms + 6000ms = 7300ms
      // Use 6000ms to appear sooner (confetti visually finishes earlier as particles fade out)
      const timeout = setTimeout(() => {
        setHighlightRank(nextRank);
      }, 5000);

      return () => {
        clearTimeout(timeout);
      };
    }
  }, [nextRank, phase]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-6 relative overflow-hidden">
      {/* Confetti animation */}
      {showConfetti && celebratingRank !== null && confettiDataRef.current.length > 0 && (
        <div className="fixed inset-0 pointer-events-none z-50">
          {confettiDataRef.current.map((data) => {
            // For "The Field" reveal (celebratingRank === 0), use paper confetti pieces
            if (celebratingRank === 0) {
              const xDrift = (data as typeof data & { xDrift?: number }).xDrift ?? 0;
              const initialRotation =
                (data as typeof data & { initialRotation?: number }).initialRotation ?? 0;
              return (
                <div
                  key={data.id}
                  className="absolute animate-confetti-paper"
                  style={
                    {
                      left: `${data.left}%`,
                      top: '-20px',
                      animationDelay: `${data.delay}s`,
                      animationDuration: `${data.duration}s`,
                      backgroundColor: data.color,
                      width: '8px',
                      height: '8px',
                      '--x-drift': `${xDrift}px`,
                      '--initial-rotation': `${initialRotation}deg`,
                    } as React.CSSProperties & {
                      '--x-drift': string;
                      '--initial-rotation': string;
                    }
                  }
                />
              );
            }
            // For podium reveals, use medal emojis
            const medalEmoji = celebratingRank === 1 ? '🥇' : celebratingRank === 2 ? '🥈' : '🥉';
            return (
              <div
                key={data.id}
                className="absolute text-2xl animate-confetti"
                style={{
                  left: `${data.left}%`,
                  top: '-20px',
                  animationDelay: `${data.delay}s`,
                  animationDuration: `${data.duration}s`,
                }}
              >
                {medalEmoji}
              </div>
            );
          })}
        </div>
      )}

      {/* Header */}
      <div className="text-center space-y-3 pt-6 pb-2 z-10 px-4">
        {phase === 'podiumReady' && (
          <>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in">
              <span className="bg-linear-to-r from-purple-200 via-pink-200 to-purple-200 bg-clip-text text-transparent animate-gradient-shift">
                Are you ready for the results?
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-purple-200 font-medium animate-fade-in-delay">
              The moment of truth awaits...
            </p>
          </>
        )}
        {phase === 'reveal3rd' && !otherSubmissionsRevealed && (
          <>
            <p className="text-lg md:text-xl font-semibold text-purple-300 uppercase tracking-wide animate-fade-in">
              Congrats
            </p>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in leading-[1.2]">
              <span className="inline-flex items-center gap-3">
                <span className="text-5xl">🥉</span>
                <span className="bg-linear-to-r from-[#CD7F32] to-[#D4A574] bg-clip-text text-transparent">
                  {third?.title}
                </span>
                <span className="text-4xl animate-pulse">🎉</span>
              </span>
            </h1>
            <p className="text-base md:text-lg font-medium text-slate-300 uppercase tracking-wide animate-fade-in-delay">
              on {getOrdinalLabel(3)} Place
            </p>
          </>
        )}
        {phase === 'reveal2nd' && !otherSubmissionsRevealed && (
          <>
            <p className="text-lg md:text-xl font-semibold text-purple-300 uppercase tracking-wide animate-fade-in">
              Congrats
            </p>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in leading-[1.2]">
              <span className="inline-flex items-center gap-3">
                <span className="text-5xl">🥈</span>
                <span className="bg-linear-to-r from-[#C0C0C0] to-[#E8E8E8] bg-clip-text text-transparent">
                  {second?.title}
                </span>
                <span className="text-4xl animate-pulse">🎉</span>
              </span>
            </h1>
            <p className="text-base md:text-lg font-medium text-slate-300 uppercase tracking-wide animate-fade-in-delay">
              on {getOrdinalLabel(2)} Place
            </p>
          </>
        )}
        {phase === 'reveal1st' && !otherSubmissionsRevealed && (
          <>
            <p className="text-lg md:text-xl font-semibold text-purple-300 uppercase tracking-wide animate-fade-in">
              Congrats
            </p>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in leading-[1.2]">
              <span className="inline-flex items-center gap-3">
                <span className="text-6xl">🥇</span>
                <span className="bg-linear-to-r from-[#FFD700] via-[#FFA500] to-[#FFD700] bg-clip-text text-transparent animate-gradient-shift">
                  {first?.title}
                </span>
              </span>
            </h1>
            <p className="text-base md:text-lg font-medium text-slate-300 uppercase tracking-wide animate-fade-in-delay">
              on {getOrdinalLabel(1)} Place
            </p>
          </>
        )}
        {otherSubmissionsRevealed && (
          <>
            <p className="text-lg md:text-xl font-semibold text-purple-300 uppercase tracking-wide animate-fade-in">
              Congratulations
            </p>
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] animate-fade-in leading-[1.2]">
              <span className="inline-flex items-center gap-3">
                <span className="text-6xl">🎉</span>
                <span className="bg-linear-to-r from-purple-200 via-pink-200 to-purple-200 bg-clip-text text-transparent animate-gradient-shift">
                  Everyone!
                </span>
                <span className="text-6xl">🎉</span>
              </span>
            </h1>
            <p className="text-base md:text-lg font-medium text-slate-300 uppercase tracking-wide animate-fade-in-delay">
              Thank you for participating
            </p>
          </>
        )}
      </div>

      {/* Podium */}
      <div className="flex items-end justify-center gap-6 z-10 w-full max-w-5xl">
        {/* 3rd Place - Left */}
        {third && (
          <div className="flex flex-col items-center flex-1 max-w-xs min-w-0">
            <PodiumSlot
              hackathonId={hackathonId}
              submission={third}
              rank={3}
              emoji="🥉"
              revealed={isRevealed(3)}
              canReveal={canReveal3rd}
              isPresenter={isPresenter}
              onReveal={handleReveal}
              isNext={highlightRank === 3}
            />
            <div className="w-full mt-3">
              <div
                className={`relative h-20 bg-linear-to-t from-[#CD7F32] via-[#B87333] to-[#A0522D] rounded-t-xl border-t-2 border-[#D4A574] shadow-[0_4px_8px_rgba(0,0,0,0.5),0_8px_16px_rgba(0,0,0,0.4),0_16px_32px_rgba(205,127,50,0.4),inset_0_2px_0_rgba(255,255,255,0.15)] overflow-hidden transition-all duration-700 ${
                  isRevealed(3) || animatingRank === 3 ? 'animate-podium-reveal scale-105' : ''
                }`}
              >
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-br from-transparent via-white/25 to-transparent pointer-events-none" />
                {/* Shine effect */}
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-r from-transparent via-white/10 to-transparent animate-shine pointer-events-none" />
                {/* Left edge */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-r from-[#8B4513]/90 to-transparent rounded-tl-xl pointer-events-none" />
                {/* Right edge */}
                <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-linear-to-l from-[#8B4513]/90 to-transparent rounded-tr-xl pointer-events-none" />
                {/* Stylized number */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-3xl md:text-4xl font-black text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8),0_0_20px_rgba(205,127,50,0.6)] tracking-tight">
                    3
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 1st Place - Center (Tallest) */}
        {first && (
          <div className="flex flex-col items-center flex-1 max-w-xs min-w-0">
            <PodiumSlot
              hackathonId={hackathonId}
              submission={first}
              rank={1}
              emoji="🥇"
              revealed={isRevealed(1)}
              canReveal={canReveal1st}
              isPresenter={isPresenter}
              onReveal={handleReveal}
              isNext={highlightRank === 1}
            />
            <div className="w-full mt-3">
              <div
                className={`relative h-28 bg-linear-to-t from-[#D4AF37] via-[#FFD700] to-[#FFA500] rounded-t-xl border-t-2 border-[#FFD700] shadow-[0_4px_8px_rgba(0,0,0,0.5),0_8px_16px_rgba(0,0,0,0.4),0_16px_32px_rgba(212,175,55,0.5),inset_0_2px_0_rgba(255,255,255,0.2)] overflow-hidden transition-all duration-700 ${
                  isRevealed(1) || animatingRank === 1 ? 'animate-podium-reveal scale-105' : ''
                }`}
              >
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-br from-transparent via-white/30 to-transparent pointer-events-none" />
                {/* Shine effect */}
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-r from-transparent via-white/15 to-transparent animate-shine pointer-events-none" />
                {/* Left edge */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-r from-[#B8860B]/90 to-transparent rounded-tl-xl pointer-events-none" />
                {/* Right edge */}
                <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-linear-to-l from-[#B8860B]/90 to-transparent rounded-tr-xl pointer-events-none" />
                {/* Stylized number */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-4xl md:text-5xl font-black bg-linear-to-b from-white via-yellow-100 to-yellow-200 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8),0_0_30px_rgba(255,215,0,0.8)] tracking-tight">
                    1
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2nd Place - Right */}
        {second && (
          <div className="flex flex-col items-center flex-1 max-w-xs min-w-0">
            <PodiumSlot
              hackathonId={hackathonId}
              submission={second}
              rank={2}
              emoji="🥈"
              revealed={isRevealed(2)}
              canReveal={canReveal2nd}
              isPresenter={isPresenter}
              onReveal={handleReveal}
              isNext={highlightRank === 2}
            />
            <div className="w-full mt-3">
              <div
                className={`relative h-24 bg-linear-to-t from-[#C0C0C0] via-[#D3D3D3] to-[#E8E8E8] rounded-t-xl border-t-2 border-[#E8E8E8] shadow-[0_4px_8px_rgba(0,0,0,0.5),0_8px_16px_rgba(0,0,0,0.4),0_16px_32px_rgba(192,192,192,0.4),inset_0_2px_0_rgba(255,255,255,0.15)] overflow-hidden transition-all duration-700 ${
                  isRevealed(2) || animatingRank === 2 ? 'animate-podium-reveal scale-105' : ''
                }`}
              >
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-br from-transparent via-white/25 to-transparent pointer-events-none" />
                {/* Shine effect */}
                <div className="absolute inset-0 rounded-t-xl bg-linear-to-r from-transparent via-white/12 to-transparent animate-shine pointer-events-none" />
                {/* Left edge */}
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-linear-to-r from-[#A9A9A9]/90 to-transparent rounded-tl-xl pointer-events-none" />
                {/* Right edge */}
                <div className="absolute right-0 top-0 bottom-0 w-1.5 bg-linear-to-l from-[#A9A9A9]/90 to-transparent rounded-tr-xl pointer-events-none" />
                {/* Stylized number */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-3xl md:text-4xl font-black bg-linear-to-b from-white via-gray-100 to-gray-200 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(0,0,0,0.8),0_0_20px_rgba(192,192,192,0.6)] tracking-tight">
                    2
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Remaining Submissions */}
      {remaining.length > 0 && (
        <div
          className={`w-full max-w-5xl space-y-4 z-10 rounded-2xl p-6 md:p-8 transition-all duration-700 ${
            isRevealed(1) && !otherSubmissionsRevealed && showFieldReveal
              ? 'border-2 border-purple-400 shadow-[0_0_40px_rgba(168,85,247,0.4)] animate-focus-glow bg-linear-to-br from-purple-950/30 to-slate-950/50'
              : 'bg-slate-950/30'
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h2
              className={`text-3xl font-extrabold text-white drop-shadow-lg transition-all duration-700 ${
                showFieldReveal
                  ? 'opacity-100 blur-0'
                  : 'opacity-30 blur-md pointer-events-none select-none'
              }`}
            >
              The Field
            </h2>
            {isRevealed(1) && !otherSubmissionsRevealed && showFieldReveal && (
              <button
                type="button"
                className="text-xs font-bold tracking-[0.3em] uppercase text-white border-2 border-purple-400/80 rounded-full px-6 py-2 bg-linear-to-r from-purple-600/90 to-pink-600/90 shadow-[0_0_20px_rgba(168,85,247,0.6)] hover:from-purple-500 hover:to-pink-500 hover:shadow-[0_0_30px_rgba(168,85,247,0.8)] transition-all duration-300 transform hover:scale-105 active:scale-95"
                onClick={handleRevealField}
              >
                Tap to Reveal
              </button>
            )}
          </div>
          <div
            className={`space-y-3 max-h-96 overflow-y-auto transition-all duration-700 ${
              !otherSubmissionsRevealed
                ? 'blur-md opacity-30 pointer-events-none select-none'
                : 'opacity-100'
            }`}
          >
            {remaining.map((submission, index) => (
              <div
                key={submission._id}
                className="bg-linear-to-r from-slate-900/90 to-slate-800/90 backdrop-blur-sm border border-slate-700/50 rounded-xl p-4 flex items-center gap-4 hover:border-purple-500/60 hover:shadow-[0_0_20px_rgba(168,85,247,0.2)] transition-all duration-300"
                style={{
                  animationDelay: `${index * 50}ms`,
                }}
              >
                {/* Rank */}
                <div className="shrink-0">
                  <div className="w-14 h-14 rounded-full bg-linear-to-br from-purple-600 via-pink-600 to-purple-700 flex items-center justify-center shadow-lg ring-2 ring-purple-500/30">
                    <span className="text-lg font-extrabold text-white">#{submission.rank}</span>
                  </div>
                </div>

                {/* Screenshot */}
                {submission.screenshots?.[0] && (
                  <div className="w-28 h-20 rounded-lg overflow-hidden bg-slate-800 shrink-0 ring-2 ring-slate-700/50">
                    <img
                      src={submission.screenshots[0].url}
                      alt={submission.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <a
                    href={`/app/h/${hackathonId}/submissions/${submission._id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <h3 className="text-lg font-bold text-white truncate hover:text-purple-300 transition-colors cursor-pointer">
                      {submission.title}
                    </h3>
                  </a>
                  <p className="text-sm text-slate-300 font-medium">{submission.team}</p>
                </div>

                {/* Action Icons and Score */}
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={submission.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-md bg-slate-800/50 hover:bg-slate-700/70 text-slate-300 hover:text-white transition-colors"
                    aria-label="View GitHub repository"
                  >
                    <SiGithub className="h-4 w-4" />
                  </a>
                  {submission.siteUrl && (
                    <a
                      href={submission.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded-md bg-slate-800/50 hover:bg-slate-700/70 text-slate-300 hover:text-white transition-colors"
                      aria-label="Launch live site"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Custom animation styles */}
      <style>{`
        @keyframes confetti {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti 5s ease-out forwards;
        }
        @keyframes confetti-paper {
          0% {
            transform: translateY(0) translateX(0) rotate(var(--initial-rotation, 0deg));
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) translateX(var(--x-drift, 0px)) rotate(calc(var(--initial-rotation, 0deg) + 720deg));
            opacity: 0;
          }
        }
        .animate-confetti-paper {
          animation: confetti-paper 5s ease-out forwards;
        }
        @keyframes subtle-bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-subtle-bounce {
          animation: subtle-bounce 0.6s ease-in-out 2;
        }
        @keyframes focus-glow {
          0% {
            box-shadow: 0 0 10px rgba(168, 85, 247, 0.15);
          }
          50% {
            box-shadow: 0 0 35px rgba(168, 85, 247, 0.5);
          }
          100% {
            box-shadow: 0 0 10px rgba(168, 85, 247, 0.15);
          }
        }
        .animate-focus-glow {
          animation: focus-glow 1.8s ease-in-out infinite;
        }
        @keyframes podium-reveal {
          0% {
            transform: scale(1);
            opacity: 0.8;
          }
          50% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-podium-reveal {
          animation: podium-reveal 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes fade-in {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.6s ease-out forwards;
        }
        @keyframes fade-in-delay {
          from {
            opacity: 0;
            transform: translateY(-5px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in-delay {
          animation: fade-in-delay 0.8s ease-out 0.3s both;
        }
        @keyframes gradient-shift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        .animate-gradient-shift {
          background-size: 200% 200%;
          animation: gradient-shift 3s ease infinite;
        }
        @keyframes shine {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        .animate-shine {
          animation: shine 3s ease-in-out infinite;
        }
        @keyframes scale-in {
          from {
            transform: scale(0);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
        .animate-scale-in {
          animation: scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        @keyframes slide-up {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-slide-up {
          animation: slide-up 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

function getOrdinalLabel(rank: number) {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

interface PodiumSlotProps {
  hackathonId: Id<'hackathons'>;
  submission: RankedSubmission;
  rank: number;
  emoji: string;
  revealed: boolean;
  canReveal: boolean;
  isPresenter: boolean;
  onReveal: () => void;
  isNext: boolean;
}

function PodiumSlot({
  hackathonId,
  submission,
  rank,
  emoji,
  revealed,
  canReveal,
  isPresenter,
  onReveal,
  isNext,
}: PodiumSlotProps) {
  const screenshot = submission.screenshots?.[0]?.url;
  const interactionEnabled = canReveal && isPresenter;
  const borderState = revealed
    ? 'border-purple-500 shadow-[0_0_40px_rgba(168,85,247,0.6),0_8px_32px_rgba(0,0,0,0.4)] ring-4 ring-purple-500/30'
    : isNext
      ? 'border-purple-400 shadow-[0_0_35px_rgba(147,51,234,0.45)] animate-focus-glow ring-2 ring-purple-400/20'
      : 'border-slate-700/50 shadow-lg shadow-black/20';
  const cardBase =
    'w-full flex flex-col bg-linear-to-b from-slate-900/95 to-slate-950/95 backdrop-blur-md border-2 rounded-xl overflow-hidden transition-all duration-700 ease-out';
  const CardComponent = interactionEnabled ? 'button' : 'div';
  const cardProps = interactionEnabled
    ? {
        type: 'button' as const,
        onClick: onReveal,
      }
    : {};

  return (
    <div className="flex flex-col items-center space-y-3 w-full">
      {/* Card */}
      <CardComponent
        className={`${cardBase} ${borderState} ${
          interactionEnabled
            ? 'cursor-pointer hover:border-purple-400'
            : 'cursor-default opacity-95'
        }`}
        {...cardProps}
      >
        {/* Screenshot or Placeholder */}
        <div className="relative flex-1 min-h-[160px] h-[160px] max-h-[160px] bg-linear-to-br from-slate-800 to-slate-900 overflow-hidden">
          {revealed && screenshot ? (
            <>
              <img
                src={screenshot}
                alt={submission.title}
                className="w-full h-full object-cover object-top transition-transform duration-700 hover:scale-105"
              />
              <div className="absolute inset-0 bg-linear-to-t from-black/60 via-transparent to-transparent pointer-events-none" />
              <div className="absolute top-2 right-2 text-4xl drop-shadow-lg animate-scale-in">
                {emoji}
              </div>
            </>
          ) : (
            <div
              className={`w-full h-full flex items-center justify-center transition-all duration-500 ${
                revealed
                  ? 'bg-linear-to-br from-purple-900/20 to-slate-900/80'
                  : 'backdrop-blur-xl bg-slate-800/90'
              }`}
            >
              {revealed && <span className="text-7xl">{emoji}</span>}
            </div>
          )}
          {isNext && !revealed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-linear-to-b from-purple-900/30 via-purple-900/10 to-transparent pointer-events-none">
              <span className="text-xs font-bold text-purple-100 tracking-[0.4em] uppercase drop-shadow-lg">
                NEXT
              </span>
              <span className="text-2xl font-extrabold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                {getOrdinalLabel(rank)} Place
              </span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (interactionEnabled) {
                    void onReveal();
                  }
                }}
                disabled={!interactionEnabled}
                className="pointer-events-auto text-xs font-bold tracking-[0.3em] uppercase text-white border-2 border-purple-400/80 rounded-full px-6 py-2.5 bg-linear-to-r from-purple-600/90 to-pink-600/90 shadow-[0_0_20px_rgba(168,85,247,0.6),inset_0_1px_0_rgba(255,255,255,0.2)] hover:from-purple-500 hover:to-pink-500 hover:shadow-[0_0_30px_rgba(168,85,247,0.8)] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-105 active:scale-95"
              >
                Tap to Reveal
              </button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-5 pt-5 pb-7 space-y-2 bg-linear-to-b from-slate-900/50 to-slate-950/80">
          {revealed ? (
            <div className="space-y-1.5 animate-slide-up">
              <a
                href={`/app/h/${hackathonId}/submissions/${submission._id}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="block"
              >
                <h3 className="text-xl font-extrabold text-white leading-[1.3] drop-shadow-sm hover:text-purple-300 transition-colors cursor-pointer">
                  {submission.title}
                </h3>
              </a>
              <p className="text-sm font-medium text-slate-300 leading-relaxed">
                {submission.team}
              </p>
              {/* Action Icons */}
              <div className="flex items-center gap-2 pt-1">
                <a
                  href={submission.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-md bg-slate-800/50 hover:bg-slate-700/70 text-slate-300 hover:text-white transition-colors"
                  aria-label="View GitHub repository"
                >
                  <SiGithub className="h-4 w-4" />
                </a>
                {submission.siteUrl && (
                  <a
                    href={submission.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-md bg-slate-800/50 hover:bg-slate-700/70 text-slate-300 hover:text-white transition-colors"
                    aria-label="Launch live site"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="h-6 bg-linear-to-r from-slate-700/50 to-slate-800/50 rounded animate-pulse" />
              <div className="h-4 bg-linear-to-r from-slate-700/50 to-slate-800/50 rounded w-2/3 animate-pulse" />
            </>
          )}
        </div>
      </CardComponent>
    </div>
  );
}
