# Contract: Lead Action Update Route

**Owner**: Lead Action Tracking (`013-lead-action-tracking`)
**Consumed by**: Dashboard lead detail page (`/dashboard/leads/[id]`) — specifically the `<ActionPicker>` client component.
**Source of Truth**: spec.md FR-001 to FR-010 + research.md R3 + data-model.md "Wire shape".

## Endpoint

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/leads/[id]/action` | POST | Update or clear a lead's follow-up action |

## Authentication & Authorization

- **Auth**: iron-session via the existing `getAuthSession()` helper.
  Request must include the dashboard's HttpOnly session cookie.
- **Authorization**: the `lead.account_id` must equal
  `session.accountId`. Cross-account access returns 404 (privacy
  hygiene per research.md R4 — don't leak lead existence).

## Request

### Headers (required)

| Header | Value | Purpose |
|---|---|---|
| `Content-Type` | `application/json` | Body parsing |
| `Cookie` | iron-session cookie (auto-attached by browser) | Auth |

### URL Parameter

- `id`: the lead's primary key (existing `leads.id` nanoid, see
  `packages/api/src/db/schema.ts`).

### Body

Validated against `leadActionUpdateSchema` from
`packages/shared/src/schemas/lead-action.ts`:

```ts
const leadActionEnum = z.enum(['contacted', 'call_no_answer', 'meeting_fixed']);

const leadActionUpdateSchema = z.object({
  /** The new action slug. `null` clears the action. */
  action: leadActionEnum.nullable(),
});
```

**Examples**:

```json
{ "action": "contacted" }
```

```json
{ "action": "meeting_fixed" }
```

```json
{ "action": null }
```

## Response

### 200 OK (success)

Body:

```ts
{
  success: true;
  follow_up_action: 'contacted' | 'call_no_answer' | 'meeting_fixed' | null;
  follow_up_action_changed_at: string | null;  // ISO 8601 OR null
}
```

The `follow_up_action_changed_at` value is the server's `now()` at
the time the update was applied, returned to the client so the UI
can display the timestamp without a follow-up read.

When `action: null` is submitted, BOTH `follow_up_action` and
`follow_up_action_changed_at` are returned as `null` (the action is
fully cleared).

**Example success**:

```json
{
  "success": true,
  "follow_up_action": "contacted",
  "follow_up_action_changed_at": "2026-05-24T14:14:00.123Z"
}
```

### 400 Bad Request

The body failed Zod validation.

```json
{
  "error": "bad_request",
  "message": "action: Invalid enum value. Expected 'contacted' | 'call_no_answer' | 'meeting_fixed' | null"
}
```

### 401 Unauthorized

Missing or invalid iron-session.

```json
{ "error": "unauthorized", "message": "Not authenticated" }
```

### 404 Not Found

The lead id doesn't exist OR is owned by a different account
(intentional privacy: same response for both cases).

```json
{ "error": "not_found" }
```

## Behavior

The route handler implements:

1. Parse iron-session via `getAuthSession()` — 401 on failure.
2. Read URL param `id`.
3. Parse + Zod-validate request body — 400 on failure.
4. SELECT the lead by `id` AND `account_id = session.accountId` —
   404 if no row.
5. UPDATE the row's `follow_up_action` to the new value AND
   `follow_up_action_changed_at`:
   - When `action` is non-null: `changed_at = new Date().toISOString()`.
   - When `action` is null: `changed_at = null` (cleared along with the action).
6. Return 200 with the updated values.

The UPDATE is a single-row mutation — no transaction needed (the
neon-http driver doesn't support multi-statement transactions
anyway, per the existing pattern from 010).

## CORS

Not applicable. The route is under `/api/dashboard/*` and is consumed
only by the same-origin dashboard React app. No `Access-Control-*`
headers required (fetch from the same origin doesn't trigger CORS).

The existing `corsHeaders` pattern from `/api/chat/cors.ts` is for
the WIDGET origin (different domain); dashboard routes don't need it.

## Tests

`packages/api/src/app/api/dashboard/leads/[id]/action/route.test.ts`:

- 200 happy path: each of the 3 action slugs + the `null` (clear) case.
- 400: missing `action` field; non-enum value (e.g., `'invalid'`);
  body with extra unrelated fields (Zod `.strict()` should reject).
- 401: no session cookie; expired/invalid session.
- 404: lead id doesn't exist; lead owned by a different account
  (cross-account guard).
- Verifies `follow_up_action_changed_at` is set to a valid ISO
  timestamp when the action is non-null.
- Verifies `follow_up_action_changed_at` is set to NULL when the
  action is cleared.

Tests stub `getAuthSession` + Drizzle `select`/`update` via DI
(matches the 011 `route.test.ts` pattern with `PreflightDeps`).

## Constitution Compliance

- **Constitution II**: body Zod-validated; Drizzle typed update.
- **Constitution IV**: Route Handler (no Server Actions); single
  UPDATE per request; no fs writes; no native deps.
- **Constitution V**: account-scoping enforced server-side; 404 (not
  403) on cross-account to avoid leaking lead existence.
- **Constitution VII**: schema additions go through Foundation's
  drizzle-kit migration tooling.
