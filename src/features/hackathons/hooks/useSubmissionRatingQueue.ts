import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useSyncExternalStore } from 'react';
import { convexClient } from '~/lib/convexClient';

type PendingRatingEntry = Readonly<{
  rating: number;
  isFlushing: boolean;
  error?: string;
}>;

type SubmissionId = Id<'submissions'>;

const pendingRatings = new Map<SubmissionId, PendingRatingEntry>();
const listeners = new Set<() => void>();
const inflightFlushes = new Map<SubmissionId, Promise<void>>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  listeners.forEach((listener) => {
    listener();
  });
}

const getSnapshot = (submissionId: SubmissionId) => pendingRatings.get(submissionId) ?? null;

async function flushLoop(submissionId: SubmissionId) {
  while (true) {
    const entry = pendingRatings.get(submissionId);
    if (!entry) {
      return;
    }

    const valueToSend = entry.rating;
    pendingRatings.set(submissionId, {
      rating: valueToSend,
      isFlushing: true,
      error: undefined,
    });
    notify();

    try {
      await convexClient.mutation(api.submissions.upsertRating, {
        submissionId,
        rating: valueToSend,
      });
    } catch (error) {
      const latest = pendingRatings.get(submissionId);
      if (!latest) {
        return;
      }

      pendingRatings.set(submissionId, {
        ...latest,
        isFlushing: false,
        error: error instanceof Error ? error.message : 'Failed to save rating',
      });
      notify();
      return;
    }

    const latest = pendingRatings.get(submissionId);
    if (!latest) {
      // Mutation finished and entry was cleared elsewhere.
      return;
    }

    if (latest.rating === valueToSend) {
      pendingRatings.delete(submissionId);
      notify();
      return;
    }

    pendingRatings.set(submissionId, {
      ...latest,
      isFlushing: false,
    });
    notify();
    // Loop again to send the newest rating value.
  }
}

function ensureFlush(submissionId: SubmissionId) {
  const existing = inflightFlushes.get(submissionId);
  if (existing) {
    return existing;
  }

  const flushPromise = flushLoop(submissionId).finally(() => {
    inflightFlushes.delete(submissionId);
  });

  inflightFlushes.set(submissionId, flushPromise);
  return flushPromise;
}

export function queueSubmissionRatingSave(submissionId: SubmissionId, rating: number) {
  const current = pendingRatings.get(submissionId);
  pendingRatings.set(submissionId, {
    rating,
    isFlushing: current?.isFlushing ?? false,
    error: undefined,
  });
  notify();

  return ensureFlush(submissionId);
}

export function usePendingSubmissionRating(submissionId: SubmissionId) {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(submissionId),
    () => getSnapshot(submissionId),
  );
}

async function flushAllPendingSubmissionRatings() {
  await Promise.all([...pendingRatings.keys()].map((submissionId) => ensureFlush(submissionId)));
}

export async function flushPendingSubmissionRatingsWithTimeout(timeoutMs = 400) {
  const flushPromise = flushAllPendingSubmissionRatings();
  await Promise.race([
    flushPromise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
}

export function hasPendingSubmissionRatings() {
  return pendingRatings.size > 0 || inflightFlushes.size > 0;
}

export type { PendingRatingEntry as PendingSubmissionRatingState };

let pendingQueueListenersRegistered = false;

if (typeof window !== 'undefined' && !pendingQueueListenersRegistered) {
  pendingQueueListenersRegistered = true;

  const handleVisibilityChange = () => {
    if (document.hidden) {
      void flushAllPendingSubmissionRatings();
    }
  };

  const handlePageHide = () => {
    void flushAllPendingSubmissionRatings();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
}
