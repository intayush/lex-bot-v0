# Data Model: Widget Redesign

**Feature**: 023-widget-redesign · **Date**: 2026-06-21

No database schema changes. No new API endpoints. Two new in-memory React state values only.

---

## New UI State

### `isExpanded: boolean`

**Location**: `ChatPanel` component (passed down to `PanelShell` as a prop)

**Default**: `false`

**Transitions**:
- `false` → `true`: User clicks the expand button in the toolbar
- `true` → `false`: User clicks the collapse button (same position, updated icon)
- Any → `false`: User closes the panel (reset on next open)

**Effect**: When `true`, the `PanelShell` sets `data-expanded="true"` on the `.lc-panel` DOM element, and CSS transitions the panel to larger dimensions. When `false`, dimensions return to normal.

---

### `showTooltip: boolean`

**Location**: `ChatWidget` component (passed to `ChatBubble` as a prop)

**Default**: `true`

**Transitions**:
- `true` → `false`: After 5 seconds (via `setTimeout` in `useEffect`)
- `true` → `false`: When the visitor clicks the bubble (any interaction dismisses it)

**Effect**: Controls visibility of the "Need help?" speech-bubble element beside the launcher.

---

## Unchanged State

All existing state is preserved without modification:

| State | Location | Unchanged behaviour |
|-------|----------|---------------------|
| `isOpen` | ChatWidget | Controls panel open/closed |
| `isMounted` | ChatWidget | Controls ChatPanel DOM mount |
| `messages` | ChatPanel (useChat) | Conversation message array |
| `sopState` | ChatPanel (useSOPState) | SOP progress state from x-sop-state header |
| `widgetConfig` | ChatPanel | Config from /api/config |
| `input` | ChatPanel (useChat) | Current text input value |
| `isLoading` | ChatPanel (useChat) | Streaming in progress flag |
| `restored` | ChatPanel (outer shell) | History-restored messages on mount |

---

## Undo State Model

No new persistent state. The undo action operates directly on the existing `messages` array via `setMessages` (provided by `useChat`).

**Pre-undo**: `messages = [msg1_user, msg1_assistant, msg2_user, msg2_assistant]`
**Post-undo**: `messages = [msg1_user, msg1_assistant]`

The SOP state in `sessionStorage['lc_sop_state']` already holds the state after `msg1_assistant` was received — it does not need to be rewound because `useSOPState` does not update unless a new `/api/chat` response arrives.

**Undo is disabled** (button non-interactive) when:
- `messages.length < 2` (nothing to undo — only bot greeting shown)
- `isLoading === true` (assistant is currently responding)
