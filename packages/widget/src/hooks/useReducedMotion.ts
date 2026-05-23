import { useEffect, useState } from 'react';

/**
 * Tracks the user's `prefers-reduced-motion: reduce` media query.
 *
 * Returns `true` when the user has opted out of motion. Components use
 * this to disable animations / transitions / shimmer effects for
 * accessibility (010-sop-workflow ProgressBar contract; matches the
 * widget's existing accessibility behavior).
 *
 * SSR-safe: defaults to `false` when `window` is unavailable.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Modern API.
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}
