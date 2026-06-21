# Phase 0 — Research: Widget Redesign

**Feature**: 023-widget-redesign · **Date**: 2026-06-21

---

## R1 — Panel styling approach

**Decision**: Continue using inline styles + CSS custom properties. No new CSS framework or library.

**Rationale**: Every existing widget component uses inline styles with `var(--lc-*)` tokens. Keeping this pattern means the firm theme system (color overrides via `config.theme`) continues to work without any changes. The design tokens in `panel.css` lines 33–83 are the single source of truth for colors and spacing.

**Changes required**:
- `--lc-background` → `#ffffff` (white, matching reference)
- `--lc-surface` → `rgba(255,255,255,0.95)` (white glass)
- `--lc-message-bg-assistant` → `transparent` (no bubble background for assistant messages)
- Add `--lc-chip-border` → `#4F46E5` (or `var(--lc-primary-color)`)
- Add `--lc-chip-bg-hover` → same as `var(--lc-primary-bg)` on hover
- Header strip: remove the solid colour header entirely; use white background with heading text only

**Alternatives considered**: Tailwind (rejected — bundle size; breaks firm theming). CSS Modules (rejected — existing pattern is inline + panel.css; mixing approaches would be inconsistent).

---

## R2 — Expand/collapse animation

**Decision**: CSS `transition` on `width` and `height` of `.lc-panel`, triggered by a new `data-expanded="true|false"` attribute forwarded from PanelShell. New CSS variables control the expanded dimensions.

**New CSS variables**:
```css
--lc-panel-expanded-width: 700px;
--lc-panel-expanded-height: min(860px, calc(100vh - 48px));
```

**CSS**:
```css
.lc-panel {
  transition: width 300ms cubic-bezier(0.16, 1, 0.3, 1),
              height 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
.lc-panel[data-expanded="true"][data-breakpoint="desktop"] {
  width: var(--lc-panel-expanded-width);
  height: var(--lc-panel-expanded-height);
}
@media (max-width: 480px) {
  .lc-panel[data-expanded="true"] {
    width: 100vw;
    height: 100dvh;
    inset: 0;
    border-radius: 0;
  }
}
```

**State flow**:
1. `isExpanded` boolean lives in `ChatPanel`.
2. Passed as `isExpanded` prop to `PanelShell`.
3. PanelShell forwards as `data-expanded={isExpanded ? "true" : "false"}` on the `.lc-panel` div.
4. CSS handles the size transition.
5. Icon in toolbar toggles between expand SVG and collapse SVG based on `isExpanded`.

**Rationale**: Follows the existing `data-phase` / `data-breakpoint` attribute pattern. CSS transitions are hardware-accelerated. No JS animation library needed (~40KB saved).

**Alternative considered**: `react-spring` or `framer-motion` — rejected for bundle size.

---

## R3 — Undo mechanics

**Decision**: Client-side only. `useChat` from `@ai-sdk/react` v1 exposes a `setMessages` function in its return value. To undo the last turn, remove the last `[user, assistant]` pair from the messages array.

**Implementation**:
```typescript
const { messages, setMessages, ... } = useChat({ ... });

function handleUndo() {
  setMessages((prev) => {
    if (prev.length < 2) return prev;
    // Pop the last assistant response and the user message before it
    return prev.slice(0, -2);
  });
}
```

**SOP state after undo**: The `sopState` stored in `sessionStorage` (key `lc_sop_state`) was written when the second-to-last response arrived. After popping 2 messages, the displayed messages match what the session looked like before the last turn. The SOP chips re-render from the now-current `sopState` in sessionStorage. This is correct because `useSOPState` reads sessionStorage on mount and only updates on new `/api/chat` responses — after undo there's no new response, so sopState stays at the pre-last-turn value.

**Server session**: The server still holds the full message history. On refresh, the history endpoint returns everything and the full conversation restores. This is intentional — undo is an in-session visual affordance, not a permanent deletion. If the spec later requires server-side undo, that is a separate feature.

**Alternatives considered**: DELETE endpoint to remove last server-side turn — rejected (spec says no data layer changes). Maintaining a local undo stack — rejected as over-engineering; `setMessages` pop is sufficient.

---

## R4 — Chip radio-circle icon

**Decision**: Inline SVG (16×16px), an open circle (`stroke-only`, no fill) that matches the reference `initial-state.png`.

**SVG**:
```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
</svg>
```

Rendered inside each chip button, before the label text. Color inherits from the button (`currentColor`), so it follows the hover state automatically.

**Alternative**: Unicode circle `○` — rejected (inconsistent rendering across fonts). Emoji — rejected (no control over color).

---

## R5 — Launcher "Need help?" tooltip

**Decision**: A positioned `<div>` rendered as a sibling of the bubble button. Controlled by `showTooltip` state (true on mount, false after 5 seconds or on first click). Not persisted to sessionStorage — reappears on every page load.

**Rationale**: The reference `chat-icon.png` shows the tooltip as a speech bubble to the left of the avatar. This is an awareness element shown to first-time visitors. Showing it on every page load matches the lightweight nature of the widget (no user accounts, no persistent preferences beyond session).

**Alternative**: Persist dismissal to localStorage — rejected (spec doesn't require permanent dismissal; adds complexity).

---

## R6 — Header redesign

**Decision**: Replace the current solid-colour header strip with a headerless approach — heading text ("How can we help you?") lives in the scrollable message area as the first item. The three toolbar buttons (restart, expand, close) float in the top-right as a row of icon-only circular grey buttons, positioned absolutely within the panel.

**Rationale**: The reference design (both `initial-state.png` and `mid-chat.png`) has no coloured header bar. The panel is entirely white. The toolbar is a minimal row of icon circles in the top-right corner. The bot avatar + timestamp appear as the first item in the conversation area.

**Impact**: The current header div (ChatPanel.tsx lines 416–456) is reworked to be transparent/white with the toolbar only. The greeting heading moves into the `greetingNode` that's already passed to MessageList.

---

## Open questions remaining

None. All design decisions are resolved. Ready for implementation.
