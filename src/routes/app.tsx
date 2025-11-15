import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { NotFound } from '~/components/NotFound';
import { DashboardErrorBoundary } from '~/components/RouteErrorBoundaries';
import { Spinner } from '~/components/ui/spinner';
import { useAuth } from '~/features/auth/hooks/useAuth';

const REDIRECT_TARGETS = [
  '/h',
  '/app/profile',
  '/app/admin',
  '/app/admin/users',
  '/app/admin/stats',
] as const;

function resolveRedirectTarget(value?: string | null): string {
  if (!value) {
    return '/h';
  }

  // Extract path from URL if full URL is provided
  let path: string;
  try {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      const url = new URL(value);
      path = url.pathname;
    } else {
      path = value.split('?')[0];
    }
  } catch {
    path = value.split('?')[0];
  }

  // Prevent redirect loops to auth pages
  if (['/login', '/register', '/forgot-password', '/reset-password'].includes(path)) {
    return '/h';
  }

  // Allow invite routes
  if (path.startsWith('/invite/')) {
    return value; // Return full URL for invites
  }

  // Check other allowed routes
  const match = REDIRECT_TARGETS.find((route) => route === path || path.startsWith(`${route}/`));
  return match ? value : '/h'; // Return full URL if allowed, otherwise default to /h
}

const appSearchSchema = z.object({
  redirect: z
    .string()
    .regex(/^\/|https?:\/\/.*$/)
    .optional(),
});

export const Route = createFileRoute('/app')({
  pendingMs: 150,
  pendingMinMs: 250,
  pendingComponent: () => <AppLayoutSkeleton />,
  component: AppLayout,
  errorComponent: DashboardErrorBoundary,
  notFoundComponent: () => <NotFound />,
  validateSearch: appSearchSchema,
});

function AppLayout() {
  const navigate = useNavigate();
  const { redirect } = Route.useSearch();
  const { isAuthenticated, isPending } = useAuth();
  const redirectRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);

  // Resolve the redirect target safely
  const redirectTarget = resolveRedirectTarget(redirect);
  // Only redirect if an explicit redirect parameter was provided
  const hasExplicitRedirect = redirect != null;

  useEffect(() => {
    if (isPending) {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
      return;
    }

    if (!isAuthenticated) {
      if (redirectTimerRef.current === null) {
        redirectTimerRef.current = window.setTimeout(() => {
          redirectTimerRef.current = null;

          if (redirectRef.current) {
            return;
          }

          redirectRef.current = true;

          void navigate({
            to: '/login',
            search: { redirect: redirectTarget },
            replace: true,
          }).catch(() => {
            redirectRef.current = false;
          });
        }, 400);
      }
    } else {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }

      // Authenticated user - redirect to target if an explicit redirect was provided
      if (!redirectRef.current && hasExplicitRedirect) {
        redirectRef.current = true;
        void navigate({ to: redirectTarget, replace: true });
      } else {
        redirectRef.current = false;
      }
    }
  }, [isAuthenticated, isPending, navigate, redirectTarget, hasExplicitRedirect]);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  if (isPending || !isAuthenticated) {
    return <AppLayoutSkeleton />;
  }

  return <Outlet />;
}

function AppLayoutSkeleton() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="h-8 w-8 text-muted-foreground" />
    </div>
  );
}
