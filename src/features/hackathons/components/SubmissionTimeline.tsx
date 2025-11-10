import type { Doc } from '@convex/_generated/dataModel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Field } from '~/components/ui/field';

interface SubmissionTimelineProps {
  submission: Doc<'submissions'>;
}

export function SubmissionTimeline({ submission }: SubmissionTimelineProps) {
  // Build timeline events array
  const events: Array<{
    timestamp: number;
    label: string;
    color: string;
    details?: string;
  }> = [];

  // Created - Always first
  events.push({
    timestamp: submission.createdAt,
    label: 'Created',
    color: 'bg-primary',
  });

  // Upload Started - use specific timestamp if available, otherwise infer from creation
  const uploadStartedAt =
    submission.source?.uploadStartedAt ?? submission.source?.uploadedAt ?? submission.createdAt;
  if (submission.source?.uploadStartedAt || submission.source?.uploadedAt) {
    events.push({
      timestamp: uploadStartedAt,
      label: 'Started uploading repository to Cloudflare R2',
      color: 'bg-amber-500',
    });
  }

  // Upload Completed
  if (submission.source?.uploadCompletedAt || submission.source?.uploadedAt) {
    events.push({
      timestamp: submission.source?.uploadCompletedAt ?? submission.source?.uploadedAt ?? 0,
      label: 'Finished uploading repository to Cloudflare R2',
      color: 'bg-green-500',
    });
  }

  // AI Search Sync Started
  if (submission.source?.aiSearchSyncStartedAt) {
    events.push({
      timestamp: submission.source.aiSearchSyncStartedAt,
      label: 'Started indexing repository files in Cloudflare AI Search',
      color: 'bg-blue-500',
    });
  }

  // AI Search Sync Finished
  if (submission.source?.aiSearchSyncCompletedAt) {
    events.push({
      timestamp: submission.source.aiSearchSyncCompletedAt,
      label: 'Finished indexing repository files in Cloudflare AI Search',
      color: 'bg-blue-600',
    });
  }

  // Summary Generation Started
  if (submission.source?.summaryGenerationStartedAt) {
    events.push({
      timestamp: submission.source.summaryGenerationStartedAt,
      label: 'Started generating AI summary and score',
      color: 'bg-purple-500',
    });
  }

  // Summary Generation Finished
  if (submission.source?.summaryGenerationCompletedAt || submission.source?.summarizedAt) {
    events.push({
      timestamp:
        submission.source?.summaryGenerationCompletedAt ?? submission.source?.summarizedAt ?? 0,
      label: 'Finished generating AI summary and score',
      color: 'bg-purple-600',
    });
  }

  // Screenshot Capture Started
  if (submission.source?.screenshotCaptureStartedAt) {
    events.push({
      timestamp: submission.source.screenshotCaptureStartedAt,
      label: 'Started capturing screenshot with Firecrawl',
      color: 'bg-indigo-500',
    });
  }

  // Screenshot Capture Completed
  if (submission.source?.screenshotCaptureCompletedAt) {
    events.push({
      timestamp: submission.source.screenshotCaptureCompletedAt,
      label: 'Finished capturing screenshot with Firecrawl',
      color: 'bg-indigo-600',
    });
  }

  // Fallback: AI Reviewed (for backwards compatibility with old data)
  if (
    submission.ai?.lastReviewedAt &&
    !submission.source?.summaryGenerationCompletedAt &&
    !submission.ai?.scoreGenerationCompletedAt
  ) {
    events.push({
      timestamp: submission.ai.lastReviewedAt,
      label: 'AI Summary and Score Generated',
      color: 'bg-blue-500',
    });
  }

  // Sort by timestamp, then by label for same timestamp
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.label.localeCompare(b.label);
  });

  // Last Updated - Show if different from created and not already covered by other events
  if (submission.updatedAt !== submission.createdAt) {
    // Only show if it's significantly different from the last event
    const lastEventTimestamp =
      events.length > 0 ? events[events.length - 1]?.timestamp : submission.createdAt;
    if (Math.abs(submission.updatedAt - lastEventTimestamp) > 1000) {
      // Only show if more than 1 second different
      events.push({
        timestamp: submission.updatedAt,
        label: 'Last Updated',
        color: 'bg-muted-foreground',
        details: submission.status !== 'submitted' ? `Status: ${submission.status}` : undefined,
      });
      // Re-sort after adding Last Updated
      events.sort((a, b) => {
        if (a.timestamp !== b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return a.label.localeCompare(b.label);
      });
    }
  }

  // Deduplicate events at the same timestamp (keep first occurrence)
  const uniqueEvents: typeof events = [];
  const seen = new Set<string>();
  for (const event of events) {
    const key = `${event.timestamp}-${event.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueEvents.push(event);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <CardDescription>Processing history and status updates</CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <div className="text-sm space-y-2">
            {uniqueEvents.map((event, index) => {
              const isLast = index === uniqueEvents.length - 1;
              return (
                <div key={`${event.timestamp}-${event.label}`} className="flex items-start gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <div className={`h-2 w-2 rounded-full ${event.color} mt-1.5`} />
                    {!isLast && <div className="h-full w-px bg-border mt-1 min-h-4" />}
                  </div>
                  <div className={`flex-1 ${!isLast ? 'pb-4' : ''}`}>
                    <p className="font-medium leading-tight">{event.label}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {new Date(event.timestamp).toLocaleString()}
                    </p>
                    {event.details && (
                      <p className="text-muted-foreground text-xs mt-1">{event.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>
      </CardContent>
    </Card>
  );
}
