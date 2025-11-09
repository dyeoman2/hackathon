import type { Id } from '@convex/_generated/dataModel';
import { useState } from 'react';

interface UseAIReplyResult {
  review: () => Promise<void>;
  isReviewing: boolean;
  error: string | null;
  rateLimitRetryAfter: number | null;
}

export function useAIReply(submissionId: Id<'submissions'>): UseAIReplyResult {
  const [isReviewing, setIsReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitRetryAfter, setRateLimitRetryAfter] = useState<number | null>(null);

  const review = async () => {
    setIsReviewing(true);
    setError(null);
    setRateLimitRetryAfter(null);

    try {
      const response = await fetch('/app/api/ai/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sid: submissionId }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        if (errorData.code === 'RATE_LIMIT' && errorData.retryAfter) {
          setRateLimitRetryAfter(errorData.retryAfter);
        }
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let _buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        _buffer += decoder.decode(value, { stream: true });
        // TODO: Update UI with streaming tokens
        // For now, we'll just wait for completion
      }

      // Parse final JSON from buffer if present
      // The server should send JSON at the end
    } catch (err) {
      console.error('AI review error:', err);
      setError(err instanceof Error ? err.message : 'Failed to run AI review');
    } finally {
      setIsReviewing(false);
    }
  };

  return {
    review,
    isReviewing,
    error,
    rateLimitRetryAfter,
  };
}
