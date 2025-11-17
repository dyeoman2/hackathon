import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction, useQuery } from 'convex/react';
import {
  isValidElement,
  type ReactElement,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { SiGithub } from 'react-icons/si';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Alert, AlertDescription, AlertTitle } from '~/components/ui/alert';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { ProcessingLoader } from '~/components/ui/processing-loader';
import { useToast } from '~/components/ui/toast';

interface SubmissionRepoChatProps {
  submission: Doc<'submissions'>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export function SubmissionRepoChat({ submission }: SubmissionRepoChatProps) {
  const processingState = submission.source?.processingState;
  const processingError = submission.source?.processingError;
  const aiSearchSyncCompletedAt = submission.source?.aiSearchSyncCompletedAt;
  const r2PathPrefix = submission.source?.r2Key;
  const streamAISearch = useAction(api.cloudflareAi.streamAISearchForRepoChat);
  const retryProcessing = useAction(api.submissions.retrySubmissionProcessing);

  // Get GitHub repo base URL for file links
  const getGitHubRepoBase = () => {
    if (!submission.repoUrl) return null;
    const githubUrl = submission.repoUrl.trim();
    const githubMatch = githubUrl.match(/github\.com[:/]+([^/]+)\/([^/#?]+)/i);
    if (!githubMatch) return null;
    const [, owner, repo] = githubMatch;
    const repoName = repo.replace(/\.git$/, '').replace(/\/$/, '');
    return `https://github.com/${owner}/${repoName}`;
  };

  const githubRepoBase = getGitHubRepoBase();

  const extractLinkText = (node: ReactNode): string => {
    if (typeof node === 'string') {
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((child) => extractLinkText(child)).join('');
    }
    if (isValidElement(node)) {
      const element = node as ReactElement<{ children?: ReactNode }>;
      if (element.props?.children) {
        return extractLinkText(element.props.children);
      }
    }
    return '';
  };

  // Transform file paths in message content from R2 paths to GitHub paths
  const transformFilePaths = (content: string): string => {
    if (!r2PathPrefix || !githubRepoBase) return content;

    // Use r2PathPrefix to match paths (e.g., "repos/{submissionId}/files/")
    // Escape special regex characters in the prefix
    const escapedPrefix = r2PathPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Simple approach: replace R2 paths with GitHub links
    // Match: repos/{submissionId}/files/path/to/file
    // Stop at whitespace, parentheses, brackets, commas, or end of string
    // Use a more permissive pattern that allows matching paths even when followed by )
    // First try with the exact prefix
    const r2PathPattern = new RegExp(`${escapedPrefix}([^\\s<>"'\\],]+?)(?=\\s|$|,|\\)|\\])`, 'g');

    // Also try matching the general pattern in case prefix doesn't match exactly
    // This handles cases where the path might be from a different submission or format
    const generalR2Pattern = /repos\/[^/]+\/files\/([^\s<>"'),\]]+?)(?=\s|$|,|\)|\])/g;

    const transformPath = (
      match: string,
      filePath: string,
      offset: number,
      fullContent: string,
    ): string => {
      // Don't transform if already inside a markdown link
      // Check if there's a ]( before this match
      const beforeMatch = fullContent.substring(Math.max(0, offset - 100), offset);
      if (beforeMatch.includes('](')) {
        // Check if we're inside a link by finding the last ]( before us
        const lastLinkStart = beforeMatch.lastIndexOf('](');
        const afterLastLink = fullContent.substring(offset - 100 + lastLinkStart + 2, offset);
        // If there's no closing ) before our match, we're inside a link
        if (!afterLastLink.includes(')')) {
          return match;
        }
      }

      const cleanPath = filePath.replace(/\/$/, '').replace(/^\/+/, '');
      // Encode path segments for URL
      const encodedPath = cleanPath
        .split('/')
        .map((segment: string) => encodeURIComponent(segment))
        .join('/');

      return `[${cleanPath}](${githubRepoBase}/blob/main/${encodedPath})`;
    };

    // First try with the exact prefix
    let transformed = content.replace(r2PathPattern, (match, filePath, offset) =>
      transformPath(match, filePath, offset, content),
    );

    // Also try the general pattern to catch any R2 paths that might not match the prefix
    transformed = transformed.replace(generalR2Pattern, (match, filePath, offset) => {
      // Only transform if it's not already a markdown link
      if (!match.startsWith('[')) {
        return transformPath(match, filePath, offset, transformed);
      }
      return match;
    });

    // Handle multiple links in parentheses: ( [link1](url1), [link2](url2) )
    // Also handles trailing punctuation: text ( [link1](url1), [link2](url2) ). or ):
    // Remove parentheses and commas, replace commas with spaces
    // Ensure proper spacing between links for ReactMarkdown to parse correctly
    transformed = transformed.replace(
      /\((\s*\[[^\]]+\]\([^)]+\)(?:\s*,\s*\[[^\]]+\]\([^)]+\))+)\s*\)([.:])?/g,
      (match, linksContent, trailingPunct) => {
        // Verify it's only links and commas
        const trimmed = linksContent.trim();
        const linkPattern = /\[[^\]]+\]\([^)]+\)/g;
        const allLinks = trimmed.match(linkPattern);
        const withoutLinks = trimmed.replace(linkPattern, '').replace(/,/g, '').trim();

        if (allLinks && allLinks.length > 0 && withoutLinks === '') {
          // Remove commas and replace with spaces, remove parentheses
          // Ensure there's a space between links for proper markdown parsing
          const linksWithoutCommas = trimmed.replace(/,\s*/g, ' ').replace(/\s+/g, ' ');
          return linksWithoutCommas + (trailingPunct ? ` ${trailingPunct}` : '');
        }
        return match;
      },
    );

    // Handle links wrapped in square brackets where the content is a list of Markdown links.
    // Example: [ [link1](url1), [link2](url2) ] -> [link1](url1) [link2](url2)
    transformed = transformed.replace(
      /\[(\s*\[[^\]]+\]\([^)]+\)(?:\s*(?:,|\s)\s*\[[^\]]+\]\([^)]+\))*)\s*\](\s*[.:,])?/g,
      (match, linksContent, trailingPunct) => {
        const trimmed = linksContent.trim();
        const linkPattern = /\[[^\]]+\]\([^)]+\)/g;
        const allLinks = trimmed.match(linkPattern);
        const withoutLinks = trimmed.replace(linkPattern, '').replace(/[,]/g, '').trim();

        if (allLinks && allLinks.length > 0 && withoutLinks === '') {
          const normalized = trimmed.replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();
          return normalized + (trailingPunct ? trailingPunct : '');
        }

        return match;
      },
    );

    // Also handle links that are already outside parentheses but have commas between them
    // Pattern: [link1](url1), [link2](url2), [link3](url3) -> [link1](url1) [link2](url2) [link3](url3)
    // This handles any number of links separated by commas
    // Ensure proper spacing for ReactMarkdown parsing
    transformed = transformed.replace(
      /(\[[^\]]+\]\([^)]+\))\s*,\s*(\[[^\]]+\]\([^)]+\))/g,
      (_match, link1, link2) => {
        // Ensure there's exactly one space between links
        return `${link1} ${link2}`;
      },
    );

    // Clean up any remaining multiple spaces between links
    transformed = transformed.replace(/(\[[^\]]+\]\([^)]+\))\s{2,}(\[[^\]]+\]\([^)]+\))/g, '$1 $2');

    // Convert plain file names in backticks and parentheses to GitHub links
    // Pattern: `filename.ext` or (filename.ext, filename2.ext) -> [filename.ext](url) [filename2.ext](url)
    // Only match if not already a markdown link
    // Common file extensions for codebases
    const fileExtensionPattern =
      /\.(ts|tsx|js|jsx|md|json|txt|yml|yaml|css|html|py|java|cpp|c|h|go|rs|rb|php|sh|bat|cmd|sql|graphql|gql|xml|svg|png|jpg|jpeg|gif|webp|ico|pdf)$/i;

    const convertFileToLink = (fileName: string): string => {
      const commonPaths = ['', 'docs/', 'src/', 'convex/'];
      const basePath = commonPaths[0]; // Start with root
      const fullPath = basePath + fileName;
      const encodedPath = fullPath
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/');
      return `[${fileName}](${githubRepoBase}/blob/main/${encodedPath})`;
    };

    // Convert file names in parentheses FIRST (to catch backtick-wrapped files inside parentheses)
    // Pattern: (filename.ext) or (document `filename.ext`, `filename2.ext`) -> [filename.ext](url) [filename2.ext](url)
    // Also handles cases like: (text filename.ext, filename2.ext)
    // Handle trailing punctuation: (document `file.ext`). -> document [file.ext](url) .
    transformed = transformed.replace(
      /\(([^)]+)\)([.,:;])?/g,
      (match, content, trailingPunct, offset) => {
        // Skip if this is already part of a markdown link
        const beforeMatch = transformed.substring(Math.max(0, offset - 50), offset);
        if (beforeMatch.includes('](')) {
          return match;
        }

        // Extract file names from content - they might be in backticks or plain
        // Pattern: look for backtick-wrapped filenames or plain filenames
        const backtickFiles = content.match(/`([^`]+)`/g) || [];
        const plainFiles: string[] = [];

        // Also check for plain file names (not in backticks)
        // Split by comma and check each part
        const parts = content.split(',').map((p: string) => p.trim());
        for (const part of parts) {
          // Remove backticks if present and check if it's a filename
          const cleaned = part.replace(/^`|`$/g, '').trim();
          // Check if it looks like a filename (has extension, no spaces, or spaces only from "document" prefix)
          if (fileExtensionPattern.test(cleaned) && /^[a-zA-Z0-9_\-./]+$/.test(cleaned)) {
            plainFiles.push(cleaned);
          }
        }

        // Combine files from backticks and plain text
        const allFiles: string[] = [];

        // Extract from backticks
        for (const bt of backtickFiles) {
          const fileName = bt.replace(/^`|`$/g, '').trim();
          if (fileExtensionPattern.test(fileName) && /^[a-zA-Z0-9_\-./]+$/.test(fileName)) {
            allFiles.push(fileName);
          }
        }

        // Add plain files that weren't already in backticks
        for (const pf of plainFiles) {
          if (!allFiles.includes(pf)) {
            allFiles.push(pf);
          }
        }

        if (allFiles.length > 0) {
          // Convert each file name to a GitHub link
          const links = allFiles.map(convertFileToLink);
          // Check if there was text like "document" before the file names
          // Remove backticks and file names to check for prefix text
          const contentWithoutFiles = content
            .replace(/`[^`]+`/g, '') // Remove backtick-wrapped content
            .replace(
              /[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx|md|json|txt|yml|yaml|css|html|py|java|cpp|c|h|go|rs|rb|php|sh|bat|cmd|sql|graphql|gql|xml|svg|png|jpg|jpeg|gif|webp|ico|pdf)/gi,
              '',
            ) // Remove file names
            .replace(/,/g, '') // Remove commas
            .trim()
            .toLowerCase();

          const linkText = contentWithoutFiles.startsWith('document')
            ? `document ${links.join(' ')}`
            : links.join(' ');

          // Return with trailing punctuation (no extra spacing needed)
          return trailingPunct ? `${linkText}${trailingPunct}` : linkText;
        }

        return match;
      },
    );

    // Handle single link in parentheses: ( [filename](url) ) becomes [filename](url)
    // Also handles: text ( [link](url) ). or text ( [link](url) ):
    // Put trailing punctuation outside the link to avoid it being included in the button
    transformed = transformed.replace(
      /\((\s*\[[^\]]+\]\([^)]+\))\s*\)([.:])?/g,
      (match, linkContent, trailingPunct) => {
        // Make sure it's just a link, no other text
        const trimmed = linkContent.trim();
        if (trimmed.match(/^\[[^\]]+\]\([^)]+\)$/)) {
          return trimmed + (trailingPunct ? ` ${trailingPunct}` : '');
        }
        return match;
      },
    );

    // Convert standalone file names in backticks (not already converted): `filename.ext` -> [filename.ext](url)
    // Handle multiple files separated by commas: `file1.ext`, `file2.ext` -> [file1.ext](url) [file2.ext](url)
    transformed = transformed.replace(/`([^`]+)`/g, (match, content, offset) => {
      // Skip if this is already part of a markdown link
      const beforeMatch = transformed.substring(Math.max(0, offset - 50), offset);
      if (beforeMatch.includes('](')) {
        return match;
      }

      // Check if content looks like file names (has extension and possibly commas)
      const files = content
        .split(',')
        .map((f: string) => f.trim())
        .filter((f: string) => {
          // Must have a file extension and look like a filename
          return fileExtensionPattern.test(f) && /^[a-zA-Z0-9_\-./]+$/.test(f);
        });

      if (files.length > 0) {
        // Convert each file name to a GitHub link
        const links = files.map(convertFileToLink);
        return links.join(' ');
      }

      return match;
    });

    return transformed;
  };

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRequestId, setCurrentRequestId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Watch for streaming response updates
  const streamingResponse = useQuery(
    api.aiResponses.getResponseByRequestKey,
    currentRequestId ? { requestKey: currentRequestId } : 'skip',
  );

  // Auto-scroll to bottom when messages change (only scroll the messages container, not the page)
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  });

  // Update messages when streaming response changes
  useLayoutEffect(() => {
    if (!streamingResponse || !currentRequestId) return;

    setMessages((prev) => {
      // Find the assistant message for this request
      const assistantMessageIndex = prev.findIndex(
        (msg) => msg.id === `assistant-${currentRequestId}`,
      );

      if (streamingResponse.status === 'error') {
        // Handle error
        const errorContent = `Error: ${streamingResponse.errorMessage || 'Failed to get AI response'}`;
        if (assistantMessageIndex >= 0) {
          const updated = [...prev];
          updated[assistantMessageIndex] = {
            ...updated[assistantMessageIndex],
            content: errorContent,
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: `assistant-${currentRequestId}`,
              role: 'assistant',
              content: errorContent,
              timestamp: new Date(),
            },
          ];
        }
      } else if (streamingResponse.status === 'complete') {
        // Update with final response
        const finalContent = streamingResponse.response || 'No response generated.';
        if (assistantMessageIndex >= 0) {
          const updated = [...prev];
          updated[assistantMessageIndex] = {
            ...updated[assistantMessageIndex],
            content: finalContent,
          };
          return updated;
        } else {
          return [
            ...prev,
            {
              id: `assistant-${currentRequestId}`,
              role: 'assistant',
              content: finalContent,
              timestamp: new Date(),
            },
          ];
        }
      } else if (streamingResponse.status === 'pending') {
        // Update with streaming content
        const currentContent = streamingResponse.response || '';
        // Only create/update message if there's actual content
        // This prevents empty message bubbles from appearing
        if (currentContent.trim() === '') {
          return prev;
        }

        if (assistantMessageIndex >= 0) {
          const updated = [...prev];
          updated[assistantMessageIndex] = {
            ...updated[assistantMessageIndex],
            content: currentContent,
          };
          return updated;
        } else {
          // Create new message only when we have content
          return [
            ...prev,
            {
              id: `assistant-${currentRequestId}`,
              role: 'assistant',
              content: currentContent,
              timestamp: new Date(),
            },
          ];
        }
      }

      return prev;
    });

    // Update loading state and clear request ID when complete or error
    if (streamingResponse.status === 'complete' || streamingResponse.status === 'error') {
      setIsLoading(false);
      setCurrentRequestId(null);
    }
  }, [streamingResponse, currentRequestId]);

  // Show processing state if indexing is still in progress (until AI Search sync is completed)
  const isProcessing =
    processingState !== 'complete' && processingState !== 'error' && !aiSearchSyncCompletedAt;

  // Show error state if processing failed
  const hasProcessingError = processingState === 'error';

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
            'Indexing repository files in Cloudflare AI Search. This may take up to five minutes...',
        };
      default:
        return {
          title: 'Processing Repository',
          description: 'Processing repository...',
        };
    }
  };

  const getErrorMessage = () => ({
    title: 'Repository Processing Failed',
    description:
      processingError ||
      'Failed to download or process the repository. This could be due to access restrictions, network issues, or repository problems.',
  });

  const createRequestId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `repo-chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const handleRetryProcessing = async () => {
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
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !r2PathPrefix) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const requestId = createRequestId();
    setCurrentRequestId(requestId);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      // Build query that includes path prefix context
      const queryWithContext = `${input.trim()}\n\nIMPORTANT: Only analyze files from the path "${r2PathPrefix}". Ignore any files from other repositories or submissions.`;

      await streamAISearch({
        query: queryWithContext,
        model: 'google-ai-studio/gemini-2.5-flash',
        maxNumResults: 20,
        pathPrefix: r2PathPrefix,
        requestId,
      });

      // The response will be updated via useQuery subscription
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get AI response';
      setError(errorMessage);
      const errorMsg: Message = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setIsLoading(false);
      setCurrentRequestId(null);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (hasProcessingError) {
    const errorMessage = getErrorMessage();
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repo Chat</CardTitle>
          <CardDescription>
            AI-powered comprehensive analysis of the repository using Cloudflare AI Search
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertTitle>{errorMessage.title}</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{errorMessage.description}</p>
              <Button
                onClick={handleRetryProcessing}
                disabled={isRetrying}
                size="sm"
                className="mt-2"
              >
                {isRetrying ? 'Retrying...' : 'Retry Processing'}
              </Button>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (isProcessing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repo Chat</CardTitle>
          <CardDescription>
            AI-powered comprehensive analysis of the repository using Cloudflare AI Search
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProcessingLoader
            title={getProcessingMessage(processingState).title}
            description={getProcessingMessage(processingState).description}
          />
        </CardContent>
      </Card>
    );
  }

  if (!submission.repoUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repo Chat</CardTitle>
          <CardDescription>
            AI-powered comprehensive analysis of the repository using Cloudflare AI Search
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Repo Chat is unavailable. This submission does not have a GitHub repository URL.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!r2PathPrefix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Repo Chat</CardTitle>
          <CardDescription>
            AI-powered comprehensive analysis of the repository using Cloudflare AI Search
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The repository will be indexed in Cloudflare AI Search. Once complete, you'll be able to
            chat with the repository.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repo Chat</CardTitle>
        <CardDescription>
          Ask questions about the repository using AI Search. Responses are based on the indexed
          repository files.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Messages */}
        <div
          ref={messagesContainerRef}
          className="flex flex-col gap-3 min-h-[300px] max-h-[500px] overflow-y-auto p-4 border rounded-lg bg-background"
        >
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[250px]">
              <p className="text-sm text-muted-foreground text-center">
                Start a conversation by asking a question about the repository.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} w-full`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-4 py-3 shadow-sm ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-foreground border border-border'
                  }`}
                >
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-medium prose-headings:text-foreground prose-headings:mt-2 prose-headings:mb-1.5 prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-p:text-foreground prose-p:leading-relaxed prose-p:my-1 prose-strong:text-foreground prose-strong:font-medium prose-code:text-foreground prose-code:bg-background prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:font-mono prose-pre:bg-background prose-pre:border prose-pre:rounded-md prose-pre:p-2 prose-pre:my-1.5 prose-ul:text-foreground prose-ol:text-foreground prose-li:text-foreground prose-li:my-0.5 prose-a:text-primary prose-a:no-underline hover:prose-a:text-primary/80 prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:my-1 prose-blockquote:text-sm">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, href, children, ...props }) => {
                            // Check if this is a GitHub file link
                            if (
                              href &&
                              githubRepoBase &&
                              href.startsWith(githubRepoBase) &&
                              href.includes('/blob/')
                            ) {
                              // Extract file path from GitHub URL
                              // Format: https://github.com/owner/repo/blob/HEAD/path/to/file
                              // or: https://github.com/owner/repo/blob/main/path/to/file
                              const blobMatch = href.match(/\/blob\/[^/]+\/(.+)$/);
                              const filePath = blobMatch ? decodeURIComponent(blobMatch[1]) : '';
                              // Remove "docs/" prefix if present (it's the root, not needed)
                              const displayPath = filePath.startsWith('docs/')
                                ? filePath.replace(/^docs\//, '')
                                : filePath;

                              // Extract trailing punctuation and commas from children if present
                              // ReactMarkdown may include punctuation in the link text when markdown has [link](url).
                              const rawLinkText = extractLinkText(children);
                              const childrenStr = rawLinkText.trim().length > 0 ? rawLinkText : '';

                              // Check if link text ends with punctuation: . : , or )
                              // Handle cases like: [link](url), [link](url). [link](url): or [link](url))
                              // ReactMarkdown may include trailing ) in link text when markdown has [link](url))
                              let linkText = childrenStr || displayPath;
                              // Prefer display path over an auto-linked URL to keep the chip readable
                              if (linkText.startsWith('http')) {
                                linkText = displayPath;
                              }
                              let trailingPunct: string | null = null;

                              // Remove trailing punctuation - be aggressive to catch all cases
                              // Match one or more of: comma, period, colon, closing parenthesis
                              // Use non-greedy match to avoid removing valid characters from the path
                              // Important: match ) first since it's most common issue with multiple links
                              const punctMatch = linkText.match(/^(.+?)([,.:)]+)$/);
                              if (punctMatch) {
                                linkText = punctMatch[1];
                                trailingPunct = punctMatch[2];
                              } else {
                                // Also check if displayPath itself has trailing punctuation
                                // (in case childrenStr doesn't match but displayPath does)
                                const pathPunctMatch = displayPath.match(/^(.+?)([,.:)]+)$/);
                                if (pathPunctMatch && linkText === displayPath) {
                                  linkText = pathPunctMatch[1];
                                  trailingPunct = pathPunctMatch[2];
                                }
                              }

                              // Special handling: if linkText ends with just ), it's likely from malformed markdown
                              // like [link](url)) where the second ) got included in the link text
                              if (linkText.endsWith(')') && !trailingPunct) {
                                // Check if this ) is actually part of the path (unlikely but possible)
                                // If the path doesn't naturally end with ), remove it
                                if (!displayPath.endsWith(')')) {
                                  linkText = linkText.slice(0, -1);
                                  trailingPunct = ')';
                                }
                              }

                              return (
                                <>
                                  <Button
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className="h-6 py-0.5 px-1.5 text-xs font-normal inline-flex items-center gap-1 my-0.5"
                                  >
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      {...props}
                                    >
                                      <SiGithub className="size-3" />
                                      <span className="truncate max-w-[150px]">{linkText}</span>
                                    </a>
                                  </Button>
                                  {trailingPunct && <span>{trailingPunct}</span>}
                                </>
                              );
                            }
                            // Regular links
                            return (
                              <a {...props} href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {transformFilePaths(message.content)}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-break-word">
                      {message.content}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading &&
            currentRequestId &&
            (!streamingResponse ||
              (streamingResponse.status === 'pending' &&
                (!streamingResponse.response || streamingResponse.response.trim() === ''))) &&
            !messages.some((msg) => msg.id === `assistant-${currentRequestId}`) && (
              <div className="flex justify-start w-full">
                <div className="max-w-[85%] bg-muted border border-border rounded-lg px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground">Thinking</span>
                    <div className="flex gap-1">
                      <span
                        className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                        style={{ animationDelay: '0ms', animationDuration: '1.4s' }}
                      />
                      <span
                        className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                        style={{ animationDelay: '200ms', animationDuration: '1.4s' }}
                      />
                      <span
                        className="h-1.5 w-1.5 bg-muted-foreground/60 rounded-full animate-pulse"
                        style={{ animationDelay: '400ms', animationDuration: '1.4s' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask a question about the repository..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            Send
          </Button>
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 p-2 rounded-md">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
