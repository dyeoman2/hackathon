import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction } from 'convex/react';
import { FileText, Loader2, MoreVertical, Zap } from 'lucide-react';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { ProcessingLoader } from '~/components/ui/processing-loader';
import { SimpleTooltip } from '~/components/ui/simple-tooltip';
import { useToast } from '~/components/ui/toast';

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
  const processingState = submission.source?.processingState;
  const hasSummary = !!source?.aiSummary;
  const isAISearchComplete = processingState === 'complete';

  // If summary already exists, no need to show loading
  if (hasSummary) {
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
  // Show summary from aiSummary field (can be early summary from README + screenshots or AI Search summary)
  // The summary should be displayed regardless of processing state once it's generated
  const summary = submission.source?.aiSummary;
  const processingState = submission.source?.processingState;
  const isAISearchComplete = processingState === 'complete';

  // Show summary if it exists, regardless of processing state
  // The summary should not change when Cloudflare AI Search indexing finishes
  const showSummary = !!summary;

  // Check if we're in early processing stages
  const earlyProcessingStage = getEarlyProcessingStage(submission);
  const earlyProcessingMessage = getEarlyProcessingMessage(earlyProcessingStage);
  const isEarlyProcessing = earlyProcessingStage !== null;
  const [isGeneratingQuick, setIsGeneratingQuick] = useState(false);
  const [isGeneratingFull, setIsGeneratingFull] = useState(false);
  const toast = useToast();
  const generateQuickSummary = useAction(api.submissionsActions.aiSummary.generateSummaryPublic);
  const generateFullSummary = useAction(api.submissionsActions.aiSummary.generateRepoSummary);

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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Summary</CardTitle>
            <CardDescription>AI-generated summary of the project.</CardDescription>
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
                <SimpleTooltip content="Generated from the repository README and screenshots of the website">
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
                        Quick Summary
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
                        Generating Full Summary...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4" />
                        Full Summary
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
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-4 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-pre:bg-muted prose-pre:border prose-pre:rounded-lg prose-pre:p-4 prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground prose-li:my-2 prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80 prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        ) : isAISearchComplete ? (
          <p className="text-sm text-muted-foreground">
            The comprehensive AI Search summary is now available in the Repo Chat card below.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The repository summary will automatically be generated once README and screenshots are
            available. This happens automatically when screenshots are captured.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
