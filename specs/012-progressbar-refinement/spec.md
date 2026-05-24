# Feature Specification: ProgressBar Refinement

**Feature Branch**: `012-progressbar-refinement` (planned)

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Change request - Make the progressbar width a little more to increase its visibility and position it at top inside the chat container. Also there should be a textual label - Step - x/6"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visible Step Progress Inside Chat Panel (Priority: P1)

A visitor opens the chat widget and starts answering SOP intake questions. They want a clear, prominent indicator of how far along they are in the qualification flow — e.g., "Step - 3/6" — visible right above the conversation area where they're already looking. Today the progress indicator exists but is so thin (3px tall, no descriptive label) that visitors don't notice it, and it sits above the header outside the chat content area.

**Why this priority**: This is the only story for this change request. The progress bar already exists from 010-sop-workflow Phase 6 (US4) but is under-discoverable. Making it visible + clearly labeled directly impacts the "visitors stay engaged through the full SOP" success metric.

**Independent Test**: Open the widget, start a conversation, observe (a) the progress bar is visible above the conversation messages but below the panel header, (b) the bar is thick enough to be noticed at a glance without staring, (c) the textual label reads "Step - X/Y" where X is the visitor's current step count and Y is the total threshold (6 by default).

**Acceptance Scenarios**:

1. **Given** the visitor opens the chat widget for the first time, **When** the panel renders, **Then** they see a progress bar with the label "Step - 0/6" positioned at the top of the chat content area (below the header, above the message list).
2. **Given** the visitor has answered 3 SOP steps, **When** the next assistant response arrives, **Then** the progress bar updates to "Step - 3/6" and the filled portion advances proportionally.
3. **Given** the visitor has reached the qualified-lead threshold, **When** the SOP finalizes, **Then** the progress bar shows "Step - 6/6" fully filled.
4. **Given** the account has no published SOP (legacy state), **When** the panel renders, **Then** the progress bar is not shown (current behavior preserved).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The progress bar's vertical thickness MUST increase from the current 3px to a value that is comfortably visible at typical viewing distances on both desktop and mobile screens. The honest reading of "make the width a little more" is "make the bar thicker so visitors notice it"; specific value tuned during implementation but should land in the 6-10px range to balance prominence with restraint.
- **FR-002**: The progress bar MUST be positioned **inside the chat container**, specifically below the panel header bar (where the chatbot name + close button live) and above the messages scroll area. The current placement above the header (outside the chat content area) is changed.
- **FR-003**: The visible textual label MUST read `"Step - X/Y"` where X is the current count of completed SOP steps that count toward the threshold and Y is the threshold (6 for the default SOP). Today the label reads only `"X/Y"` without the "Step - " prefix.
- **FR-004**: The label MUST update in real time as the SOP state advances — same data source as today (`useSOPState` hook + the per-turn `x-sop-state` response header).
- **FR-005**: When the account has no published SOP (`total === 0`), the progress bar component MUST NOT render at all (preserves the existing fallback behavior; legacy accounts see no progress UI).
- **FR-006**: ARIA accessibility (role=progressbar, aria-valuenow, aria-valuemax, descriptive aria-label) MUST be preserved. The visible "Step - X/Y" label is decorative (aria-hidden="true"); the screen-reader text remains the verbose existing aria-label so the change does not regress accessibility.
- **FR-007**: The reduced-motion behavior MUST be preserved — when `prefers-reduced-motion: reduce` is set, the bar updates instantly with no transition animation and no shimmer.
- **FR-008**: The CSS custom properties (`--lc-progress-color`, `--lc-progress-bg`, `--lc-progress-label-color`) MUST continue to allow theme overrides without rebuilding.

### Key Entities

No new entities. The change is purely presentational on top of the existing `useSOPState` hook payload + the existing `<ProgressBar>` component.

## Success Criteria *(mandatory)*

- **SC-001**: A visitor in a 5-second usability test can describe the progress bar's position and what it represents without prompting. (Today's implicit baseline: the 3px bar is not noticed in informal review.)
- **SC-002**: The bar's thickness is large enough that it is visible at the viewer's normal seated viewing distance on a typical 13-15" laptop screen at 100% zoom — i.e., not "I can find it if I look closely" but "I see it the moment the panel renders".
- **SC-003**: The textual label format is `"Step - X/Y"` exactly, where X and Y are the same numeric values the existing component computes today. No format ambiguity.
- **SC-004**: The bar continues to advance correctly across all six default SOP steps (case_type → sub_type → where → what → when → contact); each completed step bumps the displayed X by one and the filled portion by 1/6.
- **SC-005**: Existing accessibility properties (role=progressbar + aria-valuenow + aria-valuemax + verbose aria-label) are unchanged; a screen-reader user hears the same announcement they hear today.
- **SC-006**: The widget bundle size stays within the existing budget (≤ 35 KB NPM gzipped / ≤ 50 KB CDN gzipped). The change is a few attribute tweaks + a label string change; bundle impact should be negligible (< 50 bytes).

## Assumptions

- "Width a little more" is interpreted as "thickness/height" — i.e., make the bar visually thicker so visitors notice it. The bar already spans the full horizontal width of the chat panel; making it wider horizontally is not possible without overflowing the panel. If the user instead meant "more horizontal width specifically on mobile viewports" (where the panel might already be narrower than the bar's visible region), that's a different change and not handled here.
- "Top inside the chat container" means below the header (firm name + close button) and above the messages list — the natural top of the conversation content area. If the user instead meant "outside the panel, floating above" or "inside the messages area, scrolling with messages", neither matches the natural reading; we proceed with the below-header-above-messages interpretation.
- The threshold value Y is 6 today (default SOP from 010-sop-workflow). The implementation MUST read Y from the SOP state, not hard-code 6; the label's Y will adjust automatically when a lawyer customizes the SOP threshold.
- No new dependencies are needed. The change is a small CSS/JSX tweak to the existing `<ProgressBar>` component plus a 1-line move in `ChatPanel.tsx`.

## Out of Scope

- Adding milestone markers or step labels (e.g., a tick at 1/6, 2/6, etc.) — keep it simple.
- Animating the label number with a counter effect — out of scope; instant text update is fine.
- Adding a tooltip on hover with the names of remaining SOP steps — out of scope.
- Customizing the bar color per-step — out of scope; single `--lc-progress-color` continues.
