# Feature Specification: Widget Redesign

**Feature Branch**: `023-widget-redesign`

**Created**: 2026-06-21

**Status**: Draft

## User Scenarios & Testing

### User Story 1 — Visitor sees a fresh, modern chat panel (Priority: P1)

A visitor lands on the law firm's website. The chat bubble in the bottom-right corner shows the bot avatar on a circular grey background, a green online-status dot, and a "Need help?" tooltip. When the visitor clicks the bubble, the chat panel opens with a smooth entrance animation.

The panel is white with large rounded corners. The top section shows "How can we help you?" as a large bold heading, followed by the bot avatar and a timestamp. Below that, the first available response options appear as outlined pill chips — each chip has a radio-circle icon on the left and the option label on the right. The bottom of the panel shows "Powered by [brand]" in small grey text. There is no visible text-input box by default on the greeting screen.

**Why this priority**: This is the first impression. A polished initial state sets visitor expectations and increases engagement.

**Independent Test**: Open the widget on a fresh session. Confirm: panel has white background and large rounded corners; heading "How can we help you?" is visible; bot avatar with timestamp is present; at least one chip is rendered as an outlined pill with a radio-circle icon; no text input is visible; "Powered by" footer is present; launcher shows bot avatar with green dot.

**Acceptance Scenarios**:

1. **Given** a visitor opens the page, **When** the chat bubble is visible, **Then** it shows the bot avatar, a green online dot, and a "Need help?" tooltip.
2. **Given** the visitor clicks the bubble, **When** the panel opens, **Then** it animates in smoothly (slide-up or scale-in, ≤300ms).
3. **Given** the panel is open on the greeting screen, **When** the visitor views it, **Then** chips are rendered as outlined blue pill shapes with radio-circle icons and no text-input box is visible.

---

### User Story 2 — Visitor sees conversation history with undo affordance (Priority: P1)

Once the visitor has made one or more responses, the conversation renders in a clear two-column style: bot messages as large plain left-aligned text (no bubble background), user responses as filled blue rounded pill bubbles aligned to the right with a timestamp below. Immediately to the left of each user bubble is a small circular undo (↩) icon button. Clicking that icon undoes the visitor's last response, restoring the chat to the state before that turn.

The active chips for the current pending question appear at the bottom of the message list, not in a separate fixed composer area. Below the chips, a free-text input is available when the current step accepts free-text.

**Why this priority**: The undo affordance is a key new interaction and the conversation layout is the core experience.

**Independent Test**: Send one response via chip. Confirm: user response renders as a filled blue pill (right-aligned) with a small undo icon to its left; bot follow-up renders as large plain text (left-aligned); chips for the next step appear below the latest bot message. Click the undo icon; confirm the last user turn is removed and the previous chips/state are restored.

**Acceptance Scenarios**:

1. **Given** the visitor has submitted at least one response, **When** viewing the chat, **Then** their response appears as a filled blue rounded pill on the right, with a small undo icon to its left.
2. **Given** the conversation is in progress, **When** the visitor clicks the undo icon beside their most recent response, **Then** that response is removed and the preceding state (bot question + chips) is restored.
3. **Given** the visitor is on a step that accepts free text, **When** viewing the panel, **Then** a free-text input appears below the chips within the scrollable message area.
4. **Given** there is only one message pair, **When** the visitor undoes it, **Then** the greeting state is restored and no undo icon is shown on the greeting chips.

---

### User Story 3 — Visitor expands the panel for more reading room (Priority: P2)

The top-right toolbar of the chat panel contains three icon buttons: reset/restart, expand, and close. When the visitor clicks the expand button (the bracket-arrows icon), the panel smoothly grows to a larger size — wider and taller — occupying more of the viewport. A second click (or a collapse button that replaces it) returns the panel to its normal size with a smooth reverse animation. The conversation content reflows correctly in both sizes.

**Why this priority**: Expand is a usability enhancement for longer conversations; it does not block the core chat flow.

**Independent Test**: With the panel open, click the expand icon. Confirm: panel grows smoothly (animation ≤400ms); conversation content is still readable; chips and input are still accessible. Click expand again (or the collapse icon that replaces it). Confirm: panel returns to its original size smoothly.

**Acceptance Scenarios**:

1. **Given** the panel is in normal size, **When** the visitor clicks the expand icon, **Then** the panel animates to a larger size (wider and taller) within 400ms.
2. **Given** the panel is expanded, **When** the visitor clicks the collapse icon (same position, updated icon), **Then** the panel returns to its original size with a smooth animation.
3. **Given** the panel is expanded, **When** the visitor scrolls the conversation, **Then** the extra space is used to show more messages without truncation.
4. **Given** the panel is in either size, **When** the close button is clicked, **Then** the panel closes regardless of expand state.

---

### Edge Cases

- What if the visitor has no chat history to undo? The undo icon is not shown on the first-ever chip selection (the greeting chips have no prior state to revert to).
- What if the visitor is on mobile (narrow viewport)? The expanded state uses the full viewport height/width on small screens, and the normal state is a fixed-size panel anchored bottom-right.
- What if chips overflow the visible area? The message list scrolls vertically; chips are part of the scroll.
- What if the visitor clicks undo during an active streaming response? The undo action is disabled (button greyed out) while the assistant is responding.
- What if the panel is expanded and the visitor resizes the browser window? The panel recalculates its position and size to remain within the viewport.

---

## Requirements

### Functional Requirements

**Panel visual design**

- **FR-001**: The chat panel MUST have a white background, large rounded corners (≥16px), and a subtle drop shadow.
- **FR-002**: The panel header MUST display "How can we help you?" (or the configured greeting heading) as a large bold sans-serif heading.
- **FR-003**: The bot avatar MUST be a small square ghost/robot icon with a timestamp beside it, matching the reference design style.
- **FR-004**: Bot messages MUST render as large plain text with no background bubble, left-aligned, below the avatar+timestamp row.
- **FR-005**: User responses MUST render as filled blue rounded pill bubbles, right-aligned, with a small timestamp below.
- **FR-006**: A "Powered by [brand]" attribution MUST appear in small grey text at the bottom of the panel on all screens.

**Chips and input placement**

- **FR-007**: Response chips MUST render as outlined blue rounded pill shapes with a radio-circle icon on the left and the option label on the right, matching the reference initial-state design.
- **FR-008**: Active chips for the current step MUST appear below the latest bot message within the scrollable message list — NOT in a separate fixed bottom composer strip.
- **FR-009**: A free-text input field MUST appear below the chips within the scrollable area when the current SOP step accepts free text. It MUST be styled consistently with the panel (not a floating toolbar).
- **FR-010**: When the bot is streaming a response, chips and the free-text input MUST be hidden until the response completes.

**Undo button**

- **FR-011**: Each user response bubble MUST have a small circular undo icon button positioned immediately to its left.
- **FR-012**: Clicking the undo icon on the most recent user response MUST revert the conversation to the state before that response was sent (removing the user turn and the subsequent bot response).
- **FR-013**: The undo icon MUST be visually subtle (grey, small) so it does not compete with the conversation content.
- **FR-014**: The undo icon MUST be disabled (non-interactive, greyed out further) while the assistant is streaming a response.
- **FR-015**: Undo icons MUST NOT appear on chip selections that were part of the initial greeting (no prior state to revert to).

**Toolbar**

- **FR-016**: The top-right toolbar MUST contain exactly three circular icon buttons: restart/reset, expand/collapse, and close — in that order, matching the reference design.
- **FR-017**: The restart button MUST clear the conversation and return to the greeting state (existing reset behaviour, re-styled).
- **FR-018**: The close button MUST close the panel (existing close behaviour, re-styled).

**Expand / collapse animation**

- **FR-019**: Clicking the expand button MUST trigger a smooth CSS animation expanding the panel to a larger size. The animation MUST complete within 400ms.
- **FR-020**: In the expanded state, the expand icon MUST change to a collapse icon (inward-pointing arrows).
- **FR-021**: Clicking the collapse icon MUST animate the panel back to its default size within 400ms.
- **FR-022**: On viewport widths ≤480px, the expanded state MUST fill the entire viewport (full-screen mode).

**Launcher button**

- **FR-023**: The launcher bubble MUST show the bot avatar on a circular grey/light background with a green online-status dot in the bottom-right.
- **FR-024**: A "Need help?" tooltip (speech bubble) MUST appear beside the launcher on first load and disappear after the visitor interacts or after 5 seconds.

**Scope boundary**

- **FR-025**: All changes MUST be confined to the visual presentation layer. No changes to chat API calls, session management, SOP state machine, lead capture, or any backend data.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: The panel opens with an animation that completes in ≤300ms on a mid-range device.
- **SC-002**: The expand and collapse animations each complete in ≤400ms.
- **SC-003**: A visitor can undo their most recent response with a single click and see the previous state restored immediately (no page reload, no perceptible delay).
- **SC-004**: All existing chat functionality (chip selection, free-text input, contact form, SOP progression, lead capture) continues to work correctly after the redesign.
- **SC-005**: The redesigned widget scores ≥4/5 in an informal usability review against the reference designs for visual fidelity and clarity.
- **SC-006**: The widget renders correctly on viewport widths from 320px to 1440px.

---

## Assumptions

- The redesign targets `packages/widget` only. The `packages/api` dashboard and the chat API are not modified.
- The brand colour for filled chips and user bubbles is the existing blue (`#4F46E5` indigo or equivalent) unless overridden by the firm theme configuration — the same theming variable system already in use.
- The bot avatar image is the existing ghost/robot icon already in the widget asset set, not a new asset.
- "Powered by" brand text in the footer references the existing attribution already present in the widget.
- The undo functionality reuses the session history restore mechanism introduced in spec 022. The redesign exposes it via the new undo icon placement; no new API endpoints are needed.
- Free-text input is hidden on steps where the current SOP step does not accept free text (contact form step renders its own form, not a text input).
- The "Need help?" tooltip auto-dismisses after 5 seconds or on first interaction; it does not reappear on subsequent opens in the same browser session.
- The three toolbar buttons (reset, expand, close) are always visible when the panel is open; they are not hidden in any state.
