import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction } from 'convex/react';
import { FileText, Loader2, Zap } from 'lucide-react';
import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { useToast } from '~/components/ui/toast';

interface SubmissionRepositorySummaryProps {
  submission: Doc<'submissions'>;
  canEdit?: boolean;
}

export function SubmissionRepositorySummary({
  submission,
  canEdit = false,
}: SubmissionRepositorySummaryProps) {
  const summary = submission.source?.aiSummary;
  const processingState = submission.source?.processingState;
  const [isGeneratingQuick, setIsGeneratingQuick] = useState(false);
  const [isGeneratingFull, setIsGeneratingFull] = useState(false);
  const toast = useToast();
  const generateQuickSummary = useAction(
    api.submissionsActions.aiSummary.generateEarlySummaryPublic,
  );
  const generateFullSummary = useAction(api.submissionsActions.aiSummary.generateRepoSummary);

  // Show processing state if automatic processing is in progress
  const isProcessing = processingState && processingState !== 'complete' && !summary;

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

  const getProcessingMessage = (state: string) => {
    switch (state) {
      case 'downloading':
        return {
          title: 'Downloading Repository',
          description: 'Downloading repository files from GitHub...',
        };
      case 'uploading':
        return {
          title: 'Uploading Repository',
          description: 'Uploading repository files to Cloudflare R2...',
        };
      case 'indexing':
        return {
          title: 'Indexing Repository',
          description:
            'Indexing repository files in Cloudflare AI Search. This may take a minute...',
        };
      case 'generating':
        return {
          title: 'Generating Summary',
          description: 'Generating AI summary from repository files and screenshots...',
        };
      default:
        return {
          title: 'Processing Repository',
          description: 'Processing repository...',
        };
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Repository Summary</CardTitle>
            <CardDescription>
              AI-generated summary of the repository based on code analysis, README, and screenshots
            </CardDescription>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateQuickSummary}
                disabled={isGeneratingQuick || isGeneratingFull || isProcessing}
                title="Generate quick summary using README and screenshots (fast)"
              >
                {isGeneratingQuick ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Quick Summary
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateFullSummary}
                disabled={isGeneratingQuick || isGeneratingFull || isProcessing}
                title="Generate comprehensive summary using AI Search (slower, more detailed)"
              >
                {isGeneratingFull ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileText className="mr-2 h-4 w-4" />
                    Full Summary
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isProcessing && processingState && (
          <div className="rounded-md border bg-muted/50 p-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
            <p className="text-sm font-medium mb-1">
              {getProcessingMessage(processingState).title}
            </p>
            <p className="text-xs text-muted-foreground">
              {getProcessingMessage(processingState).description}
            </p>
          </div>
        )}

        {summary && !isProcessing && (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-6 prose-headings:mb-4 prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-p:leading-relaxed prose-strong:text-foreground prose-strong:font-semibold prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-pre:bg-muted prose-pre:border prose-pre:rounded-lg prose-pre:p-4 prose-ul:text-muted-foreground prose-ol:text-muted-foreground prose-li:text-muted-foreground prose-li:my-2 prose-a:text-primary prose-a:underline hover:prose-a:text-primary/80 prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
          </div>
        )}

        {!summary && !isProcessing && (
          <p className="text-sm text-muted-foreground">
            The repository summary will automatically be generated once the repository files are
            uploaded and indexed. This may take a few minutes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
