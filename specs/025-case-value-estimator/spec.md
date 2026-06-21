# Feature Specification: Case Value Estimator

**Feature Branch**: `025-case-value-estimator`

**Created**: 2026-06-22

**Status**: Draft

## User Scenarios & Testing

### User Story 1 — Lawyer configures case value ranges for a branch (Priority: P1)

A lawyer managing a Personal Injury practice opens the Branches dashboard. They navigate to the Car Accident branch editor. A new "Case Value" section appears in the editor. They toggle the case value estimator ON for Car Accident. They then define three value bands tied to lead score ranges:

- Score 76–100 (HOT band): estimated case value **$75,000 – $250,000**
- Score 51–75 (WARM band): estimated case value **$15,000 – $75,000**
- Score 26–50 (COLD band): estimated case value **$3,000 – $15,000**

They save and publish. The configuration is now live.

**Why this priority**: Configuration is the prerequisite for all other functionality. Nothing else works until ranges are defined.

**Independent Test**: Open Branches → Car Accident. Toggle case value estimator ON. Enter three score bands with min/max dollar values. Save draft and publish. Confirm the configuration is saved and retrievable.

**Acceptance Scenarios**:

1. **Given** a branch is open in the editor, **When** the lawyer toggles the case value estimator ON, **Then** a section appears allowing them to define one or more score-band-to-value-range mappings.
2. **Given** the estimator is configured, **When** the lawyer saves a band with min value greater than max value, **Then** the form rejects the entry with a clear validation error.
3. **Given** the estimator is toggled OFF for a case type, **When** the configuration is saved, **Then** no value range is shown for leads of that case type regardless of score, even if band data was previously saved.
4. **Given** the estimator is toggled ON but no bands are defined, **When** a lead is captured, **Then** no value range is displayed (the estimator requires at least one band to show output).

---

### User Story 2 — Leads table shows a value range nudge for qualifying leads (Priority: P1)

A lawyer opens the Leads dashboard. For leads where the case value estimator is configured and the lead's score falls within a defined band, a dollar range badge appears on the lead row — e.g. **"$75K–$250K"**. Leads without an estimator configured, or whose score does not fall in any defined band, show no badge.

**Why this priority**: This is the primary user-facing output — the whole point of configuration is to surface this in the leads view.

**Independent Test**: With Car Accident estimator configured (HOT band: $75K–$250K for scores 76–100), capture a HOT Car Accident lead. Open the Leads dashboard. Confirm the lead row shows the value range badge "$75K–$250K". Capture a WARM lead (score 51–75). Confirm it shows "$15K–$75K". Capture a lead with no estimator configured (e.g. DUI). Confirm no badge appears.

**Acceptance Scenarios**:

1. **Given** a lead has been scored and its score falls within a configured value band, **When** the lawyer views the Leads table, **Then** a value range badge (e.g. "$75K – $250K") appears on that lead's row.
2. **Given** a lead's case type has the estimator toggled OFF, **When** the lawyer views the Leads table, **Then** no value badge appears for that lead.
3. **Given** a lead's score does not fall within any configured band (e.g. score is 10 and only bands for 26–100 are defined), **When** the lawyer views the Leads table, **Then** no badge appears.
4. **Given** the estimator is configured, **When** the lead is a SPAM classification (score 0–25), **Then** no value badge is shown (SPAM leads are excluded from value estimation).

---

### User Story 3 — CSV upload includes case value configuration for a branch (Priority: P2)

A lawyer preparing a branch configuration in a spreadsheet can include case value bands as additional columns in the branch CSV. When they upload the CSV for a given branch, the case value configuration is parsed and pre-populated alongside the question/chip data. They can review it before saving.

**Why this priority**: Power users managing many branches prefer batch configuration. CSV is already the established import path for branch questions.

**Independent Test**: Download the branch CSV template for Personal Injury → Slip & Fall. Observe that new columns exist for case value configuration (`case_value_enabled`, `case_value_score_min`, `case_value_score_max`, `case_value_min_usd`, `case_value_max_usd`). Fill in sample bands. Upload the CSV. Confirm the case value bands are pre-populated in the branch editor for review.

**Acceptance Scenarios**:

1. **Given** the CSV template is downloaded, **When** the lawyer opens it, **Then** case value columns are present alongside the existing question/chip columns.
2. **Given** a CSV is uploaded with valid case value data, **When** parsing succeeds, **Then** the case value bands appear pre-populated in the branch editor preview.
3. **Given** a CSV contains an invalid case value row (e.g. min value > max value, or non-numeric value), **When** the CSV is parsed, **Then** a row-level validation error is returned identifying the problem.
4. **Given** a CSV omits the case value columns entirely, **When** it is uploaded, **Then** it is accepted normally (case value columns are optional).

---

### User Story 4 — Dev database seeded with Personal Injury case values (Priority: P2)

The dev database seed script includes realistic case value configurations for all four Personal Injury sub-types (Car Accident, Slip & Fall, Medical Malpractice, Dog Bite) with industry-standard US value ranges per score band. This provides an immediately usable test scenario without manual configuration.

**Why this priority**: Enables testing and demonstration of the full feature without manual setup steps.

**Independent Test**: Run `pnpm db:seed`. Open the Branches dashboard. Navigate to any Personal Injury sub-type. Confirm the case value estimator is toggled ON with three bands populated. Capture a HOT Personal Injury lead. Confirm the value badge appears in the Leads table.

**Acceptance Scenarios**:

1. **Given** the seed script is run, **When** the developer opens Branches → Personal Injury → Car Accident, **Then** the estimator is ON with bands: HOT ($75K–$250K), WARM ($15K–$75K), COLD ($3K–$15K).
2. **Given** the seed script is run, **When** the developer opens Branches → Slip & Fall, **Then** the estimator is ON with bands: HOT ($50K–$150K), WARM ($10K–$50K), COLD ($2K–$10K).
3. **Given** the seed script is run, **When** the developer opens Branches → Medical Malpractice, **Then** the estimator is ON with bands: HOT ($200K–$1M), WARM ($50K–$200K), COLD ($10K–$50K).
4. **Given** the seed script is run, **When** the developer opens Branches → Dog Bite, **Then** the estimator is ON with bands: HOT ($30K–$100K), WARM ($8K–$30K), COLD ($1.5K–$8K).

---

### Edge Cases

- What if score bands overlap (e.g. one band is 50–80 and another is 70–100)? The system uses the first matching band in order of definition. The UI warns the lawyer when bands overlap.
- What if a lead score is null (unscored lead)? No value badge is shown.
- What if a branch version is rolled back to a version before case value was configured? The rolled-back version has no case value configuration; no badge is shown for leads scored against it.
- What if the lawyer enters $0 as the minimum value? $0 is a valid minimum.
- What if a band has the same min and max (e.g. $50K–$50K)? This is allowed — it represents a point estimate rather than a range.
- What if a case type has multiple sub-types and only some branches have estimators configured? The estimator toggle and bands are per branch (case type + sub type combination), not per case type. The case type-level toggle enables/disables all branches for that case type simultaneously.

---

## Requirements

### Functional Requirements

**Case value configuration**

- **FR-001**: Each branch (case type + sub type combination) MUST have an on/off toggle for the case value estimator.
- **FR-002**: When enabled, a branch MUST allow defining one or more score bands, each specifying: score range minimum (integer 0–100), score range maximum (integer 0–100), value range minimum (USD, integer ≥ 0), value range maximum (USD, integer ≥ 0).
- **FR-003**: Value bands MUST be validated: value minimum ≤ value maximum; score minimum ≤ score maximum; score minimum and maximum must be integers in [0, 100].
- **FR-004**: The case value configuration MUST be versioned alongside the branch version — restoring a branch to a previous version also restores its previous case value configuration.
- **FR-005**: A case-type-level toggle MUST exist that enables or disables all branches under that case type simultaneously. Individual branch toggles still control per-branch behaviour when the case type toggle is ON.
- **FR-006**: The case value configuration for a branch MUST be editable from the same branch editor UI where questions and chips are configured.

**Leads table display**

- **FR-007**: When a lead's case type branch has the estimator enabled and the lead's score falls within a defined band, the Leads table MUST show a value range badge on that lead's row formatted as "$[min] – $[max]" with K/M suffixes for readability (e.g. "$75K – $250K").
- **FR-008**: The badge MUST NOT be shown for SPAM-classified leads.
- **FR-009**: The badge MUST NOT be shown when the lead's score is null (unscored).
- **FR-010**: The badge MUST NOT be shown when the estimator is toggled OFF for the case type or branch.
- **FR-011**: When a lead's score does not fall within any defined band, no badge is shown (no fallback or default value).

**CSV import**

- **FR-012**: The branch CSV template MUST include optional columns for case value configuration: `case_value_enabled` (YES/NO), `case_value_score_min` (integer), `case_value_score_max` (integer), `case_value_min_usd` (integer), `case_value_max_usd` (integer).
- **FR-013**: CSV rows providing case value data MUST be validated with the same rules as FR-003. Validation errors MUST identify the row number and the failing column.
- **FR-014**: If case value columns are absent from the CSV, the import MUST succeed without error and case value configuration remains unchanged.
- **FR-015**: Case value configuration parsed from a CSV upload MUST be included in the branch editor preview before the lawyer commits the save.

**Seeding**

- **FR-016**: The dev seed script MUST include case value configurations for all four Personal Injury branches with the following bands (industry-standard US estimates):
  - Car Accident: HOT 76–100 → $75K–$250K, WARM 51–75 → $15K–$75K, COLD 26–50 → $3K–$15K
  - Slip & Fall: HOT 76–100 → $50K–$150K, WARM 51–75 → $10K–$50K, COLD 26–50 → $2K–$10K
  - Medical Malpractice: HOT 76–100 → $200K–$1M, WARM 51–75 → $50K–$200K, COLD 26–50 → $10K–$50K
  - Dog Bite: HOT 76–100 → $30K–$100K, WARM 51–75 → $8K–$30K, COLD 26–50 → $1.5K–$8K

### Key Entities

- **CaseValueBand**: A score-band-to-value-range mapping for a specific branch. Has: branch_version_id, score_min, score_max, value_min_usd, value_max_usd, position (display order).
- **CaseValueConfig**: The case value estimator configuration for a branch version. Has: branch_version_id, is_enabled (boolean). Contains zero or more CaseValueBands.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A lawyer can configure case value bands for a branch in under 2 minutes.
- **SC-002**: 100% of HOT/WARM/COLD leads whose branch has an active estimator show a value badge in the Leads table within 1 second of the page loading.
- **SC-003**: Zero value badges appear for SPAM leads or leads with null scores, verifiable by reviewing 50 consecutive SPAM leads.
- **SC-004**: CSV upload correctly parses case value configuration from a template-compliant file — value bands appear in the editor preview without error.
- **SC-005**: After running the seed script, all four Personal Injury branches have case value configurations pre-populated matching the values in FR-016.
- **SC-006**: Rolling back a branch version also rolls back case value configuration — the value badge on existing leads updates to match the restored version's configuration.

---

## Assumptions

- The case value estimation is advisory and for internal dashboard use only — it is never shown to the chatbot visitor.
- Lead scores are integers in [0, 100]. The score band boundaries are inclusive on both ends.
- The "HOT band" (76–100), "WARM band" (51–75), and "COLD band" (26–50) in the seed data are aligned with the existing classification threshold table, but the case value configuration does not depend on classification — it is driven by the numeric score alone.
- Value amounts are stored in whole US dollars (integer). Display formatting (K, M suffixes) is a UI concern only.
- The case value configuration is stored as part of the branch version — it is immutable once a version is published, consistent with how questions and chips are versioned.
- The feature touches `packages/api` (backend + dashboard) only. The widget does not show case values to visitors.
- The case type-level toggle (FR-005) is stored on the `branches` table (one row per account + case type + sub type), not on individual branch versions.
- When the CSV import omits case value columns, the existing branch's case value configuration is left untouched (not cleared).
- Score bands are non-overlapping in practice but the system handles overlaps by using the first matching band (lowest position number wins).
