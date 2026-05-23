# Contract: Analytics Events

**Owner**: Chat Widget (`005-chat-widget`)
**Source of Truth**: §6.13.

The widget emits analytics events through two parallel surfaces:

1. **Prop callbacks** (NPM channel) — typed function callbacks.
2. **DOM `CustomEvent`s** (CDN channel; also available in NPM) —
   dispatched on `document`.

Both surfaces fire from a single internal pipeline so callbacks
and DOM events are always consistent.

## Event Catalog

| Logical name | When fired | Prop callback | DOM event name | `event.detail` |
|---|---|---|---|---|
| `chat_opened` | Bubble clicked AND panel mounts | `onChatOpen()` | `legalchatbot:open` | `{}` |
| `chat_closed` | Close clicked, Escape pressed, or panel otherwise dismissed | `onChatClosed()` | `legalchatbot:closed` | `{}` |
| `message_sent` | User submits a message (post-sanitize, pre-streamText) | `onMessageSent({ role, content })` | `legalchatbot:message` | `{ role: 'user', content: string }` |
| `lead_submitted` | `captureLead` tool returns success in the `useChat` stream | `onLeadSubmitted({ classification, leadId })` | `legalchatbot:lead` | `{ classification, leadId }` |
| `escalation_triggered` | Configured escalation phrase appears in agent response | `onEscalationTriggered()` | `legalchatbot:escalation` | `{}` |

The CDN-only `legalchatbot:ready` event (dispatched after the
widget mounts via the auto-mount script) is NOT in this table —
it is a CDN-script-tag concern documented in
`cdn-script-contract.md`.

## Detection Rules

- **`message_sent`**: fired in the form `onSubmit` handler after
  input sanitation but before the network call. The `content` is
  the sanitized text the LLM will see.
- **`lead_submitted`**: detected via the `useChat` hook's
  `onToolCall` (or stream-data) callback when the `captureLead`
  tool's result includes `success: true` and `leadId`. The
  classification comes from the same result.
- **`escalation_triggered`**: detected via regex match on the
  configured `escalation.message` phrase in the streamed
  assistant text. The widget receives the configured message via
  `/api/config` (R5 extension) and matches against streamed
  output. (Assumption documented in spec.md "escalation
  detection").

## Order of Operations

```
user types and submits
  └─→ sanitize(text)                     (Phase 3 server-side; widget mirrors locally if needed)
        └─→ emit('message_sent', { role: 'user', content: text })
              └─→ useChat.append(message)
                    └─→ stream begins
                          └─→ tool calls may resolve:
                                ├── captureLead success ─▶ emit('lead_submitted', detail)
                                └── escalation phrase    ─▶ emit('escalation_triggered')
                          └─→ stream ends
```

## Determinism

- Each event fires at most once per logical occurrence.
- Tab-close does NOT fire `chat_closed` (only explicit dismissals
  do; the `unload` event is unreliable for analytics).
- The pipeline is fail-soft: a callback that throws does not
  block the next callback or the conversation.

## Constitution Compliance

- Constitution Principle V: NO PII appears in any event payload
  except where the lawyer's own callback consumes it. The widget
  itself does NOT log analytics events — the lawyer's analytics
  platform decides what to do with them.
- Constitution Principle VI: events are observable; lawyers can
  measure conversion funnel without engineering changes to the
  widget.

## Tests

- `useAnalyticsEvents.test.ts`: verifies prop callback AND DOM
  event fire on each emit; verifies callback errors don't break
  the pipeline.
- Component tests verify each event fires at the right moment.

