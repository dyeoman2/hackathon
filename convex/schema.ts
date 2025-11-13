import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  // Note: Better Auth manages its own tables via the betterAuth component
  // Those tables are in the 'betterAuth' namespace (user, session, account, verification, etc.)
  // We should NOT duplicate them here. Access Better Auth users via Better Auth APIs.

  // Application-specific tables only
  // User profiles table - stores app-specific user data that references Better Auth user IDs
  userProfiles: defineTable({
    userId: v.string(), // References Better Auth user.id
    role: v.union(v.literal('user'), v.literal('admin')), // Enforced enum for data integrity
    // Add other app-specific user fields here as needed
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_role_createdAt', ['role', 'createdAt']),

  auditLogs: defineTable({
    id: v.string(),
    userId: v.string(), // References Better Auth user.id
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  })
    .index('by_userId', ['userId'])
    .index('by_createdAt', ['createdAt']),

  dashboardStats: defineTable({
    key: v.string(),
    totalUsers: v.number(),
    activeUsers: v.number(),
    updatedAt: v.number(),
  }).index('by_key', ['key']),

  // Rate limiting table - managed by @convex-dev/rate-limiter
  rateLimit: defineTable({
    identifier: v.string(),
    kind: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_identifier_kind', ['identifier', 'kind'])
    .index('by_createdAt', ['createdAt']),

  aiMessageUsage: defineTable({
    userId: v.string(),
    messagesUsed: v.number(),
    pendingMessages: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReservedAt: v.optional(v.number()),
    lastCompletedAt: v.optional(v.number()),
  }).index('by_userId', ['userId']),

  aiResponses: defineTable({
    userId: v.string(),
    requestKey: v.string(),
    method: v.union(v.literal('direct'), v.literal('gateway'), v.literal('structured')),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    response: v.string(),
    rawText: v.optional(v.string()),
    structuredData: v.optional(
      v.object({
        title: v.string(),
        summary: v.string(),
        keyPoints: v.array(v.string()),
        category: v.string(),
        difficulty: v.string(),
      }),
    ),
    parseError: v.optional(v.string()),
    usage: v.optional(
      v.object({
        totalTokens: v.optional(v.number()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
      }),
    ),
    finishReason: v.optional(v.string()),
    status: v.union(v.literal('pending'), v.literal('complete'), v.literal('error')),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_userId_createdAt', ['userId', 'createdAt'])
    .index('by_requestKey', ['requestKey']),

  hackathons: defineTable({
    ownerUserId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    dates: v.optional(
      v.object({
        start: v.optional(v.number()),
        end: v.number(),
      }),
    ),
    rubric: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_ownerUserId', ['ownerUserId']),

  memberships: defineTable({
    hackathonId: v.id('hackathons'),
    userId: v.optional(v.string()),
    invitedEmail: v.optional(v.string()),
    role: v.union(v.literal('owner'), v.literal('admin'), v.literal('judge')),
    status: v.union(v.literal('invited'), v.literal('active')),
    tokenHash: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    invitedByUserId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_hackathonId', ['hackathonId'])
    .index('by_userId', ['userId'])
    .index('by_tokenHash', ['tokenHash'])
    .index('by_invitedEmail', ['invitedEmail']),

  submissions: defineTable({
    hackathonId: v.id('hackathons'),
    title: v.string(),
    team: v.string(),
    repoUrl: v.string(),
    siteUrl: v.optional(v.string()),
    status: v.optional(v.string()), // Legacy field - kept for backward compatibility
    source: v.optional(
      v.object({
        r2Key: v.optional(v.string()),
        uploadedAt: v.optional(v.number()),
        uploadStartedAt: v.optional(v.number()),
        uploadCompletedAt: v.optional(v.number()),
        aiSearchSyncStartedAt: v.optional(v.number()),
        aiSearchSyncCompletedAt: v.optional(v.number()),
        aiSearchSyncJobId: v.optional(v.string()),
        aiSummary: v.optional(v.string()),
        summarizedAt: v.optional(v.number()),
        summaryGenerationStartedAt: v.optional(v.number()),
        summaryGenerationCompletedAt: v.optional(v.number()),
        screenshotCaptureStartedAt: v.optional(v.number()),
        screenshotCaptureCompletedAt: v.optional(v.number()),
        readme: v.optional(v.string()),
        readmeFilename: v.optional(v.string()),
        readmeFetchedAt: v.optional(v.number()),
        processingState: v.optional(
          v.union(
            v.literal('downloading'),
            v.literal('uploading'),
            v.literal('indexing'),
            v.literal('generating'),
            v.literal('complete'),
          ),
        ),
      }),
    ),
    ai: v.optional(
      v.object({
        summary: v.optional(v.string()),
        lastReviewedAt: v.optional(v.number()),
        inFlight: v.optional(v.boolean()),
        score: v.optional(v.float64()),
        scoreGenerationStartedAt: v.optional(v.float64()),
        scoreGenerationCompletedAt: v.optional(v.float64()),
      }),
    ),
    screenshots: v.optional(
      v.array(
        v.object({
          r2Key: v.string(),
          url: v.string(),
          capturedAt: v.number(),
          pageUrl: v.optional(v.string()),
          pageName: v.optional(v.string()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_hackathonId', ['hackathonId']),

  ratings: defineTable({
    submissionId: v.id('submissions'),
    hackathonId: v.id('hackathons'),
    userId: v.string(), // References Better Auth user.id
    rating: v.number(), // 0-10
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_submissionId', ['submissionId'])
    .index('by_userId_submissionId', ['userId', 'submissionId'])
    .index('by_hackathonId', ['hackathonId']),

  revealState: defineTable({
    hackathonId: v.id('hackathons'),
    phase: v.union(
      v.literal('idle'),
      v.literal('countdown'),
      v.literal('tally'),
      v.literal('podiumReady'),
      v.literal('reveal3rd'),
      v.literal('reveal2nd'),
      v.literal('reveal1st'),
      v.literal('complete'),
    ),
    startedAt: v.optional(v.number()), // Timestamp when current phase started
    revealedRanks: v.array(v.number()), // Array of ranks already revealed [3, 2, 1]
    controlledBy: v.optional(v.string()), // User ID of presenter
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_hackathonId', ['hackathonId']),
});
