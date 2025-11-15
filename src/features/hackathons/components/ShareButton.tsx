import { Share2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { useToast } from '~/components/ui/toast';

interface ShareButtonProps {
  hackathonId: string;
}

export function ShareButton({ hackathonId }: ShareButtonProps) {
  const toast = useToast();

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/h/${hackathonId}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.showToast('Hackathon link copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      toast.showToast('Failed to copy link', 'error');
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleShare} className="gap-2">
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
