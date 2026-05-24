# Data Model: Lead Action Tracking

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

## Scope

This feature adds **2 nullable columns** to the existing `leads` table.
No new tables, no FK relationships beyond what exists. All other
entities are unchanged.

## Schema Changes

### `leads` (existing table) — column additions

```sql
ALTER TABLE leads ADD COLUMN follow_up_action text;
ALTER TABLE leads ADD COLUMN follow_up_action_changed_at text;
```

| Field | Type | Notes |
|---|---|---|
| `follow_up_action` | `text NULL` | One of `'contacted'`, `'call_no_answer'`, `'meeting_fixed'`, or NULL. Default NULL. |
| `follow_up_action_changed_at` | `text NULL` | ISO 8601 timestamp; set to the current time on every action change. Default NULL. |

Both columns are **nullable** with no default. Existing rows get NULL
for both. The migration is constant-time on Neon (no row rewrite).

### Drizzle ORM definition

In `packages/api/src/db/schema.ts`:

```ts
export const leads = pgTable('leads', {
  // ... existing columns ...
  follow_up_action: text('follow_up_action'),
  follow_up_action_changed_at: text('follow_up_action_changed_at'),
});
```

Mirrored in `packages/api/src/db/test-schema.ts` for SQLite tests.

## Conceptual Shape

### `LeadAction` enum

```ts
type LeadAction = 'contacted' | 'call_no_answer' | 'meeting_fixed';
```

| Slug | Display label | Meaning |
|---|---|---|
| `contacted` | "Contacted" | Lawyer successfully reached the lead |
| `call_no_answer` | "Call didn't answer" | Lawyer attempted contact; no answer |
| `meeting_fixed` | "Client meeting fixed" | A consultation meeting is scheduled |

The display labels live in a small map shipped with the dashboard
client component:

```ts
const LEAD_ACTION_LABELS: Record<LeadAction, string> = {
  contacted: 'Contacted',
  call_no_answer: "Call didn't answer",
  meeting_fixed: 'Client meeting fixed',
};
```

The wire/DB stores the slug; the UI renders the label.

### Wire shape: POST /api/dashboard/leads/[id]/action

**Request body**:

```ts
{
  action: 'contacted' | 'call_no_answer' | 'meeting_fixed' | null
}
```

`null` clears the action (sets both columns to NULL — returns the
lead to "no action yet" state).

**Response — 200 OK** (success):

```json
{
  "success": true,
  "follow_up_action": "contacted",
  "follow_up_action_changed_at": "2026-05-24T14:14:00.123Z"
}
```

When the action is cleared (set to `null`):

```json
{
  "success": true,
  "follow_up_action": null,
  "follow_up_action_changed_at": null
}
```

**Response — error paths**:

| Status | Body | When |
|---|---|---|
| 400 | `{ error: 'bad_request', message: '...' }` | Body fails Zod (action not in enum or not exactly null) |
| 401 | `{ error: 'unauthorized' }` | Missing or invalid iron-session |
| 404 | `{ error: 'not_found' }` | Lead id doesn't exist OR is owned by a different account (privacy: don't leak existence) |

## Validation Rules

| Boundary | Validator | Failure → |
|---|---|---|
| Request body received | `leadActionUpdateSchema.parse()` | 400 bad_request |
| Auth (iron-session present + valid) | `getAuthSession()` (existing) | 401 unauthorized |
| Authorization (lead.account_id === session.accountId) | DB query result includes the lead row OR not | 404 not_found |
| Server-side write success | Drizzle `.update().set().where().returning()` | (transparent; rare DB errors propagate as 500) |

## State Transitions (per Lead)

```text
[follow_up_action = NULL]
       │
       │  Lawyer selects "Contacted" + Save
       ▼
[follow_up_action = 'contacted', changed_at = now]
       │
       │  Lawyer changes to "Call didn't answer" + Save
       ▼
[follow_up_action = 'call_no_answer', changed_at = now]
       │
       │  Lawyer changes to "Client meeting fixed" + Save
       ▼
[follow_up_action = 'meeting_fixed', changed_at = now]
       │
       │  Lawyer clears the action + Save (back to NULL)
       ▼
[follow_up_action = NULL, changed_at = NULL]
```

The transitions are **bidirectional** — any state can transition to
any other (including back to NULL). The timestamp updates on every
transition that ends in a non-NULL state, AND clears to NULL when
the action is cleared.

## Coordination With Other Features

### Upstream

- `001-foundation`: schema migrations + Zod baseline.
- `006-lead-classification`: the `leads` table is owned by 006; this
  feature adds two nullable columns to it. No conflict.
- `007-dashboard`: provides the `getAuthSession()` helper +
  `/dashboard/leads/[id]/page.tsx` page that gets extended.
- `010-sop-workflow`: provides the `sop_state_snapshot` column
  pattern reference + `[id]/action/route.ts` nesting pattern.

### Downstream

- None. This is a leaf feature; no other feature reads
  `follow_up_action` today. A future feature (e.g.,
  "Filter leads by action") would consume this field.

## Privacy Compliance

- **Constitution V**: the new columns store an enum slug + a timestamp,
  neither of which is PII. The dashboard route handler doesn't log
  any new sensitive data.
- The cross-account 404 (rather than 403) prevents leaking lead
  existence to attackers.
- Existing `leads.account_id` FK enforces multi-tenant isolation;
  the new columns inherit the table's account-scoping.

## Default Seed / Migration

**Migration** (auto-generated by `pnpm --filter @legal-chatbot/api db:generate`):

```sql
-- Auto-numbered file under packages/api/drizzle/
ALTER TABLE leads ADD COLUMN follow_up_action text;
ALTER TABLE leads ADD COLUMN follow_up_action_changed_at text;
```

**Seed**: no changes required. The dev seed (`packages/api/src/db/seed.ts`)
seeds accounts, configurations, SOP — not individual leads. The dev
DB has captured leads from prior testing; those rows will have NULL
for both new columns post-migration.

## Schema Migration Plan

1. Edit `packages/api/src/db/schema.ts` to add the two new columns.
2. Mirror in `packages/api/src/db/test-schema.ts`.
3. Run `pnpm --filter @legal-chatbot/api db:generate` — generates
   migration file under `packages/api/drizzle/`.
4. Run `pnpm --filter @legal-chatbot/api db:migrate` against local /
   Neon dev DB to apply.
5. Verify via `db:query` (or a one-off tsx script) that the columns
   exist and existing rows have NULL.

Same pattern as 010 T011-T016. Idempotent at apply time.
