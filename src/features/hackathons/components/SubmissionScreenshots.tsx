import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction, useMutation } from 'convex/react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreVertical,
  Play,
  SearchCode,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '~/components/ui/carousel';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Field, FieldLabel } from '~/components/ui/field';
import { Input } from '~/components/ui/input';
import { ProcessingLoader } from '~/components/ui/processing-loader';
import { useToast } from '~/components/ui/toast';
import { VideoPlayer } from '~/components/VideoPlayer';
import { useOptimisticMutation } from '~/features/admin/hooks/useOptimisticUpdates';

type ScreenshotProcessingStage = 'mapping-urls' | 'capturing-screenshots' | null;

function getScreenshotProcessingStage(submission: Doc<'submissions'>): ScreenshotProcessingStage {
  const source = submission.source;
  const screenshotStarted = !!source?.screenshotCaptureStartedAt;
  const screenshotCompleted = !!source?.screenshotCaptureCompletedAt;
  const hasSiteUrl = !!submission.siteUrl;
  const hasScreenshots = (submission.screenshots?.length ?? 0) > 0;

  // If screenshots already exist, no need to show loading
  if (hasScreenshots) {
    return null;
  }

  // Only show loading stages if there's a siteUrl (screenshots are only relevant for live sites)
  if (!hasSiteUrl) {
    return null;
  }

  // Stage 1: Mapping Website URLs
  if (hasSiteUrl && !screenshotStarted) {
    return 'mapping-urls';
  }

  // Stage 2: Capturing Screenshots
  if (screenshotStarted && !screenshotCompleted) {
    return 'capturing-screenshots';
  }

  return null;
}

function getScreenshotProcessingMessage(stage: ScreenshotProcessingStage): {
  title: string;
  description: string;
} | null {
  switch (stage) {
    case 'mapping-urls':
      return {
        title: 'Mapping Website URLs',
        description: 'Mapping website URLs for screenshot capture...',
      };
    case 'capturing-screenshots':
      return {
        title: 'Capturing Screenshots',
        description: 'Capturing screenshots from website pages...',
      };
    default:
      return null;
  }
}

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
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [isUpdatingVideo, setIsUpdatingVideo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if we're in screenshot processing stages
  const screenshotProcessingStage = getScreenshotProcessingStage(submission);
  const screenshotProcessingMessage = getScreenshotProcessingMessage(screenshotProcessingStage);
  const isScreenshotProcessing = screenshotProcessingStage !== null;

  const toast = useToast();
  const captureScreenshot = useAction(api.submissionsActions.screenshot.captureScreenshot);
  const uploadScreenshot = useAction(api.submissionsActions.screenshot.uploadScreenshot);
  const updateSubmission = useMutation(api.submissions.updateSubmission);

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

  const handleUploadScreenshot = useCallback(
    async (file: File) => {
      setIsUploadingScreenshot(true);
      try {
        // Read file as base64 string for Convex compatibility using FileReader
        const base64String = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            // Remove the "data:image/jpeg;base64," prefix if present
            const base64Data = result.split(',')[1];
            resolve(base64Data);
          };
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

        const result = await uploadScreenshot({
          submissionId: submission._id,
          fileBase64: base64String,
          fileName: file.name,
          pageName: file.name.split('.')[0] || 'Uploaded Screenshot',
        });

        if (result?.success) {
          toast.showToast('Screenshot uploaded successfully', 'success');
        } else {
          toast.showToast('Failed to upload screenshot', 'error');
        }
      } catch (error) {
        console.error('Failed to upload screenshot:', error);
        toast.showToast(
          error instanceof Error ? error.message : 'Failed to upload screenshot',
          'error',
        );
      } finally {
        setIsUploadingScreenshot(false);
      }
    },
    [submission._id, uploadScreenshot, toast],
  );

  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        // Validate file type
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.type)) {
          toast.showToast('Please select a valid image file (JPEG, PNG, or WebP)', 'error');
          return;
        }

        // Validate file size (10MB limit)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
          toast.showToast('File size must be less than 10MB', 'error');
          return;
        }

        handleUploadScreenshot(file);
      }
      // Reset input
      event.target.value = '';
    },
    [handleUploadScreenshot, toast],
  );

  const handleUpdateVideoUrl = useCallback(
    async (videoUrl: string) => {
      setIsUpdatingVideo(true);
      try {
        await updateSubmission({
          submissionId: submission._id,
          videoUrl: videoUrl.trim() || undefined,
        });

        toast.showToast(
          videoUrl.trim() ? 'Demo video added successfully' : 'Demo video removed successfully',
          'success',
        );
        setIsVideoModalOpen(false);
      } catch (error) {
        console.error('Failed to update video URL:', error);
        toast.showToast(
          error instanceof Error ? error.message : 'Failed to update demo video',
          'error',
        );
      } finally {
        setIsUpdatingVideo(false);
      }
    },
    [submission._id, updateSubmission, toast],
  );

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
  const deleteScreenshotFromR2 = useAction(
    api.submissionsActions.screenshot.deleteScreenshotFromR2,
  );

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

  if (!submission.siteUrl && !submission.videoUrl && screenshots.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Media</CardTitle>
            <CardDescription>
              Screenshots captured via Firecrawl, uploaded images, and demo videos
            </CardDescription>
          </div>
          {canEdit && submission.siteUrl && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="touch-manipulation">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Screenshot actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="flex flex-col">
                <DropdownMenuItem
                  onClick={handleCaptureScreenshot}
                  disabled={isCapturingScreenshot}
                >
                  {isCapturingScreenshot ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Capturing...
                    </>
                  ) : (
                    <>
                      <SearchCode className="h-4 w-4" />
                      Auto Capture
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingScreenshot}
                >
                  {isUploadingScreenshot ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      Upload
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setIsVideoModalOpen(true)}
                  disabled={isUpdatingVideo}
                >
                  {isUpdatingVideo ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Add Demo Video
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Screenshot Processing */}
        {isScreenshotProcessing && screenshotProcessingMessage ? (
          <ProcessingLoader
            title={screenshotProcessingMessage.title}
            description={screenshotProcessingMessage.description}
          />
        ) : screenshots.length === 0 && !submission.videoUrl ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Camera className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              No screenshots captured yet. Use the actions menu to capture a screenshot of the live
              site or upload your own images.
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
                {/* Video as first item */}
                {submission.videoUrl && (
                  <CarouselItem className="basis-1/2 md:basis-1/3">
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted">
                      <VideoPlayer
                        url={submission.videoUrl}
                        title={`Demo video for ${submission.title}`}
                        className="absolute inset-0 w-full h-full"
                      />
                    </div>
                  </CarouselItem>
                )}
                {/* Screenshot capture placeholder */}
                {isCapturingScreenshot && (
                  <CarouselItem className="basis-1/2 md:basis-1/3">
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted/50">
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                        <div className="text-xs text-muted-foreground text-center px-2">
                          <div className="font-medium">Capturing</div>
                          <div className="mt-1">Auto screenshots</div>
                        </div>
                      </div>
                    </div>
                  </CarouselItem>
                )}
                {/* Screenshot upload placeholder */}
                {isUploadingScreenshot && (
                  <CarouselItem className="basis-1/2 md:basis-1/3">
                    <div className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted/50">
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                        <div className="text-xs text-muted-foreground text-center px-2">
                          <div className="font-medium">Uploading</div>
                          <div className="mt-1">Custom screenshot</div>
                        </div>
                      </div>
                    </div>
                  </CarouselItem>
                )}
                {/* Screenshots */}
                {screenshots.map((screenshot, index) => (
                  <CarouselItem key={screenshot.r2Key} className="basis-1/2 md:basis-1/3">
                    <button
                      type="button"
                      className="relative aspect-video w-full overflow-hidden rounded-lg border bg-muted cursor-pointer hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 touch-manipulation"
                      onClick={(e) => {
                        // Don't open modal if clicking on a link
                        const target = e.target as HTMLElement;
                        if (target.tagName === 'A' || target.closest('a')) {
                          return;
                        }
                        setOpenIndex(index);
                      }}
                    >
                      <img
                        src={screenshot.url}
                        alt={`Screenshot ${index + 1} captured at ${new Date(screenshot.capturedAt).toLocaleString()}`}
                        className="h-full w-full object-contain"
                        loading="lazy"
                      />
                      <div className="hidden sm:block absolute bottom-0 left-0 right-0 bg-black/60 px-3 py-2 text-xs text-white">
                        {screenshot.pageUrl ? (
                          <>
                            <div className="font-medium truncate">
                              {screenshot.pageName ||
                                new URL(screenshot.pageUrl).pathname ||
                                'Page'}
                            </div>
                            <a
                              href={screenshot.pageUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs opacity-80 truncate hover:opacity-100 hover:underline block sm:hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                // On mobile, open modal instead of link
                                const isMobile = window.innerWidth < 640; // sm breakpoint
                                if (isMobile) {
                                  e.preventDefault();
                                  setOpenIndex(index);
                                } else {
                                  // On desktop, open link
                                  e.preventDefault();
                                  window.open(screenshot.pageUrl, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              onPointerDown={(e) => {
                                // On mobile, don't stop propagation so modal can open
                                const isMobile = window.innerWidth < 640;
                                if (!isMobile) {
                                  e.stopPropagation();
                                }
                              }}
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
              {screenshots.length +
                (submission.videoUrl ? 1 : 0) +
                (isCapturingScreenshot ? 1 : 0) +
                (isUploadingScreenshot ? 1 : 0) >
                1 && (
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
      <Dialog
        open={openIndex !== null && screenshots[openIndex] !== undefined}
        onOpenChange={(open) => !open && setOpenIndex(null)}
      >
        {openIndex !== null && screenshots[openIndex] && (
          <DialogContent
            className="max-w-[98vw]! w-[98vw]! max-h-[98vh] h-[98vh] p-2 bg-black/95 border-none"
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
                      {screenshots[openIndex].pageName ||
                        new URL(screenshots[openIndex].pageUrl).pathname ||
                        `Page ${openIndex + 1}`}
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
              This action cannot be undone. This will permanently delete the screenshot from both
              the submission and storage.
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
                const isDeletingCurrentScreenshot =
                  openIndex !== null && screenshots[openIndex]?.r2Key === deletingR2Key;

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

      {/* Demo Video Modal */}
      <Dialog open={isVideoModalOpen} onOpenChange={setIsVideoModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {submission.videoUrl ? 'Update Demo Video' : 'Add Demo Video'}
            </DialogTitle>
            <DialogDescription>
              {submission.videoUrl
                ? 'Update or remove the demo video URL for your project.'
                : 'Add a demo video URL to showcase your project. YouTube videos will be embedded directly, while other video platforms will open in a new tab.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const videoUrl = formData.get('videoUrl') as string;
              handleUpdateVideoUrl(videoUrl);
            }}
          >
            <Field>
              <FieldLabel>Demo Video URL</FieldLabel>
              <Input
                type="url"
                name="videoUrl"
                defaultValue={submission.videoUrl || ''}
                placeholder="https://youtube.com/watch?v=... or any video URL"
                disabled={isUpdatingVideo}
                required
              />
            </Field>
            <DialogFooter className="mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsVideoModalOpen(false)}
                disabled={isUpdatingVideo}
              >
                Cancel
              </Button>
              {submission.videoUrl && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => handleUpdateVideoUrl('')}
                  disabled={isUpdatingVideo}
                >
                  Remove Video
                </Button>
              )}
              <Button type="submit" disabled={isUpdatingVideo}>
                {isUpdatingVideo ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {submission.videoUrl ? 'Updating...' : 'Adding...'}
                  </>
                ) : submission.videoUrl ? (
                  'Update Video'
                ) : (
                  'Add Video'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Hidden file input for screenshot upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
      />
    </Card>
  );
}
