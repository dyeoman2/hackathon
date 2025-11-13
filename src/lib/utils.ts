import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get the application name from environment variables.
 * Falls back to a default during development/route rendering.
 */
export function getAppName(): string {
  // Check client-side env vars first (Vite prefix)
  if (typeof window !== 'undefined' && import.meta.env?.VITE_APP_NAME) {
    return import.meta.env.VITE_APP_NAME;
  }

  // Check server-side env vars
  if (process.env.VITE_APP_NAME) {
    return process.env.VITE_APP_NAME;
  }

  // During development/route rendering, provide a fallback
  // The actual validation happens in Convex functions
  return 'App';
}
