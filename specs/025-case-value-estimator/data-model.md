# Data Model: Case Value Estimator

**Feature**: 025-case-value-estimator · **Date**: 2026-06-22

---

## New Shared Schema Types

### `CaseValueBand`

One score-band-to-dollar-range mapping.

```typescript
CaseValueBand {
  score_min:     number  // integer 0–100, inclusive
  score_max:     number  // integer 0–100, inclusive, ≥ score_min
  value_min_usd: number  // integer ≥ 0
  value_max_usd: number  // integer ≥ 0, ≥ value_min_usd
  position:      number  // integer ≥ 0, display/tie-break order
}
```

**Location**: `packages/shared/src/schemas/branch.ts` (new Zod schema `caseValueBandSchema`).

### `CaseValueConfig`

The full case value configuration for a branch version.

```typescript
CaseValueConfig {
  bands: CaseValueBand[]  // Ordered by position; may be empty
}
```

**Location**: `packages/shared/src/schemas/branch.ts` (new Zod schema `caseValueConfigSchema`).

---

## Modified Tables

### `branch_versions` — add `case_value_config_json`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `case_value_config_json` | text | YES | JSON-encoded `CaseValueConfig`. NULL = not configured. |

**Migration**: `ALTER TABLE branch_versions ADD COLUMN case_value_config_json text;`

Existing rows are unaffected (NULL = no value config, no badge shown).

### `branches` — add `is_case_value_enabled`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `is_case_value_enabled` | boolean | NOT NULL | Default `false`. Controls whether the badge renders for this branch. |

**Migration**: `ALTER TABLE branches ADD COLUMN is_case_value_enabled boolean NOT NULL DEFAULT false;`

---

## No Changes to `leads` Table

The case value badge is **computed at read-time** — no new columns on leads. The resolved band is derived by:

1. Look up `branches` row for `(account_id, case_type_slug, sub_type_slug)` where `is_case_value_enabled = true`.
2. Load `current_version_id` → read `branch_versions.case_value_config_json`.
3. Find the first `CaseValueBand` where `score_min ≤ lead_score ≤ score_max` (ordered by `position`).
4. Format badge string.

---

## Extended BranchVersion Type (shared)

After the change, `BranchVersion` gains one optional field:

```typescript
BranchVersion {
  id: string
  branch_id: string
  version_number: number
  is_published: boolean
  questions: BranchQuestion[]
  classification_thresholds: { self, family_friend }
  hard_override_toggles: HardOverridesEnabled
  case_value_config: CaseValueConfig | null  // NEW
  published_at: number | null
  created_at: number
  created_by_user_id: string
}
```

---

## Utility Function

### `resolveCaseValueBadge(leadScore, config, enabled)`

Pure function — no DB access.

```typescript
resolveCaseValueBadge(
  leadScore: number | null,
  config: CaseValueConfig | null,
  enabled: boolean
): string | null
```

- Returns `null` when: `enabled === false`, `config === null`, `leadScore === null`, no band matches.
- Returns formatted badge string e.g. `"$75K – $250K"` for first matching band.
- Band matching: first band (by `position`) where `band.score_min ≤ leadScore ≤ band.score_max`.
- Format rules: ≥1,000,000 → M; ≥1,000 → K; else exact. Min === max → single value.

**Location**: `packages/api/src/lib/case-value.ts` (new file).

---

## Entity Relationships

```
branches (1:1 per account+case_type+sub_type)
  └── is_case_value_enabled  ← controls badge visibility

branch_versions (1:N per branch)
  └── case_value_config_json ← CaseValueConfig with CaseValueBand[]
        ← versioned alongside questions/thresholds

leads (read-time badge derivation)
  case_type + lead_score
    → branches.is_case_value_enabled
    → branches.current_version_id
    → branch_versions.case_value_config_json
    → resolveCaseValueBadge()
    → badge string | null
```
