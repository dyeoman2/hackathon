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
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className={cn('text-2xl font-bold text-foreground', titleClassName)}>{title}</h1>
            {titleActions && (
              <div className="flex items-center gap-2">{titleActions}</div>
            )}
          </div>
          {description && (
            <div className={cn('mt-2 text-sm text-muted-foreground', descriptionClassName)}>
              {description}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
