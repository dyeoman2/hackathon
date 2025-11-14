import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import { useToast } from '~/components/ui/toast';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

const inviteSchema = z.object({
  email: z.string().email('Invalid email address'),
  role: z.enum(['admin', 'judge']),
});

interface InviteJudgeModalProps {
  hackathonId: Id<'hackathons'>;
  open: boolean;
  onClose: () => void;
}

// Helper function to extract user-friendly error messages from Convex errors
function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'Failed to send invite. Please try again.';
  }

  const message = error.message;

  // Extract the actual error message from Convex's technical error format
  // Convex errors often include: "[CONVEX M(...)] [Request ID: ...] Server Error ..."
  // We want to extract the meaningful part after "Server Error"
  const serverErrorMatch = message.match(/Server Error\s+(.+?)(?:\s+at\s+handler|$)/s);
  if (serverErrorMatch) {
    const extractedMessage = serverErrorMatch[1].trim();
    // Remove "Uncaught Error: " prefix if present
    const cleanMessage = extractedMessage.replace(/^Uncaught Error:\s*/i, '');
    return cleanMessage;
  }

  // Fallback: return the message if it's reasonably short and user-friendly
  if (message.length < 100 && !message.includes('[CONVEX')) {
    return message;
  }

  // Default fallback for technical errors
  return 'Failed to send invite. Please try again.';
}

export function InviteJudgeModal({ hackathonId, open, onClose }: InviteJudgeModalProps) {
  const toast = useToast();

  // Use optimistic mutation for better UX - Convex automatically handles cache updates
  const inviteJudgeOptimistic = useOptimisticMutation(api.hackathons.inviteJudge, {
    onError: (error) => {
      console.error('Failed to invite judge:', error);
      setSubmitError(getErrorMessage(error));
    },
  });

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
        // Optimistic mutation - Convex automatically updates cache
        await inviteJudgeOptimistic({
          hackathonId,
          email: value.email.trim().toLowerCase(),
          role: value.role,
          appUrl: window.location.origin,
        });

        toast.showToast('Judge invite sent successfully!', 'success');
        onClose();
        form.reset();
      } catch {
        // Error handling is done in the onError callback
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  // Reset form state when modal opens to clear any previous validation errors
  useEffect(() => {
    if (open) {
      form.reset();
      setSubmitError(null);
    }
  }, [open, form]);

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
              onBlur: ({ value }) => {
                const result = inviteSchema.shape.email.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
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
              onChange: ({ value }) => {
                const result = inviteSchema.shape.role.safeParse(value);
                return result.success ? undefined : 'Role must be admin or judge';
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
            <Alert variant="destructive" role="alert">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
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
