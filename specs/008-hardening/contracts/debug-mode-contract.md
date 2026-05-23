# Contract: Per-Session Debug Mode

**Owner**: Hardening (`008-hardening`)
**Source of Truth**: §11.7 last bullet.

## Surface

```
POST /api/dashboard/debug-mode
```

Authenticated via iron-session (lawyer or engineer with
dashboard access).

## Body

```ts
{
  sessionId: z.string(),
  enable: z.boolean(),
}
```

## Behavior

1. Authenticated.
2. Verify the session belongs to the account → 404 if not.
3. Call `logger.enableSessionDebug(sessionId)` if `enable=true`,
   `logger.disableSessionDebug(sessionId)` otherwise.
4. Return `{ success: true, enabled: <bool>, sessionId }`.

The Foundation logger's `enableSessionDebug` / `disableSessionDebug`
toggles process-local debug mode for that session — when ON,
log emissions for that session include richer detail (full
system prompt, full tool-call payloads).

## Lifetime

Process-local. The toggle resets on Netlify Function instance
recycle. For long-running debug, the engineer re-toggles.

## Constitution Compliance

- Constitution Principle V: debug mode does NOT bypass
  redaction. The Foundation logger's redaction list still
  applies; only the breadth of payload fields included in the
  emission changes.
- Constitution Principle VI: this is the operator's
  troubleshooting surface for problematic conversations.

## Tests

- POST with `enable=true` → toggle on.
- POST with `enable=false` → toggle off.
- Cross-account session → 404.
- Subsequent log emissions for the marked session include
  richer detail (verified via mock Foundation logger).

