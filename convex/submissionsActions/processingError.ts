'use node';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { ActionCtx } from '../_generated/server';

const MAX_ERROR_LENGTH = 750;

/**
 * Best-effort helper to mark a submission's processing state as errored.
 * Tries the full source updater first, then falls back to a minimal patch
 * if the primary mutation rejects (e.g., due to transient schema/type drift).
 */
export async function markProcessingErrorWithFallback(
  ctx: ActionCtx,
  submissionId: Id<'submissions'>,
  errorMessage: string,
  nextState:
    | 'error'
    | 'downloading'
    | 'uploading'
    | 'indexing'
    | 'generating'
    | 'complete' = 'error',
) {
  const normalizedError = errorMessage.slice(0, MAX_ERROR_LENGTH);

  try {
    await ctx.runMutation(internal.submissions.updateSubmissionSourceInternal, {
      submissionId,
      processingState: nextState,
      processingError: normalizedError,
    });
    return;
  } catch (primaryError) {
    console.error('[SubmissionProcessing] Failed primary error update', {
      submissionId,
      error: primaryError instanceof Error ? primaryError.message : String(primaryError),
    });
  }

  try {
    await ctx.runMutation(internal.submissions.markProcessingErrorInternal, {
      submissionId,
      processingState: nextState,
      processingError: normalizedError,
    });
  } catch (fallbackError) {
    console.error('[SubmissionProcessing] Failed fallback error update', {
      submissionId,
      error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    });
  }
}
