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
    status: 'submitted' | 'review' | 'shortlist' | 'winner';
    source?: {
      r2Key?: string;
      uploadedAt?: number;
      aiSummary?: string;
      summarizedAt?: number;
    };
    ai?: {
      summary?: string;
      score?: number;
      lastReviewedAt?: number;
      inFlight?: boolean;
    };
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
    aiSummary?: string;
    summarizedAt?: number;
  },
  { success: boolean }
>;

export type CheckIndexingAndGenerateSummaryRef = FunctionReference<
  'action',
  'internal',
  { submissionId: Id<'submissions'>; attempt: number },
  void
>;
