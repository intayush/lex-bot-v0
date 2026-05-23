# Contract: `POST /api/chat`

**Owner**: Chat API + Agent (`004-chat-api-agent`)
**Consumed by**: Chat Widget (`005-chat-widget`) via Vercel AI SDK `useChat`
**Source of Truth**: §2.4, §2.10, §12.8, §11.1.

## Method & Path

`POST /api/chat`

`OPTIONS /api/chat` returns 204 with CORS preflight headers.

## Request

### Required Headers

| Header | Value | Notes |
|---|---|---|
| `Content-Type` | `application/json` | §12.8 |
| `x-api-key` | `lc_live_xxxxx` (or `dev_test_key` in dev seed) | §2.4 step 3, FR-004 |

### Optional Headers

| Header | Value | Notes |
|---|---|---|
| `x-session-id` | `sess_<nanoid>` | Resume an existing session. Omit to create new. §12.8 session lifecycle |
| `x-preview` | `true` | Use the latest unpublished configuration (preview chat in dashboard, §8.10). Otherwise published config is used. |

### Body

```jsonc
{
  "messages": [
    { "role": "user", "content": "Do you handle car accident cases?" }
  ]
}
```

Validated via Zod (R12): `messages` non-empty array of
`{ role: 'user' | 'assistant' | 'system', content: string }`.

## Response — Success (Streaming)

```
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Transfer-Encoding: chunked
x-session-id: sess_abc123

<Vercel AI SDK data-stream protocol body>
```

Body uses `result.toDataStreamResponse()` which produces the
Vercel AI SDK Data Stream format consumed by `useChat`. Includes
text chunks, tool-call events, and `finishReason` + `usage`
metadata.

The `x-session-id` response header is **always** set (whether new
or resumed) per FR-006.

## Response — Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ "error": "bad_request", "message": "<reason>" }` | Body fails Zod validation (R12) |
| 401 | `{ "error": "unauthorized", "message": "Invalid API key" }` | Missing, malformed, unmatched, or revoked API key (R7) |
| 429 | `{ "error": "rate_limited", "message": "<reason>", "retry_after": <seconds> }` | Per-session ≥ 50 messages OR per-key ≥ 1000/24h (R1, FR-046) |
| 500 | `{ "error": "internal", "message": "An error occurred processing your request" }` | Uncaught error (FR-052) |

`Retry-After` header is set on 429 responses with the integer
seconds value matching `retry_after`.

## CORS

Per §9.7: `Access-Control-Allow-Origin: *` (all responses).
Allowed methods: `POST, OPTIONS`. Allowed headers: `Content-Type`,
`x-api-key`, `x-session-id`, `x-preview`. Exposed headers:
`x-session-id`.

## Session Lifecycle

| Phase | Behavior |
|---|---|
| Create | First request without `x-session-id` (or with an unknown / cross-account / expired ID). Server inserts a new `sessions` row, returns its ID via `x-session-id`. |
| Resume | Subsequent request with `x-session-id`. Server loads via `getSessionForAccount(sessionId, accountId)` — REQUIRES account match (R6). Loads `messages_json`, applies sliding-window memory (R5), feeds to LLM. |
| Expire | Sessions with `updated_at` older than `SESSION_EXPIRY_MS` (default 30 min, configurable, R11) are treated as not-found. The session row is NOT deleted by this feature; ignored on read. |
| Persist | After successful turn, `appendMessages(sessionId, [user, assistant])` writes both messages and updates `updated_at`. |

## Agent Behavior

The route invokes `streamText` with:

- `model`: `google('gemini-2.5-flash')` (FR-027).
- `system`: composed by `composeSystemPrompt(config)` per
  `system-prompt-contract.md` (R13).
- `messages`: output of `memoryWindow(history)` (R5), so older
  messages are summarized.
- `tools.searchContext`: registered per §7.3; calls
  `searchContext(contextStoreUrl, query, sectionTypes)` from
  `003-context-search`.
- `tools.captureLead`: registered per §7.4 (owned by Phase 5
  `006-lead-classification`).
- `maxSteps`: 5 (FR-029).
- `onFinish({ text, usage, finishReason })`: writes both messages
  to the session, records `token_usage` (R3), runs partial-lead
  extraction (Phase 5 ownership), updates inability streak (R10).
- `onError(event)`: emits a logger `error` event with full context
  (session_id, account_id, failing tool if applicable).

## Determinism

The streaming protocol shape is deterministic; the LLM's response
text is non-deterministic by design (`gemini-2.5-flash` with
non-zero temperature). Tests cover the protocol shape and the
non-LLM branches; conversation-quality regression tests
(Phase 8) cover LLM behavior.

