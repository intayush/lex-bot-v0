# Research: ProgressBar Refinement

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document captures the small number of technical decisions for this
presentational refinement. Each is grounded in 010-sop-workflow's
existing `<ProgressBar>` component plus the spec's Assumptions section.

## R1 — Bar thickness: 3px → 8px

**Decision**: Increase the bar height from `3px` to `8px`.

**Rationale**:
- 3px was the original 010 R8 design choice for a "thin shiny bar" that
  signaled progress without dominating the chat panel. Live verification
  showed visitors don't notice it at all — the design optimized too
  hard for restraint.
- 8px sits in a Goldilocks zone: thick enough that the eye picks it up
  in peripheral vision, thin enough that it doesn't compete with the
  chat content for attention.
- 6px is too thin once the label is added inside the bar's vertical
  bounds. 10-12px starts to feel heavy/datedy.
- Material Design's typical horizontal progress indicator is 4px;
  iOS HIG suggests 6-8px for accent progress indicators. 8px lands at
  the upper end of platform conventions, which is appropriate given
  this is the visitor's primary signal of where they are in a 6-step
  intake flow.

**Alternatives considered**:
- 4px: barely an improvement over the 3px we're rejecting.
- 6px: feasible; 8px wins on visibility for the SOP-progress use case.
- 12px: too heavy. Becomes a header element rather than an accent.

## R2 — Position: above-header → below-header

**Decision**: Move the `<ProgressBar>` from its current pre-header
position (line 1 of the panel content stack) to immediately after the
header (between the header `<div>` and the messages scroll area).

**Rationale**:
- Spec FR-002 + the user's request: "position it at top inside the
  chat container".
- "Inside the chat container" ≠ "above the panel". The header bar
  (firm name + close button) is part of the chat panel's chrome; the
  conversation content area starts below it. A progress bar above
  the header reads as a separate notification bar — visitors don't
  associate it with the conversation.
- Below the header + above the messages list is the natural top of
  the conversation content. The bar moves with the content visually,
  making the relationship to "your progress through this chat" clear.

**Alternatives considered**:
- Inside the header (over the firm name): would clash with the header
  styling (dark background today) and crowd the close-button affordance.
- Sticky-floating over the message stream: complex layout, scroll
  jitter risk on mobile.
- Bottom of the panel (above the input): inverts the convention; users
  expect progress at the top.

## R3 — Label format: "X/Y" → "Step - X/Y"

**Decision**: Prefix the visible numeric label with the literal string
`"Step - "`.

**Rationale**:
- Spec FR-003 + the user's request.
- "5/6" alone is ambiguous to a first-time visitor (what is being
  counted? out of what?). "Step - 5/6" reads naturally.
- The dash separator (rather than `: ` or `/`) matches the visual
  rhythm of typical wizard UIs ("Step 1 of 5", "Step - 3/6").

**Alternatives considered**:
- "Step 5 of 6": longer, slightly more readable, but eats more
  horizontal space inside the bar's right-aligned label region.
- "5 / 6 steps": same length tradeoff, less natural ordering.
- Drop the dash and use spaces: "Step 5/6" — works fine but the dash
  matches the user's exact request.

## R4 — Accessibility: preserve verbose aria-label

**Decision**: The visible `Step - X/Y` text stays `aria-hidden="true"`
(decorative). The screen reader continues to announce the existing
verbose `aria-label`: `"Lead qualification progress: X of Y questions
answered"`.

**Rationale**:
- The decorative-visible-label pattern is the existing 010 contract;
  changing it would regress accessibility (screen reader users would
  lose the descriptive context).
- Adding "Step - " to the verbose aria-label is unnecessary — the
  existing wording is already self-describing.

**Alternatives considered**:
- Make the visible label the announced label (drop aria-hidden):
  rejected. Loses the verbose context for screen reader users.
- Add "Step - X/Y" as a separate sr-only element: redundant; the
  existing aria-label already announces position.

## R5 — Label vertical position with thicker bar

**Decision**: When the bar is 8px tall, the label `top: 4px` (today's
value) puts the label visually inside the filled portion. Adjust to
`top: 12px` so the label sits just above the bar.

**Rationale**:
- With 3px bar + `top: 4px`, the label sits 1px below the bar's top
  edge — barely overlapping. With 8px bar + `top: 4px`, the label
  would sit 4px down inside the bar.
- The visible label needs to be readable (not overlapping the colored
  fill) while still being clearly associated with the bar.
- `top: 12px` (8px bar + 4px clearance) puts the label just below the
  bar where there's clean panel background, matching the original
  visual intent.

**Alternatives considered**:
- Center the label vertically over the bar: requires more inline-styling
  acrobatics; doesn't read as cleanly when the fill is partial (the
  text would float over the colored fill region).
- Move the label outside the `<div role="progressbar">` and stack
  vertically: cleaner DOM but bigger refactor; unnecessary for the
  scope of this change.

## R6 — Walk-spec assertion strategy

**Decision**: Assert structural signals only — bar element exists,
label text contains "Step", aria attributes preserved. Never assert
exact pixel values (CSS specifics would couple test to styling
implementation).

**Rationale**:
- Same convention as the 010 + 011 walk specs.
- The "is the bar 8px tall" check would couple the test to implementation
  detail (a future tune to 7px or 9px would break the test for no
  user-facing reason).
- The user-facing contract is "label says 'Step - X/Y'" + "bar is
  visible" + "bar advances with state". All testable structurally.

**Alternatives considered**:
- Visual regression / screenshot-diff testing: overkill for a 4-line
  CSS change.
- Computed-style assertions (`element.computedStyle.height`): brittle.

## Summary

All decisions are minor refinements to the 010 ProgressBar contract.
No external dependencies, no new infrastructure, no Constitution
principle implications beyond preserving the 010 invariants verbatim.

Ready to proceed to Phase 1 (contracts supplement + quickstart).
