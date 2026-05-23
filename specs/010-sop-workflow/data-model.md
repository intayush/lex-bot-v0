# Data Model: SOP Workflow

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

The SOP Workflow introduces **5 NEW tables**, **2 column additions** (`sessions.sop_state_json`, `leads.sop_state_snapshot`), and **1 deprecation** (`configurations.config_json.qualifying_questions`). Schema additions go through Foundation's `drizzle-kit` migration tooling per Constitution VII.

## New Tables

### `sop_configurations`

Per-account SOP configurations. Versioned per the existing `007-dashboard` configuration model.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `account_id` | text NOT NULL FK → accounts.id | |
| `version` | integer NOT NULL | Auto-increment per account |
| `qualified_lead_threshold` | integer NOT NULL DEFAULT 5 | `N` in the progress bar's `x/N` |
| `is_published` | boolean NOT NULL DEFAULT false | Only one published per account at any time |
| `derived_from_legacy` | boolean NOT NULL DEFAULT false | Set true by R11 migration |
| `created_at` | text NOT NULL | ISO 8601 |

UNIQUE INDEX on `(account_id, version)`.

### `sop_steps`

Per-SOP-configuration ordered list of steps.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `sop_configuration_id` | text NOT NULL FK → sop_configurations.id | |
| `position` | integer NOT NULL | Display order |
| `slug` | text NOT NULL | Stable machine identifier (e.g., `case_type`, `where`, custom slug) |
| `question_text` | text NOT NULL | Template shown in chat |
| `chip_source` | text NULL | enum: `case_types` \| `sub_types` \| `inline` \| `null` |
| `inline_chips_json` | text NULL | When `chip_source='inline'`, a JSON array of `{ label, slug }` |
| `accepts_free_text` | boolean NOT NULL DEFAULT true | If false, only chip selection is valid |
| `is_required` | boolean NOT NULL DEFAULT true | |
| `counts_toward_threshold` | boolean NOT NULL DEFAULT true | |
| `is_default` | boolean NOT NULL DEFAULT false | True for the seeded 5 default steps |
| `skip_condition_json` | text NULL | JSON describing skip logic (post-MVP for advanced rules) |

UNIQUE INDEX on `(sop_configuration_id, slug)`.
UNIQUE INDEX on `(sop_configuration_id, position)` (enforced via app-level reorder; PostgreSQL doesn't allow two-stage updates without deferrable constraints, so reorder is done in a transaction).

### `case_types`

Per-account configurable case-type list. Source for the case-type chip step.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `account_id` | text NOT NULL FK → accounts.id | |
| `slug` | text NOT NULL | Machine identifier (e.g., `dui`, `personal_injury`) |
| `label` | text NOT NULL | Display text (e.g., "DUI", "Personal Injury") |
| `position` | integer NOT NULL | Display order |
| `is_in_scope` | boolean NOT NULL DEFAULT true | False → out-of-scope deflection on selection |
| `created_at` | text NOT NULL | |

UNIQUE INDEX on `(account_id, slug)`.

### `sub_types`

Per-`case_type` configurable sub-type list. Source for the sub-type chip step.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `case_type_id` | text NOT NULL FK → case_types.id | |
| `slug` | text NOT NULL | |
| `label` | text NOT NULL | |
| `position` | integer NOT NULL | |
| `created_at` | text NOT NULL | |

UNIQUE INDEX on `(case_type_id, slug)`.

### `goodbye_phrases`

Per-account list of goodbye-detection phrases.

| Field | Type | Notes |
|---|---|---|
| `id` | text PK | nanoid |
| `account_id` | text NOT NULL FK → accounts.id | |
| `phrase` | text NOT NULL | e.g., `"thanks"`, `"goodbye"` |
| `created_at` | text NOT NULL | |

UNIQUE INDEX on `(account_id, phrase)`.

## Column Additions

### `sessions.sop_state_json` (NEW)

```sql
ALTER TABLE sessions ADD COLUMN sop_state_json text;
```

Nullable. Holds the JSON-serialized `SOPState` for the session (per the conceptual shape below). When null, the session predates SOP support OR the SOP runtime hasn't yet initialized state for it.

### `leads.sop_state_snapshot` (NEW)

```sql
ALTER TABLE leads ADD COLUMN sop_state_snapshot text;
```

Nullable. Persisted at SOP completion (or out-of-scope termination) with the full captured-values map for the conversation. Read by Phase 6 dashboard's lead-detail view.

## Deprecations

### `configurations.config_json.qualifying_questions`

Marked deprecated. R11 migration converts each entry into a custom `sop_steps` row. Field is NOT removed from `config_json` (preserves a rollback path); `composeSystemPrompt` no longer reads it after this feature ships.

## Conceptual Shape: `SOPState`

JSON shape stored in `sessions.sop_state_json` and `leads.sop_state_snapshot`. Validated via Zod (`packages/shared/src/schemas/sop.ts`).

```ts
type SOPState = {
  sop_configuration_id: string;       // The SOP version in use for this session
  sop_version: number;                // Numeric version (matches sop_configurations.version)
  conversation_anchor_iso: string;    // Conversation start timestamp; basis for date inference
  steps: Array<{
    step_id: string;                  // FK reference to sop_steps.id
    slug: string;                     // Mirror for ergonomic lookup
    status: 'pending' | 'complete' | 'skipped';
    captured_value: string | null;    // Free-text or chip slug
    captured_at: string | null;       // ISO 8601 timestamp
    inferred: boolean;                // True if captured via skip-detection
  }>;
  qualified_lead_threshold: number;   // Mirror of sop_configurations.qualified_lead_threshold
  current_progress: number;           // Count of complete steps with counts_toward_threshold=true
  is_finalized: boolean;              // Set true on Step 6 finalize OR out-of-scope termination
  out_of_scope_termination: boolean;  // True if terminated because case_type was out-of-scope
};
```

The widget receives a compact form via the `x-sop-state` response header:

```ts
type SOPStateHeaderPayload = {
  current: number;
  total: number;
  pending_step_id: string | null;
  pending_step_slug: string | null;
  is_finalized: boolean;
};
```

The compact form omits captured values to keep header size bounded (< 1 KB).

## Relationships

```text
accounts (1) ────────────── (*) sop_configurations
   │                             │
   │                             │
   └─ (1) ── (*) case_types ────┴── (1) ── (*) sop_steps (chip_source='case_types')
   │                                          │
   │                                          ├── (chip_source='sub_types' references parent case_type's sub_types)
   │                                          │
   │                                          └── (chip_source='inline' uses inline_chips_json)
   │
   ├─ (1) ── (*) sub_types  [via case_types]
   │
   └─ (1) ── (*) goodbye_phrases

sessions ── (1:1) ── sop_state_json (current SOP state per session)

leads ── (0:1) ── sop_state_snapshot (final SOP state at completion)
```

## Validation Rules

| Boundary | Validator | On failure |
|---|---|---|
| SOP CRUD body | Zod (per `contracts/sop-config-routes-contract.md`) | 400 bad_request |
| `sop_steps.position` reorder | Transaction with deferred uniqueness | 500 internal (rollback) |
| Chip selection from widget | Server matches against `case_types.slug` or step's `inline_chips_json` | If no match, treated as free text (only if `accepts_free_text=true`) |
| `qualified_lead_threshold` | ≥ 1 AND ≤ count of `sop_steps` with `counts_toward_threshold=true` | 400 bad_request |
| Skip-detector confidence | ≥ 0.6 (R3 threshold) | Step left pending; agent asks clarifying question |
| Goodbye phrase | Word-boundary regex match against `goodbye_phrases.phrase` for the account | No match → no goodbye action |
| Date inference | Confidence ≥ 0.6 (R3 threshold) | Step left pending; agent asks for clearer date |
| SOP-state JSON read from DB | Zod parse against `SOPState` schema | Re-initialize SOP state from current published config; log error |

## State Transitions (per SOP Step)

```text
[pending]
   │
   ├── chip selected, server matches slug ──────────┐
   │                                                │
   ├── free-text answer captured (R4 high conf) ────┤
   │                                                ▼
   ├── skip-detector inferred (R4 high conf) ──── [complete] ──── (no further transitions)
   │
   ├── visitor refuses ("rather not say") ──────── [skipped] ──── (no further transitions)
   │
   └── ambiguous answer / low confidence ────── stays [pending]
                                                  │
                                                  └── agent asks clarifying question
```

## State Transitions (per SOP Configuration)

```text
[draft, version=N, is_published=false]
       │
       ├── Save (no publish) ──────▶ [draft, version=N+1]
       │
       ├── Publish ─────────────────▶ [published, version=N];
       │                                all other rows → is_published=false
       │
       └── Rollback to version M ───▶ [draft, version=N+1, content from version M]
```

(Mirrors Phase 6 `007-dashboard` configuration versioning.)

## State Transitions (Conversation-Scoped SOP State)

```text
[no SOP state on session]
       │
       │  first chat message arrives
       ▼
[SOP state initialized from currently published SOP]
       │
       ├── visitor message captures step(s) ──▶ [SOP state advanced]
       │
       ├── visitor message off-topic ─────────▶ [SOP state unchanged; off-SOP detour logged]
       │
       ├── visitor selects out-of-scope chip ─▶ [SOP state finalized; out_of_scope_termination=true]
       │
       └── all required threshold steps complete ──▶ [Step 6 runs] ──▶ [SOP state finalized]

[finalized SOP state] ──▶ snapshot copied to leads.sop_state_snapshot on captureLead
```

## Default Seed (TS Constants)

The R1 default-SOP seed lives at `packages/api/src/db/seed-defaults/sop.ts`. Compile-time-typed constants:

```ts
export const DEFAULT_SOP_STEPS: SOPStepInput[] = [
  { slug: 'case_type', position: 1, question_text: 'What kind of legal matter can we help you with?', chip_source: 'case_types', is_required: true, counts_toward_threshold: true, is_default: true },
  { slug: 'sub_type',  position: 2, question_text: 'What kind of {case_type} matter is this?',         chip_source: 'sub_types',  is_required: true, counts_toward_threshold: true, is_default: true },
  { slug: 'where',     position: 3, question_text: 'Where did this happen?',                            chip_source: null,         is_required: true, counts_toward_threshold: true, is_default: true },
  { slug: 'what',      position: 4, question_text: 'Can you briefly tell us what happened?',            chip_source: null,         is_required: true, counts_toward_threshold: true, is_default: true },
  { slug: 'when',      position: 5, question_text: 'When did this happen?',                             chip_source: 'inline',     is_required: true, counts_toward_threshold: true, is_default: true,
    inline_chips_json: JSON.stringify([
      { label: 'Today', slug: 'today' },
      { label: 'Yesterday', slug: 'yesterday' },
      { label: 'This week', slug: 'this_week' },
      { label: 'Last week', slug: 'last_week' },
      { label: 'This month', slug: 'this_month' },
      { label: 'Earlier this year', slug: 'earlier_this_year' },
      { label: 'Longer ago', slug: 'longer_ago' },
    ]),
  },
];

export const DEFAULT_CASE_TYPES: CaseTypeSeed[] = [
  { slug: 'dui',                label: 'DUI',                position: 1, is_in_scope: true,
    sub_types: [
      { slug: 'first_offense',     label: 'First Offense',     position: 1 },
      { slug: 'repeat_offense',    label: 'Repeat Offense',    position: 2 },
      { slug: 'dui_with_injury',   label: 'DUI with Injury',   position: 3 },
      { slug: 'dui_with_property', label: 'DUI with Property', position: 4 },
    ],
  },
  { slug: 'criminal_defense',   label: 'Criminal Defense',   position: 2, is_in_scope: true,
    sub_types: [
      { slug: 'theft',         label: 'Theft',         position: 1 },
      { slug: 'assault',       label: 'Assault',       position: 2 },
      { slug: 'fraud',         label: 'Fraud',         position: 3 },
      { slug: 'gun_charge',    label: 'Gun Charge',    position: 4 },
    ],
  },
  { slug: 'personal_injury',    label: 'Personal Injury',    position: 3, is_in_scope: true,
    sub_types: [
      { slug: 'car_accident',  label: 'Car Accident',  position: 1 },
      { slug: 'slip_fall',     label: 'Slip and Fall', position: 2 },
      { slug: 'medical_malp',  label: 'Medical Malpractice', position: 3 },
      { slug: 'dog_bite',      label: 'Dog Bite',      position: 4 },
    ],
  },
  { slug: 'family_law',         label: 'Family Law',         position: 4, is_in_scope: true,
    sub_types: [
      { slug: 'divorce',       label: 'Divorce',       position: 1 },
      { slug: 'custody',       label: 'Custody',       position: 2 },
      { slug: 'adoption',      label: 'Adoption',      position: 3 },
    ],
  },
  { slug: 'drug_crime',         label: 'Drug Crime',         position: 5, is_in_scope: true,
    sub_types: [
      { slug: 'possession',    label: 'Possession',    position: 1 },
      { slug: 'distribution',  label: 'Distribution',  position: 2 },
      { slug: 'trafficking',   label: 'Trafficking',   position: 3 },
    ],
  },
  { slug: 'estate_planning',    label: 'Estate Planning',    position: 6, is_in_scope: true,
    sub_types: [
      { slug: 'will',          label: 'Will',          position: 1 },
      { slug: 'trust',         label: 'Trust',         position: 2 },
      { slug: 'probate',       label: 'Probate',       position: 3 },
    ],
  },
];

export const DEFAULT_GOODBYE_PHRASES: string[] = [
  'bye', 'goodbye', 'thanks', 'thank you', 'good night', 'see you', 'that\u2019s all',
];
```

## Coordination With Other Features

### Upstream

- `001-foundation`: schema migrations + Zod baseline.
- `004-chat-api-agent`: route handler extension + system-prompt extension + new tool registration.
- `005-chat-widget`: progress-bar component + chips component.
- `006-lead-classification`: `captureLead` extended to accept SOP state snapshot.
- `007-dashboard`: SOP editor page + new CRUD routes.

### Downstream

- `008-hardening`: per-session debug mode (R8 of that feature) gains visibility into SOP transitions; the FAQ semantic cache (`008-hardening` R7) is unaffected (cache hits short-circuit the agent before SOP runs).
- `009-deployment-release`: SOP and chip-list seeds deployed alongside the API; eval suite (Phase 8 R5) gains 4 new scenarios (R-eval below).

## Schema Migration Plan

Generated via `pnpm --filter @legal-chatbot/api db:generate` after the `schema.ts` edit. Migration file lands in `packages/api/drizzle/000X_sop_workflow.sql`. Foundation `pnpm db:migrate` applies idempotently in production.

