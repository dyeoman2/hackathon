import type { Id } from '@convex/_generated/dataModel';
import { Badge } from '~/components/ui/badge';

interface RankedSubmission {
  _id: Id<'submissions'>;
  title: string;
  team: string;
  averageRating: number;
  ratingCount: number;
  emojiVotes: string[];
  rank: number;
}

interface CountdownPhaseProps {
  submissions: RankedSubmission[];
  timeRemaining: number;
  isPresenter: boolean;
}

export function CountdownPhase({ submissions, timeRemaining, isPresenter }: CountdownPhaseProps) {
  const secondsRemaining = Math.ceil(timeRemaining / 1000);

  // Shuffle submissions for display (using index as seed for consistent shuffle per render)
  const displaySubmissions = [...submissions].sort(() => Math.random() - 0.5);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold text-white">Get Ready!</h1>
        <p className="text-slate-300">Final results will be revealed soon</p>
      </div>

      {/* Countdown Timer */}
      <div className="flex flex-col items-center space-y-4">
        <div className="relative">
          <div
            className="text-8xl font-bold text-white transition-all duration-300 animate-pulse"
            style={{
              textShadow: '0 0 40px rgba(168, 85, 247, 0.4)',
            }}
          >
            {secondsRemaining}
          </div>
        </div>
        <p className="text-lg text-slate-400">seconds</p>
      </div>

      {/* Submissions Preview - Unordered */}
      <div className="w-full max-w-5xl space-y-3">
        <div className="text-center space-y-1 mb-6">
          <h2 className="text-2xl font-semibold text-white">
            {submissions.length} {submissions.length === 1 ? 'Submission' : 'Submissions'}
          </h2>
          <p className="text-sm text-slate-400">Rankings not final</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto">
          {displaySubmissions.map((submission) => (
            <div
              key={submission._id}
              className="bg-slate-900/50 backdrop-blur-sm border border-slate-800 rounded-lg p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-semibold text-white truncate">{submission.title}</h3>
                  <p className="text-sm text-slate-400">{submission.team}</p>
                </div>
                {submission.ratingCount > 0 && (
                  <Badge variant="secondary" className="flex-shrink-0">
                    {submission.ratingCount} {submission.ratingCount === 1 ? 'rating' : 'ratings'}
                  </Badge>
                )}
              </div>

              {/* Emoji Preview */}
              {submission.emojiVotes.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {submission.emojiVotes.slice(0, 10).map((emoji) => (
                    <span key={emoji} className="text-lg">
                      {emoji}
                    </span>
                  ))}
                  {submission.emojiVotes.length > 10 && (
                    <span className="text-xs text-slate-500">
                      +{submission.emojiVotes.length - 10} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Presenter Note */}
      {isPresenter && (
        <div className="fixed bottom-4 right-4 bg-purple-900/80 backdrop-blur-sm border border-purple-700 rounded-lg p-3">
          <p className="text-xs text-purple-200">
            Presenter view • Auto-advancing to tally in {secondsRemaining}s
          </p>
        </div>
      )}
    </div>
  );
}
