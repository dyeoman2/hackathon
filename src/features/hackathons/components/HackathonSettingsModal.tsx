import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
import { useQuery } from 'convex/react';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { DateTimePicker } from '~/components/ui/datetime-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

const settingsSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  description: z.string().optional(),
  submissionDeadline: z.date().refine(
    (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      return selectedDate >= today;
    },
    { message: 'Submission deadline must be today or in the future' },
  ),
  rubric: z.string().min(1, 'Rubric is required'),
});

interface HackathonSettingsModalProps {
  hackathonId: Id<'hackathons'>;
  open: boolean;
  onClose: () => void;
}

export function HackathonSettingsModal({
  hackathonId,
  open,
  onClose,
}: HackathonSettingsModalProps) {
  const toast = useToast();
  const hackathon = useQuery(api.hackathons.getHackathon, { hackathonId });

  // Use optimistic mutations for better UX - Convex automatically handles cache updates and rollback
  const updateHackathonOptimistic = useOptimisticMutation(api.hackathons.updateHackathon, {
    onSuccess: () => {
      toast.showToast('Hackathon settings updated successfully!', 'success');
      onClose();
    },
    onError: (error) => {
      console.error('Failed to update hackathon:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to update hackathon');
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      submissionDeadline: new Date(),
      rubric: '',
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Optimistic mutation - Convex automatically updates cache and handles rollback on error
        await updateHackathonOptimistic({
          hackathonId,
          title: value.title,
          description: value.description?.trim() || undefined,
          dates: {
            submissionDeadline: value.submissionDeadline.getTime(),
          },
          rubric: value.rubric,
        });
        // Modal close is handled in the onSuccess callback
      } catch {
        // Error handling is done in the onError callback
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  // Update form when hackathon data loads and modal opens
  useEffect(() => {
    if (open && hackathon) {
      form.setFieldValue('title', hackathon.title);
      form.setFieldValue('description', hackathon.description || '');
      // Set the submission deadline as Date object
      const submissionDeadline = hackathon.dates?.submissionDeadline
        ? new Date(hackathon.dates.submissionDeadline)
        : new Date();
      form.setFieldValue('submissionDeadline', submissionDeadline);
      form.setFieldValue('rubric', hackathon.rubric);
    }
  }, [open, hackathon, form]);

  if (hackathon === undefined) {
    return null; // Don't show modal while loading
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Hackathon Settings</DialogTitle>
          <DialogDescription>
            Update hackathon details and judging rubric. Changes will be saved immediately.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4"
        >
          <form.Field
            name="title"
            validators={{
              onChange: settingsSchema.shape.title,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Title *</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="My Awesome Hackathon"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Describe your hackathon..."
                  rows={4}
                  disabled={isSubmitting}
                />
              </Field>
            )}
          </form.Field>

          <form.Field
            name="submissionDeadline"
            validators={{
              onChange: settingsSchema.shape.submissionDeadline,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Submission Deadline *</FieldLabel>
                <DateTimePicker
                  date={field.state.value}
                  onDateChange={(date) => field.handleChange(date || new Date())}
                  disabled={isSubmitting}
                  required
                  preserveTime
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="rubric"
            validators={{
              onChange: settingsSchema.shape.rubric,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Judging Rubric *</FieldLabel>
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Enter the judging criteria and rubric for this hackathon..."
                  rows={6}
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          {submitError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isFormSubmitting]) => (
                  <Button type="submit" disabled={!canSubmit || isSubmitting || isFormSubmitting}>
                    {isSubmitting || isFormSubmitting ? 'Saving...' : 'Save Changes'}
                  </Button>
                )}
              </form.Subscribe>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
