# Data Model: Preflight Phrase

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

## Scope

This feature introduces **NO new database tables, NO new columns, NO
column deprecations**. All "data" lives in transient request/response
shapes plus existing tables.

Per Constitution VII (Phased Incremental Delivery) the storage layer
is unchanged from 010-sop-workflow's tip.

## In-Memory Shapes

### `PreflightRequest` (boundary input)

Defined in `packages/shared/src/schemas/preflight.ts`. Validated at the
route handler boundary via `preflightRequestSchema.parse()`.

```ts
{
  message: string;            // 1-2000 chars; the visitor's latest message
  pendingStepSlug: string | null;  // Optional context: SOP step slug currently pending
}
```

**Validation rules**:
- `message`: required, 1 ≤ length ≤ 2000. Strings outside this range
  return 400.
- `pendingStepSlug`: nullable. When non-null, must match the existing
  `slugSchema` from 010-sop-workflow (`^[a-z][a-z0-9_]*$`).

### `PreflightResponse` (boundary output, success)

Returned by the route handler on 200.

```ts
{
  phrase: string;             // 3-60 chars; no leading/trailing whitespace; no trailing punctuation
}
```

**Validation rules** (enforced by the helper's post-filter, FR-007):
- 3 ≤ length ≤ 60.
- No leading/trailing whitespace.
- No trailing `.` or `…` (the widget adds the ellipsis).
- No email-like pattern (regex: `\S+@\S+\.\S+`).
- No phone-like pattern (regex: `[\d\s\-\(\)]{7,}` with at least 7 digits/separators).

### `PreflightError` (boundary output, failure)

Returned by the route handler on 4xx/5xx.

```ts
{
  error: 'preflight_timeout' | 'preflight_failed' | 'preflight_validation' | 'unauthorized' | 'rate_limited' | 'bad_request';
  message?: string;           // Optional diagnostic; never leaked to UI
}
```

The widget hook ignores all error responses silently — the visitor
sees no UI difference between success and failure (other than seeing
dots vs. phrase). Server logs capture the error type for observability.

### Internal: `PreflightLogPayload` (Constitution V — privacy-redacted)

Emitted by the route handler, NEVER returned to the client.

```ts
{
  event: 'preflight';
  account_id: string;
  session_id?: string;        // From x-session-id header if present
  duration_ms: number;
  outcome: 'ok' | 'timeout' | 'llm_error' | 'validation_error' | 'rate_limited' | 'unauthenticated' | 'bad_request';
  pending_step_slug: string | null;
  message_token_count: number;     // approxTokenCount(message), not the message itself
  phrase_word_count?: number;      // present only when outcome=ok
}
```

**Privacy invariant**: NO `message` content, NO `phrase` content,
NO PII fields. Only counts + outcome strings. Verified by the
redaction unit test in `route.test.ts`.

## Relationships

The feature consumes:
- `accounts` (read): for auth + rate-limit pool.
- `sessions` (read): for `session_id` lookup; (write in Phase C):
  increments `tokens_in/tokens_out` columns with the preflight call's
  token usage.
- `goodbye_phrases`, `case_types`, `sub_types`, `sop_*` (none directly):
  the preflight does not read SOP state. The optional
  `pendingStepSlug` is provided by the widget from its own
  client-side state — the server doesn't need to look it up.

The feature does NOT consume or modify any other tables.

## State Transitions

### `PreflightRequest` → `PreflightResponse` lifecycle (server-side)

```text
[POST /api/chat/preflight received]
       │
       ├── x-api-key invalid ──────────────▶ 401 unauthorized
       │
       ├── body fails Zod ─────────────────▶ 400 bad_request
       │
       ├── rate-limit pool exceeded ───────▶ 429 rate_limited
       │
       └── [valid request, auth OK]
              │
              │  [start AbortController; setTimeout(800ms)]
              │
              ├── generateObject throws ────▶ 503 preflight_failed
              │
              ├── 800ms abort ──────────────▶ 503 preflight_timeout
              │
              ├── post-filter rejects ──────▶ 503 preflight_validation
              │
              └── post-filter accepts ──────▶ 200 { phrase }
```

### `PreflightHookState` lifecycle (widget-side)

```text
[hook initial state: phrase=null, turnId=0, clearedTurnIds={}]
       │
       │  [user clicks Send / chip / contact-form submit]
       ▼
start(message, pendingStepSlug)
       │
       ├── abort previous AbortController (if any)
       ├── increment turnId → turnId=N
       ├── setPhrase(null)
       ├── fire fetch (captures turnId=N)
       ├── client-side timeout setTimeout(1000ms)
       │
       ▼
[fetch in flight; phrase=null; visitor sees dots]
       │
       ├── fetch resolves 200 ─────────────▶ if turnId still N AND N not in clearedTurnIds → setPhrase(json.phrase)
       ├── fetch resolves non-200 ─────────▶ no-op (silent failure)
       ├── fetch rejects (network) ────────▶ no-op
       ├── fetch aborted (client timeout) ─▶ no-op
       ├── fetch aborted (next start()) ───▶ no-op
       │
       ▼
[phrase shown OR still dots; visitor sees the relevant state]
       │
       │  [main agent's first token streams]
       ▼
clear()  (called by useEffect watching messages)
       │
       ├── add turnId=N to clearedTurnIds
       ├── abort current AbortController
       ├── setPhrase(null)
       │
       ▼
[bubble swaps to streaming message; phrase=null]
```

## Validation Rules Summary

| Boundary | Validator | Failure → |
|---|---|---|
| Request body received | `preflightRequestSchema.parse()` | 400 bad_request |
| Auth header | `verifyApiKey()` (existing) | 401 unauthorized |
| Rate-limit | `checkRateLimit()` (existing) | 429 rate_limited |
| LLM structured output | `responseSchema` in `generateObject` | 503 preflight_failed |
| Post-filter (length, PII regex) | `validatePhrase()` in helper | 503 preflight_validation |
| LLM 800ms budget | AbortController in helper | 503 preflight_timeout |
| Hook fetch response status | check `res.ok` | silent no-op |
| Hook 1000ms client timeout | AbortController in hook | silent no-op |

## Default Seed / Migration

**None.** This feature requires no DB seed and no migration. It can
be deployed to any environment where 010-sop-workflow's schema is
already applied.

## Constitution Compliance

- **II Type Safety**: every shape above is Zod-validated at the
  boundary. Internal types derive from the schemas (`z.infer<...>`).
- **V Privacy**: `PreflightLogPayload` is the only non-transient
  shape; explicitly redacted to metadata-only.
- **VII Phased Incremental**: zero schema additions; pure additive
  feature on top of 010's schema.
