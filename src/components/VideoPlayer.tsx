import { ExternalLink, Play } from 'lucide-react';
import { extractYouTubeVideoId, getYouTubeEmbedUrl } from '~/lib/utils';
import { Button } from './ui/button';

interface VideoPlayerProps {
  url: string;
  title?: string;
  className?: string;
}

export function VideoPlayer({ url, title, className = '' }: VideoPlayerProps) {
  const videoId = extractYouTubeVideoId(url);

  // If it's a YouTube URL, embed the player
  if (videoId) {
    const embedUrl = getYouTubeEmbedUrl(videoId);

    return (
      <div className={`relative aspect-video w-full overflow-hidden rounded-lg ${className}`}>
        <iframe
          src={embedUrl}
          title={title || 'Video'}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  // For non-YouTube URLs, show a link to open in new tab
  return (
    <Button
      variant="outline"
      className={`flex h-auto flex-col items-center justify-center rounded-lg border border-border bg-muted/20 p-8 text-center ${className}`}
      onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-primary/10">
          <Play className="w-8 h-8 text-primary" />
        </div>
        <div>
          <p className="font-medium mb-2">Demo Video</p>
          <div className="flex items-center gap-2 text-sm">
            <ExternalLink className="w-4 h-4" />
            Open Video in New Tab
          </div>
        </div>
      </div>
    </Button>
  );
}
