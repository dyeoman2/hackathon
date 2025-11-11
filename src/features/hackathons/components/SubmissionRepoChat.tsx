import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction } from 'convex/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { SiGithub } from 'react-icons/si';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '~/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card';
import { Input } from '~/components/ui/input';
import { ProcessingLoader } from '~/components/ui/processing-loader';

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
  const r2PathPrefix = submission.source?.r2Key;
  const queryAISearch = useAction(api.cloudflareAi.queryAISearchForRepoChat);

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

  // Transform file paths in message content from R2 paths to GitHub paths
  const transformFilePaths = (content: string): string => {
    if (!r2PathPrefix || !githubRepoBase) return content;
    // Replace R2 paths like "repos/{submissionId}/files/path/to/file" with GitHub URLs
    // Handle paths in various contexts: plain text, markdown links, code blocks, etc.
    // Also remove parentheses around file paths
    const escapedSubmissionId = submission._id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // First, replace all file paths (with or without parentheses) with markdown links
    const r2PathRegex = new RegExp(`repos/${escapedSubmissionId}/files/([^\\s<>"'(]+)`, 'g');
    let transformed = content.replace(r2PathRegex, (_match, filePath) => {
      const cleanPath = filePath.replace(/\/$/, '').replace(/^\/+/, '');
      // Encode each path segment properly for GitHub URLs
      // GitHub URLs use forward slashes between segments, so we encode each segment individually
      const encodedPath = cleanPath
        .split('/')
        .map((segment: string) => encodeURIComponent(segment))
        .join('/');
      // Use 'main' as default branch - GitHub will redirect if the repo uses 'master' or another branch
      return `[${cleanPath}](${githubRepoBase}/blob/main/${encodedPath})`;
    });

    // Then, remove parentheses that now only contain markdown links (and optional commas/whitespace)
    // This handles cases like: (CLOUDFLARE_AI_SETUP.md) or (CLOUDFLARE_AI_SETUP.md, src/routes/app/ai-playground.tsx)
    transformed = transformed.replace(
      /\((\s*\[[^\]]+\]\([^)]+\)(?:\s*,\s*\[[^\]]+\]\([^)]+\))*\s*)\)/g,
      (_match, innerContent) => innerContent.trim(),
    );

    // Also handle cases where there's text before/after the links in parentheses
    // Like: (some text [link1](url1), [link2](url2))
    transformed = transformed.replace(
      /\(([^)]*?)(\[[^\]]+\]\([^)]+\)(?:\s*,\s*\[[^\]]+\]\([^)]+\))*)([^)]*?)\)/g,
      (_match, before, links, after) => {
        // Only remove parens if the content is mostly links
        const linkCount = (links.match(/\[/g) || []).length;
        const totalLength = before.length + links.length + after.length;
        if (linkCount > 0 && links.length / totalLength > 0.5) {
          return `${before.trim()} ${links} ${after.trim()}`.trim();
        }
        return _match;
      },
    );

    return transformed;
  };

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change (only scroll the messages container, not the page)
  useLayoutEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  });

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

  const handleSend = async () => {
    if (!input.trim() || isLoading || !r2PathPrefix) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      // Build query that includes path prefix context
      const queryWithContext = `${input.trim()}\n\nIMPORTANT: Only analyze files from the path "${r2PathPrefix}". Ignore any files from other repositories or submissions.`;

      const result = await queryAISearch({
        query: queryWithContext,
        model: 'google-ai-studio/gemini-2.5-flash',
        maxNumResults: 20,
        pathPrefix: r2PathPrefix,
      });

      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.response || 'No response generated.',
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
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
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

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

  if (processingState !== 'complete' || !r2PathPrefix) {
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

                              return (
                                <Button
                                  asChild
                                  variant="outline"
                                  size="sm"
                                  className="h-6 py-0.5 px-1.5 text-xs font-normal inline-flex items-center gap-1 my-0.5 mx-0 -mr-1"
                                >
                                  <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    {...props}
                                  >
                                    <SiGithub className="size-3" />
                                    <span className="truncate max-w-[150px]">{displayPath}</span>
                                  </a>
                                </Button>
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
          {isLoading && (
            <div className="flex justify-start w-full">
              <div className="max-w-[85%] bg-muted border border-border rounded-lg px-4 py-3 shadow-sm">
                <p className="text-sm text-muted-foreground">Thinking...</p>
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
