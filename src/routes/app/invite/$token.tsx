import { api } from '@convex/_generated/api';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Skeleton } from '~/components/ui/skeleton';
import { useAuth } from '~/features/auth/hooks/useAuth';

export const Route = createFileRoute('/app/invite/$token')({
  component: InviteAcceptComponent,
});

function InviteAcceptComponent() {
  const router = useRouter();
  const { token } = Route.useParams();
  const { isAuthenticated } = useAuth();
  const tokenValidation = useQuery(api.hackathons.validateInviteToken, {
    token: decodeURIComponent(token),
  });
  const acceptInvite = useMutation(api.hackathons.acceptInvite);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (isAuthenticated === false) {
      void router.navigate({
        to: '/login',
        search: { redirect: `/app/invite/${token}` },
      });
    }
  }, [isAuthenticated, router, token]);

  const handleAccept = async () => {
    setIsAccepting(true);
    setError(null);

    try {
      const result = await acceptInvite({ token: decodeURIComponent(token) });
      // Redirect to hackathon workspace
      await router.navigate({
        to: '/app/h/$id',
        params: { id: result.hackathonId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept invite');
      setIsAccepting(false);
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

  // Valid invite
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
                void router.navigate({ to: '/app/h' });
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
