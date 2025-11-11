import type { Doc } from '@convex/_generated/dataModel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { ProcessingLoader } from '~/components/ui/processing-loader';

interface SubmissionRepoChatProps {
  submission: Doc<'submissions'>;
}

export function SubmissionRepoChat({ submission }: SubmissionRepoChatProps) {
  const processingState = submission.source?.processingState;

  // Show processing state if automatic processing is in progress (same logic as Scoring section)
  const isProcessing = processingState && processingState !== 'complete';

  const getProcessingMessage = (state: string | undefined) => {
    switch (state) {
      case 'downloading':
        return {
          title: 'Downloading Repository',
          description: 'Downloading repository files from GitHub...',
        };
      case 'indexing':
        return {
          title: 'Indexing Repository',
          description:
            'Indexing repository files in Cloudflare AI Search. This may take a five minutes...',
        };
      case 'generating':
        return {
          title: 'Generating Score',
          description: 'Generating AI score from repository files...',
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
        <CardTitle>Repo Chat</CardTitle>
        <CardDescription>
          AI-powered comprehensive analysis of the repository using Cloudflare AI Search
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isProcessing ? (
          <ProcessingLoader
            title={getProcessingMessage(processingState).title}
            description={getProcessingMessage(processingState).description}
          />
        ) : processingState === 'complete' ? (
          <p className="text-sm text-muted-foreground">Ready to chat</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            The repository will be indexed in Cloudflare AI Search. Once complete, you'll be able to
            chat with the repository.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
