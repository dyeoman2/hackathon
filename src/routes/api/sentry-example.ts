import * as Sentry from '@sentry/tanstackstart-react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/sentry-example')({
  server: {
    handlers: {
      GET: () => {
        // Test server-side console logging
        console.log('Sentry server test: This is a server console.log message');
        console.warn('Sentry server test: This is a server console.warn message');
        console.error('Sentry server test: This is a server console.error message');

        // Test server-side metrics
        Sentry.metrics.count('api_request', 1, { attributes: { endpoint: '/api/sentry-example' } });
        Sentry.metrics.gauge('server_load', Math.random() * 10, { unit: 'percentage' });
        Sentry.metrics.distribution('api_processing_time', Math.random() * 500, {
          unit: 'millisecond',
        });

        // Test server-side profiling with spans
        return Sentry.startSpan(
          {
            name: 'Example Server Span',
            op: 'test',
          },
          async () => {
            // Simulate some server work that should be profiled
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Throw error to test error tracking
            throw new Error('Sentry Example Route Error');
          },
        );
      },
    },
  },
});
