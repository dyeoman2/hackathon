import { cn } from '~/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string | React.ReactNode;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  actions?: React.ReactNode;
  titleActions?: React.ReactNode;
}

export function PageHeader({
  title,
  description,
  className,
  titleClassName,
  descriptionClassName,
  actions,
  titleActions,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 sm:justify-start sm:gap-3">
            <h1 className={cn('text-2xl font-bold text-foreground', titleClassName)}>{title}</h1>
            {titleActions && <div className="flex items-center gap-2 shrink-0">{titleActions}</div>}
          </div>
          {description && (
            <div className={cn('mt-2 text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </div>
          )}
        </div>
        {actions && <div className="w-full sm:w-auto">{actions}</div>}
      </div>
    </div>
  );
}
