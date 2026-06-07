# Contract: PanelShell Component

The `PanelShell` is a new component that owns the chatbot's outer
visual surface (positioning, glass treatment, animation, scroll-lock,
focus management). It is the *only* component that knows about
breakpoints visually; downstream components render the same regardless
of which breakpoint they are inside.

## Location

`packages/widget/src/components/PanelShell.tsx`

## Props

```ts
import type { ReactNode } from 'react';

export interface PanelShellProps {
  /**
   * Whether the panel is open. When this transitions from false → true,
   * the shell mounts and runs the entry animation. When true → false,
   * the shell runs the exit animation, then calls `onClosed`.
   */
  isOpen: boolean;

  /**
   * Called after the exit animation completes. The parent uses this
   * to unmount the panel and update its own `isOpen` state.
   */
  onClosed: () => void;

  /**
   * Called when the user requests to close: tap close button, press
   * Escape, or (on mobile only) tap the backdrop scrim. The parent
   * should flip `isOpen` to false; the shell will then animate out
   * and call `onClosed`.
   */
  onCloseRequest: () => void;

  /**
   * Panel children: typically PanelHeader, MessageList, ProgressBar
   * (optional), Composer.
   */
  children: ReactNode;

  /**
   * ARIA label for the dialog region. Defaults to "Chat".
   */
  ariaLabel?: string;
}
```

## Behavior

### Mounting

The component is mounted by its parent (`ChatPanel`) only when the
parent decides the panel should be visible. `PanelShell` itself does
not gate on `isOpen`; it always renders. The parent unmounts it after
`onClosed` fires.

(This split — parent owns mount/unmount, shell owns animation phase
state — keeps the shell's internal state machine simple and avoids
the React 18 "render-after-unmount" gotcha.)

### Animation phases

Internal state: `phase: 'entering' | 'open' | 'exiting'`. Initial
phase is `'entering'`.

- On mount: phase = `'entering'`. After one `requestAnimationFrame`,
  the shell sets a `data-phase="entering"` attribute on the root
  element, which (via CSS) starts the `slideUp` keyframe.
- On the keyframe's `animationend` event, phase → `'open'`,
  `data-phase="open"`.
- When `isOpen` flips false (parent prop change), phase → `'exiting'`,
  `data-phase="exiting"`, which (via CSS) runs `slideDown`.
- On the exit `animationend`, the shell calls `onClosed()`.

If `useReducedMotion()` is true, the shell skips the requestAnimationFrame
delay AND the animationend wait — phase advances synchronously.

### Breakpoint behavior

The shell consumes `usePanelLayout()`, which returns:

```ts
type PanelLayout = 'mobile' | 'tablet' | 'desktop' | 'desktop-clamped';
```

The layout drives:

- `data-breakpoint` attribute on the root, which the CSS keys off for
  position / size / corner-radius / animation rules
- Whether to engage `useScrollLock` (only when `'mobile'`)
- Whether to render the mobile backdrop scrim (only when `'mobile'`)

### Focus management

- On mount, focus moves to the panel's close button (a focusable
  header element with `aria-label="Close chat"`).
- On `onClosed`, focus returns to whichever element the parent had
  before opening (the chat bubble in practice). The shell does not
  manage this directly; it delegates by emitting `onClosed` and
  trusting the parent to call `bubbleRef.current?.focus()` —
  documented in the parent's contract (see `ChatPanel`).
- Tab cycling stays within the panel via a focus trap implemented
  with a sentinel-element pattern (no third-party dep).

### Keyboard

- `Escape` anywhere within the panel calls `onCloseRequest`.
- Tab / Shift+Tab cycle focus within the panel.

### ARIA

- Root has `role="dialog"`, `aria-modal="true"` (mobile only — on
  tablet/desktop it's a non-modal floating panel, so `aria-modal`
  is omitted).
- Root has `aria-label={ariaLabel}` (default "Chat").

## Slot Contract

`PanelShell` expects `children` to render in the order:

1. PanelHeader (or any element designed to occupy the header track)
2. The scrolling region (typically MessageList) — must have
   `flex: 1; overflow: auto; min-height: 0`
3. (optional) ProgressBar
4. Composer (or any element designed to be pinned)

The shell uses CSS grid with named tracks `[header]`, `[content]`,
`[progress]`, `[composer]` and assigns children to tracks in
document order. Slot misuse (wrong order, missing required regions)
is an authoring bug, not a runtime check.

## Test Contract

`PanelShell.test.tsx` MUST verify:

1. **Render order**: children render inside the panel root in
   document order.
2. **Phase progression (motion)**: with reduced-motion off, mounting
   the shell sets `data-phase="entering"` initially, advancing to
   `data-phase="open"` after the keyframe completes (jsdom does not
   actually run keyframes; the test fires `animationend` manually).
3. **Phase progression (reduced motion)**: with `useReducedMotion`
   mocked to `true`, the shell jumps to `data-phase="open"` on the
   same tick as mount.
4. **Close on Escape**: pressing Escape inside the panel calls
   `onCloseRequest`.
5. **Close-then-onClosed sequence**: setting `isOpen` to false
   transitions to `data-phase="exiting"`, fires the exit
   `animationend`, then calls `onClosed`.
6. **ARIA**: root has `role="dialog"` and the configured
   `aria-label`. On mobile breakpoint (mocked via
   `usePanelLayout`), `aria-modal="true"` is set; on desktop, it
   is absent.
7. **Scroll-lock on mobile**: when `usePanelLayout` returns
   `'mobile'`, mounting the shell calls into `useScrollLock` which
   sets `document.body.style.position = 'fixed'`. Unmounting
   restores the original style.

## Non-goals

- The shell does not own chat state (messages, sendMessage, status).
- The shell does not own the SOP state.
- The shell does not own the `widgetConfig` fetch.
- The shell does not render the bubble — `ChatBubble` is a
  sibling component owned by `ChatWidget`.
