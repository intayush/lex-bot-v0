# Contract: Rate Limiting

**Owner**: Chat API + Agent (`004-chat-api-agent`)
**Source of Truth**: §11.1, §12.8.

## Two Independent Limits

Per §11.1 the chat endpoint enforces TWO limits:

| Limit | Value | Scope | Reset |
|---|---|---|---|
| Per-session messages | 50 | One session | Counter exists for session lifetime; no reset (cap, not window) |
| Per-API-key conversations | 1000 | One API key | Rolling 24-hour window |

Both must be checked on every request (after auth, before LLM
call). If either limit is exceeded, return 429 immediately.

## Module Surface

```ts
// packages/api/src/lib/rate-limit.ts

export function checkSessionLimit(sessionId: string):
  { allowed: boolean; remaining: number };

export function recordSessionMessage(sessionId: string): void;

export function checkKeyDailyLimit(apiKeyId: string):
  { allowed: boolean; remaining: number; resetIn: number };

export function recordKeyConversation(apiKeyId: string): void;
```

## Per-Session Counter

```ts
type SessionCounter = Map<sessionId, { count: number }>;
```

- Increments on every successful POST that uses an existing
  session (i.e., after auth, after session resolution).
- New sessions start at 0.
- The counter persists for the session's lifetime in memory; on
  function restart, it resets (acceptable per §11.1 — in-memory).
- Cap = 50 messages. The 51st request returns 429.

## Per-Key Daily Counter

```ts
type KeyDailyCounter = Map<apiKeyId, { timestamps: number[] }>;
```

- Increments on every NEW conversation start (POST without a
  matching session ID).
- Each entry's `timestamps` is a sorted list of conversation-start
  ms-epochs.
- On read, prune entries older than `Date.now() - 86_400_000`.
- Allowed if remaining count < 1000.
- Cap = 1000 conversations per rolling 24h.

## Order of Checks

```
POST /api/chat received
    │
    ├─ verifyApiKey → 401 if invalid
    │
    ├─ resolve session (load or create)
    │
    ├─ if session was loaded (existing):
    │     checkSessionLimit(sid) → 429 if ≥ 50
    │
    ├─ else (new conversation):
    │     checkKeyDailyLimit(keyId) → 429 if ≥ 1000/24h
    │
    ├─ recordSessionMessage(sid)        // both new and resumed
    │
    ├─ if new conversation:
    │     recordKeyConversation(keyId)
    │
    └─ proceed to LLM call
```

## 429 Response Shape

```jsonc
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 30

{
  "error": "rate_limited",
  "message": "Too many requests. Try again in 30 seconds.",
  "retry_after": 30
}
```

The `retry_after` value is computed:

- For per-session cap (50 reached): `retry_after = 0` (no reset
  — the cap is a hard limit per conversation; a new conversation
  starts the count over).
- For per-key daily cap: `retry_after = ceil((oldestTimestamp + 86400000 - Date.now()) / 1000)` — seconds until the oldest counted timestamp ages out.

## Determinism & Testability

- Both counters are pure-functional given a controlled
  `Date.now()`. Use `vi.useFakeTimers()` in tests to verify the
  rolling-window behavior.
- Module-level singletons are exposed for tests via a `__reset()`
  helper that clears both maps between test cases.

## Constitution Compliance

- Constitution Architectural Limits: 50 messages/conversation,
  1000 conversations/day/key — both hard.
- §11.1 binding: "no external dependency for MVP" — in-memory
  Maps are the binding implementation.
- Constitution Principle VI: rate limits are a cost-and-abuse
  bound on the agent.

