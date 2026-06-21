# Phase 0 — Research: Case Value Estimator

**Feature**: 025-case-value-estimator · **Date**: 2026-06-22

---

## R1 — Storage location for case value config

**Decision**: `case_value_config_json` (nullable text) added to `branch_versions` table. Stores a JSON-encoded `CaseValueConfig` object.

**Rationale**: Branch versions are already immutable snapshots of questions + thresholds + hard override toggles. Adding case value config to the same row makes rollback automatic — restoring a prior version also restores its value configuration. The JSON-column-on-version pattern is already established by `questions_json`, `classification_thresholds_json`, and `hard_override_toggles_json`.

**Alternatives considered**:
- Separate `branch_case_value_bands` table — rejected (extra join on every leads page load; versioning linkage is complex; no advantage over JSON column for this small dataset).
- Store on `branches` row — rejected (would not be versioned; publishing a new version with new bands would lose the old configuration without history).

---

## R2 — Case-type-level toggle

**Decision**: `is_case_value_enabled` boolean column on `branches` table, default `false`.

**Rationale**: The toggle controls whether the badge appears at all for this branch (case type + sub type combination). Separating it from the versioned config means toggling off doesn't destroy the configured bands — just stops rendering the badge. The `branches` table already has per-pair metadata (`is_active`) so this fits naturally.

**Alternatives considered**:
- Inside `case_value_config_json` as `enabled: boolean` — rejected (would require JSON parsing just to evaluate visibility in the leads query; non-queryable without index).

---

## R3 — Lead badge computation

**Decision**: Computed at read-time in the leads page. The leads server component fetches all active branch versions for the account (one query), builds a lookup map `(case_type_slug, sub_type_slug) → CaseValueConfig`, then resolves each lead's badge using `resolveCaseValueBadge(leadScore, config)`.

**Rationale**: Leads are immutable records of a moment in time. Writing derived values to the leads table would go stale when configuration is updated. Read-time computation keeps leads clean and ensures the badge always reflects current configuration.

**Performance note**: The branch version lookup is a single query per page load, not per lead. With 100 leads per page, this adds ≤1 extra query. Acceptable.

**Alternatives considered**:
- Store `case_value_min/max` on leads — rejected (stale risk, schema churn, write during finalization adds latency).

---

## R4 — CSV case value columns

**Decision**: Extend the CSV with a separate `[CASE_VALUE]` section after the question rows. Lines starting with `[CASE_VALUE]` are the section header. Following rows have columns: `score_min`, `score_max`, `value_min_usd`, `value_max_usd` (one row per band). The `case_value_enabled` value is a single metadata row: `case_value_enabled,YES` (or NO).

**Example CSV extension**:
```csv
question_position,question_text,...,score_weight
1,Were you injured?,NO,NO,Yes,injured,15
...

[CASE_VALUE]
case_value_enabled,YES
score_min,score_max,value_min_usd,value_max_usd
76,100,75000,250000
51,75,15000,75000
26,50,3000,15000
```

**Rationale**: Cleanly separates the two independent concerns (branch questions vs case value bands) without awkward per-row columns that would repeat across all chip rows for a question. The section-header approach is self-documenting and easy for lawyers to fill in a spreadsheet.

**Alternatives considered**:
- Per-row case value columns appended to existing columns — rejected (every chip row would need the same band repeated or left blank; confusing in spreadsheets).
- Separate CSV file for case value — rejected (spec asks for the existing CSV upload to support it; two uploads is worse UX).

---

## R5 — Badge display format

**Decision**: Format `"$[X]K – $[Y]K"` using K/M suffixes. Pill badge, green tint (#ECFDF5 background, #059669 text), positioned as a new column in the Leads table after the Classification column.

**Format rules**:
- Values ≥ 1,000,000: use M suffix (e.g. $1M)
- Values ≥ 1,000: use K suffix (e.g. $75K)
- Values < 1,000: show as-is (e.g. $500)
- Single-point estimates (min === max): show as "$75K"

---

## R6 — Personal Injury seed values

**Source**: US personal injury settlement averages (research-backed):

| Sub-type | HOT (76–100) | WARM (51–75) | COLD (26–50) |
|---|---|---|---|
| Car Accident | $75,000–$250,000 | $15,000–$75,000 | $3,000–$15,000 |
| Slip & Fall | $50,000–$150,000 | $10,000–$50,000 | $2,000–$10,000 |
| Medical Malpractice | $200,000–$1,000,000 | $50,000–$200,000 | $10,000–$50,000 |
| Dog Bite | $30,000–$100,000 | $8,000–$30,000 | $1,500–$8,000 |

These reflect average US jury verdicts and settlements. Lawyers can adjust via the editor.

---

## Open Questions Resolved

All open questions resolved. No NEEDS CLARIFICATION items remain.
