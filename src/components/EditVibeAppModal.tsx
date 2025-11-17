import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

const vibeAppSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  creator: z.string().optional(),
  githubUrl: z.string().optional(),
  websiteUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  isActive: z.boolean(),
});

interface EditVibeAppModalProps {
  project: Doc<'vibeAppsProjects'>;
  open: boolean;
  onClose: () => void;
}

export function EditVibeAppModal({ project, open, onClose }: EditVibeAppModalProps) {
  const toast = useToast();

  // Use optimistic mutation for better UX - Convex automatically handles cache updates and rollback
  const updateProjectOptimistic = useOptimisticMutation(api.vibeApps.updateVibeAppsProject, {
    onSuccess: () => {
      toast.showToast('Project updated successfully!', 'success');
      onClose();
    },
    onError: (error) => {
      console.error('Failed to update project:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to update project');
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      name: project.name,
      creator: project.creator || '',
      githubUrl: project.githubUrl || '',
      websiteUrl: project.websiteUrl || '',
      videoUrl: project.videoUrl || '',
      isActive: project.isActive,
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        // Optimistic mutation - Convex automatically updates cache and handles rollback on error
        await updateProjectOptimistic({
          id: project._id,
          name: value.name,
          creator: value.creator?.trim() || undefined,
          githubUrl: value.githubUrl?.trim() || undefined,
          websiteUrl: value.websiteUrl?.trim() || undefined,
          videoUrl: value.videoUrl?.trim() || undefined,
          isActive: value.isActive,
        });
        // Modal close is handled in the onSuccess callback
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
          <DialogTitle>Edit Vibe App Project</DialogTitle>
          <DialogDescription>
            Update the project details. Changes will be saved immediately.
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
            name="name"
            validators={{
              onChange: vibeAppSchema.shape.name,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Name *</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Project Name"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="creator">
            {(field) => (
              <Field>
                <FieldLabel>Creator (Optional)</FieldLabel>
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Creator Name"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="githubUrl"
            validators={{
              onChange: ({ value }) => {
                if (value && value.trim() !== '') {
                  const urlSchema = z.string().url('Please enter a valid GitHub URL');
                  return urlSchema.safeParse(value).success
                    ? undefined
                    : 'Please enter a valid GitHub URL';
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>GitHub URL (Optional)</FieldLabel>
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

          <form.Field
            name="websiteUrl"
            validators={{
              onChange: ({ value }) => {
                if (value && value.trim() !== '') {
                  const urlSchema = z.string().url('Please enter a valid URL');
                  return urlSchema.safeParse(value).success
                    ? undefined
                    : 'Please enter a valid URL';
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Website URL (Optional)</FieldLabel>
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

          <form.Field
            name="videoUrl"
            validators={{
              onChange: ({ value }) => {
                if (value && value.trim() !== '') {
                  const urlSchema = z.string().url('Please enter a valid video URL');
                  return urlSchema.safeParse(value).success
                    ? undefined
                    : 'Please enter a valid video URL';
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Demo Video URL (Optional)</FieldLabel>
                <Input
                  type="url"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="https://youtube.com/watch?v=... or any video URL"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field name="isActive">
            {(field) => (
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={field.state.value ? 'active' : 'inactive'}
                  onValueChange={(value) => field.handleChange(value === 'active')}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (include in seeding)</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
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
                  {isSubmitting || isFormSubmitting ? 'Updating...' : 'Update Project'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
