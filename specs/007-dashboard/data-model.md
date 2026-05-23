# Data Model: Dashboard

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The Dashboard is a read-mostly consumer of the §2.6 schema with
limited writes (auth, configurations, lead status mutations,
notification reads, API key management, deletion → archival).
This feature introduces THREE new schema artifacts (R12) and
defines the read/write contract for each persistent entity.

## Persistent Entities

### Account (`accounts`)

| Operation | When | Owner |
|---|---|---|
| INSERT | User signs up via `/signup` (R2) | Dashboard |
| READ | Login validation; every page render (`getAuthSession`) | Dashboard |
| UPDATE | Password reset (R2); profile edit (post-MVP) | Dashboard |

Schema unchanged from §2.6.

### API Key (`api_keys`)

| Operation | When | Owner |
|---|---|---|
| INSERT | Generate new key (R4) | Dashboard |
| READ | Widget Installation page render | Dashboard |
| UPDATE | Revoke (`revoked_at`) or rotate (`rotation_grace_until`) | Dashboard |
| DELETE | Never (Constitution V — keep audit trail) | — |

**Schema addition (R12)**:

```ts
export const apiKeys = pgTable('api_keys', {
  // … existing columns
  rotation_grace_until: text('rotation_grace_until'), // NULLABLE; set during rotation
});
```

The auth layer (`packages/api/src/lib/auth.ts`) already accepts
revoked-or-not logic; rotation grace is a parallel time-based
acceptance: a row is valid if NOT revoked OR if
`rotation_grace_until > now()`.

### Configuration (`configurations`)

| Operation | When | Owner |
|---|---|---|
| INSERT | Save (new draft); Publish (sets `is_published=true` on the latest); Rollback (R8 inserts a new row from a historical config) | Dashboard |
| READ | Form load; version history; preview chat | Dashboard |
| UPDATE | `is_published` toggling on Publish action | Dashboard |

Schema unchanged from §2.6. Rollback (R8) creates new rows; it
never mutates existing rows (immutable history).

### Session (`sessions`)

| Operation | When | Owner |
|---|---|---|
| READ | Lead detail transcript view | Dashboard |
| UPDATE | None (Phase 3 owns writes) | — |

Schema unchanged.

### Lead (`leads`)

| Operation | When | Owner |
|---|---|---|
| READ | Leads page; lead detail; bulk actions; counts on Overview | Dashboard |
| UPDATE | Mark as contacted; Add internal note; Dismiss (R7) | Dashboard |
| DELETE | Lawyer-initiated deletion (writes archive, then cascade-deletes lead + notifications) (R7) | Dashboard |

**Schema addition (R12)**:

```ts
export const leads = pgTable('leads', {
  // … existing columns
  internal_notes: text('internal_notes'), // NULLABLE; appended with timestamp
});
```

`internal_notes` is a free-text column. Each "Add internal note"
action appends to the existing value with an ISO timestamp:

```
[2026-05-23T14:30:00Z] First contact attempt failed; left voicemail.
[2026-05-23T16:45:00Z] Follow-up scheduled for Friday 2pm.
```

### Archived Data (`archived_data`)

| Operation | When | Owner |
|---|---|---|
| INSERT | On lawyer-initiated lead deletion (R7) | Dashboard |
| READ | Never by the dashboard (audit-only) | — |

Schema unchanged. Snapshot is the entire row's pre-deletion state
serialized to `data_json`. `original_table = 'leads'`,
`original_id = leadId`.

### Notification (`notifications`)

| Operation | When | Owner |
|---|---|---|
| READ | Bell badge count; drawer; full notifications page (R3) | Dashboard |
| UPDATE | Mark read (single); mark all read (bulk) (R3) | Dashboard |
| DELETE | Cascade delete with parent lead (R7) | Dashboard |

Schema unchanged. Phase 5 (`006-lead-classification`) owns
INSERT.

### Password Resets (`password_resets`) — NEW (R12)

| Field | Type | Notes |
|---|---|---|
| `id` | text | PK; nanoid |
| `account_id` | text | FK → `accounts.id` |
| `token_hash` | text | bcryptjs hash of the reset token |
| `expires_at` | text | ISO 8601 UTC; 1 hour from creation |
| `used_at` | text \| null | Set when used; one-time-use |

Lifecycle:
- Created on `POST /api/auth/reset-password/request`.
- Read + verified on `POST /api/auth/reset-password/confirm`.
- Marked `used_at` on success; never reusable.
- Expired rows can be purged by a future cleanup job (out of scope).

Index: `UNIQUE INDEX password_resets_token_hash_unique ON
password_resets(token_hash)`.

## Read Surfaces

### Leads list (paginated)

```ts
SELECT id, name, contact_email, contact_phone,
       case_type, classification, status, created_at
FROM leads
WHERE account_id = ?
  AND status != 'dismissed' OR ? -- include-dismissed flag
ORDER BY created_at DESC
LIMIT 25 OFFSET ?;
```

Plus filter clauses for classification / case_type / date range
per FR-031.

### Lead detail (full)

```ts
SELECT * FROM leads WHERE id = ? AND account_id = ?;
SELECT messages_json FROM sessions WHERE id = ? AND account_id = ?;
SELECT * FROM notifications WHERE lead_id = ? AND account_id = ?;
```

### Notifications (drawer, full page)

```ts
SELECT * FROM notifications
WHERE account_id = ?
ORDER BY created_at DESC
LIMIT 50;

-- Unread count
SELECT COUNT(*) FROM notifications
WHERE account_id = ? AND read = false;
```

### Configuration version history

```ts
SELECT id, version, is_published, created_at
FROM configurations
WHERE account_id = ?
ORDER BY version DESC;
```

### Crawler status (read from external HTTPS)

Not a DB read. Fetches `_manifest.json` from
`api_keys.context_store_url` for the lawyer's account, parses
fields per Phase 2's manifest contract.

## Write Surfaces

### POST /api/dashboard/config (existing, EXTEND R8)

Body shape:

```ts
{ action: 'save'   | 'publish' | 'rollback';
  config?: Configuration;        // for save
  version_id?: string;           // for rollback
}
```

R8 adds the `rollback` action.

### PATCH /api/dashboard/leads/{id}

Body (any subset):

```ts
{ status?: 'new' | 'contacted' | 'dismissed';
  append_internal_note?: string;
}
```

The handler appends notes with a timestamp prefix; status
mutations go straight through.

### DELETE /api/dashboard/leads/{id}

In a transaction:

1. SELECT the lead row + related notifications + session row.
2. INSERT into `archived_data` with `original_table = 'leads'`,
   `data_json = JSON.stringify({ lead, notifications, session })`,
   `deleted_by_user_at = now()`, `archived_at = now()`.
3. DELETE FROM `notifications` WHERE `lead_id = ?`.
4. DELETE FROM `leads` WHERE `id = ?`.

Session is NOT deleted (other features may reference it).

### POST /api/dashboard/leads/bulk

Body:

```ts
{ ids: string[];
  action: 'contacted' | 'dismissed' | 'export';
}
```

For `contacted` / `dismissed`: bulk UPDATE.
For `export`: returns a JSON or CSV download.

### POST /api/dashboard/api-keys (R4)

```ts
{ label?: string }
```

Returns:

```ts
{ id: string;
  plaintext_key: string;  // shown ONCE
  masked: string;
  context_store_url: string;
}
```

### DELETE /api/dashboard/api-keys/{id} (R4)

Sets `revoked_at`. Returns `{ success: true }`.

### POST /api/dashboard/api-keys/{id}/rotate (R4)

Generates a new key in same `account_id`; sets the OLD key's
`rotation_grace_until = now() + 24h`. Returns the new
plaintext + masked.

### PATCH /api/dashboard/notifications (R3)

```ts
{ all: true }
```

Marks all notifications for the account read.

### PATCH /api/dashboard/notifications/{id} (R3)

```ts
{ read: true }
```

Marks one notification read.

## Validation Pipeline

Every mutation route runs `bodySchema.safeParse(body)` before
touching the DB. On failure → 400 `bad_request`. On account
mismatch (`session.accountId` doesn't match the resource's
account_id) → 404 `not_found` (don't leak existence).

## State Transitions

### Configuration

```text
[draft, version=N, is_published=false]
       │
       ├── save (without publish) ──▶  [draft, version=N+1]
       │
       ├── publish ──▶  [published, version=N]; all other rows → is_published=false
       │
       └── rollback to version M ──▶  [draft, version=N+1, content from version M]
```

### Lead

```text
[new]  ──── Mark as contacted ──▶  [contacted]
[new]  ──── Dismiss ──▶  [dismissed] (filtered out by default views)
[*]    ──── Delete ──▶  [archived in archived_data; row removed]
```

### Notification

```text
[unread]  ──── Mark read ──▶  [read]
[*]       ──── parent lead deleted (R7) ──▶  [removed]
```

### API Key

```text
[active]  ──── revoke ──▶  [revoked_at set; auth fails]
[active]  ──── rotate ──▶
   ├── new row inserted (active)
   └── old row: rotation_grace_until = now()+24h
       │
       └── after 24h → revoked_at auto-set (or auth simply rejects)
```

### Password Reset

```text
[no token]  ──── request reset ──▶  [token issued, expires_at = now()+1h]
[token]     ──── confirm with valid token ──▶  [used_at set; password_hash updated]
[token]     ──── expires_at < now() ──▶  [expired; rejected on confirm]
```

## Coordination With Other Features

### Upstream

- `001-foundation`: schema base, `getAuthSession`, env, logger,
  Drizzle DB factory.
- `002-crawler-cli`: produces the manifest the Crawler Status
  page reads.
- `003-context-search`: `searchContext` invoked by Test context
  retrieval action (R5).
- `004-chat-api-agent`: backs the Preview chat (R6) via
  `x-preview` header.
- `005-chat-widget`: embedded inside the Preview & Test page
  (R6) and within the inline preview in the Configuration page.
- `006-lead-classification`: writes `leads` and `notifications`
  rows that this feature reads.

### Downstream

- `008-hardening` Phase 7: extends the privacy policy template
  surface (R9) with GDPR Article 17 language; uses the
  notifications table for spend alerts (FR-002 of Phase 7).
- `009-deployment-release` Phase 8: deploys the Dashboard +
  API as a single Netlify site per §9.7.

