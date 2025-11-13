import type { RefObject } from 'react';
import { useCallback, useEffect, useState } from 'react';

interface UseFullscreenReturn {
  isFullscreen: boolean;
  enterFullscreen: () => Promise<void> | void;
  exitFullscreen: () => Promise<void> | void;
  toggleFullscreen: () => Promise<void> | void;
}

/**
 * Lightweight fullscreen helper that targets the provided element (or the entire document).
 */
export function useFullscreen(targetRef?: RefObject<HTMLElement | null>): UseFullscreenReturn {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    if (typeof document === 'undefined') {
      return false;
    }
    return document.fullscreenElement !== null;
  });

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement !== null);
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleChange);
    };
  }, []);

  const enterFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    if (document.fullscreenElement) return;
    const el = targetRef?.current ?? document.documentElement;
    if (!el) return;
    try {
      await el.requestFullscreen();
    } catch (error) {
      // Swallow errors caused by browsers requiring user gestures
      console.warn('Failed to enter fullscreen', error);
    }
  }, [targetRef]);

  const exitFullscreen = useCallback(async () => {
    if (typeof document === 'undefined') return;
    if (!document.fullscreenElement) return;
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.warn('Failed to exit fullscreen', error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (isFullscreen) {
      await exitFullscreen();
    } else {
      await enterFullscreen();
    }
  }, [enterFullscreen, exitFullscreen, isFullscreen]);

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  };
}
