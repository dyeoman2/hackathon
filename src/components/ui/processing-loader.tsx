import { Loader2 } from 'lucide-react';

interface ProcessingLoaderProps {
  title: string;
  description: string;
}

export function ProcessingLoader({ title, description }: ProcessingLoaderProps) {
  return (
    <div className="rounded-md border bg-muted/50 p-6 text-center">
      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-3 text-primary" />
      <p className="text-sm font-medium mb-1">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
