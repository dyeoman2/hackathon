import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Slider } from '~/components/ui/slider';
import {
  queueSubmissionRatingSave,
  usePendingSubmissionRating,
} from '~/features/hackathons/hooks/useSubmissionRatingQueue';
import { cn } from '~/lib/utils';

const emojiScale = ['💀', '😬', '🥴', '🫠', '😅', '🙂', '🔥', '🚀', '🤯', '👑'];

interface SubmissionRatingSliderProps {
  submissionId: Id<'submissions'>;
  hackathonId: Id<'hackathons'>;
  hackathonRole?: 'owner' | 'admin' | 'judge' | null;
  className?: string;
}

export function SubmissionRatingSlider({
  submissionId,
  hackathonId,
  hackathonRole,
  className,
}: SubmissionRatingSliderProps) {
  // Fetch current user's rating
  const userRating = useQuery(api.submissions.getUserRating, { submissionId });
  // Fetch hackathon to check if voting is closed
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });

  // Get the current rating value (from server or default to 0)
  const currentRating = userRating?.rating ?? 0;

  const [displayValue, setDisplayValue] = useState(currentRating);
  const pendingState = usePendingSubmissionRating(submissionId);
  const pendingRating = pendingState?.rating ?? null;
  const isSaving = pendingState !== null;
  const isFlushing = pendingState?.isFlushing ?? false;
  const savingError = pendingState?.error;

  useEffect(() => {
    const nextValue = pendingRating ?? currentRating;
    setDisplayValue((prev) => (prev === nextValue ? prev : nextValue));
  }, [pendingRating, currentRating]);

  const handleValueChange = useCallback((values: number[]) => {
    setDisplayValue(values[0]);
  }, []);

  const handleValueCommit = useCallback(
    (values: number[]) => {
      const newValue = values[0];
      setDisplayValue(newValue);

      queueSubmissionRatingSave(submissionId, newValue).catch((error) => {
        console.error('Failed to save rating:', error);
      });
    },
    [submissionId],
  );

  const sliderValue = useMemo(() => [displayValue], [displayValue]);

  const getScoreDisplay = (val: number) => {
    if (val === 0) return 'Unranked';
    return `${emojiScale[val - 1]} ${val}/10`;
  };

  // Check if user can rate (owner, admin, or judge)
  const canRate =
    hackathonRole === 'owner' || hackathonRole === 'admin' || hackathonRole === 'judge';
  const isVotingClosed = hackathon?.votingClosedAt !== undefined;
  const isLoading = userRating === undefined || hackathon === undefined;
  const isDisabled = !canRate || isLoading || isVotingClosed;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>My Rating</CardTitle>
            <CardDescription>
              {isVotingClosed
                ? 'Voting has ended. No new ratings can be submitted.'
                : canRate
                  ? 'Rate this submission from 0 to 10.'
                  : 'Only owners, admins, and judges can rate submissions.'}
            </CardDescription>
          </div>
          <div className="text-right">
            <CardTitle className="text-right">
              {isLoading ? 'Loading...' : getScoreDisplay(displayValue)}
            </CardTitle>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="w-full space-y-2">
          <div className="relative space-y-4 pt-1">
            <Slider
              value={sliderValue}
              onValueChange={handleValueChange}
              onValueCommit={handleValueCommit}
              min={0}
              max={10}
              step={1}
              disabled={isDisabled}
              className="w-full"
            />

            {/* Emoji scale display - positioned to align with slider thumb */}
            <div className="relative w-full h-5 -mt-2">
              {/* 0 marker - thumb is size-4 (16px), so center starts at 8px from left */}
              <span
                className={cn(
                  'absolute text-xs transition-all',
                  displayValue === 0
                    ? 'text-primary font-medium scale-110'
                    : 'text-muted-foreground opacity-60',
                )}
                style={{ left: 'calc(0% + 8px)', transform: 'translateX(-50%)' }}
              >
                0
              </span>

              {/* Emoji markers 1-10 - calculate position accounting for 16px thumb width */}
              {emojiScale.map((emoji, index) => {
                const value = index + 1;
                const percentage = (value / 10) * 100;
                // Thumb center travels from 8px to calc(100% - 8px)
                // At 0%: 8px, at 100%: calc(100% - 8px)
                // Formula: calc(8px + percentage * (100% - 16px) / 100)
                const position = `calc(${percentage}% * (100% - 16px) / 100% + 8px)`;
                return (
                  <span
                    key={`scale-${emoji}`}
                    className={cn(
                      'absolute text-sm transition-all',
                      displayValue === value
                        ? 'text-base scale-110'
                        : 'text-muted-foreground opacity-60',
                    )}
                    style={{ left: position, transform: 'translateX(-50%)' }}
                  >
                    {emoji}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="min-h-5 text-xs">
            {savingError ? (
              <span className="text-destructive">Unable to save rating. Please try again.</span>
            ) : isSaving ? (
              <span className="text-muted-foreground">
                {isFlushing ? 'Saving rating...' : 'Waiting to sync rating...'}
              </span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
