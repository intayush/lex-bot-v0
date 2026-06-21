# Contract: Undo Interaction

**Feature**: 023-widget-redesign

---

## Undo Icon Placement

Each user message bubble has a small circular undo button rendered **immediately to the left** of the bubble:

```
[undo ↩]  [User message bubble              ]
                                  a few seconds ago
```

- Button size: `28px × 28px` circle
- Position: `align-self: center` in a flex row containing `[undo-btn] [bubble]`
- Icon: `↩` (counter-clockwise arrow) SVG, `14px`, `#9CA3AF` (grey)
- Background: `transparent` (default), `#F3F4F6` on hover
- Border: none (no outline, no ring)
- `aria-label="Undo last response"`

---

## Trigger Behaviour

**On click**:
1. Call `handleUndo()` in ChatPanel
2. `setMessages(prev => prev.slice(0, -2))` — removes last user + last assistant message
3. SOP chips re-render based on the current sessionStorage `lc_sop_state` (which already reflects the pre-last-turn state)
4. Input re-enables if it was disabled for any reason

**The undo icon only appears on the MOST RECENT user message bubble**. Previous user bubbles show no undo icon — only the current last turn is undoable.

---

## Disabled States

The undo button is rendered but non-interactive (`disabled`, `opacity: 0.4`, `cursor: not-allowed`) when:
- `isLoading === true` (assistant is streaming)

The undo button is NOT rendered at all when:
- `messages.length < 2` — no full turn to undo (only greeting visible)

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Only the greeting is shown (no user messages) | No undo button rendered anywhere |
| User sent 1 message and received 1 reply | Undo removes both; greeting state restores |
| Multiple messages in history | Undo only removes the last pair (one step at a time) |
| Undo while streaming | Button is disabled (greyed out) — no action |
| Rapid double-click on undo | Second click fires after state updates; removes the now-last pair (undo undo) |
| The undo removes a contact-form submission | The contact form re-appears in the trailing slot (SOP step reverts to contact pending) |

---

## What Undo Does NOT Do

- Does NOT call any API to delete server-side session data
- Does NOT modify sessionStorage directly
- Does NOT affect the SOP progress bar calculation (that derives from sopState in sessionStorage, which is not popped)
- Does NOT apply to assistant messages (no undo icon on bot messages)
- Does NOT affect previous user messages (only the most recent turn is undoable)
