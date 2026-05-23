# Contract: `POST /api/dashboard/config`

**Owner**: Dashboard (`007-dashboard`)
**Source of Truth**: §4.4, §4.5, §4.7, §8.4.

## Existing Behavior

The route at
`packages/api/src/app/api/dashboard/config/route.ts` (78 LOC)
already supports `save` and `publish` actions. R8 adds the
`rollback` action.

## Request

```ts
POST /api/dashboard/config
Cookie: <iron-session>

body = {
  action: 'save' | 'publish' | 'rollback',
  config?: Configuration,    // for save
  version_id?: string,        // for rollback
}
```

Authenticated via iron-session cookie (`getAuthSession`).
Unauthenticated → 401.

## Action: save

Body: `{ action: 'save', config: <Configuration object> }`.

Behavior:
1. Validate `config` via `configurationSchema` from
   `packages/shared`.
2. Compute next version: `MAX(version) + 1` for the
   account.
3. INSERT new `configurations` row with `is_published: false`,
   `created_at = now()`.
4. Return `{ success: true, version: <new version> }`.

## Action: publish

Body: `{ action: 'publish' }` (no config; publishes the latest
saved draft).

Behavior:
1. UPDATE `configurations SET is_published = false WHERE
   account_id = ?` (clear all).
2. Find the LATEST `configurations` row for the account by
   `version`.
3. UPDATE its `is_published = true`.
4. Return `{ success: true }`.

## Action: rollback (NEW, R8)

Body: `{ action: 'rollback', version_id: '<id>' }`.

Behavior:
1. Read the historical row at `version_id` (validate it
   belongs to the account).
2. Compute next version: `MAX(version) + 1`.
3. INSERT new `configurations` row with the historical
   `config_json`, new `version`, `is_published: false`.
4. Return `{ success: true, new_version: <new version> }`.

The lawyer reviews the new draft in the form and clicks
Publish to make it live.

## Validation

All bodies validated via Zod:

```ts
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), config: configurationSchema }),
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('rollback'), version_id: z.string() }),
]);
```

## Errors

| Status | Body | When |
|---|---|---|
| 400 | `{ error: 'bad_request', message: '...' }` | Body fails Zod validation |
| 401 | `{ error: 'Not authenticated' }` | No session |
| 404 | `{ error: 'not_found' }` | Rollback `version_id` not found / not owned by account |

## Constitution Compliance

- Constitution II: Zod validation on body + use of shared
  `configurationSchema`.
- Constitution IV: Route Handler, no Server Actions; Drizzle
  queries.
- Constitution V: account-scoped queries (every read filters
  by `account_id`).

