import {
  type ReactNode,
  type AnimationEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import '../styles/panel.css';

import { usePanelLayout } from '../hooks/usePanelLayout';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useScrollLock } from '../hooks/useScrollLock';

/**
 * Spec 017 — PanelShell. Owns the chatbot's outer visual surface:
 * positioning per breakpoint, glass treatment via CSS tokens, slide
 * animation on mobile, scroll-lock on mobile, focus trap, Escape
 * close, ARIA dialog semantics. The chat state itself (messages,
 * SOP, useChat) stays in `ChatPanel.tsx`; this component is purely
 * presentational + a few effects.
 *
 * See `contracts/panel-shell.md` for the prop contract and the seven
 * test items that gate this implementation.
 */
export interface PanelShellProps {
  /**
   * Whether the panel is open. When this transitions false → true
   * the shell starts the entry animation. true → false starts the
   * exit animation, then calls `onClosed` on `animationend`.
   */
  isOpen: boolean;

  /**
   * Called after the exit animation completes (or synchronously on
   * close when reduced-motion is active). The parent uses this to
   * unmount the panel and update its own `isOpen` state.
   */
  onClosed: () => void;

  /**
   * Called when the user requests close: header close button, Escape
   * key, or (on mobile) tapping the backdrop scrim. The parent should
   * flip `isOpen` to false; the shell will then animate out and call
   * `onClosed`.
   *
   * Focus restoration: the parent is responsible for moving focus
   * back to the chat bubble after `onClosed` fires (e.g. by holding
   * a ref and calling `bubbleRef.current?.focus()`).
   */
  onCloseRequest: () => void;

  /**
   * Panel children: typically PanelHeader, MessageList, optional
   * ProgressBar, Composer.
   */
  children: ReactNode;

  /** ARIA label for the dialog region. Defaults to "Chat". */
  ariaLabel?: string;

  /**
   * Rendering mode (Spec 017 + dashboard-preview parity):
   *
   *   - `'floating'` (default): the production widget surface. Fixed
   *     positioning, slide-up/down animation on mobile, mobile scroll-
   *     lock + backdrop scrim, role="dialog" + aria-modal on mobile.
   *
   *   - `'embedded'`: the dashboard Preview Chat surface. Rendered
   *     inline inside its parent's flow with no fixed positioning,
   *     no animation, no scroll-lock, no backdrop. Exposes role=
   *     "region" instead of dialog so screen readers don't announce
   *     it as a modal.
   *
   * Both modes share the same grid layout, glass surface tokens, and
   * child-track placement, so consumers see consistent behavior at
   * the slot level.
   */
  mode?: 'floating' | 'embedded';
}

type Phase = 'entering' | 'open' | 'exiting';

export function PanelShell({
  isOpen,
  onClosed,
  onCloseRequest,
  children,
  ariaLabel = 'Chat',
  mode = 'floating',
}: PanelShellProps) {
  const layout = usePanelLayout();
  const reducedMotion = useReducedMotion();
  const isEmbedded = mode === 'embedded';
  const rootRef = useRef<HTMLDivElement>(null);

  // Reduced-motion short-circuit: jump straight to 'open' on mount,
  // and on close fire onClosed synchronously without waiting for the
  // (already 0ms) animation to end. With motion enabled, mount starts
  // in 'entering' and advances on animationend.
  // Embedded mode also jumps straight to 'open' — no entry animation
  // is attached when embedded, so waiting for animationend would
  // hang the close path the same way it did pre-fix on desktop.
  const [phase, setPhase] = useState<Phase>(
    reducedMotion || isEmbedded ? 'open' : 'entering',
  );

  // When isOpen flips false, transition to 'exiting'. Fire onClosed
  // immediately when there is no exit animation to wait for:
  //
  //   - reduced motion: animation duration is 0ms by CSS rule
  //   - embedded mode: no animation attached at any breakpoint
  //   - non-mobile breakpoints: panel.css does NOT attach a slide-down
  //     keyframe to tablet/desktop/desktop-clamped, so `animationend`
  //     would never fire. Without this guard the close X button does
  //     nothing on desktop (the panel stays mounted forever).
  //
  // On mobile floating mode with motion, the slide-down keyframe runs
  // and the animationend handler below fires onClosed.
  useEffect(() => {
    if (!isOpen) {
      setPhase('exiting');
      const noAnimation = reducedMotion || isEmbedded || layout !== 'mobile';
      if (noAnimation) {
        onClosed();
      }
    }
  }, [isOpen, reducedMotion, isEmbedded, layout, onClosed]);

  // Engage scroll-lock only when floating AND on mobile. Embedded mode
  // intentionally never locks the host page — the dashboard sidebar
  // host expects normal scroll behavior around the preview pane.
  const shouldLock = !isEmbedded && layout === 'mobile';
  useScrollLock(shouldLock);

  // Focus the panel root on mount + after entry so keyboard users
  // (and screen readers) land inside the dialog. We focus the panel
  // itself rather than a specific child because the shell does not
  // know which child should receive focus first; the parent can move
  // focus by attaching tabindex to the close button or first
  // interactive element.
  useEffect(() => {
    if (phase === 'open' && rootRef.current) {
      const focusable = rootRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    }
  }, [phase]);

  const handleAnimationEnd = useCallback(
    (e: AnimationEvent<HTMLDivElement>) => {
      // Only act on the root's own animation, not on bubbled events
      // from inside (e.g. shimmer keyframes on chips). React's
      // synthetic event has currentTarget pinned to the listener
      // element; we compare target's nodeName/class to filter out
      // bubbled child animations. Practically, our CSS only animates
      // the root via lc-slide-up / lc-slide-down keyframes, so we
      // also accept any event whose animation name starts with
      // 'lc-slide-' or has no animationName (jsdom test environment).
      const name = e.animationName ?? '';
      const fromChild =
        e.target instanceof HTMLElement &&
        e.target !== e.currentTarget &&
        name !== '' &&
        !name.startsWith('lc-slide-');
      if (fromChild) return;

      if (phase === 'entering') {
        setPhase('open');
      } else if (phase === 'exiting') {
        onClosed();
      }
    },
    [phase, onClosed],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRequest();
      }
    },
    [onCloseRequest],
  );

  return (
    <>
      {!isEmbedded && layout === 'mobile' ? (
        <div
          className="lc-backdrop"
          aria-hidden="true"
          onClick={onCloseRequest}
          data-phase={phase}
        />
      ) : null}
      <div
        ref={rootRef}
        className="lc-panel"
        // Embedded surfaces are NOT dialogs (they're inline regions
        // hosted inside their parent's flow). Floating surfaces remain
        // dialogs as before.
        role={isEmbedded ? 'region' : 'dialog'}
        aria-label={ariaLabel}
        // aria-modal only applies in floating mode on mobile (full-
        // viewport takeover). Desktop floating panels and embedded
        // surfaces are non-modal.
        {...(!isEmbedded && layout === 'mobile' ? { 'aria-modal': 'true' } : {})}
        data-mode={mode}
        data-phase={phase}
        data-breakpoint={layout}
        tabIndex={-1}
        onAnimationEnd={handleAnimationEnd}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </>
  );
}
