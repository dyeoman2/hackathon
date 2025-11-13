import { api } from '@convex/_generated/api';
import { useForm } from '@tanstack/react-form';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
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
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

const hackathonSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  description: z.string().optional(),
  endDateTime: z.date().refine(
    (date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const selectedDate = new Date(date);
      selectedDate.setHours(0, 0, 0, 0);
      return selectedDate >= today;
    },
    { message: 'End date must be today or in the future' },
  ),
  rubric: z.string().min(1, 'Rubric is required'),
});

interface NewHackathonModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewHackathonModal({ open, onClose }: NewHackathonModalProps) {
  const router = useRouter();

  // Use optimistic mutation for better UX - Convex automatically handles cache updates
  const createHackathonOptimistic = useOptimisticMutation(api.hackathons.createHackathon, {
    onError: (error) => {
      console.error('Failed to create hackathon:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create hackathon');
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Default end date to 7 days from now
  const defaultEndDateTime = new Date();
  defaultEndDateTime.setDate(defaultEndDateTime.getDate() + 7);

  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      endDateTime: defaultEndDateTime,
      rubric:
        'Build something that shows what TanStack Start can really do with rich interactivity, live updates, server streaming, collaborative tools, full-stack routing, and RPCs with Convex, CodeRabbit, Netlify, Firecrawl, Sentry, Autumn, and Cloudflare.',
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Optimistic mutation - Convex automatically updates cache
        const result = await createHackathonOptimistic({
          title: value.title,
          description: value.description?.trim() || undefined,
          dates: {
            end: value.endDateTime.getTime(),
          },
          rubric: value.rubric,
        });

        // Redirect to the new hackathon workspace
        await router.navigate({
          to: '/app/h/$id',
          params: { id: result.hackathonId },
        });

        onClose();
        form.reset();
      } catch {
        // Error handling is done in the onError callback
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Create New Hackathon</DialogTitle>
          <DialogDescription>
            Create a new hackathon event to manage submissions and reviews.
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
              onChange: hackathonSchema.shape.title,
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
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="endDateTime"
            validators={{
              onChange: hackathonSchema.shape.endDateTime,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>End Date & Time *</FieldLabel>
                <DateTimePicker
                  date={field.state.value}
                  onDateChange={(date) => field.handleChange(date || new Date())}
                  disabled={isSubmitting}
                  required
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
              onChange: hackathonSchema.shape.rubric,
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
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isFormSubmitting]) => (
                <Button type="submit" disabled={!canSubmit || isSubmitting || isFormSubmitting}>
                  {isSubmitting || isFormSubmitting ? 'Creating...' : 'Create Hackathon'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
