import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';

interface EditSummaryModalProps {
  submission: Doc<'submissions'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSummaryModal({ submission, open, onOpenChange }: EditSummaryModalProps) {
  // Pre-populate with current displayed summary (manual takes priority over AI)
  const currentSummary = submission.manualSummary || submission.source?.aiSummary || '';
  const [summary, setSummary] = useState(currentSummary);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const updateSubmission = useMutation(api.submissions.updateSubmission);
  const toast = useToast();

  // Reset summary when modal opens to show current state
  useEffect(() => {
    if (open) {
      setSummary(currentSummary);
    }
  }, [open, currentSummary]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await updateSubmission({
        submissionId: submission._id,
        manualSummary: summary.trim(),
      });
      toast.showToast('Summary updated successfully', 'success');
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update summary:', error);
      toast.showToast(error instanceof Error ? error.message : 'Failed to update summary', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setSummary(currentSummary);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Edit Summary</DialogTitle>
          <DialogDescription>
            Update the manual summary for this submission. This will override any AI-generated
            summary.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            placeholder="Enter a custom summary for this submission..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={8}
            className="resize-none"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              'Save Summary'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
