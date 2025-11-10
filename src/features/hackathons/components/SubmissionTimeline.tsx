import type { Doc } from '@convex/_generated/dataModel';
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

  // R2 Upload Started - inferred from creation (upload starts automatically)
  events.push({
    timestamp: submission.createdAt,
    label: 'Started syncing to R2 and AI Search',
    color: 'bg-amber-500',
  });

  // R2 Upload Completed
  if (submission.source?.uploadedAt) {
    events.push({
      timestamp: submission.source.uploadedAt,
      label: 'Completed syncing to R2 and AI Search',
      color: 'bg-green-500',
    });
  }

  // AI Reviewed
  if (submission.ai?.lastReviewedAt) {
    events.push({
      timestamp: submission.ai.lastReviewedAt,
      label: 'AI Summary and Score Generated',
      color: 'bg-blue-500',
    });
  }

  // Last Updated - Show if different from created
  if (submission.updatedAt !== submission.createdAt) {
    events.push({
      timestamp: submission.updatedAt,
      label: 'Last Updated',
      color: 'bg-muted-foreground',
      details: submission.status !== 'submitted' ? `Status: ${submission.status}` : undefined,
    });
  }

  // Sort by timestamp, then by label for same timestamp
  events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.label.localeCompare(b.label);
  });

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
    <div className="pt-6 border-t space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h3 className="text-lg font-semibold">Timeline</h3>
      </div>

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
    </div>
  );
}
