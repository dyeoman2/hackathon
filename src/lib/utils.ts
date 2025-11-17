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
 * Extract YouTube video ID from various YouTube URL formats
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID, etc.
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (!url) return null;

  try {
    const urlObj = new URL(url);

    // Handle youtu.be short URLs
    if (urlObj.hostname === 'youtu.be') {
      return urlObj.pathname.slice(1); // Remove leading slash
    }

    // Handle youtube.com URLs
    if (urlObj.hostname.includes('youtube.com')) {
      // Handle /watch?v=VIDEO_ID format
      if (urlObj.pathname === '/watch') {
        return urlObj.searchParams.get('v');
      }

      // Handle /embed/VIDEO_ID format
      if (urlObj.pathname.startsWith('/embed/')) {
        return urlObj.pathname.split('/embed/')[1]?.split('/')[0] || null;
      }

      // Handle /v/VIDEO_ID format (legacy)
      if (urlObj.pathname.startsWith('/v/')) {
        return urlObj.pathname.split('/v/')[1]?.split('/')[0] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Generate YouTube embed URL from video ID
 */
export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}`;
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
