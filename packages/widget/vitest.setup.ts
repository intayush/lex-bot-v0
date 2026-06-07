import '@testing-library/jest-dom/vitest';

/*
 * Spec 017 — jsdom does not expose `AnimationEvent` or `TransitionEvent`
 * constructors. React 19's event delegation watches for native event
 * types and the synthetic-event handlers won't fire if the dispatched
 * event isn't recognised. We polyfill both with the generic `Event`
 * subclass; testing-library's `fireEvent.animationEnd` then constructs
 * a real animationend event that React picks up.
 *
 * Without this shim, every `fireEvent.animationEnd(root)` silently
 * no-ops and the PanelShell phase machine never advances.
 */
if (typeof window !== 'undefined') {
  if (typeof (window as unknown as { AnimationEvent?: unknown }).AnimationEvent === 'undefined') {
    class AnimationEventPolyfill extends Event {
      animationName: string;
      elapsedTime: number;
      pseudoElement: string;

      constructor(type: string, init: AnimationEventInit = {}) {
        super(type, init);
        this.animationName = init.animationName ?? '';
        this.elapsedTime = init.elapsedTime ?? 0;
        this.pseudoElement = init.pseudoElement ?? '';
      }
    }
    (window as unknown as { AnimationEvent: typeof AnimationEventPolyfill }).AnimationEvent =
      AnimationEventPolyfill;
  }

  if (typeof (window as unknown as { TransitionEvent?: unknown }).TransitionEvent === 'undefined') {
    class TransitionEventPolyfill extends Event {
      propertyName: string;
      elapsedTime: number;
      pseudoElement: string;

      constructor(type: string, init: TransitionEventInit = {}) {
        super(type, init);
        this.propertyName = init.propertyName ?? '';
        this.elapsedTime = init.elapsedTime ?? 0;
        this.pseudoElement = init.pseudoElement ?? '';
      }
    }
    (window as unknown as { TransitionEvent: typeof TransitionEventPolyfill }).TransitionEvent =
      TransitionEventPolyfill;
  }

  // jsdom doesn't implement scrollIntoView; Element auto-scrolling
  // (e.g. MessageList scrolling to the latest message) calls it. The
  // polyfill is a no-op since there's no real layout to scroll.
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function noopScrollIntoView() {};
  }
}
