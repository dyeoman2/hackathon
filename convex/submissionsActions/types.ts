import type { FunctionReference } from 'convex/server';
import type { Id } from '../_generated/dataModel';

// Type definitions for internal function references (until Convex regenerates types)
export type GetSubmissionInternalRef = FunctionReference<
  'query',
  'internal',
  { submissionId: Id<'submissions'> },
  {
    _id: Id<'submissions'>;
    _creationTime: number;
    hackathonId: Id<'hackathons'>;
    title: string;
    team: string;
    repoUrl: string;
    siteUrl?: string;
    source?: {
      r2Key?: string;
      uploadedAt?: number;
      uploadStartedAt?: number;
      uploadCompletedAt?: number;
      aiSearchSyncStartedAt?: number;
      aiSearchSyncCompletedAt?: number;
      aiSearchSyncJobId?: string;
      aiSummary?: string;
      summarizedAt?: number;
      summaryGenerationStartedAt?: number;
      summaryGenerationCompletedAt?: number;
      readme?: string;
      readmeFilename?: string;
      readmeFetchedAt?: number;
      processingState?: 'downloading' | 'uploading' | 'indexing' | 'generating' | 'complete' | 'error';
    };
    ai?: {
      summary?: string;
      lastReviewedAt?: number;
      inFlight?: boolean;
      score?: number;
      scoreGenerationStartedAt?: number;
      scoreGenerationCompletedAt?: number;
    };
    screenshots?: Array<{
      r2Key: string;
      url: string;
      capturedAt: number;
    }>;
    createdAt: number;
    updatedAt: number;
  } | null
>;

export type UpdateSubmissionSourceInternalRef = FunctionReference<
  'mutation',
  'internal',
  {
    submissionId: Id<'submissions'>;
    r2Key?: string;
    uploadedAt?: number;
    uploadStartedAt?: number;
    uploadCompletedAt?: number;
    aiSearchSyncStartedAt?: number;
    aiSearchSyncCompletedAt?: number;
    aiSearchSyncJobId?: string;
    earlySummary?: string;
    aiSummary?: string;
    summarizedAt?: number;
    summaryGenerationStartedAt?: number;
    summaryGenerationCompletedAt?: number;
    screenshotCaptureStartedAt?: number;
    screenshotCaptureCompletedAt?: number;
    readme?: string;
    readmeFilename?: string;
    readmeFetchedAt?: number;
    processingState?: 'downloading' | 'uploading' | 'indexing' | 'generating' | 'complete' | 'error';
  },
  { success: boolean }
>;

export type CheckCloudflareIndexingRef = FunctionReference<
  'action',
  'internal',
  { submissionId: Id<'submissions'>; attempt: number; forceRegenerate?: boolean },
  void
>;

export type GenerateSummaryRef = FunctionReference<
  'action',
  'internal',
  { submissionId: Id<'submissions'>; forceRegenerate?: boolean },
  { success: boolean; skipped?: boolean; summary?: string; error?: string; reason?: string }
>;

export type GetHackathonInternalRef = FunctionReference<
  'query',
  'internal',
  { hackathonId: Id<'hackathons'> },
  {
    _id: Id<'hackathons'>;
    ownerUserId: string;
    title: string;
    description?: string;
    dates?: { start?: number; end?: number };
    createdAt: number;
    updatedAt: number;
  } | null
>;

export type UpdateSubmissionAIInternalRef = FunctionReference<
  'mutation',
  'internal',
  {
    submissionId: Id<'submissions'>;
    summary?: string;
  },
  { success: boolean }
>;
