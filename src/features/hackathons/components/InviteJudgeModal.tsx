import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
import { useMutation } from 'convex/react';
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

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'judge']),
});

interface InviteJudgeModalProps {
  hackathonId: Id<'hackathons'>;
  open: boolean;
  onClose: () => void;
}

export function InviteJudgeModal({ hackathonId, open, onClose }: InviteJudgeModalProps) {
  const toast = useToast();
  const inviteJudge = useMutation(api.hackathons.inviteJudge);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      email: '',
      role: 'judge' as 'admin' | 'judge',
    },
    onSubmit: async ({ value }) => {
      setIsSubmitting(true);
      setSubmitError(null);

      try {
        await inviteJudge({
          hackathonId,
          email: value.email.trim().toLowerCase(),
          role: value.role,
        });

        toast.showToast('Judge invite sent successfully!', 'success');
        onClose();
        form.reset();
      } catch (error) {
        console.error('Failed to invite judge:', error);
        setSubmitError(error instanceof Error ? error.message : 'Failed to send invite');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Invite Judge</DialogTitle>
          <DialogDescription>
            Send an invitation to a judge or admin to join this hackathon.
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
            name="email"
            validators={{
              onChange: inviteSchema.shape.email,
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Email Address *</FieldLabel>
                <Input
                  type="email"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="judge@example.com"
                  disabled={isSubmitting}
                />
                {field.state.meta.errors && field.state.meta.errors.length > 0 && (
                  <p className="text-sm text-destructive">{String(field.state.meta.errors[0])}</p>
                )}
              </Field>
            )}
          </form.Field>

          <form.Field
            name="role"
            validators={{
              onChange: (value: unknown) => {
                if (value !== 'admin' && value !== 'judge') {
                  return 'Role must be admin or judge';
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field>
                <FieldLabel>Role *</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value as 'admin' | 'judge');
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="judge">Judge</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
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
                  {isSubmitting || isFormSubmitting ? 'Sending...' : 'Send Invite'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
