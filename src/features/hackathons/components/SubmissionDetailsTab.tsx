import type { Doc } from '@convex/_generated/dataModel';
import { ExternalLink } from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Field, FieldLabel } from '~/components/ui/field';

interface SubmissionDetailsTabProps {
  submission: Doc<'submissions'>;
}

export function SubmissionDetailsTab({ submission }: SubmissionDetailsTabProps) {
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel>Title</FieldLabel>
        <p className="text-sm">{submission.title}</p>
      </Field>

      <Field>
        <FieldLabel>Team</FieldLabel>
        <p className="text-sm">{submission.team}</p>
      </Field>

      <Field>
        <FieldLabel>Status</FieldLabel>
        <div>
          <Badge variant="outline">{submission.status}</Badge>
        </div>
      </Field>

      <Field>
        <FieldLabel>Repository URL</FieldLabel>
        <div className="flex items-center gap-2">
          <a
            href={submission.repoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            {submission.repoUrl}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </Field>

      {submission.siteUrl && (
        <Field>
          <FieldLabel>Site URL</FieldLabel>
          <div className="flex items-center gap-2">
            <a
              href={submission.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              {submission.siteUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </Field>
      )}

      <Field>
        <FieldLabel>R2 Upload Status</FieldLabel>
        <div>
          {submission.source?.r2Key ? (
            <Badge variant="success">Uploaded</Badge>
          ) : (
            <Badge variant="outline">Not uploaded</Badge>
          )}
          {submission.source?.uploadedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              {new Date(submission.source.uploadedAt).toLocaleString()}
            </p>
          )}
        </div>
      </Field>

      <Field>
        <FieldLabel>Created</FieldLabel>
        <p className="text-sm">{new Date(submission.createdAt).toLocaleString()}</p>
      </Field>

      <Field>
        <FieldLabel>Last Updated</FieldLabel>
        <p className="text-sm">{new Date(submission.updatedAt).toLocaleString()}</p>
      </Field>
    </div>
  );
}
