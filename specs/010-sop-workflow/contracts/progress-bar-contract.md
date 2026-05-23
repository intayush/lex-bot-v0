# Contract: Progress Bar UI

**Owner**: SOP Workflow (`010-sop-workflow`)
**Implements**: spec.md FR-033 to FR-040.
**Coordinates with**: `005-chat-widget` theming + reduced-motion contracts.

## Component Surface

```ts
// packages/widget/src/components/ProgressBar.tsx

export interface ProgressBarProps {
  current: number;          // Captured count
  total: number;            // Configured threshold
  reducedMotion: boolean;   // From useReducedMotion() hook (Phase 4)
}

export function ProgressBar(props: ProgressBarProps): JSX.Element | null;
```

When `total === 0` the component renders `null` (FR-038: bar hidden when no SOP threshold).

When `current >= total` the bar is filled to 100% AND remains rendered (FR-037).

## Visual Specifications

| Attribute | Value | Source |
|---|---|---|
| Height | `3px` | FR-033 ("≤ 4 px") |
| Background color | `--lc-progress-bg` (default: `rgba(0,0,0,0.06)`) | New CSS custom property |
| Fill color | `--lc-progress-color` (default: `#22c55e`, WCAG AA contrast verified) | New CSS custom property |
| Fill mechanism | `transform: scaleX(<ratio>); transform-origin: left` | R8 (GPU-accelerated) |
| Transition | `transform 300ms ease-out` (skipped under reduced motion) | FR-035 + FR-036 |
| Shimmer | Linear-gradient `@keyframes` translating left-to-right (skipped under reduced motion) | FR-035 + FR-036 |
| Label | `<x>/<N>` text in 11px, top-right corner | FR-034 |
| Label color | `--lc-progress-label-color` (default: `#171717`) | New CSS custom property |

## DOM Structure

```html
<div class="lc-progress-bar" role="progressbar"
     aria-valuenow="{current}" aria-valuemin="0" aria-valuemax="{total}"
     aria-label="Lead qualification progress: {current} of {total} questions answered">
  <div class="lc-progress-bar-track"></div>
  <div class="lc-progress-bar-fill" style="--lc-fill-ratio: {ratio}"></div>
  <span class="lc-progress-bar-label" aria-hidden="true">{current}/{total}</span>
</div>
```

The `aria-label` provides full context for screen readers; the visible label is decorative (`aria-hidden="true"`).

## Layout Integration

Per `005-chat-widget`'s breakpoint contract:

| Breakpoint | Bar position |
|---|---|
| Mobile (full-screen panel, `< 768px`) | Above the sticky header (top of the panel) |
| Tablet (right-anchored, `768-1024px`) | Above the panel header |
| Desktop (floating panel, `> 1024px`) | Top of the panel chrome, above the chatbot-name title |

The bar's wrapper has `position: sticky; top: 0; z-index: 1` so it stays visible during message-list scroll.

## Reduced Motion

When `reducedMotion === true` (computed from `useReducedMotion()` hook from `005-chat-widget`):

- `.lc-progress-bar-fill` has `transition: none`.
- `.lc-progress-bar-fill::after` (shimmer pseudo-element) is hidden via `display: none`.
- Bar still updates instantly to reflect new `current` value.

## State Source

The widget's `useSOPState` hook reads the `x-sop-state` response header on every chat-API response (per `sop-state-contract.md → SOPStateHeaderPayload`). It exposes:

```ts
const { current, total, isFinalized, pendingStepSlug } = useSOPState();
```

The `<ProgressBar>` consumes `current` and `total`. The hook handles missing-header fallback (uses last-known value or hides bar if no prior state).

## Theming Hooks

Three new CSS custom properties exposed to lawyers:

- `--lc-progress-color` — fill color.
- `--lc-progress-bg` — track background.
- `--lc-progress-label-color` — label text color.

Lawyers override these in their site's CSS (or via the widget's `theme` prop per `005-chat-widget` theming contract).

## Bundle Size Budget

Component target: ≤ 1.5 KB gzipped (component + its CSS keyframes).

Verified at CI time by Phase 4 R8's `size-limit` gate (NPM ≤ 35 KB total, CDN ≤ 50 KB total). The new `<ProgressBar>` and `<Chips>` together must not push either bundle over its budget.

## Tests

`packages/widget/src/components/ProgressBar.test.tsx` MUST cover:

- Renders with correct ARIA attributes.
- `current=3, total=5` → fill ratio 0.6.
- `current=0, total=5` → fill ratio 0; bar visible but empty.
- `current=5, total=5` → fill ratio 1.0; bar visible at 100%.
- `current=8, total=5` → fill ratio capped at 1.0 (defensive against count > threshold).
- `total=0` → returns `null` (component not rendered).
- `reducedMotion=true` → `transition: none` style applied; shimmer pseudo-element absent (visual snapshot).
- Label `2/5` is shown with `aria-hidden="true"`; ARIA label uses verbose text.

