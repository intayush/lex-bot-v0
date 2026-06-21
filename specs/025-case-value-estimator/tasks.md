---
description: "Task list for 025-case-value-estimator"
---

# Tasks: Case Value Estimator

**Input**: Design documents from `/specs/025-case-value-estimator/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/case-value-config-api.md, contracts/leads-api-extension.md, quickstart.md

**Tests**: Constitution III applies. Unit tests for `resolveCaseValueBadge()` and CSV case value parsing.

**Organization**: Tasks grouped by user story. US1 (config) + US2 (badge) are P1 MVP. US3 (CSV) and US4 (seed) are P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete task dependencies)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2, US3, US4)
- Every task lists exact file paths (repo-root-relative)

## Path Conventions

This feature touches `packages/api` and `packages/shared`. All paths are repo-root-relative.

---

## Phase 1: Setup

**Purpose**: Schema changes, Zod types, migration. No UI or business logic yet.

- [X] T001 Confirm branch `025-case-value-estimator` is checked out and working tree is clean: `git status`
- [X] T002 Edit `packages/shared/src/schemas/branch.ts`: add `caseValueBandSchema` Zod object with fields `score_min` (int 0–100), `score_max` (int 0–100), `value_min_usd` (int ≥ 0), `value_max_usd` (int ≥ 0), `position` (int ≥ 0). Add `caseValueConfigSchema` Zod object with `bands: z.array(caseValueBandSchema)`. Export `CaseValueBand` and `CaseValueConfig` types. Add refinement on `caseValueBandSchema`: `score_min ≤ score_max` and `value_min_usd ≤ value_max_usd`.
- [X] T003 Edit `packages/shared/src/schemas/branch.ts`: extend `branchVersionSchema` to include `case_value_config: caseValueConfigSchema.nullable().optional()`. Update `BranchVersion` type accordingly.
- [X] T004 Edit `packages/api/src/db/schema.ts`: add `case_value_config_json` (nullable text) to `branch_versions` table. Add `is_case_value_enabled` (boolean, NOT NULL, default false) to `branches` table.
- [X] T005 Edit `packages/api/src/db/test-schema.ts`: mirror the same two column additions to the SQLite test schema for `branchVersions` and `branches` tables.
- [X] T006 Run `pnpm --filter @legal-chatbot/api db:generate` to generate Drizzle migration. Rename the generated file to `packages/api/drizzle/0008_add_case_value_estimator.sql` and update `packages/api/drizzle/meta/_journal.json` with the new tag. Verify the migration contains only: `ALTER TABLE branch_versions ADD COLUMN case_value_config_json text;` and `ALTER TABLE branches ADD COLUMN is_case_value_enabled boolean NOT NULL DEFAULT false;`
- [X] T007 Run `pnpm --filter @legal-chatbot/api db:migrate` to apply the migration to the Neon dev DB. Confirm it succeeds with no errors.

**Checkpoint**: Schema updated, Zod types defined, migration applied. No business logic yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core utility function and branch API changes that both US1 and US2 depend on.

- [X] T008 [P] Create `packages/api/src/lib/case-value.ts`: export `resolveCaseValueBadge(leadScore: number | null, config: CaseValueConfig | null, enabled: boolean): string | null`. Logic: return null if `!enabled || !config || leadScore === null`; find first band (ordered by `position`) where `band.score_min <= leadScore <= band.score_max`; if no match return null. Export `formatCaseValueBadge(min: number, max: number): string` — format as "$75K – $250K" using K/M suffixes per contract (≥1M → M, ≥1K → K, else exact; min===max → single value). Import `CaseValueConfig` from `@legal-chatbot/shared`.

- [X] T009 [P] Create `packages/api/src/lib/case-value.test.ts`: unit tests for `resolveCaseValueBadge` covering: (a) returns null when enabled=false; (b) returns null when config=null; (c) returns null when leadScore=null; (d) returns correct band for score in range; (e) returns null when score in no band; (f) uses first matching band when bands are ordered by position; (g) SPAM classification path (caller must pass enabled=false — verify null returned). Unit tests for `formatCaseValueBadge`: (a) $75000/250000 → "$75K – $250K"; (b) $200000/1000000 → "$200K – $1M"; (c) $1500/8000 → "$1.5K – $8K"; (d) min===max → single value.

- [X] T010 Edit `packages/api/src/app/api/dashboard/branches/handler.ts` (or wherever the branch GET/save/publish actions live): extend the save action to accept and persist `case_value_config` (Zod-validated `CaseValueConfig | null`) into `case_value_config_json` column when saving a new branch version. Extend the GET action to include `case_value_config` (parsed from JSON) and `is_case_value_enabled` in the response. Add new `action: 'toggle_case_value'` handler that UPDATEs `branches.is_case_value_enabled` without creating a new version. Update the rollback handler to copy `case_value_config_json` from the historical version into the new draft version.

**Checkpoint**: Core utility function tested. Branch API extended. US1 and US2 can now be implemented.

---

## Phase 3: User Story 1 — Lawyer configures case value ranges for a branch (Priority: P1) 🎯 MVP

**Goal**: Branch editor shows a case value section with an on/off toggle and band editor. Lawyer can add/edit/delete bands and save alongside the branch.

**Independent Test**: Open Branches → DUI → First Offense. Toggle case value ON. Add band 76–100 = $10K–$50K. Save draft and publish. Confirm configuration persists. Toggle OFF. Confirm toggle state saves. Run quickstart.md Step 2.

### Implementation for User Story 1

- [X] T011 [US1] Edit `packages/api/src/app/dashboard/sop/branch-editor.tsx`: add `caseValueConfig: CaseValueConfig | null` and `isCaseValueEnabled: boolean` to editor state (initialised from props loaded via branch GET). Add a "Case Value Estimator" section below the hard override toggles section containing: (a) a toggle switch wired to `action: 'toggle_case_value'` (fires on change, no new version); (b) when enabled, a band list editor showing score_min, score_max, value_min_usd, value_max_usd per band with add/remove controls; (c) include `case_value_config` in the save/publish POST body. Import `CaseValueBand`, `CaseValueConfig` from `@legal-chatbot/shared`.

- [X] T012 [US1] Edit `packages/api/src/app/dashboard/sop/branches-tab.tsx`: pass `is_case_value_enabled` from the branch summary into the editor so the initial toggle state is correct when opening the editor for an existing branch.

**Checkpoint**: US1 complete. Lawyers can configure case value bands from the branch editor.

---

## Phase 4: User Story 2 — Leads table shows value range nudge (Priority: P1)

**Goal**: The Leads dashboard shows a "$X – $Y" badge for qualifying leads (HOT/WARM/COLD with a scored branch that has an active case value estimator).

**Independent Test**: With Car Accident estimator ON (seeded or manually configured), capture a HOT Car Accident lead. Open `/dashboard/leads`. Confirm the lead row shows a green value badge "$75K – $250K". SPAM lead shows no badge. Non-PI lead shows no badge. Run quickstart.md Steps 3–5.

### Implementation for User Story 2

- [X] T013 [US2] Edit the leads data-fetching logic in `packages/api/src/app/dashboard/leads/page.tsx` (or the leads API route that serves the table): after fetching leads, do one additional query: SELECT `branches.case_type_slug, branches.sub_type_slug, branches.is_case_value_enabled, branch_versions.case_value_config_json` WHERE `branches.account_id = session.accountId AND branches.is_case_value_enabled = true` JOIN `branch_versions ON branch_versions.id = branches.current_version_id`. Build a lookup map `Map<string, { enabled: boolean; config: CaseValueConfig | null }>` keyed by `case_type_slug`. Pass this map to the lead table component.

- [X] T014 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx`: add `caseValueMap: Map<string, { enabled: boolean; config: CaseValueConfig | null }>` prop. For each lead row, call `resolveCaseValueBadge(lead.lead_score, config, enabled)` — pass `enabled = false` when `lead.classification === 'SPAM'` or `lead.lead_score === null`. Render the returned badge string as a green pill badge in a new "Est. Value" column after the Classification column. If badge is null, render an empty cell. Import `resolveCaseValueBadge` from `../../../lib/case-value`. Import `CaseValueConfig` from `@legal-chatbot/shared`.

**Checkpoint**: US1 + US2 complete. Full MVP is functional.

---

## Phase 5: User Story 3 — CSV upload includes case value configuration (Priority: P2)

**Goal**: The branch CSV template includes a `[CASE_VALUE]` section. Uploading a CSV with this section pre-populates the case value bands in the branch editor preview.

**Independent Test**: Download CSV template for Personal Injury → Slip & Fall. Confirm `[CASE_VALUE]` section exists with seeded bands. Modify one band value. Upload CSV. Confirm updated bands appear in the editor preview. Upload CSV without `[CASE_VALUE]` section — confirm no error. Upload CSV with invalid band (min > max) — confirm 422 error with row reference. Run quickstart.md Step 6.

### Implementation for User Story 3

- [X] T015 [US3] Edit `packages/api/src/lib/branch-csv.ts`: extend `parseBranchCsv` to parse an optional `[CASE_VALUE]` section after all question rows. The section starts with a line containing only `[CASE_VALUE]`. Following lines are: one `case_value_enabled,YES|NO` row (optional), then header row `score_min,score_max,value_min_usd,value_max_usd`, then data rows. Parse into `{ caseValueEnabled: boolean | null; bands: CaseValueBand[] }`. Add `caseValueConfig` to the `ParseResult` success shape. Validate bands with `caseValueBandSchema`; return `CsvError[]` for invalid rows with row numbers relative to the `[CASE_VALUE]` header. If section is absent, return `caseValueConfig: null` (not an error).

- [X] T016 [US3] Edit the branch CSV template generator in `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/template/route.ts` (or equivalent): append the `[CASE_VALUE]` section to the downloaded CSV when the branch has existing case value config (read from the current published version's `case_value_config_json`). If no config exists, append an empty `[CASE_VALUE]` section with commented-out example rows.

- [X] T017 [US3] Edit the branch import handler `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/import/route.ts`: include `caseValueConfig` from `parseBranchCsv` result in the 200 response alongside `questions`. The branch editor must display the parsed case value bands in the preview before save.

- [X] T018 [US3] Edit `packages/api/src/app/dashboard/sop/branch-editor.tsx`: when the CSV import preview loads, also set the case value config state from `importedCaseValueConfig` returned by the import endpoint, so the band editor pre-fills with the CSV data.

**Checkpoint**: US3 complete. CSV round-trip works for case value config.

---

## Phase 6: User Story 4 — Dev database seeded with Personal Injury case values (Priority: P2)

**Goal**: Running `pnpm db:seed` produces case value configurations for all four PI branches per the spec's FR-016 values.

**Independent Test**: Run `pnpm db:seed`. Open Branches for each PI sub-type. Confirm estimator is ON with three bands per FR-016. Run quickstart.md Step 1.

### Implementation for User Story 4

- [X] T019 [US4] Edit `packages/api/src/db/seed-defaults/branches.ts`: for each of the four Personal Injury branches (car_accident, slip_fall, medical_malpractice, dog_bite), add a `case_value_config_json` property to the seed object containing three bands: HOT (76–100), WARM (51–75), COLD (26–50) with values from FR-016. Validate using `caseValueConfigSchema` at module load (same pattern as existing question validation). The seed should also set `is_case_value_enabled = true` for these four branches.

- [X] T020 [US4] Edit `packages/api/src/db/seed.ts` (or `packages/api/src/db/ensure-default-branches.ts`): when seeding branch rows, write `is_case_value_enabled = true` for Personal Injury branches if their seed data includes case value config. For all other branches, leave `is_case_value_enabled = false` (the column default).

- [X] T021 [US4] Edit the migration script that inserts seed branch versions: include `case_value_config_json` in the INSERT for PI branches. Ensure non-PI branch inserts leave the column NULL.

**Checkpoint**: All four PI branches have case value config in the seed. Feature is fully testable with `pnpm db:seed`.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T022 [P] Run `pnpm --filter @legal-chatbot/api typecheck` and `pnpm --filter @legal-chatbot/shared typecheck` — fix any type errors from new Zod schemas and component prop additions.
- [X] T023 [P] Run `pnpm --filter @legal-chatbot/api test` — confirm all tests pass including T009 (`case-value.test.ts`). Fix any test regressions from schema or inline SQL changes (add `case_value_config_json` / `is_case_value_enabled` columns to inline CREATE TABLE SQL in affected test files).
- [X] T024 Execute quickstart.md Steps 1–6 end-to-end against the local dev server. Record results and note any deviations.
- [X] T025 [P] Verify SPAM badge exclusion: confirm that no value badge appears for any SPAM-classified lead in the Leads table, even when the branch has an active estimator. Check 5 SPAM leads manually.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (Zod types and schema columns must exist). BLOCKS US1 and US2.
- **Phase 3 (US1)**: Depends on Phase 2 complete (T010 branch API, T008 utility exist).
- **Phase 4 (US2)**: Depends on Phase 2 complete (T008 `resolveCaseValueBadge` exists). Can run in parallel with US1.
- **Phase 5 (US3)**: Depends on Phase 2 complete (Zod types exist for CSV validation). Can run in parallel with US1+US2.
- **Phase 6 (US4)**: Depends on Phase 1 complete (schema columns exist for seed). Can run in parallel with US1–US3.
- **Phase 7 (Polish)**: Depends on all prior phases complete.

### Within Phase 2

- T008 (case-value.ts) and T009 (case-value.test.ts) can run in parallel with T010 (branch API).

### Within Phase 3+4 (US1 + US2)

- T011 (branch-editor UI) and T013 (leads page data) can run in parallel — different files.
- T014 (lead-table badge) depends on T008 (resolveCaseValueBadge) and T013 (prop added).

### Parallel Opportunities

- T008 + T009 + T010 — different files, same phase.
- T011 + T013 — different files, US1 and US2 are independent.
- T015 + T019 — different files (CSV lib vs seed).
- T022 + T023 + T025 — independent validation checks.

---

## Parallel Example: Foundational Phase

```bash
# Developer A:
Task: "Create case-value.ts and case-value.test.ts (T008, T009)"

# Developer B:
Task: "Extend branch API handler for case_value_config (T010)"
```

## Parallel Example: US1 + US2

```bash
# Developer A:
Task: "Add case value section to branch-editor.tsx (T011)"

# Developer B:
Task: "Add case value badge column to leads page (T013, T014)"
```

---

## Implementation Strategy

### MVP Scope

**MVP = Phase 1 + Phase 2 + Phase 3 (US1) + Phase 4 (US2)** — 14 tasks. Configuration UI + badge in Leads table. Ship-ready without CSV or seed.

### Incremental Delivery

1. Phase 1+2 → Foundation ready, types defined, migration applied
2. Phase 3 (US1) → Branch editor has case value config section
3. Phase 4 (US2) → Leads table shows value badges. **Ship-ready point.**
4. Phase 5 (US3) → CSV round-trip works
5. Phase 6 (US4) → Dev seed includes PI values
6. Phase 7 → All gates green

### Recommended Single-Developer Sequence

```text
T001 → T002 → T003 → T004 → T005 → T006 → T007    (Schema)
T008 + T009 + T010 in parallel                       (Foundation)
T011 + T013 in parallel                              (US1 + US2 start)
T012 → T014                                         (US1 + US2 finish)
T015 → T016 → T017 → T018                           (US3 CSV)
T019 → T020 → T021                                  (US4 Seed)
T022 + T023 + T025 → T024                           (Polish)
```

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` label is required on US1/US2/US3/US4 tasks; Setup, Foundational, and Polish tasks omit it.
- Constitution III: T009 (`case-value.test.ts`) is a first-class deliverable — write it before implementing T008 and confirm it fails first.
- The `case_value_config_json` column is nullable on existing branch versions — no backfill needed.
- After adding new columns to the schema, check if any inline `CREATE TABLE` SQL in existing test files references `branch_versions` or `branches` and add the new columns there too (T023 catches this).
- The PI seed values in FR-016 are advisory estimates; lawyers can adjust via the editor or CSV after seeding.
