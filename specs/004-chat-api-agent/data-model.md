# Data Model: Chat API + Agent

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The Chat API + Agent reads and writes the §2.6 schema entities
already defined by `001-foundation`. This feature introduces ONE
new persistent table (`token_usage`) and several in-memory
operational entities (rate-limit counters, repeated-inability
counter, summarized memory window).

## Persistent Entities (read/write)

### Account (read)

Read by `verifyApiKey` to associate a request with a firm.
Source: §2.6 `accounts`. No writes from this feature.

### API Key (read)

Read by `verifyApiKey` via bcryptjs hash comparison; supplies
`account_id` and `context_store_url` for the request.
Source: §2.6 `api_keys`, §2.4. No writes from this feature.

### Configuration (read)

Read at conversation start to compose the system prompt. Both
the published row (normal mode) and the latest saved row (preview
mode, signaled by `x-preview: true`) are supported.
Source: §2.6 `configurations`, §2.9, §4.7, §8.10.

### Session (read/write)

Created on first chat request without `x-session-id`. Resumed on
subsequent requests with `x-session-id`. **R6** scopes lookups
by `account_id` to prevent cross-account access.

| Operation | When | What |
|---|---|---|
| Insert | First POST without session ID | New session row with `messages_json: '[]'`, `is_preview` from header |
| Read | POST with `x-session-id` | Load history; verify `account_id` match (R6); check expiry (R11) |
| Update | After every successful turn (`onFinish`) | Append `[user, assistant]` messages; update `updated_at` |

Source: §2.6 `sessions`, §12.8.

### Token Usage (write — NEW table introduced by this feature)

```sql
CREATE TABLE token_usage (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  session_id text NOT NULL REFERENCES sessions(id),
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  finish_reason text,
  created_at text NOT NULL
);
```

Written once per successful LLM turn (R3) from the route's
`onFinish` callback. Consumed by `008-hardening` for the
cost-monitoring dashboard. The Foundation migration tooling
(`drizzle-kit generate`) produces the SQL migration; this feature
adds the table to `packages/api/src/db/schema.ts` and the parallel
`test-schema.ts`.

## In-Memory Entities (process-local)

### Rate-Limit Counters (R1)

Two `Map`s in a single module
(`packages/api/src/lib/rate-limit.ts`):

```ts
type SessionCounter = Map<sessionId, { count: number }>;
type KeyDailyCounter = Map<apiKeyId, { timestamps: number[] }>;
```

| Counter | Limit | Reset behavior |
|---|---|---|
| Session message counter | 50 messages per conversation (§11.1) | Counter exists for the session's lifetime; never reset (50 is the cap, not a window) |
| API-key daily counter | 1000 conversations per rolling 24h (§11.1) | Sliding window; entries older than 24h are pruned on read |

Lifecycle: created at module load; populated on first request;
in-memory only; resets on process restart (acceptable per §11.1
"in-memory counter, no external dependency for MVP").

### Repeated-Inability Counter (R10)

```ts
type InabilityStreaks = Map<sessionId, number>;
```

Increments when a turn produces empty context AND the §7.11
fallback wording. Resets to 0 when a turn produces non-fallback
output. Threshold = 2 → next turn injects the §7.11
"Repeated inability" message.

### Memory Window (R5)

Pure-function output; not persistent. Given a full message history
of length N:

- N ≤ 10: pass through unchanged.
- N > 10: take the last 10; produce a summary message; prepend.

Output is `Message[]` ready for `streamText`'s `messages` argument.

### Manifest Cache (R8 — owned by `003-context-search`)

Removed from `route.ts`. The route imports `searchContext` from
`003-context-search`'s module which has its own cache. No
duplicate cache here.

## Validation Rules

| Boundary | Validator | On failure |
|---|---|---|
| HTTP request body | Zod (R12; `bodySchema` in `packages/shared/src/schemas/messages.ts`) | 400 `bad_request` |
| API key | bcryptjs.compare against stored hash | 401 `unauthorized` |
| `x-session-id` header (when present) | Validate format + load + verify `account_id` match (R6) + check expiry (R11) | Treat as missing → create new session |
| Tool parameters | Zod (`z.object` schemas defined inline in tool wiring per §7.3, §7.4) | Vercel AI SDK enforces; tool execute receives parsed values |
| User message text (latest) | `sanitize()` (R2): strip control chars, length cap, NFC normalize | Text replaced inline before LLM call; no error to user |
| Manifest read | Zod (owned by `003-context-search` `manifest-fetcher`) | Empty result, log error |

## State Transitions

### Session State

```text
[no session]
    │
    │  first POST (no x-session-id)
    ▼
[active, fresh]  ◄──── POST with x-session-id (within expiry, account match) ────┐
    │                                                                              │
    │  > 30 min inactivity (FR-017)                                                │
    ▼                                                                              │
[expired]  ──── treated as not-found ──── creates new [active, fresh] ────────────┘
    │
    │  account_id mismatch (R6)
    ▼
[treated as not-found, new session created]
```

### Repeated-Inability Streak

```text
streak = 0
    │
    │  turn produces fallback wording with empty context
    ▼
streak = 1
    │
    │  turn produces fallback again
    ▼
streak = 2  ──── next turn injects §7.11 "Repeated inability" message
    │
    │  any turn produces non-fallback output
    ▼
streak = 0
```

## Coordination With Other Features

### Upstream

- `001-foundation`: provides `apiEnv` (env loader), `logger`
  (Foundation logger), Drizzle DB factory, schema definitions.
- `002-crawler-cli`: produces the manifest + markdown content
  the agent retrieves indirectly via `003-context-search`.
- `003-context-search`: provides the `searchContext` function
  registered as the agent's first tool (§7.3). Manages its own
  cache and budget; this feature consumes its results.

### Downstream

- `005-chat-widget` (Phase 4): consumes the `POST /api/chat`
  streaming response.
- `006-lead-classification` (Phase 5): owns the `captureLead`
  tool implementation. The current code base already wires
  `captureLead` into the agent's tools map; that wiring is
  acceptable but the test ownership and full lead persistence
  belong to Phase 5.
- `007-dashboard` (Phase 6): consumes session transcripts via
  `getSessionMessages` for the lead-detail Chat Transcript view
  (§8.6). Reads `token_usage` for cost monitoring (Phase 7).
- `008-hardening` (Phase 7): consumes `token_usage` for spend
  display, alerts, and budget cap. Adds optional injection
  classifier on top of R9's logging.

## Schema Migration

Adding the `token_usage` table is a forward-compatible migration:

1. Run `pnpm --filter @legal-chatbot/api db:generate` to produce
   the SQL.
2. Inspect the new migration file in `packages/api/drizzle/`.
3. `pnpm db:migrate` applies it idempotently (Foundation
   guarantee).

The Foundation `data-model.md` already enumerates the seven §2.6
tables; this feature's plan documents the eighth.

