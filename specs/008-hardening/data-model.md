# Data Model: Hardening

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

Hardening introduces **four NEW tables** + **two column
additions** + **two markdown templates** + a small set of
in-memory operational state. The schema additions (R1) are
coordinated via Foundation's `drizzle-kit` migration tooling.

## New Tables

### `spend_alerts`

Per-account spend alert configurations. Multiple alerts per
account allowed (e.g., "$50/day" + "$300/week").

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `account_id` | text NOT NULL FK → accounts.id | |
| `threshold_usd` | numeric NOT NULL | Trigger threshold |
| `period` | text NOT NULL | enum: `daily` \| `weekly` \| `monthly` |
| `enabled` | boolean DEFAULT true | |
| `last_triggered_at` | text NULL | ISO 8601 UTC; deduplication |
| `created_at` | text NOT NULL | |
| `updated_at` | text NOT NULL | |

Lifecycle:
- INSERT on lawyer-configures-alert.
- READ on every chat-turn `onFinish` (R2).
- UPDATE `last_triggered_at` when threshold crossed.
- DELETE when lawyer removes alert.

### `daily_budget_caps`

Per-account daily budget cap. UNIQUE on `account_id`
(at most one cap per account).

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `account_id` | text NOT NULL UNIQUE FK → accounts.id | |
| `daily_limit_usd` | numeric NOT NULL | |
| `current_day` | text NOT NULL | ISO date `YYYY-MM-DD` |
| `current_day_spend_usd` | numeric NOT NULL DEFAULT 0 | Lazy-rolls on first read of new day |
| `enabled` | boolean DEFAULT true | |
| `created_at` | text NOT NULL | |
| `updated_at` | text NOT NULL | |

Lifecycle:
- INSERT on lawyer-configures-budget.
- READ on every chat-turn entry (R2 budget cap check).
- UPDATE `current_day_spend_usd` on every chat-turn `onFinish`.
- Lazy day-roll: when `current_day` < today, reset
  `current_day_spend_usd = 0` and update `current_day` BEFORE
  the cap check.

### `tos_acceptances`

Audit trail of ToS acceptance per account per version.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `account_id` | text NOT NULL FK → accounts.id | |
| `tos_version` | text NOT NULL | e.g., `'1'`, `'2'` |
| `accepted_at` | text NOT NULL | ISO 8601 UTC |
| `ip_address` | text NULL | If extractable |
| `user_agent` | text NULL | If extractable |

Index: `tos_acceptances_account_id_idx ON tos_acceptances(account_id)`.

Lifecycle:
- INSERT on each acceptance.
- READ by ToS-acceptance middleware on every dashboard
  request to check if the latest version has been accepted.
- Never UPDATE; never DELETE (audit trail).

### `faq_cache` (MAY-level)

Per-account semantic cache of FAQ-style query/response
pairs. Used only when `FAQ_CACHE_ENABLED=true`.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `account_id` | text NOT NULL FK → accounts.id | |
| `query_embedding` | text NOT NULL | JSON-serialized Float32Array |
| `query_text` | text NOT NULL | Original user query (for debugging) |
| `response_text` | text NOT NULL | The cached LLM response |
| `hit_count` | integer NOT NULL DEFAULT 0 | |
| `last_hit_at` | text NULL | |
| `expires_at` | text NOT NULL | ISO 8601 UTC; ~7 days from creation |
| `invalidated_at` | text NULL | Set when context store changes |
| `created_at` | text NOT NULL | |

Index: `faq_cache_account_id_idx ON faq_cache(account_id)`.

Lifecycle:
- INSERT on chat-turn completion (when not from cache).
- READ on chat-turn entry (cosine-similarity scan).
- UPDATE `hit_count` and `last_hit_at` on cache hit.
- UPDATE `invalidated_at` lazily when `created_at < manifest.generated_at`.

## Column Additions

### `sessions.consent_accepted_at` (NEW, R3)

| Field | Type |
|---|---|
| `consent_accepted_at` | text NULL |
| `consent_method` | text NULL |

Set by `POST /api/consent`. Read by Phase 6 dashboard for
audit purposes (Phase 7 doesn't surface it directly).

## Markdown Templates

Two templates in `packages/shared/src/templates/`:

### `privacy-policy.md`

Markdown template containing:
- §1.10 retention disclosure (verbatim).
- §11.5 data-retention paragraph (verbatim).
- GDPR Article 17 exceptions language (PLACEHOLDER —
  awaits counsel review per FR-009).
- Placeholders: `{{firm_name}}`, `{{contact_email}}`,
  `{{retention_purposes}}`.

### `terms-of-service.md`

Markdown template containing:
- §11.4 limitations acknowledgment (verbatim).
- Data retention disclosure (cross-references privacy).
- Liability terms PLACEHOLDER — awaits counsel review per
  FR-013.
- Placeholders: `{{firm_name}}`, `{{tos_version}}`.

Front matter on each:

```yaml
---
version: '1'
last_updated: '2026-05-23'
---
```

The dashboard's Privacy & Compliance section (Phase 6 R9)
reads these via `import` and seeds the lawyer's editable
copy.

## In-Memory Operational State

### Per-Session Debug Mode (R8)

A `Set<string>` of session IDs for which the Foundation
logger emits richer detail. Lifetime = function instance.
Toggled via `POST /api/dashboard/debug-mode`.

## Validation Rules

| Boundary | Validator | On failure |
|---|---|---|
| `POST /api/consent` body | Zod `{ sessionId, method }` | 400 bad_request |
| `POST /api/auth/accept-tos` body | Zod `{ tos_version }` | 400 |
| `POST /api/dashboard/spend-alerts` body | Zod `{ threshold_usd, period, enabled }` | 400 |
| `PUT /api/dashboard/budget-cap` body | Zod `{ daily_limit_usd, enabled }` | 400 |
| `POST /api/dashboard/debug-mode` body | Zod `{ sessionId, enable }` | 400 |
| FAQ cache embedding | Length matches Gemini's embedding dimension | warn + skip cache |

## State Transitions

### Daily Budget Cap

```text
[no cap]  ──── lawyer configures ──▶  [cap set, current_day=today, spend=0]

[cap, spend < limit]
    │
    ├── chat turn → spend += turn_cost ──▶ [cap, spend=spend+turn_cost]
    │
    └── new day arrives → first read this day ──▶ [cap, current_day=today, spend=0]

[cap, spend >= limit]
    │
    └── chat turn ──▶ [chatbot disabled message returned; LLM not called]
```

### ToS Acceptance

```text
[no row for current version]  ──── login ──▶  [redirect to ToS modal]
                                                    │
                                                    └── accept ──▶ [row inserted; redirect to dashboard]

[row for current version]  ──── login ──▶  [proceed to dashboard]

[ToS version bump (e.g., 1 → 2)]  ──── next login ──▶  [no row for v2 → ToS modal]
```

### FAQ Cache

```text
[empty]  ──── chat turn (LLM responds) ──▶ [row inserted, expires in 7d]

[row exists, fresh]
    │
    ├── similar query within similarity threshold ──▶ [HIT; hit_count++]
    │
    └── manifest.generated_at > row.created_at ──▶ [invalidated_at set]

[invalidated]  ──── any query ──▶  [MISS; new LLM call; new row inserted]
[expired]      ──── any query ──▶  [MISS; new LLM call; new row inserted]
```

## Coordination With Other Features

### Upstream

- `001-foundation`: Drizzle DB factory; structured logger;
  env loader; schema base.
- `004-chat-api-agent`: writes `token_usage` rows that R2
  aggregates; Phase 3's chat route is extended with budget-cap
  middleware (Phase 7 owns the helper; Phase 3 owns the
  integration point).
- `005-chat-widget`: consent banner UI submits to R3's
  `POST /api/consent`.
- `007-dashboard`: Privacy & Compliance form section (Phase
  6 R9) imports R4's templates as starter content; ToS
  modal (R5) is reachable from the dashboard middleware.

### Downstream

- `009-deployment-release`: deploys all Hardening surfaces
  with the rest of the API site; user-testing release-gate
  (R9) is a §11.8 doc artifact in the repo.

## Migration Plan

R1 schemas are added to `packages/api/src/db/schema.ts` and
the parallel `test-schema.ts`. Migrations generated via
`pnpm --filter @legal-chatbot/api db:generate`. Foundation's
`pnpm db:migrate` applies idempotently.

The two `sessions` column additions are forward-compatible
(NULL-default).

