import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction } from 'convex/react';
import { Camera, ChevronLeft, ChevronRight, Loader2, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';
import { useToast } from '~/components/ui/toast';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '~/components/ui/carousel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
} from '~/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog';

interface SubmissionScreenshotsProps {
  submission: Doc<'submissions'>;
  canEdit?: boolean;
}

export function SubmissionScreenshots({ submission, canEdit = false }: SubmissionScreenshotsProps) {
  const screenshots = submission.screenshots || [];
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingR2Key, setDeletingR2Key] = useState<string | null>(null);
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false);
  
  const toast = useToast();
  const captureScreenshot = useAction(api.submissionsActions.screenshot.captureScreenshot);

  const handleCaptureScreenshot = useCallback(async () => {
    if (!submission.siteUrl) {
      toast.showToast('No live URL available for this submission', 'error');
      return;
    }

    setIsCapturingScreenshot(true);
    try {
      const result = await captureScreenshot({ submissionId: submission._id });
      if (result && typeof result === 'object' && 'pagesCaptured' in result) {
        const pagesCaptured = result.pagesCaptured as number;
        const totalPagesFound = result.totalPagesFound as number;
        if (pagesCaptured > 1) {
          toast.showToast(
            `Captured ${pagesCaptured} of ${totalPagesFound} page${totalPagesFound !== 1 ? 's' : ''} successfully`,
            'success',
          );
        } else {
          toast.showToast('Screenshot captured successfully', 'success');
        }
      } else {
        toast.showToast('Screenshots captured successfully', 'success');
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to capture screenshot',
        'error',
      );
    } finally {
      setIsCapturingScreenshot(false);
    }
  }, [submission.siteUrl, submission._id, captureScreenshot, toast]);
  
  // Use optimistic mutation for instant UI updates - Convex handles rollback on error
  const removeScreenshotOptimistic = useOptimisticMutation(api.submissions.removeScreenshot, {
    onSuccess: () => {
      toast.showToast('Screenshot deleted successfully', 'success');
    },
    onError: (error) => {
      console.error('Failed to delete screenshot:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to delete screenshot',
        'error',
      );
      // Reopen confirmation dialog on error so user can try again
      if (deletingR2Key) {
        setDeleteConfirmOpen(true);
      }
    },
  });

  // Action to clean up R2 storage (fire and forget - doesn't block UI)
  const deleteScreenshotFromR2 = useAction(api.submissionsActions.screenshot.deleteScreenshotFromR2);

  // Keyboard navigation for modal
  useEffect(() => {
    if (openIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && openIndex > 0) {
        setOpenIndex(openIndex - 1);
      } else if (e.key === 'ArrowRight' && openIndex < screenshots.length - 1) {
        setOpenIndex(openIndex + 1);
      } else if (e.key === 'Escape') {
        setOpenIndex(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openIndex, screenshots.length]);

  // Close modal if the currently open screenshot no longer exists (was deleted)
  useEffect(() => {
    if (openIndex !== null && screenshots.length > 0) {
      // If the index is out of bounds, close the modal
      if (openIndex >= screenshots.length) {
        setOpenIndex(null);
      }
    } else if (openIndex !== null && screenshots.length === 0) {
      // If all screenshots were deleted, close the modal
      setOpenIndex(null);
    }
  }, [openIndex, screenshots.length]);

  if (!submission.siteUrl && screenshots.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Screenshots</CardTitle>
            <CardDescription>
              Visual previews of the live site captured via Firecrawl
            </CardDescription>
          </div>
          {canEdit && submission.siteUrl && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCaptureScreenshot}
              disabled={isCapturingScreenshot}
            >
              {isCapturingScreenshot ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Capturing...
                </>
              ) : (
                <>
                  <Camera className="mr-2 h-4 w-4" />
                  Capture Screenshot
                </>
              )}
            </Button>
          )}
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
          <div className="relative">
            <Carousel
              className="w-full"
              opts={{
                align: 'start',
                slidesToScroll: 'auto',
              }}
            >
              <CarouselContent>
                {screenshots.map((screenshot, index) => (
                  <CarouselItem key={screenshot.r2Key} className="basis-1/2 md:basis-1/3">
                    <button
                      type="button"
                      className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      onClick={() => setOpenIndex(index)}
                    >
                      <img
                        src={screenshot.url}
                        alt={`Screenshot ${index + 1} captured at ${new Date(screenshot.capturedAt).toLocaleString()}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2 text-xs text-white">
                        {screenshot.pageUrl ? (
                          <>
                            <div className="font-medium truncate">
                              {screenshot.pageName || new URL(screenshot.pageUrl).pathname || 'Page'}
                            </div>
                            <a
                              href={screenshot.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs opacity-80 truncate hover:opacity-100 hover:underline block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {new URL(screenshot.pageUrl).hostname}
                            </a>
                            <div className="text-xs opacity-60 mt-1">
                              Captured {new Date(screenshot.capturedAt).toLocaleString()}
                            </div>
                          </>
                        ) : (
                          <div className="text-xs opacity-60">
                            Captured {new Date(screenshot.capturedAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {screenshots.length > 1 && (
                <>
                  <CarouselPrevious className="left-2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background" />
                  <CarouselNext className="right-2 z-10 bg-background/80 backdrop-blur-sm hover:bg-background" />
                </>
              )}
            </Carousel>
          </div>
        )}
      </CardContent>

      {/* Full-size image modal */}
      <Dialog open={openIndex !== null && screenshots[openIndex] !== undefined} onOpenChange={(open) => !open && setOpenIndex(null)}>
        {openIndex !== null && screenshots[openIndex] && (
          <DialogContent 
            className="!max-w-[98vw] !w-[98vw] max-h-[98vh] h-[98vh] p-2 bg-black/95 border-none"
            showCloseButton={false}
          >
            <div className="relative flex items-center justify-center w-full h-full">
              {/* Action buttons - top right */}
              <div className="absolute top-4 right-4 z-20 flex gap-2">
                {/* Delete button */}
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-background/80 backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingR2Key(screenshots[openIndex].r2Key);
                    setDeleteConfirmOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete screenshot</span>
                </Button>
                {/* Close button */}
                <Button
                  variant="outline"
                  size="icon"
                  className="bg-background/80 backdrop-blur-sm hover:bg-background"
                  onClick={() => setOpenIndex(null)}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>

              {/* Previous button */}
              {screenshots.length > 1 && openIndex > 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute left-4 z-10 bg-background/80 backdrop-blur-sm hover:bg-background"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenIndex(openIndex - 1);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span className="sr-only">Previous image</span>
                </Button>
              )}

              {/* Full-size image */}
              <img
                src={screenshots[openIndex].url}
                alt={`Screenshot ${openIndex + 1} captured at ${new Date(screenshots[openIndex].capturedAt).toLocaleString()}`}
                className="max-w-full max-h-[96vh] w-auto h-auto object-contain rounded-lg"
              />

              {/* Next button */}
              {screenshots.length > 1 && openIndex < screenshots.length - 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="absolute right-4 z-10 bg-background/80 backdrop-blur-sm hover:bg-background"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenIndex(openIndex + 1);
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                  <span className="sr-only">Next image</span>
                </Button>
              )}

              {/* Image info */}
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 px-4 py-3 rounded-lg text-xs text-white max-w-[90%]">
                {screenshots[openIndex].pageUrl ? (
                  <>
                    <div className="font-medium text-center mb-1">
                      {screenshots[openIndex].pageName || new URL(screenshots[openIndex].pageUrl).pathname || `Page ${openIndex + 1}`}
                    </div>
                    <a
                      href={screenshots[openIndex].pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs opacity-80 text-center mb-1 break-all hover:opacity-100 hover:underline block"
                    >
                      {screenshots[openIndex].pageUrl}
                    </a>
                    <div className="text-xs opacity-60 text-center">
                      Screenshot {openIndex + 1} of {screenshots.length} • Captured{' '}
                      {new Date(screenshots[openIndex].capturedAt).toLocaleString()}
                    </div>
                  </>
                ) : (
                  <div className="text-xs opacity-60 text-center">
                    Screenshot {openIndex + 1} of {screenshots.length} • Captured{' '}
                    {new Date(screenshots[openIndex].capturedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Screenshot?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the screenshot from both the
              submission and storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                setDeletingR2Key(null);
                setDeleteConfirmOpen(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deletingR2Key) return;

                // Check if we're deleting the currently open screenshot BEFORE the mutation
                const isDeletingCurrentScreenshot = openIndex !== null && screenshots[openIndex]?.r2Key === deletingR2Key;

                // Close confirmation dialog immediately
                setDeleteConfirmOpen(false);
                setDeletingR2Key(null);

                // Close modal immediately if we're deleting the currently open screenshot
                // This ensures the modal closes right away, before the optimistic update
                if (isDeletingCurrentScreenshot) {
                  setOpenIndex(null);
                }

                try {
                  // Optimistic mutation - UI updates immediately, Convex handles rollback on error
                  await removeScreenshotOptimistic({
                    submissionId: submission._id,
                    r2Key: deletingR2Key,
                  });

                  // Clean up R2 storage in the background (fire and forget)
                  // This doesn't block the UI and failures are non-critical
                  deleteScreenshotFromR2({
                    submissionId: submission._id,
                    r2Key: deletingR2Key,
                  }).catch((error) => {
                    // Log but don't show error to user - R2 cleanup is best effort
                    console.error('Failed to delete screenshot from R2 (non-critical):', error);
                  });
                } catch (_error) {
                  // Error handling is done in the onError callback
                  // If error occurs, the useEffect will handle reopening if needed
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

