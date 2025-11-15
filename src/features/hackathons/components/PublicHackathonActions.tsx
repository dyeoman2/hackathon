import type { Id } from '@convex/_generated/dataModel';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '~/components/ui/button';

interface PublicHackathonActionsProps {
  hackathonId: Id<'hackathons'>;
}

export function PublicHackathonActions({ hackathonId }: PublicHackathonActionsProps) {
  const navigate = useNavigate();

  return (
    <Button
      onClick={() =>
        navigate({
          to: '/register',
          search: {
            redirect: `/app/h/${hackathonId}?newSubmission=true`,
          },
        })
      }
      size="lg"
    >
      Register & Submit
    </Button>
  );
}
