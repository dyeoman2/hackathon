import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction } from 'convex/react';
import { ChevronDown, ChevronUp, Edit, FileText, Loader2, MoreVertical, Zap } from 'lucide-react';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { ProcessingLoader } from '~/components/ui/processing-loader';
import { SimpleTooltip } from '~/components/ui/simple-tooltip';
import { useToast } from '~/components/ui/toast';
import { EditSummaryModal } from './EditSummaryModal';

/**
 * Parses error messages and makes URLs clickable, opening in new tabs
 */
function renderErrorMessageWithClickableLinks(message: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = message.split(urlRegex);
  let cursor = 0;

  return parts.map((part) => {
    const key = `${part}-${cursor}`;
    cursor += part.length;
    const isUrl = /^https?:\/\/\S+$/i.test(part);

    if (isUrl) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => window.open(part, '_blank', 'noopener,noreferrer')}
          className="text-primary hover:text-primary/80 underline cursor-pointer"
          title={`Open ${part} in new tab`}
        >
          {part}
        </button>
      );
    }
    return part;
  });
}

type EarlyProcessingStage =
  | 'fetching-readme'
  | 'mapping-urls'
  | 'capturing-screenshots'
  | 'generating-summary'
  | null;

function getEarlyProcessingStage(submission: Doc<'submissions'>): EarlyProcessingStage {
  const source = submission.source;
  const hasReadme = !!source?.readmeFetchedAt;
  const screenshotStarted = !!source?.screenshotCaptureStartedAt;
  const screenshotCompleted = !!source?.screenshotCaptureCompletedAt;
  const hasSiteUrl = !!submission.siteUrl;
  const hasVideoUrl = !!submission.videoUrl;
  const hasNonRepoSources = hasSiteUrl || hasVideoUrl || (submission.screenshots?.length ?? 0) > 0;
  const processingState = submission.source?.processingState;
  const hasSummary = !!source?.aiSummary;
  const isAISearchComplete = !!submission.source?.aiSearchSyncCompletedAt;
  const hasProcessingError =
    (processingState === 'error' || !!submission.source?.processingError) && !hasNonRepoSources;

  // If summary already exists, no need to show loading
  if (hasSummary) {
    return null;
  }

  // If processing failed, don't show any early processing stages
  if (hasProcessingError) {
    return null;
  }

  // Don't show "generating summary" if AI Search indexing is complete
  // At this point, if there's no summary, it means it wasn't generated or failed
  if (isAISearchComplete) {
    return null;
  }

  // Stage 1: Fetching Readme
  if (!hasReadme && submission.repoUrl) {
    return 'fetching-readme';
  }

  // Stage 2: Mapping Website URLs (only if siteUrl exists)
  if (hasReadme && hasSiteUrl && !screenshotStarted) {
    return 'mapping-urls';
  }

  // Stage 3: Capturing Screenshots
  if (screenshotStarted && !screenshotCompleted) {
    return 'capturing-screenshots';
  }

  // Stage 4: Generating Summary
  // Show when README is fetched and screenshots are done (or no siteUrl), but summary doesn't exist yet
  if (hasReadme) {
    // If there's a siteUrl, wait for screenshots to complete
    // If there's no siteUrl, we can generate summary right away after README is fetched
    const screenshotsReady = !hasSiteUrl || screenshotCompleted;
    if (screenshotsReady && !hasSummary) {
      return 'generating-summary';
    }
  }

  return null;
}

function getEarlyProcessingMessage(stage: EarlyProcessingStage): {
  title: string;
  description: string;
} | null {
  switch (stage) {
    case 'fetching-readme':
      return {
        title: 'Fetching Readme',
        description: 'Fetching README file from repository...',
      };
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
    case 'generating-summary':
      return {
        title: 'Generating Summary',
        description: 'Generating summary from README and screenshots...',
      };
    default:
      return null;
  }
}

interface SubmissionRepositorySummaryProps {
  submission: Doc<'submissions'>;
  canEdit?: boolean;
}

export function SubmissionRepositorySummary({
  submission,
  canEdit = false,
}: SubmissionRepositorySummaryProps) {
  // Show manual summary if it exists, otherwise show AI summary
  // Manual summary takes priority over AI-generated summaries
  const manualSummary = submission.manualSummary;
  const aiSummary = submission.source?.aiSummary;
  const summary = manualSummary || aiSummary;
  const processingState = submission.source?.processingState;
  const processingError = submission.source?.processingError;
  const isAISearchComplete = !!submission.source?.aiSearchSyncCompletedAt;
  const hasManualSummary = !!manualSummary;
  const hasRepoProcessingError = processingState === 'error' || !!processingError;
  const hasSummary = !!summary;
  const hasScreenshots = (submission.screenshots?.length ?? 0) > 0;
  const hasSiteUrl = !!submission.siteUrl;
  const hasVideoUrl = !!submission.videoUrl;
  const hasNonRepoSources = hasScreenshots || hasSiteUrl || hasVideoUrl;
  const hasBlockingProcessingError = hasRepoProcessingError && !hasNonRepoSources && !hasSummary;

  // Show summary if it exists, regardless of processing state
  // The summary should not change when Cloudflare AI Search indexing finishes
  const showSummary = hasSummary;

  // Check if we're in early processing stages
  const earlyProcessingStage = getEarlyProcessingStage(submission);
  const earlyProcessingMessage = getEarlyProcessingMessage(earlyProcessingStage);
  const isEarlyProcessing = earlyProcessingStage !== null;

  // Detect "no data" scenarios for better error messages
  const source = submission.source;
  const hasReadme = !!source?.readme;
  const readmeFetched = !!source?.readmeFetchedAt;
  const screenshotStarted = !!source?.screenshotCaptureStartedAt;
  const screenshotCompleted = !!source?.screenshotCaptureCompletedAt;

  // Determine why summary wasn't generated
  const getNoSummaryReason = (): {
    title: string;
    description: string;
  } | null => {
    if (showSummary || isEarlyProcessing) {
      return null; // Summary exists or still processing
    }

    // Check if processing failed completely
    if (hasBlockingProcessingError) {
      return {
        title: 'Repository Processing Failed',
        description:
          processingError ||
          'Failed to download or process the repository. This could be due to access restrictions, network issues, or repository problems. No summary could be generated.',
      };
    }

    // README fetch completed but found nothing
    const readmeFetchFailed = readmeFetched && !hasReadme;
    // Screenshot capture started but failed (no completion timestamp or no screenshots)
    const screenshotCaptureFailed =
      hasSiteUrl && screenshotStarted && (!screenshotCompleted || !hasScreenshots);

    if (readmeFetchFailed && screenshotCaptureFailed) {
      return {
        title: 'Unable to Generate Summary',
        description:
          'No README file was found in the repository and screenshot capture failed. A summary requires at least a README file or screenshots of the live site.',
      };
    }

    if (readmeFetchFailed && hasSiteUrl) {
      if (screenshotStarted && !screenshotCompleted) {
        return {
          title: 'Waiting for Screenshots',
          description:
            'No README file was found in the repository. Waiting for screenshots to be captured before generating summary.',
        };
      }
      if (hasScreenshots) {
        return {
          title: 'Generating Summary',
          description:
            'No README file found, but screenshots are available. Generating summary from screenshots...',
        };
      }
      return {
        title: 'Unable to Generate Summary',
        description:
          'No README file was found in the repository. A summary requires at least a README file or screenshots of the live site.',
      };
    }

    if (readmeFetchFailed && !hasSiteUrl) {
      return {
        title: 'Unable to Generate Summary',
        description:
          'No README file was found in the repository. A summary requires at least a README file.',
      };
    }

    if (screenshotCaptureFailed && hasReadme) {
      return {
        title: 'Generating Summary',
        description:
          'Screenshot capture failed, but README is available. Generating summary from README...',
      };
    }

    return null;
  };

  const noSummaryReason = getNoSummaryReason();
  const [isGeneratingQuick, setIsGeneratingQuick] = useState(false);
  const [isGeneratingFull, setIsGeneratingFull] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const toast = useToast();
  const generateQuickSummary = useAction(api.submissionsActions.aiSummary.generateSummaryPublic);
  const generateFullSummary = useAction(api.submissionsActions.aiSummary.generateRepoSummary);
  const retryProcessing = useAction(api.submissions.retrySubmissionProcessing);

  const handleGenerateQuickSummary = useCallback(async () => {
    setIsGeneratingQuick(true);
    try {
      const result = await generateQuickSummary({
        submissionId: submission._id,
        forceRegenerate: true,
      });
      if (result.success) {
        toast.showToast('Quick summary generated successfully', 'success');
      } else if (result.skipped) {
        toast.showToast('Summary already exists', 'info');
      } else {
        toast.showToast(result.error || 'Failed to generate quick summary', 'error');
      }
    } catch (error) {
      console.error('Failed to generate quick summary:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to generate quick summary',
        'error',
      );
    } finally {
      setIsGeneratingQuick(false);
    }
  }, [submission._id, generateQuickSummary, toast]);

  const handleGenerateFullSummary = useCallback(async () => {
    setIsGeneratingFull(true);
    try {
      await generateFullSummary({
        submissionId: submission._id,
        forceRegenerate: true,
      });
      toast.showToast('Full AI Search summary generation started', 'success');
    } catch (error) {
      console.error('Failed to generate full summary:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to generate full summary',
        'error',
      );
    } finally {
      setIsGeneratingFull(false);
    }
  }, [submission._id, generateFullSummary, toast]);

  const handleRetryProcessing = useCallback(async () => {
    setIsRetrying(true);
    try {
      await retryProcessing({
        submissionId: submission._id,
      });
      toast.showToast('Repository processing restarted successfully', 'success');
    } catch (error) {
      console.error('Failed to retry processing:', error);
      toast.showToast(
        error instanceof Error ? error.message : 'Failed to retry processing',
        'error',
      );
    } finally {
      setIsRetrying(false);
    }
  }, [submission._id, retryProcessing, toast]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Summary</CardTitle>
            <CardDescription>
              {hasManualSummary
                ? 'Custom summary of the project.'
                : 'AI-generated summary of the project.'}
            </CardDescription>
          </div>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="touch-manipulation">
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Summary actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="flex flex-col">
                <SimpleTooltip content="Edit the manual summary for this submission">
                  <DropdownMenuItem onClick={() => setIsEditModalOpen(true)}>
                    <Edit className="h-4 w-4" />
                    Edit Summary
                  </DropdownMenuItem>
                </SimpleTooltip>
                <DropdownMenuSeparator />
                <SimpleTooltip content="Generated from the repository README, video, and screenshots of the website">
                  <DropdownMenuItem
                    onClick={handleGenerateQuickSummary}
                    disabled={isGeneratingQuick || isGeneratingFull}
                  >
                    {isGeneratingQuick ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4" />
                        Summary
                      </>
                    )}
                  </DropdownMenuItem>
                </SimpleTooltip>
                <SimpleTooltip
                  content={
                    !isAISearchComplete
                      ? 'Unavailable until the repository finishes indexing with AI Search'
                      : isGeneratingQuick || isGeneratingFull
                        ? 'Please wait for the current operation to complete'
                        : 'Generated from repository files using AI Search (slower, more detailed)'
                  }
                >
                  <DropdownMenuItem
                    onClick={handleGenerateFullSummary}
                    disabled={isGeneratingQuick || isGeneratingFull || !isAISearchComplete}
                  >
                    {isGeneratingFull ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating RAG Summary...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4" />
                        RAG Summary
                      </>
                    )}
                  </DropdownMenuItem>
                </SimpleTooltip>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEarlyProcessing && earlyProcessingMessage ? (
          <ProcessingLoader
            title={earlyProcessingMessage.title}
            description={earlyProcessingMessage.description}
          />
        ) : showSummary ? (
          <div className="space-y-4">
            <div
              className={`prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-4 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-pre:bg-muted prose-pre:border prose-pre:rounded-lg prose-pre:p-4 prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground prose-li:my-2 prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80 prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic ${
                !isSummaryExpanded ? 'line-clamp-4' : ''
              }`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
            {summary.length > 500 && ( // Show button if summary is reasonably long
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                className="h-auto p-0 text-muted-foreground hover:text-foreground"
              >
                {isSummaryExpanded ? (
                  <>
                    Show Less
                    <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    Show More
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        ) : noSummaryReason ? (
          <Alert variant="warning">
            <AlertTitle>{noSummaryReason.title}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>
                {hasBlockingProcessingError && processingError
                  ? renderErrorMessageWithClickableLinks(processingError)
                  : noSummaryReason.description}
              </p>
              {hasBlockingProcessingError && (
                <Button
                  onClick={handleRetryProcessing}
                  disabled={isRetrying}
                  size="sm"
                  className="mt-2"
                >
                  {isRetrying ? 'Retrying...' : 'Retry Processing'}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : isAISearchComplete ? (
          <p className="text-sm text-muted-foreground">
            The comprehensive AI Search summary is now available in the Repo Chat card below.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The repository summary will automatically be generated once the repository README,
            video, and screenshots are available. This happens automatically when screenshots are
            captured.
          </p>
        )}
      </CardContent>
      <EditSummaryModal
        submission={submission}
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
      />
    </Card>
  );
}
