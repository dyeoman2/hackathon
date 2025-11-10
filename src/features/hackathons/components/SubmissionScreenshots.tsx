import type { Doc } from '@convex/_generated/dataModel';
import { Camera } from 'lucide-react';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '~/components/ui/carousel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';

interface SubmissionScreenshotsProps {
  submission: Doc<'submissions'>;
}

export function SubmissionScreenshots({ submission }: SubmissionScreenshotsProps) {
  const screenshots = submission.screenshots || [];

  if (!submission.siteUrl && screenshots.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Screenshots</CardTitle>
          <CardDescription>
            Visual previews of the live site captured via Firecrawl
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {screenshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              No screenshots captured yet. Use the actions menu to capture a screenshot of the live
              site.
            </p>
          </div>
        ) : (
          <Carousel className="w-full">
            <CarouselContent>
              {screenshots.map((screenshot, index) => (
                <CarouselItem key={screenshot.r2Key}>
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                    <img
                      src={screenshot.url}
                      alt={`Screenshot ${index + 1} captured at ${new Date(screenshot.capturedAt).toLocaleString()}`}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2 text-xs text-white">
                      Captured {new Date(screenshot.capturedAt).toLocaleString()}
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            {screenshots.length > 1 && (
              <>
                <CarouselPrevious />
                <CarouselNext />
              </>
            )}
          </Carousel>
        )}
      </CardContent>
    </Card>
  );
}

