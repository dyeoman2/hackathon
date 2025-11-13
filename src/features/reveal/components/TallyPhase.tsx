import type { Id } from '@convex/_generated/dataModel';
import { Maximize } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';

interface RankedSubmission {
  _id: Id<'submissions'>;
  title: string;
  team: string;
  averageRating: number;
  ratingCount: number;
  emojiVotes: string[];
  rank: number;
}

interface TallyPhaseProps {
  submissions: RankedSubmission[];
  timeRemaining: number;
  isPresenter: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onStartTallying: () => Promise<void>;
}

const ROW_HEIGHT_PX = 96;
const MAX_EMOJI_PARTICLES = 150;
const EARLIEST_REVEAL_PROGRESS = 0.08;
const LATEST_REVEAL_PROGRESS = 0.75;
const REVEAL_PROGRESS_RANGE = LATEST_REVEAL_PROGRESS - EARLIEST_REVEAL_PROGRESS;
const MIN_VISIBLE_DURATION_MS = 2500;

interface EmojiParticle {
  key: string;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
  revealThreshold: number;
}

const PHASE_DURATION_MS = 10000; // 10 seconds

export function TallyPhase({
  submissions,
  timeRemaining,
  isPresenter,
  isFullscreen,
  onToggleFullscreen,
  onStartTallying,
}: TallyPhaseProps) {
  const [progress, setProgress] = useState(0);
  const randomOrderRef = useRef<Map<Id<'submissions'>, number>>(new Map());
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => a.rank - b.rank),
    [submissions],
  );

  // Check if tallying has started (startedAt is set, so timeRemaining is counting down)
  // If timeRemaining is at max (10000ms) or undefined, tallying hasn't started yet
  const hasStartedTallying = timeRemaining < PHASE_DURATION_MS * 0.95;
  const isInitialStart = !hasStartedTallying && isPresenter;

  // Ensure we have a randomized snapshot of the current submissions for the initial layout.
  useEffect(() => {
    if (sortedSubmissions.length === 0) {
      randomOrderRef.current = new Map();
      return;
    }

    const current = randomOrderRef.current;

    // If submissions changed (add/remove), rebuild the random map.
    const hasSameIds =
      current.size === sortedSubmissions.length &&
      sortedSubmissions.every((submission) => current.has(submission._id));

    if (!hasSameIds) {
      randomOrderRef.current = createRandomOrderMap(sortedSubmissions);
    }
  }, [sortedSubmissions]);

  // Calculate progress (0-1) based on time remaining - only if tallying has started
  useEffect(() => {
    if (!hasStartedTallying) {
      setProgress(0);
      return;
    }

    const totalDuration = 10000; // 10 seconds
    const elapsed = totalDuration - timeRemaining;
    const newProgress = Math.min(1, Math.max(0, elapsed / totalDuration));
    setProgress(newProgress);
  }, [timeRemaining, hasStartedTallying]);

  const easedProgress = progress ** 0.85;

  const emojiParticles = useMemo<EmojiParticle[]>(() => {
    const particles: EmojiParticle[] = [];
    submissions.forEach((submission, submissionIdx) => {
      submission.emojiVotes.forEach((emoji, voteIdx) => {
        const key = `${submission._id}-${voteIdx}`;
        const noise = hashStringToUnit(key);
        const horizontalNoise = hashStringToUnit(`${key}-x`);
        const delayNoise = hashStringToUnit(`${key}-delay`);
        const durationNoise = hashStringToUnit(`${key}-duration`);

        particles.push({
          key,
          emoji,
          left: 10 + ((submissionIdx * 7 + horizontalNoise * 80) % 80),
          delay: 200 + delayNoise * 800,
          duration: MIN_VISIBLE_DURATION_MS + durationNoise * 2000,
          revealThreshold: EARLIEST_REVEAL_PROGRESS + noise * REVEAL_PROGRESS_RANGE,
        });
      });
    });

    if (particles.length > MAX_EMOJI_PARTICLES) {
      return particles
        .sort((a, b) => a.revealThreshold - b.revealThreshold)
        .slice(0, MAX_EMOJI_PARTICLES);
    }

    return particles.sort((a, b) => a.revealThreshold - b.revealThreshold);
  }, [submissions]);

  const visibleEmojiParticles = useMemo(() => {
    // Don't show any emojis until tallying has started
    if (!hasStartedTallying || emojiParticles.length === 0) {
      return [];
    }

    const revealed = emojiParticles.filter((particle) => particle.revealThreshold <= easedProgress);

    if (revealed.length > 0) {
      return revealed;
    }

    // Always keep at least one particle so the scene doesn't feel empty at the very start.
    return emojiParticles.slice(0, 1);
  }, [emojiParticles, easedProgress, hasStartedTallying]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-6 relative overflow-hidden">
      {/* Floating Emoji Cloud */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-[9999]">
        {visibleEmojiParticles.map((particle) => (
          <div
            key={particle.key}
            className="absolute text-4xl animate-float-up"
            style={{
              left: `${particle.left}%`,
              bottom: '-50px',
              animationDelay: `${particle.delay}ms`,
              animationDuration: `${particle.duration}ms`,
              opacity: 0.8,
            }}
          >
            {particle.emoji}
          </div>
        ))}
      </div>

      {/* Initial Start Buttons */}
      {isInitialStart && isPresenter && (
        <div className="flex flex-col items-center gap-8 z-20 mb-8">
          <div className="text-center space-y-4 animate-fade-in">
            <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
              <span className="bg-linear-to-r from-purple-200 via-pink-200 to-purple-200 bg-clip-text text-transparent animate-gradient-shift">
                The Moment of Truth
              </span>
            </h1>
            <p className="text-xl md:text-2xl text-purple-200 font-medium">
              Ready to see who came out on top?
            </p>
            <p className="text-lg text-slate-300 font-light">
              {submissions.length} {submissions.length === 1 ? 'submission' : 'submissions'} await
              their fate
            </p>
          </div>
          <div className="flex gap-4">
            {!isFullscreen && (
              <Button
                onClick={onToggleFullscreen}
                variant="outline"
                size="lg"
                className="border-purple-400/70 bg-slate-800/50 text-purple-100 hover:bg-purple-500/20 hover:border-purple-400 hover:text-white font-medium px-8 py-6 text-lg"
              >
                <Maximize className="h-5 w-5 mr-2" />
                Enter Fullscreen
              </Button>
            )}
            <Button
              onClick={onStartTallying}
              size="lg"
              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 text-lg font-semibold shadow-lg shadow-purple-500/50 border-2 border-purple-400/50"
            >
              Tally the Votes
            </Button>
          </div>
        </div>
      )}

      {/* Header - only show when tallying has started */}
      {hasStartedTallying && (
        <>
          <div className="text-center space-y-2 z-10">
            <h1 className="text-4xl font-bold text-white">Tallying Results...</h1>
            <p className="text-slate-300">Rankings are being calculated</p>
          </div>

          {/* Progress Bar */}
          <div className="w-full max-w-md z-10">
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-purple-500 to-pink-500 transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="text-center text-sm text-slate-400 mt-2">
              {Math.ceil(timeRemaining / 1000)} seconds remaining
            </p>
          </div>
        </>
      )}

      {/* Submissions Sorting Animation */}
      <div className="w-full max-w-5xl space-y-3 z-10">
        <div
          className="grid grid-cols-1 gap-3 max-h-[500px] overflow-y-auto transition-all duration-1000"
          style={{
            // Keep a constant blur so the final order stays hidden until reveal
            filter: 'blur(4px)',
            opacity: 1 - progress * 0.3,
          }}
        >
          {sortedSubmissions.map((submission, index) => {
            const initialIndex = randomOrderRef.current.get(submission._id) ?? index;
            const displacement = (initialIndex - index) * ROW_HEIGHT_PX * (1 - easedProgress);
            return (
              <div
                key={submission._id}
                className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-lg p-4 transition-transform duration-700 ease-out will-change-transform"
                style={{ transform: `translateY(${displacement}px)` }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 font-mono text-sm flex-shrink-0">
                      ?
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-semibold text-white truncate">
                        {submission.title}
                      </h3>
                      <p className="text-sm text-slate-400">{submission.team}</p>
                    </div>
                  </div>

                  {/* Loading spinner for score */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-slate-500 text-sm">Tallying...</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom animation styles */}
      <style>{`
        @keyframes float-up {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 0;
          }
          10% {
            opacity: 0.8;
          }
          90% {
            opacity: 0.8;
          }
          100% {
            transform: translateY(-100vh) rotate(360deg);
            opacity: 0;
          }
        }
        .animate-float-up {
          animation: float-up 3s ease-out forwards;
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
      `}</style>
    </div>
  );
}

function createRandomOrderMap(submissions: RankedSubmission[]) {
  const shuffled = [...submissions];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const map = new Map<Id<'submissions'>, number>();
  shuffled.forEach((submission, index) => {
    map.set(submission._id, index);
  });
  return map;
}

function hashStringToUnit(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 1664525 + input.charCodeAt(i) + 1013904223) >>> 0;
  }
  return hash / 0xffffffff;
}
