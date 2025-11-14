import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Get the application name from environment variables
 * Falls back to a default name if not set
 */
export function getAppName(): string {
  return import.meta.env.VITE_APP_NAME || 'Hackathon';
}

/**
 * Format time remaining until a date
 * Returns a human-readable string like "2 days left", "5 hours left", "Submissions closed", etc.
 */
export function formatTimeRemaining(endDate: number | Date | undefined | null): string {
  if (!endDate) {
    return 'No end date';
  }

  const end = typeof endDate === 'number' ? new Date(endDate) : endDate;
  const now = new Date();
  const diff = end.getTime() - now.getTime();

  if (diff < 0) {
    return 'Closed';
  }

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) {
    return `${months} ${months === 1 ? 'month' : 'months'} left`;
  }
  if (weeks > 0) {
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} left`;
  }
  if (days > 0) {
    return `${days} ${days === 1 ? 'day' : 'days'} left`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} left`;
  }
  if (minutes > 0) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`;
  }
  return 'Less than a minute left';
}
