# Contract: `POST /api/consent`

**Owner**: Hardening (`008-hardening`)
**Source of Truth**: §11.5.

## Endpoint

```
POST /api/consent
Headers:
  Content-Type: application/json
  x-api-key: lc_live_xxxxxxxx
```

Authenticated via the same API-key mechanism as `/api/chat`.

## Body

```ts
{
  sessionId: z.string(),
  method: z.enum(['banner']),  // 'banner' for MVP; future: 'implied', 'tos', etc.
}
```

## Behavior

1. Validate body via Zod.
2. Verify API key (same flow as `/api/chat`).
3. Verify the session belongs to the API key's account → 404
   if not (no cross-account leak).
4. UPDATE `sessions.consent_accepted_at = now()` and
   `sessions.consent_method = method`.
5. Return `{ success: true }`.

## Idempotency

Repeat acceptance updates the timestamp; no error. The widget's
`<ConsentBanner>` (Phase 4 R5) shows the banner only on first
open per session, so repeat calls are rare.

## CORS

Same as `/api/chat` per §9.7:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, x-api-key`

## Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ error: 'bad_request', message: '...' }` | Body fails Zod |
| 401 | `{ error: 'unauthorized' }` | Invalid or missing API key |
| 404 | `{ error: 'not_found' }` | Session doesn't belong to account |

## Logging

- `consent_recorded` event via Foundation logger:
  `{ session_id, account_id, method }`.
- No PII in payload.

## Tests

- Valid request → 200; column updated.
- Cross-account session → 404.
- Missing API key → 401.
- Repeat acceptance → 200; timestamp updates.

