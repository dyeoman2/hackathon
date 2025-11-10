import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Id } from '@convex/_generated/dataModel';
import { Button } from '~/components/ui/button';
import { Kbd } from '~/components/ui/kbd';
import { SimpleTooltip } from '~/components/ui/simple-tooltip';

interface SubmissionNavigationProps {
  currentIndex: number;
  totalSubmissions: number;
  previousSubmissionId: Id<'submissions'> | null;
  nextSubmissionId: Id<'submissions'> | null;
  onBack: () => void;
  onNavigateToSubmission: (submissionId: Id<'submissions'>) => void;
}

export function SubmissionNavigation({
  currentIndex,
  totalSubmissions,
  previousSubmissionId,
  nextSubmissionId,
  onBack,
  onNavigateToSubmission,
}: SubmissionNavigationProps) {
  if (totalSubmissions <= 1) {
    return (
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>
    );
  }

  const tooltipContent = (
    <div className="space-y-2 text-left">
      <div className="font-semibold mb-2">Keyboard Shortcuts</div>
      <div className="flex items-center gap-2">
        <span>Navigate:</span>
        <Kbd className="text-xs">←</Kbd>
        <Kbd className="text-xs">→</Kbd>
      </div>
    </div>
  );

  return (
    <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>
      <div className="flex items-center gap-1">
        <SimpleTooltip content={tooltipContent}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => previousSubmissionId && onNavigateToSubmission(previousSubmissionId)}
            disabled={!previousSubmissionId}
            className="touch-manipulation"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </SimpleTooltip>
        <span className="text-sm text-muted-foreground px-2 whitespace-nowrap">
          {currentIndex + 1} / {totalSubmissions}
        </span>
        <SimpleTooltip content={tooltipContent}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => nextSubmissionId && onNavigateToSubmission(nextSubmissionId)}
            disabled={!nextSubmissionId}
            className="touch-manipulation"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </SimpleTooltip>
      </div>
    </div>
  );
}

