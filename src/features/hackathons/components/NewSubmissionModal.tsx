import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useForm } from '@tanstack/react-form';
import { useRouter } from '@tanstack/react-router';
import { useAction } from 'convex/react';
import { useEffect, useState } from 'react';
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
import { CREDIT_PACKAGES } from '~/features/ai/constants';
import { FREE_SUBMISSION_LIMIT } from '~/features/hackathons/constants';
import { AUTUMN_CREDIT_FEATURE_ID } from '~/lib/shared/autumn';

const submissionSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255, 'Title is too long'),
  team: z.string().min(1, 'Team name is required').max(255, 'Team name is too long'),
  repoUrl: z.string().url('Please enter a valid GitHub repository URL'),
  siteUrl: z.string(),
  videoUrl: z.string(),
});

interface NewSubmissionModalProps {
  hackathonId: Id<'hackathons'>;
  open: boolean;
  onClose: () => void;
  totalSubmissions: number;
  userRole: 'owner' | 'admin' | 'judge' | 'contestant';
}

export function NewSubmissionModal({
  hackathonId,
  open,
  onClose,
  totalSubmissions,
  userRole,
}: NewSubmissionModalProps) {
  const router = useRouter();
  const toast = useToast();
  const checkoutAction = useAction(api.autumn.checkoutAutumn);
  const checkCreditsAction = useAction(api.autumn.check);
  const checkOwnerCreditsAction = useAction(api.submissions.checkOwnerCredits);
  const createSubmissionAction = useAction(api.submissions.createSubmission);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [creditStatus, setCreditStatus] = useState<
    'idle' | 'checking' | 'allowed' | 'denied' | 'error'
  >('idle');
  const [creditInfo, setCreditInfo] = useState<{
    balance: number | null;
    unlimited: boolean;
  } | null>(null);
  const [_, setCreditCheckAttempt] = useState(0);
  // Owner credit status (for judges)
  const [ownerCreditStatus, setOwnerCreditStatus] = useState<
    'idle' | 'checking' | 'allowed' | 'denied' | 'error'
  >('idle');
  const [ownerCreditInfo, setOwnerCreditInfo] = useState<{
    balance: number | null;
    unlimited: boolean;
  } | null>(null);

  const freeSubmissionsRemaining = Math.max(FREE_SUBMISSION_LIMIT - totalSubmissions, 0);
  const isOutOfCredits = freeSubmissionsRemaining <= 0;
  const hasPaidCredits = isOutOfCredits && creditStatus === 'allowed';
  const checkingPaidCredits =
    isOutOfCredits &&
    (creditStatus === 'idle' || creditStatus === 'checking') &&
    userRole !== 'judge' &&
    userRole !== 'contestant';

  // For judges and contestants: check if owner credits are being checked
  const checkingOwnerCredits =
    isOutOfCredits &&
    (userRole === 'judge' || userRole === 'contestant') &&
    (ownerCreditStatus === 'idle' || ownerCreditStatus === 'checking');

  // Submission is locked if:
  // 1. Hackathon is out of credits AND user is owner/admin but doesn't have credits/error checking
  // 2. Hackathon is out of credits AND user is judge/contestant but owner doesn't have credits
  const submissionLocked =
    isOutOfCredits &&
    (((userRole === 'owner' || userRole === 'admin') &&
      !(creditStatus === 'allowed' || creditStatus === 'error')) ||
      ((userRole === 'judge' || userRole === 'contestant') &&
        ownerCreditStatus !== 'idle' &&
        ownerCreditStatus !== 'checking' &&
        ownerCreditStatus !== 'allowed'));

  let creditLabel: string;
  if (freeSubmissionsRemaining > 0) {
    creditLabel = `${freeSubmissionsRemaining} free submission${
      freeSubmissionsRemaining === 1 ? '' : 's'
    } remaining.`;
  } else if (hasPaidCredits) {
    if (creditInfo?.unlimited) {
      creditLabel = 'Unlimited submissions available for this hackathon.';
    } else if (creditInfo?.balance !== null) {
      creditLabel = `${creditInfo?.balance} submission${
        creditInfo?.balance === 1 ? '' : 's'
      } remaining for this hackathon.`;
    } else {
      creditLabel = 'Credits detected. You can continue submitting to this hackathon.';
    }
  } else if (creditStatus === 'error') {
    creditLabel =
      'Unable to verify paid credits right now. Try again or purchase additional credits.';
  } else {
    creditLabel = 'All free submissions have been used for this hackathon.';
  }

  // Owner credit label for judges
  let ownerCreditLabel: string;
  if (userRole === 'judge' && isOutOfCredits) {
    if (ownerCreditStatus === 'checking') {
      ownerCreditLabel = 'Checking hackathon owner credits...';
    } else if (ownerCreditStatus === 'allowed') {
      if (ownerCreditInfo?.unlimited) {
        ownerCreditLabel = 'Hackathon owner has unlimited credits. You can create submissions.';
      } else if (ownerCreditInfo && ownerCreditInfo.balance !== null) {
        ownerCreditLabel = `Hackathon owner has ${ownerCreditInfo.balance} submission${
          ownerCreditInfo.balance === 1 ? '' : 's'
        } remaining.`;
      } else {
        ownerCreditLabel = 'Hackathon owner has credits available. You can create submissions.';
      }
    } else if (ownerCreditStatus === 'denied') {
      ownerCreditLabel =
        '⚠️ The hackathon owner has run out of credits. Please contact them to purchase more credits before creating submissions.';
    } else if (ownerCreditStatus === 'error') {
      ownerCreditLabel =
        'Unable to verify hackathon owner credits. Please try again or contact the hackathon owner.';
    } else {
      ownerCreditLabel = 'Checking hackathon owner credits...';
    }
  } else {
    ownerCreditLabel = '';
  }

  // Check credits for owners/admins
  useEffect(() => {
    if (!open) {
      setCreditStatus('idle');
      setCreditInfo(null);
      return;
    }

    if (freeSubmissionsRemaining > 0 || userRole === 'judge' || userRole === 'contestant') {
      setCreditStatus('idle');
      setCreditInfo(null);
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout;

    async function checkCredits() {
      setCreditStatus('checking');
      setCreditInfo(null);
      try {
        const result = await checkCreditsAction({
          featureId: AUTUMN_CREDIT_FEATURE_ID,
        });

        if (cancelled) {
          return;
        }

        if (result.error) {
          setCreditStatus('error');
          return;
        }

        if (result.data?.allowed) {
          setCreditInfo({
            balance:
              typeof result.data.balance === 'number'
                ? Math.max(0, Math.floor(result.data.balance))
                : null,
            unlimited: Boolean(result.data.unlimited),
          });
          setCreditStatus('allowed');
        } else {
          setCreditStatus('denied');
        }
      } catch (_error) {
        if (!cancelled) {
          setCreditStatus('error');
        }
      }
    }

    void checkCredits();

    // Add timeout to prevent hanging on mobile/network issues
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        setCreditStatus('error');
      }
    }, 10000); // 10 second timeout

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [open, freeSubmissionsRemaining, checkCreditsAction, userRole]);

  // Check owner credits for judges and contestants
  useEffect(() => {
    if (!open) {
      setOwnerCreditStatus('idle');
      setOwnerCreditInfo(null);
      return;
    }

    if (freeSubmissionsRemaining > 0 || (userRole !== 'judge' && userRole !== 'contestant')) {
      setOwnerCreditStatus('idle');
      setOwnerCreditInfo(null);
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout;

    async function checkOwnerCredits() {
      setOwnerCreditStatus('checking');
      setOwnerCreditInfo(null);
      try {
        const result = await checkOwnerCreditsAction({
          hackathonId,
        });

        if (cancelled) {
          return;
        }

        if (result.error) {
          setOwnerCreditStatus('error');
          return;
        }

        if (result.data?.allowed) {
          setOwnerCreditInfo({
            balance:
              typeof result.data.balance === 'number'
                ? Math.max(0, Math.floor(result.data.balance))
                : null,
            unlimited: Boolean(result.data.unlimited),
          });
          setOwnerCreditStatus('allowed');
        } else {
          setOwnerCreditStatus('denied');
        }
      } catch (_error) {
        if (!cancelled) {
          setOwnerCreditStatus('error');
        }
      }
    }

    void checkOwnerCredits();

    // Add timeout to prevent hanging on mobile/network issues
    timeoutId = setTimeout(() => {
      if (!cancelled) {
        setOwnerCreditStatus('error');
      }
    }, 10000); // 10 second timeout

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [open, freeSubmissionsRemaining, checkOwnerCreditsAction, userRole, hackathonId]);

  const handleRetryCreditCheck = () => {
    setCreditStatus('idle');
    setCreditInfo(null);
    setCreditCheckAttempt((attempt) => attempt + 1);
  };

  const form = useForm({
    validators: {
      onSubmit: submissionSchema,
    },
    defaultValues: {
      title: 'My Awesome Project',
      team: 'Team Awesome',
      repoUrl: 'https://github.com/dyeoman2/hackathon',
      siteUrl: '',
      videoUrl: '',
    },
    onSubmit: async ({ value }) => {
      if (submissionLocked) {
        if (userRole === 'judge' || userRole === 'contestant') {
          setSubmitError(
            'The hackathon owner has run out of credits. Please contact them to purchase more credits before creating submissions.',
          );
        } else {
          setSubmitError(
            'All free submissions have been used. Please purchase credits to continue.',
          );
        }
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const result = await createSubmissionAction({
          hackathonId,
          title: value.title,
          team: value.team,
          repoUrl: value.repoUrl,
          siteUrl: value.siteUrl?.trim() || undefined,
          videoUrl: value.videoUrl?.trim() || undefined,
        });

        toast.showToast('Submission created successfully!', 'success');
        form.reset();
        onClose();

        // Navigate to the new submission detail page
        await router.navigate({
          to: '/h/$id/submissions/$submissionId',
          params: { id: hackathonId, submissionId: result.submissionId },
        });
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : 'Failed to create submission');
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      form.reset();
    }
  }, [open, form]);

  const handleBuyCredits = async () => {
    const packageToPurchase = CREDIT_PACKAGES[0];
    if (!packageToPurchase) {
      toast.showToast('No credit packages are configured. Please try again later.', 'error');
      return;
    }

    try {
      setIsCheckoutLoading(true);
      const successUrl = `${window.location.origin}/h/${hackathonId}?payment=success`;
      const result = await checkoutAction({
        productId: packageToPurchase.productId,
        successUrl,
      });

      if (result.error) {
        toast.showToast(result.error.message ?? 'Purchase failed. Please try again.', 'error');
        return;
      }

      if (result.data?.url) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer');
      } else {
        toast.showToast('Credits purchased successfully.', 'success');
      }
    } catch (_error) {
      toast.showToast('Failed to initiate checkout. Please try again.', 'error');
    } finally {
      setIsCheckoutLoading(false);
    }
  };

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

          <form.Field name="videoUrl">
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

          {!checkingPaidCredits && userRole !== 'judge' && userRole !== 'contestant' && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex sm:items-center sm:justify-between">
              <span className="font-medium">{creditLabel}</span>
              {isOutOfCredits && (
                <div className="mt-2 flex w-full flex-col gap-2 sm:mt-0 sm:w-auto sm:flex-row">
                  {creditStatus === 'error' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleRetryCreditCheck}
                    >
                      Check Credits
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary"
                    onClick={handleBuyCredits}
                    disabled={isCheckoutLoading}
                  >
                    {isCheckoutLoading ? 'Opening Checkout...' : 'Buy Credits'}
                  </Button>
                </div>
              )}
            </div>
          )}

          {(userRole === 'judge' || userRole === 'contestant') &&
            isOutOfCredits &&
            ownerCreditStatus === 'denied' &&
            ownerCreditLabel && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive sm:flex sm:items-center sm:justify-between">
                <span className="font-medium">{ownerCreditLabel}</span>
              </div>
            )}

          {submitError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {submitError}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <form.Subscribe
              selector={(state) => [state.canSubmit, state.isSubmitting, state.isTouched]}
            >
              {([canSubmit, isFormSubmitting, isTouched]) => (
                <Button
                  type="submit"
                  disabled={
                    checkingPaidCredits ||
                    checkingOwnerCredits ||
                    submissionLocked ||
                    (isTouched && !canSubmit) ||
                    isSubmitting ||
                    isFormSubmitting
                  }
                  title={
                    submissionLocked
                      ? userRole === 'judge' || userRole === 'contestant'
                        ? 'The hackathon owner has run out of credits. Please contact them so they can purchase more credits.'
                        : 'Purchase credits to add more submissions.'
                      : checkingPaidCredits
                        ? 'Verifying your credit balance...'
                        : checkingOwnerCredits
                          ? 'Verifying hackathon owner credit balance...'
                          : undefined
                  }
                >
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
