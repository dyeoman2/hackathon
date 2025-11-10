import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useState } from 'react';
import { Badge } from '~/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '~/components/ui/sheet';
import { Skeleton } from '~/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { SubmissionAIReviewTab } from './SubmissionAIReviewTab';
import { SubmissionDetailsTab } from './SubmissionDetailsTab';

interface SubmissionDrawerProps {
  submissionId: Id<'submissions'>;
  open: boolean;
  onClose: () => void;
}

export function SubmissionDrawer({ submissionId, open, onClose }: SubmissionDrawerProps) {
  const [activeTab, setActiveTab] = useState('details');
  const submission = useQuery(api.submissions.getSubmission, { submissionId });

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="sm:max-w-[600px] overflow-y-auto">
        {submission === undefined ? (
          <>
            <SheetHeader>
              <SheetTitle className="sr-only">Loading submission</SheetTitle>
              <SheetDescription className="sr-only">Loading submission details</SheetDescription>
            </SheetHeader>
            <div className="space-y-4">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          </>
        ) : submission === null ? (
          <>
            <SheetHeader>
              <SheetTitle>Submission not found</SheetTitle>
              <SheetDescription className="sr-only">The requested submission could not be found</SheetDescription>
            </SheetHeader>
            <div className="text-center py-8">
              <p className="text-muted-foreground">Submission not found</p>
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{submission.title}</SheetTitle>
              <SheetDescription>Submission details</SheetDescription>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline">{submission.status}</Badge>
                {submission.ai?.score !== undefined && (
                  <Badge variant="secondary">Score: {submission.ai.score.toFixed(1)}</Badge>
                )}
              </div>
            </SheetHeader>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="ai-review">AI Review</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="mt-4">
                <SubmissionDetailsTab submission={submission} />
              </TabsContent>
              <TabsContent value="ai-review" className="mt-4">
                <SubmissionAIReviewTab submission={submission} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
