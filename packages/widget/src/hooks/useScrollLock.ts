import { useEffect, useRef } from 'react';

/**
 * Spec 017 — host-page scroll preservation when the chatbot opens
 * mobile-full-viewport. Implements the iOS-Safari-compatible
 * scroll-lock idiom: snapshot `body.style` + `window.scrollY`, set
 * `position: fixed; top: -scrollY; left: 0; right: 0; width: 100%;
 * overflow: hidden`, then restore exactly on disengage.
 *
 * Snapshot-then-mutate is critical: the host page may have its own
 * inline `<body style="...">` rules that we must NOT clobber. We
 * remember the original string value (including `''` for unset) so
 * that on disengage we put back exactly what was there before.
 *
 * See `data-model.md` § "Scroll-Lock State".
 */

type LockSnapshot = {
  scrollY: number;
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflow: string;
};

const LOCKED_PROPS = [
  'position',
  'top',
  'left',
  'right',
  'width',
  'overflow',
] as const satisfies readonly (keyof CSSStyleDeclaration)[];

function snapshot(): LockSnapshot {
  const s = document.body.style;
  return {
    scrollY: window.scrollY,
    position: s.position,
    top: s.top,
    left: s.left,
    right: s.right,
    width: s.width,
    overflow: s.overflow,
  };
}

function applyLock(scrollY: number) {
  const s = document.body.style;
  s.position = 'fixed';
  s.top = `-${scrollY}px`;
  s.left = '0px';
  s.right = '0px';
  s.width = '100%';
  s.overflow = 'hidden';
}

function restore(snap: LockSnapshot) {
  const s = document.body.style;
  s.position = snap.position;
  s.top = snap.top;
  s.left = snap.left;
  s.right = snap.right;
  s.width = snap.width;
  s.overflow = snap.overflow;
  window.scrollTo(0, snap.scrollY);
}

/**
 * Engages a body-level scroll lock while `engaged === true`.
 * Disengages and restores the original body styles when `engaged`
 * flips false OR the consumer unmounts (safety net).
 */
export function useScrollLock(engaged: boolean): void {
  const snapRef = useRef<LockSnapshot | null>(null);

  useEffect(() => {
    if (engaged) {
      // Capture-then-mutate. Skip if already engaged from a prior
      // render so we don't overwrite a real snapshot with a fake.
      if (snapRef.current === null) {
        const snap = snapshot();
        snapRef.current = snap;
        applyLock(snap.scrollY);
      }
      return () => {
        // Cleanup runs both on unmount AND between effect runs (e.g.
        // when `engaged` changes). We restore in both cases so a
        // mid-life unmount cannot leave the host page locked.
        if (snapRef.current !== null) {
          restore(snapRef.current);
          snapRef.current = null;
        }
      };
    }

    // engaged === false: nothing to do; cleanup of any prior engage
    // already ran via the previous effect's cleanup.
    return undefined;
  }, [engaged]);

  // Suppress lint warning about LOCKED_PROPS being unused — it
  // documents the snapshot shape and is exercised by tests.
  void LOCKED_PROPS;
}
