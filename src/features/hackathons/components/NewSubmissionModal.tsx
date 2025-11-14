import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '~/components/ui/button';
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
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

const submissionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  team: z.string().min(1, 'Team name is required').max(255, 'Team name is too long'),
  repoUrl: z.string().url('Please enter a valid GitHub repository URL'),
  siteUrl: z.string().url('Please enter a valid URL').optional().or(z.literal('')),
});

interface NewSubmissionModalProps {
  hackathonId: Id<'hackathons'>;
  open: boolean;
  onClose: () => void;
}

export function NewSubmissionModal({ hackathonId, open, onClose }: NewSubmissionModalProps) {
  const router = useRouter();
  const toast = useToast();

  // Use optimistic mutation for better UX - Convex automatically handles cache updates
  const createSubmissionOptimistic = useOptimisticMutation(api.submissions.createSubmission, {
    onError: (error) => {
      console.error('Failed to create submission:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to create submission');
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      title: 'My Awesome Project',
      team: 'Team Awesome',
      repoUrl: 'https://github.com/dyeoman2/hackathon',
      siteUrl: 'https://tanstack-start-convex.netlify.app/',
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Optimistic mutation - Convex automatically updates cache
        const result = await createSubmissionOptimistic({
          hackathonId,
          title: value.title,
          team: value.team,
          repoUrl: value.repoUrl,
          siteUrl: value.siteUrl?.trim() || undefined,
        });

        toast.showToast('Submission created successfully!', 'success');
        form.reset();
        onClose();

        // Navigate to the new submission detail page
        await router.navigate({
          to: '/app/h/$id/submissions/$submissionId',
          params: { id: hackathonId, submissionId: result.submissionId },
        });
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
          <DialogTitle>Add New Submission</DialogTitle>
          <DialogDescription>
            Add a new submission to this hackathon. Include the GitHub repository URL and optional
            live site URL.
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
              onChange: submissionSchema.shape.title,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Title *</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="My Awesome Project"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="team"
            validators={{
              onChange: submissionSchema.shape.team,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Team Name *</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Team Awesome"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="repoUrl"
            validators={{
              onChange: submissionSchema.shape.repoUrl,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>GitHub Repository URL *</FieldLabel>
                <Input
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="siteUrl">
            {(field) => (
              <Field>
                <FieldLabel>Live Site URL (Optional)</FieldLabel>
                <Input
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="https://myproject.com"
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
                  {isSubmitting || isFormSubmitting ? 'Creating...' : 'Create Submission'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
