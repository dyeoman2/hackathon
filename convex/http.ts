import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { healthCheck } from './health';
import { resendWebhookHandler } from './webhooks/resend';

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);

// Health check endpoint
http.route({
  path: '/health',
  method: 'GET',
  handler: healthCheck,
});

// Resend webhook endpoint for receiving emails
http.route({
  path: '/webhooks/resend',
  method: 'POST',
  handler: resendWebhookHandler,
});

export default http;
