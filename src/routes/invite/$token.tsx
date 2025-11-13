import { api } from '@convex/_generated/api';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuth } from '~/features/auth/hooks/useAuth';

export const Route = createFileRoute('/invite/$token')({
  component: InviteAcceptComponent,
});

function InviteAcceptComponent() {
  const router = useRouter();
  const { token } = Route.useParams();
  const { isAuthenticated } = useAuth();
  const decodedToken = decodeURIComponent(token);

  const tokenValidation = useQuery(api.hackathons.validateInviteToken, {
    token: decodedToken,
  });

  // Check if the invited email exists (always call the hook for consistent order)
  const emailExistsQuery = useQuery(api.auth.checkEmailExists, {
    email: tokenValidation?.invitedEmail || '',
  });

  // Only use the result if we have a valid token and email
  const emailExistsCheck =
    tokenValidation?.status === 'valid' && tokenValidation.invitedEmail
      ? emailExistsQuery
      : { exists: false };

  const acceptInvite = useMutation(api.hackathons.acceptInvite);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    if (isAuthenticated) {
      // If authenticated, accept the invite immediately and redirect to hackathon
      setIsAccepting(true);
      setError(null);

      try {
        const result = await acceptInvite({ token: decodedToken });
        // Redirect to hackathon workspace
        await router.navigate({
          to: '/app/h/$id',
          params: { id: result.hackathonId },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to accept invite');
        setIsAccepting(false);
      }
      return;
    }

    // If not authenticated, check if email exists and redirect appropriately
    if (tokenValidation && tokenValidation.status === 'valid' && tokenValidation.invitedEmail) {
      // Wait for email existence check to complete
      if (emailExistsCheck === undefined) {
        setIsAccepting(true); // Show loading while checking
        return;
      }

      setIsAccepting(false); // Reset loading

      if (emailExistsCheck.exists) {
        // Email exists - redirect to login
        const url = `/login?redirect=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(tokenValidation.invitedEmail)}&message=${encodeURIComponent(`Login to accept your invitation to join ${tokenValidation.hackathonTitle}`)}`;
        window.location.href = url;
      } else {
        // Email doesn't exist - redirect to register
        const url = `/register?redirect=${encodeURIComponent(`/invite/${token}`)}&email=${encodeURIComponent(tokenValidation.invitedEmail)}&message=${encodeURIComponent(`Create an account to accept your invitation to join ${tokenValidation.hackathonTitle}`)}`;
        window.location.href = url;
      }
    }
  };

  if (tokenValidation === undefined) {
    return (
      <div className="container mx-auto py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenValidation.status === 'invalid') {
    return (
      <div className="container mx-auto py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Invalid Invite
            </CardTitle>
            <CardDescription>The invite link is invalid or has been revoked.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>
                This invite link is not valid. Please ask the hackathon owner to send you a new
                invite.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenValidation.status === 'used') {
    return (
      <div className="container mx-auto py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Invite Already Used</CardTitle>
            <CardDescription>This invite has already been accepted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <AlertDescription>
                You've already accepted this invite. You should have access to the hackathon
                workspace.
              </AlertDescription>
            </Alert>
            <Button
              className="mt-4"
              onClick={() => {
                void router.navigate({ to: '/app/h' });
              }}
            >
              Go to Hackathons
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenValidation.status === 'expired') {
    return (
      <div className="container mx-auto py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Invite Expired
            </CardTitle>
            <CardDescription>This invite link has expired.</CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertDescription>
                This invite link has expired. Please ask the hackathon owner to send you a new
                invite.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Valid invite - show different UI based on authentication status
  return (
    <div className="container mx-auto py-8">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Hackathon Invitation
          </CardTitle>
          <CardDescription>You've been invited to join a hackathon as a judge.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium">Hackathon:</p>
            <p className="text-lg">{tokenValidation.hackathonTitle}</p>
          </div>

          <div>
            <p className="text-sm font-medium">Invited by:</p>
            <p className="text-lg">{tokenValidation.inviterName}</p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-4 pt-4">
            <Button onClick={handleAccept} disabled={isAccepting} className="flex-1">
              {isAccepting ? 'Accepting...' : 'Accept Invite'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                void router.navigate({ to: '/' });
              }}
              disabled={isAccepting}
            >
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
