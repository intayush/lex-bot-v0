# Contract: SOP Configuration Routes

**Owner**: SOP Workflow (`010-sop-workflow`)
**Consumed by**: Dashboard SOP Editor (`/dashboard/sop`)
**Source of Truth**: spec.md FR-045 to FR-054, R-dashboard editor.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/dashboard/sop` | GET | Read currently published SOP + version history |
| `/api/dashboard/sop` | POST | Save / publish / rollback SOP config |
| `/api/dashboard/sop/case-types` | GET | Read account's case-type list with sub-types |
| `/api/dashboard/sop/case-types` | POST | Save / update case-types |
| `/api/dashboard/sop/goodbye-phrases` | GET | Read account's goodbye phrase list |
| `/api/dashboard/sop/goodbye-phrases` | POST | Replace account's goodbye phrase list |

All authenticated via iron-session per `007-dashboard` auth contract.

## GET /api/dashboard/sop

Returns the published SOP + version history (recent N).

```ts
{
  current_published: {
    id: string;
    version: number;
    qualified_lead_threshold: number;
    is_published: boolean;
    derived_from_legacy: boolean;
    created_at: string;
    steps: Array<{
      id: string;
      position: number;
      slug: string;
      question_text: string;
      chip_source: 'case_types' | 'sub_types' | 'inline' | null;
      inline_chips_json: string | null;
      accepts_free_text: boolean;
      is_required: boolean;
      counts_toward_threshold: boolean;
      is_default: boolean;
    }>;
  } | null,
  history: Array<{ id, version, is_published, created_at }>;
}
```

## POST /api/dashboard/sop

Body: discriminated union per Phase 6 `dashboard-config-route-contract.md` pattern.

```ts
const sopActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    qualified_lead_threshold: z.number().int().positive(),
    steps: z.array(z.object({
      slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
      position: z.number().int().positive(),
      question_text: z.string().min(1).max(500),
      chip_source: z.enum(['case_types', 'sub_types', 'inline']).nullable(),
      inline_chips_json: z.string().nullable(),
      accepts_free_text: z.boolean(),
      is_required: z.boolean(),
      counts_toward_threshold: z.boolean(),
    })),
  }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('rollback'), version_id: z.string() }),
]);
```

### Action `save`

Behavior:

1. Authenticate; verify `session.accountId`.
2. Validate body via `sopActionSchema`.
3. Validate the step list:
   - All slugs unique within the configuration.
   - Positions form `[1..N]` (no gaps).
   - `qualified_lead_threshold ≤ count of steps with counts_toward_threshold=true`.
   - For each step with `chip_source='case_types'` or `'sub_types'`, the account has at least one matching live row.
   - For each step with `chip_source='inline'`, `inline_chips_json` parses as an array of `{ label, slug }` objects.
4. Insert new `sop_configurations` row with `version = MAX(version)+1`, `is_published=false`.
5. Insert all `sop_steps` rows linked to the new configuration.
6. Return `{ success: true, version: <new version> }`.

### Action `publish`

Behavior:

1. Authenticate.
2. UPDATE all `sop_configurations` for the account: `is_published=false`.
3. UPDATE the latest version: `is_published=true`.
4. Return `{ success: true }`.

### Action `rollback`

Behavior:

1. Authenticate.
2. Read historical row at `version_id`; verify it belongs to the account.
3. Read its `sop_steps`.
4. Insert new `sop_configurations` row with `version = MAX(version)+1, is_published=false`.
5. Copy historical steps into new configuration (with new `id`s).
6. Return `{ success: true, new_version: <new version> }`.

## POST /api/dashboard/sop/case-types

Body:

```ts
const caseTypesActionSchema = z.object({
  action: z.literal('save'),
  case_types: z.array(z.object({
    slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1).max(100),
    position: z.number().int().positive(),
    is_in_scope: z.boolean(),
    sub_types: z.array(z.object({
      slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1).max(100),
      position: z.number().int().positive(),
    })),
  })),
});
```

Behavior:

1. Authenticate.
2. Validate slugs are unique within the case-types list and within each case-type's sub-types.
3. Diff the incoming list against existing rows for the account:
   - Insert new entries.
   - Update existing entries by slug.
   - Delete entries not in the incoming list (cascade-delete sub_types).
4. Wrap in a transaction.
5. Return `{ success: true }`.

CRITICAL: deletions cascade to `sub_types`. SOP steps that reference the deleted case-type/sub-type via `chip_source` continue to work but the live chip list shrinks. Validation at chat-time (server) skips chips referencing missing rows.

## POST /api/dashboard/sop/goodbye-phrases

Body:

```ts
{ phrases: z.array(z.string().min(1).max(50)).max(50) }
```

Behavior:

1. Authenticate.
2. Replace the account's goodbye phrase list (DELETE existing + INSERT new) in a transaction.
3. Return `{ success: true }`.

## Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ error: 'bad_request', message: '...' }` | Body fails Zod validation; constraint violations |
| 401 | `{ error: 'Not authenticated' }` | No iron-session |
| 404 | `{ error: 'not_found' }` | Rollback `version_id` not found / not owned |

## Constitution Compliance

- Constitution II: every body Zod-validated.
- Constitution IV: Route Handlers (no Server Actions); Drizzle transactions for multi-row operations.
- Constitution V: account-scoped queries on every read/write.
- Constitution VII: SOP versioning mirrors the existing `007-dashboard` configuration model.

