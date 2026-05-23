# Data Model: Chat Widget

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The Chat Widget is a UI component. It introduces no persistent
server-side entities. Its "data model" consists of: component
tree + props, theme tokens (CSS custom properties), client-side
storage shape, and the analytics-event payloads.

## Component Tree

```
LegalChatbot                                              (NPM library entry)
├── DemoSite (NPM consumer's host page)
└── <ChatWidget>                                           (root)
    ├── <ChatBubble>                                       (always-rendered trigger)
    └── <ChatPanel>                                        (lazy-loaded; Shadow DOM-rooted)
        ├── <Header>                                       (chatbot name + close button)
        ├── <ConsentBanner>                                (shown on first open w/o consent)
        ├── <Messages>                                     (role="log" aria-live="polite")
        │   ├── <WelcomeScreen>                            (shown when messages.length === 0)
        │   │   ├── greeting message
        │   │   └── <QuickReplies>
        │   ├── <MessageGroup>×N                           (relative timestamps)
        │   ├── <TypingIndicator>                          (during streaming)
        │   ├── <ReconnectingIndicator>                    (offline)
        │   └── <ErrorMessage>                             (4xx/5xx/timeout)
        ├── <DisclaimerFooter>                             (persistent §11.4 text)
        └── <InputForm>
            └── <AutoGrowTextarea>
```

The CDN entry script (`cdn-entry.tsx`) is a thin wrapper around
`<LegalChatbot>` that auto-mounts on `data-api-key`.

## Props

```ts
// packages/widget/src/components/ChatWidget.tsx (public API)

export interface LegalChatbotTheme {
  primaryColor?: string;
  primaryText?: string;
  background?: string;
  fontFamily?: string;
  borderRadius?: string;
  bubbleUser?: string;
  bubbleBot?: string;
  position?: 'bottom-right' | 'bottom-left';
  // Internal-only:
  disclaimerColor?: string;
}

export interface LegalChatbotProps {
  apiKey: string;
  apiUrl?: string;                 // default from VITE_API_URL or 'http://localhost:3000/api/chat'
  position?: 'bottom-right' | 'bottom-left';
  theme?: Partial<LegalChatbotTheme>;
  onChatOpen?: () => void;
  onChatClosed?: () => void;
  onMessageSent?: (m: { role: 'user'; content: string }) => void;
  onLeadSubmitted?: (l: { classification: string; leadId: string }) => void;
  onEscalationTriggered?: () => void;
}
```

The `theme` prop is shallow-merged with default theme; missing
keys fall back to CSS custom property defaults.

## Theme Tokens (CSS Custom Properties)

Per §6.7 / FR-021. Defined as CSS variables; settable from the
host page's CSS or via the `theme` prop.

| Variable | Default | Purpose |
|---|---|---|
| `--lc-primary-color` | `#1a365d` | Bubble trigger; user message bubble bg; primary buttons |
| `--lc-primary-text` | `#ffffff` | Text on primary backgrounds |
| `--lc-background` | `#ffffff` | Panel background |
| `--lc-font-family` | system-ui stack | All widget text |
| `--lc-border-radius` | `12px` | Panel + bubble corners |
| `--lc-bubble-user` | `#1a365d` | User message bubble bg |
| `--lc-bubble-bot` | `#edf2f7` | Bot message bubble bg |
| `--lc-position` | `bottom-right` | Panel/bubble anchor (`bottom-right` \| `bottom-left`) |

The Shadow DOM boundary is permeable to CSS custom properties
(R9), so host-page overrides still work even though styles are
encapsulated.

## Client-Side Storage

Only `sessionStorage` is used. Two keys:

| Key | Value | Set when | Cleared when |
|---|---|---|---|
| `lc_session_id` | `sess_<nanoid>` from API's `x-session-id` header | First chat response received | Tab/browser closed (sessionStorage native lifecycle) |
| `lc_consent_accepted` | ISO 8601 timestamp string | User clicks "Continue" in `<ConsentBanner>` | Tab/browser closed |

No other browser storage. Constitution V binding (FR-026, SC-018).

## Network Boundaries

The widget makes HTTPS calls to exactly two API surfaces:

| Endpoint | Owner | Purpose |
|---|---|---|
| `POST /api/chat` | `004-chat-api-agent` | Streaming chat; consumed via `useChat` |
| `GET /api/config` | `004-chat-api-agent` (route exists) | Fetch greeting + practice areas + phone + privacy_policy_url |
| `POST /api/consent` (planned) | `008-hardening` (FR-006) | Submit consent timestamp on banner accept |

Both are reached at `apiUrl` (the chat URL) or its base for
`/api/config` and `/api/consent`. The host page's CORS already
permits the wildcard origin (Phase 3 `004-chat-api-agent`
contract).

## Analytics Event Payloads

Per §6.13 / FR-049. Five events:

| Event Name | Prop Callback | DOM Event Name | Payload |
|---|---|---|---|
| `chat_opened` | `onChatOpen` | `legalchatbot:open` | `{}` |
| `chat_closed` | `onChatClosed` | `legalchatbot:closed` | `{}` |
| `message_sent` | `onMessageSent` | `legalchatbot:message` | `{ role: 'user', content: string }` |
| `lead_submitted` | `onLeadSubmitted` | `legalchatbot:lead` | `{ classification: 'urgent' \| 'normal' \| 'unqualified', leadId: string }` |
| `escalation_triggered` | `onEscalationTriggered` | `legalchatbot:escalation` | `{}` |

DOM events are dispatched via `document.dispatchEvent(new CustomEvent('legalchatbot:...', { detail }))`.

## /api/config Response Shape (consumed)

```ts
// Validated via packages/shared/src/schemas/widget-config.ts (NEW — owned by Phase 4)
const widgetConfigSchema = z.object({
  chatbot_name: z.string(),
  greeting_message: z.string(),
  practice_areas: z.array(z.string()),
  phone: z.string().optional(),
  privacy_policy_url: z.string().url().optional(),
});
```

The schema is exported from `@legal-chatbot/shared` so Phase 6
dashboard's preview chat reuses the same validation. The config
endpoint is owned by Phase 3 (`004-chat-api-agent`); the schema
location is `packages/shared` per Constitution II.

## State Transitions

### Widget Open/Close

```
[closed]  ── click bubble ──▶  [open, panel rendered]
                                       │
                                       ├── click close / Escape ──▶ [closed]
                                       │
                                       └── tab unload ──▶ [storage cleared]
```

### Consent

```
[no consent stored]  ── first open ──▶  [banner shown]
                                                │
                                                ├── click Continue ──▶ [accepted, banner dismissed]
                                                │     (sessionStorage write + POST /api/consent)
                                                │
                                                └── click Privacy Policy ──▶ [target=_blank link]
```

### Network

```
[online, idle]  ── send ──▶  [online, streaming]
[online, *]    ── offline event ──▶  [offline, queued]
                                            │
                                            └── online event ──▶ [online, flushing queue]
[online, awaiting]  ── 10s no response ──▶  [stale, show connectivity error]
```

### Session

```
[no lc_session_id]  ── first POST /api/chat ──▶  [stores ID from response x-session-id]
[has lc_session_id] ── nav within tab ──▶  [reads from sessionStorage; resumes]
[has lc_session_id] ── tab close + reopen ──▶  [no lc_session_id; fresh session]
```

## Coordination With Other Features

### Upstream

- `001-foundation`: shared types (`Message`, `Configuration`,
  Zod schemas), `apiEnv` for `VITE_API_URL`.
- `004-chat-api-agent`: `POST /api/chat` (streaming) and
  `GET /api/config` (widget bootstrap data).

### Downstream

- `007-dashboard` Phase 6: §8.10 Preview chat embeds the same
  `<ChatWidget>` component inside the dashboard. Phase 6 passes
  a different `apiKey` and sets `x-preview: true` (the agent
  feature already supports it).
- `008-hardening` Phase 7: `POST /api/consent` endpoint owns
  the timestamp persistence for FR-006 of that spec; widget's
  banner submits to it.

### Cross-cutting

- `009-deployment-release` Phase 8: publishes the NPM and CDN
  artifacts. The CI bundle-size check (R8) is the gate; deploy
  doesn't proceed if budgets are exceeded.

