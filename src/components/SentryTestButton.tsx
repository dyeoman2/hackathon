import * as Sentry from '@sentry/tanstackstart-react';
import { Button } from './ui/button';

export function SentryTestButton() {
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={async () => {
        // Test console logging
        console.log('Sentry test: This is a console.log message');
        console.warn('Sentry test: This is a console.warn message');
        console.error('Sentry test: This is a console.error message');

        // Test metrics
        Sentry.metrics.count('button_clicked', 1, { attributes: { page: 'test-sentry' } });
        Sentry.metrics.gauge('test_memory_usage', Math.random() * 100, { unit: 'megabyte' });
        Sentry.metrics.distribution('test_response_time', Math.random() * 1000, {
          unit: 'millisecond',
        });

        // Test client-side profiling with spans
        await Sentry.startSpan(
          {
            name: 'Example Frontend Span',
            op: 'test',
          },
          async () => {
            // Simulate some work that should be profiled
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Test API call that will trigger server-side profiling and error
            const res = await fetch('/api/sentry-example');
            if (!res.ok) {
              throw new Error('Sentry Example Frontend Error');
            }
          },
        );
      }}
    >
      Test All Sentry Features
    </Button>
  );
}
