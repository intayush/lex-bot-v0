'use client';

import { useEffect, useState } from 'react';

/**
 * Returns `true` after the first client-side render. Used to gate
 * client-only subtrees (e.g., `@dnd-kit` components, which generate
 * unique IDs differently on server vs. client and otherwise produce
 * a hydration-mismatch warning) so they render only once on the client.
 */
export function useIsMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  return mounted;
}
