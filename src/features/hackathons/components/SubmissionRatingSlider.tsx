import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Slider } from '~/components/ui/slider';
import { cn } from '~/lib/utils';

const emojiScale = ['💀', '😬', '🥴', '🫠', '😅', '🙂', '🔥', '🚀', '🤯', '👑'];

interface SubmissionRatingSliderProps {
  submissionId: Id<'submissions'>;
  hackathonRole?: 'owner' | 'admin' | 'judge' | null;
  className?: string;
}

export function SubmissionRatingSlider({
  submissionId,
  hackathonRole,
  className,
}: SubmissionRatingSliderProps) {
  // Fetch current user's rating
  const userRating = useQuery(api.submissions.getUserRating, { submissionId });
  const upsertRating = useMutation(api.submissions.upsertRating);

  // Get the current rating value (from server or default to 0)
  const currentRating = userRating?.rating ?? 0;

  const [displayValue, setDisplayValue] = useState(currentRating);
  const [isSaving, setIsSaving] = useState(false);

  // Update display value when rating loads from server
  useEffect(() => {
    setDisplayValue(currentRating);
  }, [currentRating]);

  const handleValueChange = (values: number[]) => {
    // Update display value for immediate visual feedback during drag
    setDisplayValue(values[0]);
  };

  const handleValueCommit = async (values: number[]) => {
    // Commit the final value when drag completes
    const newValue = values[0];
    setDisplayValue(newValue);

    // Save to database
    setIsSaving(true);
    try {
      await upsertRating({ submissionId, rating: newValue });
    } catch (error) {
      console.error('Failed to save rating:', error);
      // Revert on error - force slider reset with key change
      setDisplayValue(currentRating);
    } finally {
      setIsSaving(false);
    }
  };

  const getScoreDisplay = (val: number) => {
    if (val === 0) return 'Unranked';
    return `${emojiScale[val - 1]} ${val}/10`;
  };

  // Check if user can rate (owner, admin, or judge)
  const canRate =
    hackathonRole === 'owner' || hackathonRole === 'admin' || hackathonRole === 'judge';
  const isLoading = userRating === undefined;
  const isDisabled = !canRate || isSaving || isLoading;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>My Rating</CardTitle>
            <CardDescription>
              {canRate
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
              key={`slider-${currentRating}`}
              defaultValue={[currentRating]}
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
        </div>
      </CardContent>
    </Card>
  );
}
