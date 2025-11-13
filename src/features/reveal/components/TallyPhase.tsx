import type { Id } from '@convex/_generated/dataModel';
import { useEffect, useMemo, useRef, useState } from 'react';

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

export function TallyPhase({ submissions, timeRemaining, isPresenter }: TallyPhaseProps) {
  const [progress, setProgress] = useState(0);
  const randomOrderRef = useRef<Map<Id<'submissions'>, number>>(new Map());
  const sortedSubmissions = useMemo(
    () => [...submissions].sort((a, b) => a.rank - b.rank),
    [submissions],
  );

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

  // Calculate progress (0-1) based on time remaining
  useEffect(() => {
    const totalDuration = 10000; // 10 seconds
    const elapsed = totalDuration - timeRemaining;
    const newProgress = Math.min(1, Math.max(0, elapsed / totalDuration));
    setProgress(newProgress);
  }, [timeRemaining]);

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
    if (emojiParticles.length === 0) {
      return [];
    }

    const revealed = emojiParticles.filter((particle) => particle.revealThreshold <= easedProgress);

    if (revealed.length > 0) {
      return revealed;
    }

    // Always keep at least one particle so the scene doesn't feel empty at the very start.
    return emojiParticles.slice(0, 1);
  }, [emojiParticles, easedProgress]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-6 relative overflow-hidden">
      {/* Floating Emoji Cloud */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
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

      {/* Header */}
      <div className="text-center space-y-2 z-10">
        <h1 className="text-4xl font-bold text-white">Tallying Results...</h1>
        <p className="text-slate-300">Rankings are being calculated</p>
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-md z-10">
        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-300"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        <p className="text-center text-sm text-slate-400 mt-2">
          {Math.ceil(timeRemaining / 1000)} seconds remaining
        </p>
      </div>

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
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-slate-500 text-sm">Tallying...</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Presenter Note */}
      {isPresenter && (
        <div className="fixed bottom-4 right-4 bg-purple-900/80 backdrop-blur-sm border border-purple-700 rounded-lg p-3 z-20">
          <p className="text-xs text-purple-200">
            Presenter view • Auto-advancing to podium in {Math.ceil(timeRemaining / 1000)}s
          </p>
        </div>
      )}

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
