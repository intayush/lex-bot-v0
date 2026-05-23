# Contract: Preflight Route

**Owner**: Preflight Phrase (`011-preflight-phrase`)
**Consumed by**: `usePreflightPhrase` widget hook (this feature) and any
future server-side caller that wants a tailored loading phrase.
**Source of Truth**: spec.md FR-001 to FR-009 + research.md R1-R3.

## Endpoint

| Route | Method | Purpose |
|---|---|---|
| `/api/chat/preflight` | POST | Generate a tailored loading phrase for one visitor message |
| `/api/chat/preflight` | OPTIONS | CORS preflight (browser standard) |

The route is **public** (cross-origin via the widget). Auth is via the
`x-api-key` header, identical to `/api/chat`.

## Request

### Headers (required)

| Header | Value | Purpose |
|---|---|---|
| `Content-Type` | `application/json` | Request body parsing |
| `x-api-key` | account API key (e.g., `dev_test_key`) | Auth |

### Headers (optional)

| Header | Purpose |
|---|---|
| `x-session-id` | If present and valid, included in the structured log payload for cross-correlation. Not required for the preflight to work. |

### Body

Validated against `preflightRequestSchema` from
`packages/shared/src/schemas/preflight.ts`:

```ts
const preflightRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  pendingStepSlug: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable(),
});
```

**Example**:

```json
{
  "message": "I had a DUI in Pittsburgh yesterday",
  "pendingStepSlug": "case_type"
}
```

## Response

### 200 OK (success)

Body:

```ts
const preflightResponseSchema = z.object({
  phrase: z.string().min(3).max(60),
});
```

**Example**:

```json
{ "phrase": "Looking into your DUI matter" }
```

The phrase is suitable for direct rendering in the widget. The widget
appends an ellipsis (`…`) when displaying.

### 400 Bad Request

The body failed Zod validation.

```json
{ "error": "bad_request", "message": "message: String must contain at least 1 character(s)" }
```

### 401 Unauthorized

Missing or invalid `x-api-key`.

```json
{ "error": "unauthorized", "message": "Missing API key" }
```

```json
{ "error": "unauthorized", "message": "Invalid API key" }
```

### 429 Rate Limited

The account's daily conversation cap (1000/day per §11.1) was reached.
Same response shape as `/api/chat`'s rate-limit response.

```json
{ "error": "rate_limited", "message": "Too many requests. Please try again shortly." }
```

Response also includes `Retry-After` header (in seconds).

### 503 Service Unavailable

The preflight failed in one of three classified ways. The widget treats
all 503s identically (silent no-op).

```json
{ "error": "preflight_timeout" }
{ "error": "preflight_failed" }
{ "error": "preflight_validation" }
```

| `error` value | When |
|---|---|
| `preflight_timeout` | Server-side 800ms hard timeout fired before the LLM responded. |
| `preflight_failed` | LLM call rejected (network error, provider 5xx, content-filter rejection). |
| `preflight_validation` | LLM returned a phrase that failed the post-filter (>60 chars, PII pattern, etc.). |

## CORS

Identical to `/api/chat`:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, x-api-key, x-session-id
Access-Control-Expose-Headers: (none for preflight)
Access-Control-Max-Age: 86400
```

The route does NOT emit `x-sop-state` (that's a chat-route concern only).

## Behavior

The route handler implements the following sequence:

1. CORS OPTIONS preflight: return 204 with CORS headers.
2. Verify `x-api-key` via `verifyApiKey()` → 401 on failure.
3. Check rate limit via `checkRateLimit()` → 429 on failure.
4. Parse + Zod-validate body → 400 on failure.
5. Create `AbortController`; schedule `setTimeout(abort, 800)`.
6. Call `generatePreflightPhrase({ message, pendingStepSlug, abortSignal })`
   from `lib/preflight-phrase.ts`.
7. If helper resolves: emit log payload `{outcome: 'ok', ...}`; return
   200 with `{ phrase }`.
8. If helper throws `AbortError`: emit `{outcome: 'timeout', ...}`;
   return 503 `preflight_timeout`.
9. If helper throws `PreflightLLMError`: emit `{outcome: 'llm_error', ...}`;
   return 503 `preflight_failed`.
10. If helper throws `PreflightValidationError`: emit
    `{outcome: 'validation_error', ...}`; return 503 `preflight_validation`.
11. Always: clear the `setTimeout`; close the `AbortController`.

## Latency

| Phase | Typical | Hard ceiling |
|---|---|---|
| Auth + rate-limit + Zod parse | 5-30ms | <100ms |
| `generateObject` LLM call | 250-400ms | 800ms (server abort) |
| Total server-side | 250-450ms | 900ms (very rare) |

Client-side hard ceiling: 1000ms (FR-013).

## Constitution Compliance

- Constitution II: every body Zod-validated.
- Constitution IV: Route Handler (no Server Actions); CORS wildcard
  set; no native deps.
- Constitution V: log payload contains no message/phrase content.
- Constitution VI: preflight is NOT a tool call (does not affect
  `maxSteps: 5`); counts against the per-account daily 1000-conv cap.
