# Phase 1 Data Model: Multi-Branch SOP Workflow

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

## Overview

Two new tables (`branches`, `branch_versions`), two new columns on
`leads`, and one deprecated column on `sub_types`. Two new tables (`branches`, `branch_versions`), two new columns on
`leads`, and one deprecated column on `sub_types`. All new shapes have
Zod schemas in `packages/shared/src/schemas/branch.ts`.

## Entities

### Branch

The configurable per-(case_type, sub_type) workflow. At most one
active Branch per pair (FR-009).

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | TEXT (nanoid) | yes (PK) | Stable identifier, never reused |
| `firm_id` | TEXT FK → `firms.id` | yes | Per-firm scoping (consistent with spec 010 multi-firm model) |
| `case_type_slug` | TEXT | yes | References the firm's case-type slug (not a hard FK because case-type slugs may be edited by admins; lookup is by string) |
| `sub_type_slug` | TEXT | yes | Same as above, for sub-type |
| `is_active` | INTEGER (0/1) | yes (default 1) | Inactive branches do not fire (FR-025); preserved for history |
| `current_version_id` | TEXT FK → `branch_versions.id` | nullable | The currently published version. Null for branches that have only draft versions. |
| `created_at` | INTEGER (ms epoch) | yes | |
| `updated_at` | INTEGER (ms epoch) | yes | |

**Indexes**:

- UNIQUE `(firm_id, case_type_slug, sub_type_slug)` — enforces
  at-most-one branch per pair (FR-009).
- INDEX `(firm_id)` — for the dashboard list query.

**Relationships**:

- 1:N with `branch_versions` (history).
### BranchVersion

An immutable snapshot of a Branch's full configuration. Each Save
creates a new row; Publish updates the parent Branch's
`current_version_id` to point at this row.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | TEXT (nanoid) | yes (PK) | |
| `branch_id` | TEXT FK → `branches.id` | yes | Parent branch |
| `version_number` | INTEGER | yes | Auto-increment within a branch (1, 2, 3 …) |
| `is_published` | INTEGER (0/1) | yes (default 0) | True only for the version currently referenced by `branches.current_version_id` |
| `questions_json` | TEXT (JSON) | yes | Array of `BranchQuestion` (validated by `branchQuestionSchema[]`) |
| `classification_thresholds_json` | TEXT (JSON) | yes | `{ self: ThresholdTable, family_friend: ThresholdTable }` (per spec 015 shape, relocated) |
| `hard_override_toggles_json` | TEXT (JSON) | yes | `{ missing_contact: bool, out_of_scope: bool, no_injury_no_treatment: bool, fake_info: bool }` (per spec 015) |
| `published_at` | INTEGER (ms epoch) | nullable | Set when this version is published |
| `created_at` | INTEGER (ms epoch) | yes | |
| `created_by_user_id` | TEXT FK → `users.id` | yes | For audit log (FR-028) |

**Indexes**:

- INDEX `(branch_id)` — list versions for a branch.
- UNIQUE `(branch_id, version_number)` — version numbers are unique
  per branch.

### BranchQuestion (JSON shape inside `branch_versions.questions_json`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (nanoid) | yes | Stable across versions when an admin edits without delete-recreate |
| `position` | integer | yes | Order within the branch (0-indexed) |
| `text` | string | yes | The question prompt the assistant emits |
| `preface` | string | nullable | Optional lead-in text rendered before the question (e.g., "Thanks for that. Now…") |
| `chips` | `BranchChip[]` | yes | At least 1; may be empty only if `free_text_allowed: true` |
| `free_text_allowed` | boolean | yes | Whether free-text input is accepted in addition to chips |
| `multi_select` | boolean | yes (default false) | Single-chip selection vs multi-select (matches spec 015 question model) |

### BranchChip (JSON shape inside `BranchQuestion.chips`)

| Field | Type | Required | Notes |
|---|---|---|---|
| `slug` | string | yes | Stable machine identifier; logged (Constitution V) |
| `label` | string | yes | Display text shown in the widget |
| `weight` | integer | yes | Signed; may be negative; may be zero (FR-015) |

**Validation rules** (Zod):

- `weight` is `z.number().int()` — no decimals, no NaN.
- `slug` matches `/^[a-z0-9_-]+$/` (lowercase ASCII).
- `label` length 1–80 chars.
- A question's chip slugs must be unique within that question.

**Score contribution** (per FR-015):

- Single-select: contribution = the selected chip's `weight`.
- Multi-select: contribution = sum of all selected chips' `weights`.
### BranchSnapshot (new column on `leads`: `branch_snapshot_json`)

A frozen record on the lead row that survives branch deletion (FR-018).
Materialized at finalization (or at session-end abandonment).

| Field | Type | Required | Notes |
|---|---|---|---|
| `branch_id` | string | yes | Reference (not FK) to the Branch that fired |
| `branch_version_id` | string | yes | Reference (not FK) to the BranchVersion in effect |
| `version_number` | integer | yes | Denormalized for human-readable rendering |
| `case_type_slug` | string | yes | Denormalized for filtering historical leads |
| `sub_type_slug` | string | yes | Denormalized |
| `questions_snapshot` | `BranchQuestion[]` | yes | Full question payload at the time of capture |
| `captured_chips` | `{ question_id: string, chip_slugs: string[] }[]` | yes | Per-question chip selections (may be empty array for partial-branch leads with no answers) |
| `captured_free_text` | `{ question_id: string, text: string }[]` | yes (may be empty) | Free-text answers per question |
| `score` | integer | yes | Final `lead_score` (0–100, clamped). For partial-branch with no chips, this is 0. |
| `classification` | enum HOT \| WARM \| COLD \| SPAM | yes | Derived from thresholds applied to `score` |
| `reasons` | string[] | yes | Reason rule names that fired (per spec 015 reason-builder) |
| `branch_incomplete` | boolean | yes | True for partial-branch leads (FR-011a); also written to a sibling column for fast filtering |
| `finalized_at` | integer (ms epoch) | yes | When the snapshot was frozen |

### Lead — new columns

| Column | Type | Required | Notes |
|---|---|---|---|
| `branch_snapshot_json` | TEXT (JSON) | nullable | The `BranchSnapshot` above. Null for default-only leads (no branch fired). |
| `branch_incomplete` | INTEGER (0/1) | yes (default 0) | Sibling boolean for fast filter queries (FR-011b). Mirrors `branch_snapshot_json.branch_incomplete`. |

### Sub Types — deprecated column

| Column | Status | Notes |
|---|---|---|
| `sub_types.scoring_config_json` | DEPRECATED (read-only) | Per R2: kept in schema for backwards compatibility of historical lead rendering. New code path reads from `branches`. Drop is a follow-up cleanup migration. |

### SOP State (existing JSON shape, extended)

The existing SOP state JSON (per spec 010 FR-042) gets two new fields:

| Field | Type | Notes |
|---|---|---|
| `pending_contact` | `{ name?: string, email?: string, phone?: string }` \| null | Stash for skip-detected contact fields before Step 6 satisfies (R5 / FR-005a) |
| `contact_retry_count` | `0 \| 1 \| 2` | Retry counter for FR-002a |
| `branch_state` | `{ branch_id: string, branch_version_id: string, current_question_index: number, captured: { question_id: string, chip_slugs: string[], free_text?: string }[] }` \| null | Active branch state when a branch is mid-flow. Null before Step 6 and for unconfigured pairs. |

## State Transitions

### Default SOP step machine (revised)

```text
step1_case_type
  → step2_sub_type   (FR-001)
  → step3_where
  → step4_what
  → step5_when
  → step6_contact
       ├─ satisfied (≥ 1 of email/phone) → branch_lookup
       ├─ retry (count < 2)              → step6_contact
       └─ refusal (count >= 2)           → terminated_no_contact

branch_lookup
  ├─ active branch found → branch_running
  └─ no branch / inactive → finalize_default_only
```

### Branch state machine (new)

```text
branch_running
  ├─ next question presented           → branch_running
  ├─ last question answered            → finalize_with_branch
  ├─ visitor changes case_type/sub_type → re-evaluate (discard captured branch chips, jump back to branch_lookup with new pair)
  └─ session timeout / browser close   → branch_incomplete_finalized (R6)

finalize_with_branch
  → captureLead invoked with score + classification + reasons + branch_snapshot
  → conversation stays open (FR-012)

finalize_default_only
  → captureLead invoked with legacy-classifier classification + null score
  → conversation stays open (FR-012)

## Validation Rules Summary

Cross-referencing the spec's functional requirements with the
schema-level enforcement points (Constitution II):

| Rule | Where enforced |
|---|---|
| At most one active branch per (case_type, sub_type) pair (FR-009) | UNIQUE index on `(firm_id, case_type_slug, sub_type_slug)` |
| Branch with zero questions treated as unconfigured (Edge case) | Runtime `branch-lookup.ts` returns `null` when `questions_json.length === 0`; admin save emits a warning but does not block save |
| Lead score range 0–100 (spec 015 FR-001) | Existing `score-lead.ts` clamp; admin editor warns on out-of-range theoretical totals (FR-023) |
| Step 6 satisfaction: ≥ 1 of email/phone (FR-002) | `contact-form.ts` satisfaction predicate |
| At least 1 reachable contact on every captured lead (FR-002b, SC-003) | Database CHECK constraint on `leads`: `(contact_email IS NOT NULL OR contact_phone IS NOT NULL)` enforced at the application layer (Drizzle does not generate CHECKs cross-platform; runtime guard before INSERT) |
| Branch chip slugs unique within a question | Zod refinement on `branchQuestionSchema` |
| Branch version monotonic numbering | DB auto-increment on insert (sequence per branch) |
| `branch_incomplete` mirrors `branch_snapshot_json.branch_incomplete` | Single source of truth: write both atomically in the finalization handler |

## Migration Plan (Drizzle 0004)

```sql
-- 1. Create new tables
CREATE TABLE branches (
  id TEXT PRIMARY KEY NOT NULL,
  firm_id TEXT NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  case_type_slug TEXT NOT NULL,
  sub_type_slug TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT REFERENCES branch_versions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(firm_id, case_type_slug, sub_type_slug)
);

CREATE INDEX idx_branches_firm ON branches(firm_id);

CREATE TABLE branch_versions (
  id TEXT PRIMARY KEY NOT NULL,
  branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  is_published INTEGER NOT NULL DEFAULT 0,
  questions_json TEXT NOT NULL,
  classification_thresholds_json TEXT NOT NULL,
  hard_override_toggles_json TEXT NOT NULL,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  UNIQUE(branch_id, version_number)
);

CREATE INDEX idx_branch_versions_branch ON branch_versions(branch_id);

-- 2. Add columns to leads
ALTER TABLE leads ADD COLUMN branch_snapshot_json TEXT;
ALTER TABLE leads ADD COLUMN branch_incomplete INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_leads_branch_incomplete ON leads(branch_incomplete) WHERE branch_incomplete = 1;

-- 3. Data copy: every existing sub_types.scoring_config_json → new branch + version
-- (executed in TypeScript migration body, not raw SQL, because Postgres+SQLite need
-- different JSON-array shapes; idempotent via INSERT ... ON CONFLICT DO NOTHING.)
```

## Backwards Compatibility

- Pre-existing `leads` rows are unchanged. `branch_snapshot_json`
  defaults to `NULL` and `branch_incomplete` to `0`. Dashboard
  rendering treats null `branch_snapshot_json` as "default-only lead"
  (existing behaviour).
- Pre-existing `sub_types.scoring_config_json` rows remain readable
  but are no longer the source-of-truth for the runtime. The
  `ensureCarAccidentScoring.ts` boot-time migration is renamed/replaced
  by `ensureCarAccidentBranch.ts` which operates on the new tables
  (idempotent against the new shape).
- Pre-existing SOP step lists are migrated by the boot-time
  `ensure-contact-step.ts` function per R9: only firms whose SOP
  matches the seeded 5-step default get a Step 6 inserted; custom
  configurations are left alone.

