import { useEffect, useState } from 'react';

/**
 * Spec 017 — Panel layout breakpoint matrix.
 *
 * Returns the layout regime the chatbot panel should use, derived from
 * the current window dimensions. The hook listens to `resize` and
 * `orientationchange` and updates state when the regime crosses a
 * boundary.
 *
 * Breakpoints (from `data-model.md` § "Breakpoint Matrix"):
 *
 *   - `mobile`         : width <  768
 *   - `tablet`         : 768 ≤ width < 1024
 *   - `desktop`        : width ≥ 1024 AND height ≥ 808
 *   - `desktop-clamped`: width ≥ 1024 AND height <  808
 *
 * 808 = 760 (panel height) + 24 + 24 (top/bottom edge padding). Below
 * that the desktop panel must shrink to fit (`calc(100vh - 48px)`)
 * rather than overflow.
 */
export type PanelLayout =
  | 'mobile'
  | 'tablet'
  | 'desktop'
  | 'desktop-clamped';

const DESKTOP_MIN_WIDTH = 1024;
const TABLET_MIN_WIDTH = 768;
const DESKTOP_MIN_HEIGHT = 808;

function compute(width: number, height: number): PanelLayout {
  if (width < TABLET_MIN_WIDTH) return 'mobile';
  if (width < DESKTOP_MIN_WIDTH) return 'tablet';
  if (height < DESKTOP_MIN_HEIGHT) return 'desktop-clamped';
  return 'desktop';
}

function read(): PanelLayout {
  if (typeof window === 'undefined') return 'desktop';
  return compute(window.innerWidth, window.innerHeight);
}

export function usePanelLayout(): PanelLayout {
  const [layout, setLayout] = useState<PanelLayout>(() => read());

  useEffect(() => {
    function handle() {
      setLayout(read());
    }
    window.addEventListener('resize', handle);
    window.addEventListener('orientationchange', handle);
    // Sync once on mount in case dimensions changed between initial
    // render and effect run (rare but possible during hydration).
    handle();
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('orientationchange', handle);
    };
  }, []);

  return layout;
}
