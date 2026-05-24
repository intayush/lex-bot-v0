# Contract Supplement: ProgressBar Refinement

**Owner**: ProgressBar Refinement (`012-progressbar-refinement`)
**Supplements**: `specs/010-sop-workflow/contracts/progress-bar-contract.md`
**Source of Truth**: spec.md FR-001 to FR-008 + research.md R1-R6.

## Purpose

This document supplements (does not replace) the 010-sop-workflow
ProgressBar contract. It documents the three behavioral changes
introduced by 012-progressbar-refinement; everything else from the
010 contract is preserved unchanged.

## Visible Changes

### Bar Height

| | 010 (current) | 012 (rev) |
|---|---|---|
| `height` style | `3px` | `8px` |
| Visual prominence | Subtle accent line | Clearly noticeable progress indicator |

### Label Format

| | 010 (current) | 012 (rev) |
|---|---|---|
| Label text format | `"{current}/{total}"` (e.g. `5/6`) | `"Step - {current}/{total}"` (e.g. `Step - 5/6`) |
| `aria-hidden` on label | `"true"` (decorative) | `"true"` (preserved) |
| Verbose `aria-label` on parent | `"Lead qualification progress: X of Y questions answered"` | unchanged |

### Label Position

| | 010 (current) | 012 (rev) |
|---|---|---|
| Label `position` | `absolute` | `absolute` (preserved) |
| Label `top` | `4px` | `12px` (clears the now-thicker 8px bar) |
| Label `right` | `8px` | `8px` (preserved) |

### Component Position in ChatPanel

| | 010 (current) | 012 (rev) |
|---|---|---|
| Render order in `ChatPanel.tsx` | Before the header `<div>` (above the header bar) | After the header `<div>` (below the header, above the messages) |

## Unchanged from 010

- Component file path: `packages/widget/src/components/ProgressBar.tsx`.
- Component prop signature: `{ current: number; total: number; reducedMotion: boolean }`.
- ARIA: `role="progressbar"`, `aria-valuenow`, `aria-valuemin={0}`,
  `aria-valuemax={total}`, verbose `aria-label`.
- `total === 0` case: component returns `null` (no render).
- `current` clamped to `[0, total]`; visible ratio = `current / max(total, 1)`.
- Fill mechanism: `transform: scaleX(${ratio})` (GPU-accelerated).
- Animation: `300ms ease-out` transition; disabled when `reducedMotion=true`.
- Shimmer pseudo-element: present when active; hidden when
  `reducedMotion=true`.
- CSS custom properties: `--lc-progress-color`, `--lc-progress-bg`,
  `--lc-progress-label-color` continue to allow theme overrides.
- The `@keyframes lc-progress-shimmer` and viewport-based label hide
  (`@media (max-width: 360px)`) injected via inline `<style>`.

## Compatibility Notes

- The 010 component test file (deferred `[~]` per 010 T048) still
  applies to the post-012 component. When widget Vitest+jsdom infra
  lands, those tests cover the `current/total` ratio computation +
  ARIA invariants — not the visible-label format. Adding a label-format
  assertion is a small addition to the deferred test file at that time.
- CSS custom-property consumers don't need to change anything. The
  defaults match the 010 contract.
- The "Step - " prefix is hard-coded in this rev. A future feature
  could add a customizable label template (e.g. `"Question - "` for
  firms that prefer that wording); not in scope for 012.

## Testing

A new walk-tagged Playwright spec at
`packages/api/tests/e2e/widget-progressbar-refinement.walk.spec.ts`
asserts the visible refinements:

1. The progress bar is rendered inside the chat container (after the
   header bar in the DOM order).
2. The visible label contains `"Step - "` prefix.
3. The label text matches `Step - X/Y` format with X/Y matching the
   live SOP-state values.
4. ARIA attributes (`role`, `aria-valuenow`, `aria-valuemax`) are
   preserved.

Structural assertions only — never asserts exact pixel values for
height/top/etc., per research.md R6.
