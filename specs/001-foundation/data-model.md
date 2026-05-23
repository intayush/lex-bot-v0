# Data Model: Foundation

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The Foundation feature defines the database schema for the entire MVP
in a single migration. The schema mirrors §2.6 of the product spec
(Drizzle PostgreSQL definitions). Foundation does NOT populate any of
these entities at runtime (other than the dev seed); writes are
performed by downstream features.

## Entity-Relationship Overview

```
┌──────────┐ 1   N ┌─────────┐ 1   N ┌──────────┐
│ accounts │──────►│ sessions│──────►│  leads   │
└──────────┘       └─────────┘       └──────────┘
     │ 1                                  │ 0..1
     │ N                                  │
     ▼                                    ▼
┌──────────────┐                    ┌───────────────┐
│  api_keys    │                    │ notifications │
└──────────────┘                    └───────────────┘
     │ 1
     │ N
     ▼
┌────────────────┐
│ configurations │
└────────────────┘

┌────────────────┐
│ archived_data  │  (loose reference by original_id; no FK)
└────────────────┘
```

## Entities

All entity definitions are extracted verbatim from §2.6. Foundation's
job is to ensure the schema in `packages/api/src/db/schema.ts` matches
this table exactly and that the in-memory test schema in
`packages/api/src/db/test-schema.ts` is a faithful SQLite mirror.

### accounts

A law firm's account. One row per firm.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `email` | text | NOT NULL, UNIQUE (`accounts_email_unique`) | Login identifier |
| `password_hash` | text | NOT NULL | bcryptjs hash |
| `firm_name` | text | nullable | Display name |
| `created_at` | text | NOT NULL | ISO 8601 |

**Lifecycle**: created at signup; updated on profile changes; never
deleted in MVP (data-deletion writes to `archived_data` and clears
the lawyer-visible row contents).

### api_keys

Per-account widget authentication tokens.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `account_id` | text | NOT NULL, FK → `accounts.id` | |
| `key_hash` | text | NOT NULL | bcryptjs hash of the API key |
| `label` | text | nullable | e.g., "Production", "Staging" |
| `context_store_url` | text | NOT NULL | Base URL for context fetches |
| `created_at` | text | NOT NULL | |
| `revoked_at` | text | nullable | non-null = revoked |

**Lifecycle**: created via dashboard; revoked sets `revoked_at`;
rotation creates a new row and the old remains valid for 24 hours
(per §8.8 — Phase 6 enforces the window).

### configurations

Versioned guardrails configurations.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `account_id` | text | NOT NULL, FK → `accounts.id` | |
| `version` | integer | NOT NULL | Auto-increment per account |
| `config_json` | text | NOT NULL | Full §4.4 form-output JSON |
| `is_published` | boolean | NOT NULL, DEFAULT false | Only one published per account at any time |
| `created_at` | text | NOT NULL | |

**Lifecycle**: created via dashboard Save (`is_published=false`)
and Publish (`is_published=true`). Previous versions retained.

### sessions

Chat sessions.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid; sent to widget |
| `account_id` | text | NOT NULL, FK → `accounts.id` | |
| `messages_json` | text | NOT NULL, DEFAULT `'[]'` | Full conversation history |
| `is_preview` | boolean | NOT NULL, DEFAULT false | Preview-mode sessions don't appear in Leads |
| `created_at` | text | NOT NULL | |
| `updated_at` | text | NOT NULL | |

**Lifecycle**: created on first chat request without `x-session-id`;
updated on every turn; expires after 30 minutes of inactivity per
§12.8 (configurable). Foundation does not enforce expiry — the
chat API does.

### leads

Captured intake leads.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `account_id` | text | NOT NULL, FK → `accounts.id` | |
| `session_id` | text | NOT NULL, FK → `sessions.id` | |
| `name` | text | nullable | |
| `contact_email` | text | nullable | |
| `contact_phone` | text | nullable | |
| `case_type` | text | nullable | |
| `incident_date` | text | nullable | |
| `brief_description` | text | nullable | Required by `captureLead` tool but persisted as nullable for partial-lead heuristic path |
| `classification` | text | NOT NULL | enum: `urgent` \| `normal` \| `unqualified` |
| `classification_rationale` | text | nullable | Required for LLM-driven captures |
| `urgency_factors_json` | text | nullable | JSON-serialized array |
| `status` | text | NOT NULL, DEFAULT `'new'` | enum: `new` \| `contacted` \| `dismissed` |
| `created_at` | text | NOT NULL | |

**Lifecycle**: created by `captureLead` tool path or by heuristic
fallback (Phase 5). Status mutated by dashboard actions
(Mark as contacted / Dismiss). Lawyer-initiated deletion writes to
`archived_data` and clears the row.

### archived_data

Retained snapshots after lawyer-initiated deletion.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `account_id` | text | NOT NULL | No FK — account may be deleted later |
| `original_table` | text | NOT NULL | enum: `leads` \| `sessions` |
| `original_id` | text | NOT NULL | Loose reference |
| `data_json` | text | NOT NULL | Full record snapshot |
| `deleted_by_user_at` | text | NOT NULL | When the lawyer clicked delete |
| `archived_at` | text | NOT NULL | When the snapshot row was written |

**Lifecycle**: write-once. Never read by lawyer-facing surfaces.

### notifications

Dashboard alerts.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | text | PK | nanoid |
| `account_id` | text | NOT NULL, FK → `accounts.id` | |
| `type` | text | NOT NULL | enum: `urgent_lead` \| `escalation` \| `system` |
| `title` | text | NOT NULL | |
| `body` | text | NOT NULL | |
| `lead_id` | text | nullable, FK → `leads.id` | Required for `urgent_lead`; nullable allows future types |
| `read` | boolean | NOT NULL, DEFAULT false | |
| `delivery_channel` | text | NOT NULL, DEFAULT `'dashboard'` | Future: `email`, `sms`, `webhook` |
| `delivered_at` | text | nullable | |
| `created_at` | text | NOT NULL | |

**Lifecycle**: created by `captureLead` (urgent) or future delivery
flows. Read state mutated by dashboard mark-read actions.

## Foundation-Scoped Operational Entities

Beyond the §2.6 schema, Foundation introduces three non-database
entities used at runtime / build time. None of these are persisted
to Postgres.

### Parsed-Env Object (per package)

The output of the env loader. Three variants:

- **`apiEnv`**: `{ DATABASE_URL: string, GOOGLE_GENERATIVE_AI_API_KEY: string, SESSION_SECRET: string (>=32 chars) }`. Constructed once from `process.env` at module load. Throws on missing/invalid.
- **`widgetEnv`**: `{ VITE_API_URL: string }`. Constructed from `import.meta.env` for the Vite build.
- **`devEnv`**: `{ CONTEXT_STORE_URL?: string }`. Optional override for the dev seed.

Validated via Zod. Importing the module runs validation; downstream modules consume the parsed object as a typed value.

### Log Event Object

The unit emitted by the structured-JSON logger. Shape:

```jsonc
{
  "ts": "2026-05-23T12:34:56.789Z",     // ISO 8601 UTC
  "level": "info" | "warn" | "error" | "debug",
  "event": "<event-name>",              // e.g., "message_received", "tool_called"
  "session_id": "<sess_…>",             // optional, for correlation
  "account_id": "<acct_…>",             // optional
  "payload": { ... }                    // event-specific, redacted
}
```

Redacted payload field names (case-insensitive substring): `apikey`, `api_key`, `key_hash`, `password`, `password_hash`, `session_secret`, `authorization`, `cookie`, `set-cookie`. Values for matched keys → `"<redacted>"`.

The Log Event is not persisted by Foundation. On Netlify, Functions stdout is aggregated into the platform's log stream.

### Per-Session Debug Mode Flag

An in-memory `Set<string>` of session IDs. When a log call's `session_id` is in the set, additional fields (full system prompt, full tool-call payloads) are included in the emitted event. Default: empty. No public HTTP surface in Foundation; downstream features may add toggles.

## Schema Migration Plan

1. Verify `packages/api/src/db/schema.ts` matches every column above.
2. Verify `packages/api/drizzle/0000_quick_cerebro.sql` applies cleanly to a fresh Neon branch — re-run `pnpm --filter @legal-chatbot/api db:generate` if drift is detected; commit any new migration file.
3. Verify `packages/api/src/db/test-schema.ts` mirrors every table for the SQLite test driver.
4. Make `pnpm db:migrate` idempotent — Drizzle's `migrate()` is already idempotent against a tracked migrations folder; confirm this.
5. Make `pnpm db:seed` idempotent — change inserts to upsert-on-conflict for the dev account (by email), the dev API key (by `(account_id, label)`), and the dev configuration (by `(account_id, version)`).
6. Add `packages/api/src/db/seed.test.ts` that runs `seed()` twice in a Vitest test and asserts row counts unchanged.

## Validation Rules

These are validated by Zod schemas in `packages/shared/src/schemas/` (per Constitution Principle II), enforced at every cross-boundary:

- `accounts.email`: format-valid email, unique per the unique index.
- `api_keys.context_store_url`: HTTPS URL (HTTP allowed only when matching `http://localhost:` for dev).
- `configurations.config_json`: parses against the §4.4 configuration shape (the existing `packages/shared/src/schemas/configuration.ts`).
- `sessions.messages_json`: parses to a JSON array of message objects (the existing `packages/shared/src/schemas/messages.ts`).
- `leads.classification`: enum `urgent`/`normal`/`unqualified`.
- `leads.status`: enum `new`/`contacted`/`dismissed`.
- `notifications.type`: enum `urgent_lead`/`escalation`/`system`.
- `notifications.delivery_channel`: enum `dashboard` for MVP; reserved `email`/`sms`/`webhook` post-MVP.
