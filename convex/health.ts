import { api } from './_generated/api';
import { httpAction } from './_generated/server';

/**
 * Validate that required environment variables are set
 */
function validateRequiredEnvVars() {
  if (!process.env.VITE_APP_NAME) {
    throw new Error(
      'VITE_APP_NAME environment variable is required. ' +
        'Set it in Convex environment variables.',
    );
  }
}

/**
 * Health check HTTP endpoint
 * Returns database connectivity status and service metadata
 */
export const healthCheck = httpAction(async (ctx, _request) => {
  const startTime = Date.now();

  // Validate required environment variables
  validateRequiredEnvVars();

  try {
    // Test Convex connectivity by checking user count
    const userCountResult = await ctx.runQuery(api.users.getUserCount, {});

    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        database: {
          connected: true,
          provider: 'convex',
          userCount: userCountResult.totalUsers,
        },
        service: {
          name: process.env.VITE_APP_NAME as string,
          version: '1.0.0',
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    const responseTime = Date.now() - startTime;

    return new Response(
      JSON.stringify({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
        error: error instanceof Error ? error.message : 'Unknown error',
        database: {
          connected: false,
          provider: 'convex',
        },
        service: {
          name: process.env.VITE_APP_NAME as string,
          version: '1.0.0',
        },
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
