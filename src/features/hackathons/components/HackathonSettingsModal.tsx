import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from 'convex/react';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Alert, AlertDescription } from '~/components/ui/alert';
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
import { Textarea } from '~/components/ui/textarea';
import { useToast } from '~/components/ui/toast';

const settingsSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  description: z.string().optional(),
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
  const updateHackathon = useMutation(api.hackathons.updateHackathon);
  const deleteHackathon = useMutation(api.hackathons.deleteHackathon);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const form = useForm({
    defaultValues: {
      title: '',
      description: '',
      rubric: '',
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await updateHackathon({
          hackathonId,
          title: value.title,
          description: value.description?.trim() || undefined,
          rubric: value.rubric,
        });

        toast.showToast('Hackathon settings updated successfully!', 'success');
        onClose();
      } catch (error) {
        console.error('Failed to update hackathon:', error);
        setSubmitError(error instanceof Error ? error.message : 'Failed to update hackathon');
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
      form.setFieldValue('rubric', hackathon.rubric);
    }
  }, [open, hackathon, form]);

  const handleDelete = async () => {
    setIsDeleting(true);
    setSubmitError(null);

    try {
      await deleteHackathon({ hackathonId });
      toast.showToast('Hackathon deleted successfully', 'success');
      onClose();
      // Navigate away - the parent component should handle this
      window.location.href = '/app/h';
    } catch (error) {
      console.error('Failed to delete hackathon:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to delete hackathon');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (hackathon === undefined) {
    return null; // Don't show modal while loading
  }

  const canDelete = hackathon?.role === 'owner';

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

          {showDeleteConfirm && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Are you sure you want to delete this hackathon? This action cannot be undone. All
                submissions and data will be permanently deleted.
              </AlertDescription>
            </Alert>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {canDelete && (
              <div className="flex-1">
                {!showDeleteConfirm ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isSubmitting || isDeleting}
                  >
                    Delete Hackathon
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={isSubmitting || isDeleting}
                    >
                      {isDeleting ? 'Deleting...' : 'Confirm Delete'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowDeleteConfirm(false)}
                      disabled={isSubmitting || isDeleting}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                {([canSubmit, isFormSubmitting]) => (
                  <Button
                    type="submit"
                    disabled={!canSubmit || isSubmitting || isFormSubmitting || showDeleteConfirm}
                  >
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
