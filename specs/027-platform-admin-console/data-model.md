# Phase 1 Data Model: Platform Admin Console

Conventions (from existing `schema.ts`): all IDs are `text` primary keys
populated by `nanoid()`; all timestamps are ISO-string `text` columns
(`new Date().toISOString()`); FKs are `text('...').references(() => …)`;
versioned tables use `integer('version')` + `boolean('is_published')` +
composite unique index. Booleans in the SQLite `test-schema.ts` mirror use
`integer(..., { mode: 'boolean' })`.

Migration: **`0010_*.sql`** (next after `0009`). Every new table MUST also be
added to `src/db/test-schema.ts` and each affected test's `CREATE TABLE` SQL.

---

## New table: `super_admins`

Platform operator identity, separate from `accounts` (§VIII).

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `nanoid()` |
| `email` | text NOT NULL | unique index `super_admins_email_unique` |
| `password_hash` | text NOT NULL | `bcryptjs`, rounds 10 |
| `created_at` | text NOT NULL | ISO string |

Relationships: referenced by `admin_audit_log.super_admin_id`.
Validation: email format + non-empty password (Zod, `packages/shared/admin.ts`).

---

## New table: `account_llm_config`

Per-tenant LLM provider/model/key. One active config per account.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `nanoid()` |
| `account_id` | text NOT NULL FK→accounts.id | unique index `account_llm_config_account_unique` |
| `provider` | text NOT NULL | enum: `google` \| `anthropic` \| `openai` |
| `model` | text NOT NULL | validated against provider→model allow-list |
| `api_key_encrypted` | text NULL | AES-256-GCM `iv:tag:ciphertext`; NULL → platform key |
| `is_active` | boolean NOT NULL default true | |
| `created_at` | text NOT NULL | |
| `updated_at` | text NOT NULL | |

Absence of a row (or `is_active=false`) → resolver returns platform default
`google('gemini-2.5-flash')`.
Validation: `(provider, model)` pair must be in the Zod allow-list
(`packages/shared/llm-config.ts`). `api_key_encrypted` never serialized to any
API response.

---

## New table: `usage_events`

Per-conversation token usage for metrics + cost attribution (§VI). Currently no
such capture exists.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `nanoid()` |
| `account_id` | text NOT NULL FK→accounts.id | index `usage_events_account_idx` |
| `session_id` | text NULL FK→sessions.id | |
| `provider` | text NOT NULL | resolved provider |
| `model` | text NOT NULL | resolved model |
| `prompt_tokens` | integer NOT NULL default 0 | |
| `completion_tokens` | integer NOT NULL default 0 | |
| `total_tokens` | integer NOT NULL default 0 | |
| `created_at` | text NOT NULL | index for date-window queries |

Written from chat `onFinish({ usage })`, deferred post-stream (spec-021
`waitUntil`). Estimated spend derived at read-time from a price map — not stored.

---

## New table: `admin_audit_log`

Attribution for every mutating admin action (§VIII, SC-007).

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | `nanoid()` |
| `super_admin_id` | text NOT NULL FK→super_admins.id | |
| `action` | text NOT NULL | e.g. `tenant.create`, `tenant.publish`, `tenant.suspend`, `tenant.reactivate`, `tenant.rotate_key`, `tenant.delete`, `llm_config.update` |
| `target_account_id` | text NULL FK→accounts.id | the affected tenant |
| `metadata_json` | text NULL | non-PII context (JSON) |
| `created_at` | text NOT NULL | index `admin_audit_log_created_idx` |

Append-only. No PII in `metadata_json`.

---

## Extended table: `accounts`

Add lifecycle/onboarding columns (all nullable or defaulted so existing rows and
migrations are unaffected).

| New column | Type | Notes |
|---|---|---|
| `status` | text NOT NULL default `'active'` | `active` \| `suspended` |
| `onboarding_status` | text NOT NULL default `'live'` | `draft` \| `published` \| `live`; existing accounts default `live` |
| `deleted_at` | text NULL | soft-delete marker; NULL = active fleet |

Existing columns unchanged (`id`, `email`, `password_hash`, `firm_name`,
`created_at`). Fleet queries filter `deleted_at IS NULL`.

---

## Reused tables (no schema change)

- `apiKeys` — suspend revokes (`revoked_at`), rotate inserts new + revokes old;
  `verifyApiKey` already skips `revoked_at` rows.
- `configurations`, `sop_configurations`, `sopSteps`, `caseTypes`, `subTypes`,
  `branches`, `branchVersions`, `goodbyePhrases` — onboarding writes drafts here
  and publishes via the existing versioning model; SOP-view reads from them.
- `sessions`, `leads` — metrics funnel + routing outcomes source data.
- `archived_data` — soft-delete snapshot target.
- `attorneys`, `attorneyCaseTypeAssignments` — routing-outcome metrics.

---

## State transitions

**Tenant onboarding_status**: `draft` → (publish) → `published`/`live`.
Registration creates `draft`; wizard finish keeps `draft`; explicit publish →
`live`. (`published` and `live` are equivalent for the widget; `live` is the
surfaced label once serving.)

**Tenant status**: `active` ⇄ `suspended` (suspend/reactivate). Orthogonal to
onboarding_status.

**Tenant deletion**: any state → soft-deleted (`deleted_at` set + archival
snapshot). Terminal for the active fleet.

**LLM config**: none (default) → configured (active) → updated / deactivated.
