# Phase 1 Data Model: Chatbot Redesign + LexBot Playground

This feature is a visual-layer redesign with no schema, no API, and no
persistent state changes. The "data model" here is therefore the
**visual data model**: the design tokens, layout regions, breakpoint
matrix, and animation/state machine that the implementation must
produce. These are the types and shapes the new components consume.

## Design Tokens

CSS custom properties exposed on the `.lc-panel` root class. Tokens
marked **public** are the existing customer-facing override hooks and
MUST remain backwards-compatible. Tokens marked **internal** are new
to this redesign; they are not part of the v1 customer override
surface.

| Token | Visibility | Default | Purpose |
|-------|------------|---------|---------|
| `--lc-primary-color` | public | `#4338CA` | Accent: bubble, user message bg, focused input ring, chip selected bg |
| `--lc-primary-text` | public | `#ffffff` | Text on primary color |
| `--lc-background` | public | `#fcfaf5` | Panel solid background (fallback) |
| `--lc-border-radius` | public | `20px` | Panel corner radius |
| `--lc-font-family` | public | system stack | Font family applied to entire panel |
| `--lc-surface` | internal | `rgba(252,250,245,0.72)` | Glass surface fill |
| `--lc-surface-fallback` | internal | `rgba(252,250,245,0.96)` | Solid fallback when backdrop-filter unsupported |
| `--lc-surface-blur` | internal | `blur(20px) saturate(180%)` | backdrop-filter value |
| `--lc-shadow` | internal | `0 8px 40px rgba(20,16,8,0.16)` | Panel drop shadow |
| `--lc-message-radius` | internal | `16px` | Message card corner radius |
| `--lc-panel-radius` | internal | `20px` | Panel corner radius (alias of border-radius for clarity) |
| `--lc-text-primary` | internal | `#1f1b16` | Body text color |
| `--lc-text-muted` | internal | `#65604f` | Disclaimer + caption text |
| `--lc-message-bg-assistant` | internal | `#f5f1e8` | Assistant card background |
| `--lc-border-subtle` | internal | `rgba(31,27,22,0.06)` | Card inner border |
| `--lc-panel-anim-distance` | internal | `100%` | Slide-up offset (set to `0` on tablet/desktop) |
| `--lc-panel-anim-duration` | internal | `320ms` | Slide-up duration (set to `0ms` on reduced-motion) |
| `--lc-panel-anim-easing` | internal | `cubic-bezier(0.16,1,0.3,1)` | Slide-up easing |

### Token validation rules

- **Customer override safety**: a customer providing only
  `--lc-primary-color` MUST get a usable, contrast-passing panel
  without overriding any internal token. The internal tokens have
  defaults that read against any reasonable accent.
- **Contrast invariant**: `--lc-text-primary` over the effective
  composite of `--lc-surface` (alpha-composited over white) MUST
  be ≥ 4.5:1. Verified manually before merge.
- **Reduced motion**: when
  `@media (prefers-reduced-motion: reduce)` matches,
  `--lc-panel-anim-duration` is forced to `0ms` and the panel
  appears instantly. The `useReducedMotion` hook also short-
  circuits the JS-side close-animation timer to avoid dead delay.

## Layout Regions

The panel interior is composed of four named regions, top to bottom.
Each is a CSS grid track; the conversation list is the only flexible
track.

```text
┌─────────────────────────────────────────┐
│  PanelHeader        (auto height)       │  ← brand mark + close
├─────────────────────────────────────────┤
│                                         │
│  MessageList        (1fr — flex)        │  ← scrolls
│                                         │
├─────────────────────────────────────────┤
│  ProgressBar        (auto, optional)    │  ← shown only when SOP active
├─────────────────────────────────────────┤
│  Composer           (auto height)       │  ← chips + input + form
└─────────────────────────────────────────┘
```

| Region | Component | Mandatory? |
|--------|-----------|------------|
| Header | `PanelHeader` | yes |
| MessageList | `MessageList` | yes |
| ProgressBar | `ProgressBar` (existing) | only when SOP active |
| Composer | `Composer` (chips + input + ContactForm) | yes |

Composer internal sub-regions, top to bottom:

1. **QuickReplies / Chips row** — wraps to multiple lines if needed
2. **ContactForm** — when the SOP advances to a contact-collect step,
   replaces input/chips for that step
3. **Input row** — text input + send button
4. **Disclaimer** — persistent muted line ("I am an AI assistant...")

## Breakpoint Matrix

The `usePanelLayout` hook returns a value that drives both the JS
side (knowing whether to scroll-lock the host page) and the CSS side
(via a `data-breakpoint` attribute on the panel root + media-query
fallback in CSS).

| Breakpoint | Viewport width | Panel position | Panel size | Edge padding | Corner radius | Animation |
|-----------|----------------|----------------|------------|--------------|----------------|-----------|
| `mobile`  | `< 768px`      | full viewport  | 100vw × 100dvh | 0 | 0 (flush) | slide-up 320ms |
| `tablet`  | `768–1023px`   | right-anchored sheet | 420px × 100dvh | 0 | 20px on inner edges (top-left, bottom-left) | none |
| `desktop` | `≥ 1024px`     | floating bottom-right | 480px × 760px | 24px right, 24px bottom | 20px (all corners) | none |
| `desktop-clamped` | `≥ 1024px` AND viewport height < (760 + 48)px | floating bottom-right | 480px × (vh − 48) | 24px right, 24px bottom | 20px | none |

State transitions: when the viewport crosses a breakpoint while the
panel is open, the `usePanelLayout` value updates and the CSS variables
re-apply on next paint. No explicit transition animation between
breakpoints is required (rare event in practice).

## Open / Close State Machine

The panel's open/close lifecycle has four states. State is owned by
the existing `ChatWidget.tsx` (`isOpen` boolean) plus a new local
`animationPhase` state inside `PanelShell`.

```text
       click bubble
            │
            ▼
       ┌────────┐    requestAnimationFrame   ┌──────────┐
 closed│        │ ─────────────────────────▶│ entering │
       │        │                           │  (320ms) │
       │        │ ◀──────────────────────── └──────────┘
       │        │      animationend (fwd)        │
       │        │                                ▼
       │        │                           ┌──────────┐
       │        │                           │   open   │
       │        │                           └──────────┘
       │        │                                │
       │        │   click close / Esc            │
       │        │                                ▼
       │        │                           ┌──────────┐
       │        │ ◀──────────────────────── │ exiting  │
       │        │      animationend (rev)   │  (320ms) │
       └────────┘                           └──────────┘
```

States and CSS classes applied to the `.lc-panel` root:

| State | Class on root | Notes |
|-------|---------------|-------|
| `closed` | (component unmounted) | `<PanelShell />` not rendered |
| `entering` | `.lc-panel--entering` | mobile: applies `transform: translateY(100%) → 0` keyframe; tablet/desktop: identical to `open` (no animation) |
| `open` | `.lc-panel--open` | resting state; user can interact |
| `exiting` | `.lc-panel--exiting` | mobile: reverse keyframe; tablet/desktop: unmounts immediately |

Transitions:

- `closed → entering`: when `ChatWidget` flips `isOpen` to `true`.
  Mount the panel; set `animationPhase = 'entering'`; on the next
  frame, update to apply the keyframe.
- `entering → open`: on `animationend` event from the keyframe; if
  reduced-motion, fire synchronously.
- `open → exiting`: when user clicks close or presses Esc.
- `exiting → closed`: on `animationend`, call the parent `onClose`
  callback which unmounts the component.

Edge: if `useReducedMotion()` returns `true`, `entering` and
`exiting` states each last 0ms and immediately advance — visually
the panel just appears/disappears.

## Scroll-Lock State

Owned by the new `useScrollLock` hook. Engaged only when the panel
is `entering` / `open` / `exiting` AND the breakpoint is `mobile`.

```text
type ScrollLockState =
  | { engaged: false }
  | {
      engaged: true;
      savedScrollY: number;
      savedBodyStyle: {
        position: string;
        top: string;
        left: string;
        right: string;
        width: string;
        overflow: string;
      };
    };
```

Engagement steps (snapshot then mutate):

1. Capture `window.scrollY` → `savedScrollY`
2. Capture each of the six `document.body.style.*` properties listed
   above into `savedBodyStyle`
3. Apply `position: fixed; top: -${savedScrollY}px; left: 0; right: 0;
   width: 100%; overflow: hidden`

Disengagement steps (restore exactly):

1. For each of the six properties, restore from `savedBodyStyle`
   (set to original string value, including `''` if originally unset)
2. Call `window.scrollTo(0, savedScrollY)`

The hook's effect cleanup MUST disengage on unmount as a safety net
in case the component is torn down while open.

## Message Card Variants

Two variants for assistant vs. user messages, distinguishable in
greyscale and high-contrast (FR-015). Both share the same outer
container shape; visual treatment differs:

| Variant | Alignment | Background | Text | Border | Width |
|---------|-----------|-----------|------|--------|-------|
| Assistant | left | `--lc-message-bg-assistant` (`#f5f1e8`) | `--lc-text-primary` | `1px solid var(--lc-border-subtle)` | max 80% of MessageList width |
| User | right | `var(--lc-primary-color)` (warm indigo) | `var(--lc-primary-text)` (white) | none | max 80% of MessageList width |

Streaming responses (FR-021): the assistant card receives token-by-
token text updates from the existing AI SDK `useChat` hook. No
buffering or animation per-token — the existing behavior of new
characters appearing instantly is preserved.

The typing indicator (preflight phrase or `● ● ●`) renders as an
assistant-variant card with italicized muted text.

## Composer State

The Composer's visible content depends on the SOP state, derived
from `useSOPState` and `computeActiveChips` (existing hooks,
unchanged). The visual data model:

| SOP state | Composer content (top-to-bottom) |
|-----------|----------------------------------|
| No SOP active | Input + send button + disclaimer |
| SOP at a chip step | Chips row + Input + send + disclaimer |
| SOP at a quick-reply step | QuickReplies row + Input + send + disclaimer |
| SOP at a contact step | ContactForm (replaces input) + disclaimer |
| SOP at a free-text step | Input + send + disclaimer |

The progress bar appears above the composer (between MessageList and
Composer) iff `sopState.totalSteps > 0`. Its props and behavior are
unchanged from spec 012 / 016.

## Playground Page Structure

A separate visual-data view used only by `main.tsx` to render the
LexBot Playground. Sections, top to bottom:

| Section | Required content | Source of truth |
|---------|------------------|-----------------|
| TopBar | "LexBot" wordmark left; "Playground" pill right | hard-coded copy |
| Hero | H1 "Try LexBot on a sample legal-services site"; subhead explaining demo nature | hard-coded copy |
| Demo banner | "Sample content for the LexBot demo" | hard-coded copy |
| Practice areas | 3-card grid (Personal Injury, Family Law, Estate Planning) | preserved from existing main.tsx |
| CTA | "Ready to Talk?" headline + sample phone | preserved |
| Footer | "© LexBot — sample-content demo. The 'firm' shown on this page is fictional." | hard-coded copy |
| ChatWidget | The redesigned widget at the corner | unchanged props (`apiKey="dev_test_key"`) |

Branding rules:

- The page title (`<title>` in `index.html`) MUST be "LexBot
  Playground" or contain that exact phrase.
- The strings "Smith & Associates", "Smith and Associates",
  "Springfield, IL" MUST NOT appear anywhere in the rendered page.
  The Playwright spec asserts both negatives.
- Practice area copy may name fictional services (Personal Injury,
  Family Law, Estate Planning) without naming a fictional firm —
  the cards describe the *services*, not "Smith & Associates'
  services."
