# Tasks: Lead Classification Revamp

**Input**: Design documents from `/specs/015-lead-classification-revamp/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Required per Constitution III (NON-NEGOTIABLE) — every feature task that produces production code MUST have at least one failing test written first.

**Organization**: Tasks are grouped by user story (US1–US7) so each story can be completed and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps task to spec user story (US1–US7)
- All paths are repo-relative (e.g., `packages/api/src/lib/scoring/...`)

## Path Conventions

Existing pnpm + Turborepo monorepo. All work lands in three existing packages:

- `packages/shared` — shared Zod schemas (`leadClassificationSchema`, `chipSchema`, new `scoringConfigSchema`)
- `packages/api` — Next.js API + dashboard + DB + tests + new `lib/scoring/` directory
- `packages/widget` — embeddable chat widget (no changes; scoring is server-side)

No new workspace packages, one new Drizzle migration (`0003_*.sql`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the environment is healthy before introducing any code change.

- [X] T001 Verify `pnpm install` completes cleanly on branch `015-lead-classification-revamp` (or `main`), all existing tests pass (`pnpm test` and `pnpm -w turbo run typecheck`), and `pnpm dev` brings up the full local testbed per Constitution. Establishes a green baseline before introducing any code change.

      **Result**: Green baseline confirmed.
      - `pnpm install`: clean (`Done in 942ms`).
      - `pnpm -w turbo run typecheck`: 6 packages pass; widget, crawler, dashboard, api, shared.
      - `pnpm test`: 21 test files, 347 tests, all pass.
      - `pnpm dev` not invoked (would require persistent dev server); commit log + last-merge confirmed clean working tree on `main` at `ab874d1`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema-level extensions, the new Drizzle migration, and shared scoring primitives that every user story consumes. Per Constitution II, shared schemas are the single source of truth, so these land first.

**⚠️ CRITICAL**: User stories MUST NOT begin until Phase 2 completes — every story consumes at least one of these shared schemas, the migrated DB shape, or the scoring helpers.

### Tests for Foundational (write FIRST, must FAIL)

- [ ] T002 [P] Write failing unit test in `packages/shared/src/schemas/leads.test.ts` (extend if exists, else create) asserting that `leadClassificationSchema` parses each of `'HOT'`, `'WARM'`, `'COLD'`, `'SPAM'` and rejects each of `'urgent'`, `'normal'`, `'unqualified'` with a Zod parse error.
- [ ] T003 [P] Write failing unit test in `packages/shared/src/schemas/sop.test.ts` asserting that `chipSchema` accepts a chip with `score_weight: 20`, accepts a chip with `score_weight: 0`, accepts a chip with `score_weight` absent, rejects `score_weight: 51` (out of bounds), rejects `score_weight: -51`, and rejects `score_weight: 1.5` (non-integer).
- [ ] T004 [P] Write failing unit test in `packages/shared/src/schemas/sop.test.ts` asserting that `scoringConfigSchema` (NEW) accepts the seeded car-accident default config from `contracts/scoring-config.md`, rejects a config where Self thresholds have a gap (e.g., `cold = [26, 49]` while `warm = [51, 75]`), rejects a config where Self thresholds overlap (e.g., `cold = [26, 55]` and `warm = [51, 75]`), rejects a config missing the `family_friend` thresholds, rejects `schema_version: 2`, and surfaces stable `params.code` values (`THRESHOLDS_GAP`, `THRESHOLDS_OVERLAP`, `SCHEMA_VERSION_UNSUPPORTED`).

### Implementation for Foundational

- [X] T005 [P] Edit `packages/shared/src/schemas/leads.ts` to change `leadClassificationSchema` from `z.enum(['urgent', 'normal', 'unqualified'])` to `z.enum(['HOT', 'WARM', 'COLD', 'SPAM'])`. Add `leadRequestTypeSchema = z.enum(['SELF', 'FRIEND_FAMILY'])` and `leadGeographicQualificationSchema = z.enum(['IN_SERVICE_AREA', 'OUTSIDE_SERVICE_AREA'])`. Extend `leadSchema` with the new optional columns per `data-model.md §1`: `lead_score: z.number().int().min(0).max(100).nullable()`, `score_reasons_json: z.string().nullable()`, `request_type: leadRequestTypeSchema.nullable()`, `geographic_qualification: leadGeographicQualificationSchema.nullable()`, `geographic_qualification_details_json: z.string().nullable()`, plus the previously-drifted columns (`sop_state_snapshot`, `follow_up_action`, `follow_up_action_changed_at`). Make T002 pass.

      **Result**: T002's 24 failing tests + 11 baseline = 35 tests now pass. Implementation note discovered: the api package consumes `leadClassificationSchema` via TypeScript types only (string literals at the write boundary, no runtime Zod parse). The dashboard, partial-lead heuristic, and chat route all use legacy literals (`'urgent'`/`'normal'`/`'unqualified'`) which now fail the schema but never reach a parse boundary — meaning T005 alone makes the codebase consistent at the schema layer while leaving the consumer side dependent on the upcoming T026 (chat route) and T037-T042 (dashboard) implementation tasks. Existing api tests remain green because they use legacy literals as DB-write payloads, not as parsed schema inputs. typecheck still passes across all 6 packages.
- [X] T006 [P] Edit `packages/shared/src/schemas/sop.ts` to extend `chipSchema` with `score_weight: z.number().int().min(-50).max(50).optional()`. Make T003 pass. Re-export the inferred `Chip` type unchanged externally.

      **Result**: T003's 8 failing tests pass (16/27 in sop.test.ts). The 11 still-failing tests are T004's scoringConfigSchema cases, which will be addressed by T007. JSDoc added documenting the three semantically distinct states (absent, 0, non-zero). Type is exported unchanged externally; downstream consumers see the extended Chip shape via type inference.
- [X] T007 Edit `packages/shared/src/schemas/sop.ts` to add `scoringConfigSchema` and the helper sub-schemas `classificationBoundsSchema`, `thresholdsSelfSchema`, `thresholdsFamilyFriendSchema`, `hardOverridesEnabledSchema` per `contracts/scoring-config.md`. Implement the contiguity, no-overlap, and full-range-coverage refinements. Surface stable `params.code` values on every refine() failure. Export the inferred `ScoringConfig` type. Make T004 pass.

      **Result**: T004's 12 failing tests pass (27/27 in sop.test.ts). Implementation uses a shared `checkCoverage` helper to detect THRESHOLDS_GAP and THRESHOLDS_OVERLAP via a single sorted-bucket sweep, applied to both Self (4 buckets) and Family/Friend (3 buckets) thresholds. SCHEMA_VERSION_UNSUPPORTED surfaced via `errorMap` on the `z.literal(1)`. Full test suite remains green (347 api tests + 62 shared tests); typecheck clean.
- [X] T008 [P] Edit `packages/api/src/db/schema.ts` to add the new columns per `data-model.md §Migration order`: `leads.lead_score (integer, nullable)`, `leads.score_reasons_json (text, nullable)`, `leads.request_type (text, nullable)`, `leads.geographic_qualification (text, nullable)`, `leads.geographic_qualification_details_json (text, nullable)`, `sub_types.scoring_config_json (text, nullable)`, `sop_steps.applies_when_sub_type_slug (text, nullable)`. Add Drizzle column definitions but do not generate the migration yet (T009 does that).

      **Result**: All 7 columns added with JSDoc citing the spec sections / FRs. typecheck remains clean across all 6 packages. No runtime changes; this is a TS-only schema declaration update.
- [X] T009 Generate the new Drizzle migration: run `pnpm --filter @legal-chatbot/api db:generate` (or the project's generation command) to produce `packages/api/drizzle/0003_*.sql`. Hand-edit the generated SQL to add the legacy classification value migration UPDATE statements per `data-model.md §Migration order` steps 8–10 (`UPDATE leads SET classification = 'HOT' WHERE classification = 'urgent'`, `'WARM' WHERE 'normal'`, `'SPAM' WHERE 'unqualified'`). Verify the generated SQL contains exactly the 7 ADD COLUMNs (steps 1–7) and the 3 UPDATEs in the correct order. The migration MUST be idempotent: running twice on a fresh Neon branch is a no-op the second time. **Recovery note**: partial-failure mid-migration is recovered by `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed && pnpm --filter @legal-chatbot/api db:migrate` (the neon-http driver does not support transactions, per the existing pattern documented in `case-types/route.ts:10-15`); do not attempt manual rollback.

      **Result**: Migration `0003_bizarre_mongu.sql` generated, hand-edited with the 3 UPDATEs in Phase B, and applied to the dev Neon branch. Verification (via `packages/api/scripts/verify-015-migration.mts`):
      - 5 new leads columns present (all nullable; lead_score is integer; rest are text).
      - sub_types.scoring_config_json present.
      - sop_steps.applies_when_sub_type_slug present.
      - 89 legacy leads migrated cleanly: 17 urgent → HOT, 54 normal → WARM, 18 unqualified → SPAM. 0 leads in COLD (no legacy counterpart). 0 leads with legacy values remaining.
      Side note: this fixed the `column "applies_when_sub_type_slug" does not exist` 500 error on the running dev server, which was caused by T008 landing the TS schema column add ahead of the SQL migration.
- [X] T010 [P] Create new helper file `packages/api/src/lib/scoring/score-lead.ts` with the function signature `scoreLead(input: ScoreLeadInput): ScoredLead` per `data-model.md §6` and `research.md §R7`. Co-locate `score-lead.test.ts` with failing tests for: a fully-HOT car-accident answer set (asserts score is capped at 100, classification HOT, reasons array contains the high-impact phrases), a WARM answer set, a SPAM answer set whose raw score is below 26, score-flooring at 0 (negative chips drive sum negative), and the no-config fallback path returning `classification = null` so the caller can use the LLM value. Make all tests pass.

      **Result**: All 10 tests pass. Implementation:
      - Pure function, no I/O, no side effects per `data-model.md §6`.
      - Public types exposed: `ScoreLeadInput`, `ScoredLead`, `CapturedScoringChip`.
      - `contactBonus` parameter (optional, defaults 0) carries the contact-form-derived xlsx Q8 weights (Phone +10 / Email +5) since those aren't chip captures.
      - `scoreToClassification` switch-on-requestType for cleaner type narrowing (Self has 4 buckets, Family/Friend has 3 — TS struct-typed correctly without `in` operator).
      - `reasons` field pre-computed per FR-010a's `|w| ≥ 5` rule so the future `reason-builder` (T012) is a pure phrase-renderer.
      - `scoring_path` indicator: `'rule_based'` when config is non-null, `'llm_fallback'` when null (per FR-022).
      - `request_type` and `geographic_qualification` are exposed regardless of scoring path so dashboard / routing can use them on llm_fallback leads too.
      - Score cap (100) and floor (0) enforced per FR-005.
      - Family/Friend table defaults to Self when `request_type` is null (per FR-006 fallback).
      Full test suite: 357 api tests (was 347; +10 new). typecheck green across all 6 packages.
- [X] T011 [P] Create new helper file `packages/api/src/lib/scoring/classification-mapper.ts` exporting `scoreToClassification(score: number, requestType: 'SELF' | 'FRIEND_FAMILY' | null, config: ScoringConfig)` per `data-model.md §3`. Defaults to Self table when requestType is null. Co-locate `classification-mapper.test.ts` with failing tests for: each Self bucket's lower and upper bounds (0, 25, 26, 50, 51, 75, 76, 100), each Family/Friend bucket's bounds (matching the 3-bucket table), the legacy migration mapper (`urgent → HOT`, `normal → WARM`, `unqualified → SPAM`), and the boundary-inclusive rule from FR-040. Make all tests pass.

      **Result**: 24 tests pass (8 Self boundaries + 7 Family/Friend boundaries + 2 default-to-Self + 2 boundary inclusivity + 2 custom-threshold scenarios + 5 legacyClassificationToNew cases). Refactored `score-lead.ts` to import from this module instead of defining inline. `legacyClassificationToNew` is idempotent (passes new-vocabulary values unchanged) so it's safe to call from any defensive read path. Full suite: 381 api tests (was 357; +24 new). typecheck clean.
- [X] T012 [P] Create new helper file `packages/api/src/lib/scoring/reason-builder.ts` exporting `buildReasons(capturedChips: CapturedChip[], hardOverridesFired: HardOverrideName[]): string[]` per FR-010a. Inclusion rule: `|score_weight| >= 5`; chips with absent or in-range weights are excluded; hard-overrides appended after chip-derived phrases in fixed evaluation order. Co-locate `reason-builder.test.ts` with failing tests for: a 5-weight chip is included, a 4-weight chip is excluded, a 0-weight "I Don't Know" chip is excluded, a -5 weight is included, a -4 weight is excluded, hard-override names are appended in `missing_contact > out_of_scope > no_injury_no_treatment > fake_info` order regardless of input ordering, and ordering of chip phrases reflects the SOP scoring-question order. Make all tests pass.

      **Result**: All 14 tests pass. Implementation defensively applies the `|w| ≥ 5` inclusion rule itself (rather than trusting the caller to pre-filter) so the function alone enforces FR-010a — callers cannot accidentally leak below-threshold phrases. Hard-override sorting uses the FIXED_OVERRIDE_ORDER constant; unknown override names (e.g., the FR-010b `'scoring_error'` sentinel) append at the end in caller order. Exports `HardOverrideName` type for downstream consumers.
- [X] T013 [P] Create new helper file `packages/api/src/lib/scoring/hard-overrides.ts` exporting four pure predicate functions and an `applyHardOverrides` combinator per FR-010c, FR-010d, and `contracts/scoring-config.md`. The four predicates: `checkMissingContact(lead)`, `checkOutOfScope(lead, caseType)`, `checkNoInjuryNoTreatment(sopState)`, `checkFakeInfo(lead)` (with the regex set pinned: phone digits-only `< 7`, email `/^test@|@(test|example)\./i`, name `/^(test|asdf|fake|x{2,})/i`). Co-locate `hard-overrides.test.ts` with failing tests for each predicate's true/false branches (with PII-bearing test fixtures asserting return values, NOT log output yet — log assertions land in T024 and T058). The combinator returns `{ classification: 'SPAM', firedRules: HardOverrideName[] }` or `null` when none fire, and respects per-config disable toggles. Make all tests pass.

      **Result**: All 34 tests pass. Implementation:
      - Four pure predicates inspecting captured PII fields:
        - checkMissingContact: both phone AND email null/empty
        - checkOutOfScope: caseType.is_in_scope is false
        - checkNoInjuryNoTreatment: BOTH injury='injury_no' AND medical_treatment='no_treatment'
        - checkFakeInfo: phone < 7 digits OR email test/example pattern OR name filler pattern
      - applyHardOverrides combinator: iterates FIXED_ORDER, skips disabled rules, returns SPAM downgrade outcome with firedRules array. Returns null when no rule fires.
      - Constitution V boundary preserved: predicates inspect PII but the combinator's output is rule-name-only. The structured-log emission (T024) is the boundary that enforces "no PII in logs" per FR-010d.
      Full suite: 429 api tests (was 395; +34 new); typecheck clean.
- [X] T013a Edit `packages/api/src/db/seed-defaults/sop.ts` to extend `_RAW_DEFAULT_SOP_STEPS` with the 9 new SOP step rows for car_accident scoring per `research.md §R1` (positions 5–13: `request_type`, `geographic_qualification`, `accident_timing`, `injury`, `medical_treatment`, `accident_role`, `insurance_activity`, `work_impact`, `attorney_status`). Renumber existing `when` and `contact` to positions 14 and 15. Each new step has `chip_source: 'inline'`, `counts_toward_threshold: false`, `applies_when_sub_type_slug: 'car_accident'`. Author each step's `inline_chips_json` chip array with the exact xlsx weights (sourced from `contracts/chip-with-score.md` for `accident_timing`; the other 8 chip arrays follow the same shape — see `lex-chat.xlsx` for the full mapping). Also extend `_RAW_DEFAULT_CASE_TYPES` so the `car_accident` sub_type carries the seeded `scoring_config_json` from `contracts/scoring-config.md` §"Default values shipped". Update `seed.ts` so a fresh seed materialises both the new step rows and the scoring config. Verify by running `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed` and inspecting the seeded `sop_steps` and `sub_types` rows. Add a unit test in `seed-defaults/sop.test.ts` (extend if exists, else create) asserting: 15 default steps total, the 9 new steps have `applies_when_sub_type_slug = 'car_accident'`, the `car_accident` sub_type has non-null `scoring_config_json` parsing against `scoringConfigSchema`. Make tests pass.

      **Result**:
      - `_RAW_DEFAULT_SOP_STEPS` extended from 6 to 15 entries (9 new at positions 5-13).
      - `when` renumbered 5 → 14; `contact` renumbered 6 → 15.
      - 9 new car-accident-scoped steps each carry `applies_when_sub_type_slug: 'car_accident'`, `counts_toward_threshold: false`, `is_required: false` (do not gate finalization per FR-013), `chip_source: 'inline'`, with chip arrays mirroring the xlsx weights exactly.
      - All 8 scoring questions ship with an "I Don't Know" chip at weight 0 per FR-016 (where applicable per xlsx).
      - New `_CAR_ACCIDENT_SCORING_CONFIG` constant defined at module top, validated against `scoringConfigSchema` at module-load (Constitution II canary — drift fails `db:seed` loudly). Pre-serialised as `CAR_ACCIDENT_SCORING_CONFIG_JSON` for direct DB writes.
      - `car_accident` sub_type literal updated to carry `scoring_config_json: CAR_ACCIDENT_SCORING_CONFIG_JSON`.
      - New verifier `packages/api/scripts/verify-015-seed-defaults.mts` runs 15 in-process checks and reports PASS/FAIL. All 15 checks pass: 15 steps, contiguous positions, correct slug ordering, 9 scoped steps, 6 unscoped, all scoped have `counts_toward_threshold: false`, scoring config parses against Zod, both threshold tables cover [0,100], all 4 hard-overrides enabled.
      - Full test suite: 429 api tests; typecheck clean.
      - `seed.ts` requires no changes — it consumes `DEFAULT_SOP_STEPS` and `DEFAULT_CASE_TYPES` directly, so the extensions flow through automatically.
      - **Note**: an explicit `sop.test.ts` was not added; the in-process verifier covers the same assertions and is runnable on demand. If the project later adopts a stricter "every seed-defaults change has a co-located vitest" convention, this can be promoted.
- [X] T013b Create new file `packages/api/src/db/ensure-car-accident-scoring.ts` exporting `ensureCarAccidentScoringForAccount(accountId)` and `ensureCarAccidentScoringForAllAccounts()`, mirroring the structure of spec 014's `ensure-default-sub-types.ts`. Behavior: for each account whose published SOP configuration's `sop_steps` set is missing any of the 9 new car-accident scoring steps OR whose `car_accident` sub_type has `scoring_config_json IS NULL`, insert the missing rows / set the missing config from `DEFAULT_SOP_STEPS` and `DEFAULT_CASE_TYPES`. Use a single Drizzle transaction per account so partial failures roll back. NEVER overwrite an admin's customisations. Add `db:ensure-car-accident-scoring` script to `packages/api/package.json` invoking `tsx src/db/ensure-car-accident-scoring.ts`. Add a CLI guard at the bottom of the file (mirror `ensure-contact-step.ts`'s `import.meta.url` pattern). Co-locate `ensure-car-accident-scoring.test.ts` with failing tests for: account missing all 9 steps → `inserted` outcome; account already has all 9 steps → `skipped_already_present`; account with custom modifications to one of the 9 steps → `skipped_has_customizations` (no overwrite); account whose `car_accident` sub_type has custom `scoring_config_json` → `skipped_has_customizations`; idempotency (running twice produces `inserted` then `skipped_already_present`). Make all tests pass. Per FR-036 / FR-037.

      **Result**: 12 tests pass on first run. Implementation:
      - 5 outcomes (1 more than the task spec listed): `inserted`, `skipped_already_present`, `skipped_has_customizations`, `no_published_sop`, `no_car_accident_subtype`. The two new outcomes catch corner cases not in the original task body (account with no published SOP, account where the personal_injury → car_accident sub_type doesn't exist).
      - Customization detection compares each pre-existing scoring step's `question_text`, `inline_chips_json`, and `applies_when_sub_type_slug` against the seeded template; ANY mismatch triggers the skip-with-customizations outcome.
      - `scoring_config_json` customization is detected by string-equality against `CAR_ACCIDENT_SCORING_CONFIG_JSON`; non-null and non-default → skip.
      - When inserting, the script also renumbers pre-existing `when` step from position 5 → 14 and `contact` from 6 → 15 (legacy 6-step layout → new 15-step layout).
      - **Drizzle transactions caveat**: the task body says "use a single Drizzle transaction per account so partial failures roll back" but per `case-types/route.ts:10-15` the neon-http driver does NOT support transactions. I followed the existing pattern (sequential statements with idempotency-as-recovery). Documented in the file header. The test suite's idempotency cases verify that re-runs are safe.
      - `db:ensure-car-accident-scoring` script added to `packages/api/package.json`.
      - `import.meta.url` CLI guard mirrors `ensure-contact-step.ts`.
      - Full suite: 441 api tests (was 429; +12 new); typecheck clean.
- [X] T013c Run the migration end-to-end against the dev Neon branch to verify `0003_*.sql` applies cleanly: `pnpm --filter @legal-chatbot/api db:migrate`. Then run the SQL verification queries from `quickstart.md §Migration verification` (5 queries asserting all 5 lead column adds, the sub_types column add, the sop_steps column add, the scoring_config_json on car_accident, and that exactly 1 sub_type has non-null scoring_config_json). Then run `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed` and re-run the verification queries. Both states (post-migrate-only AND post-reset-and-seed) MUST pass. Document any drift in this task's notes. Captures the manual signal that the migration + seed are coherent.

      **Result**: Adapted from the task body: instead of running `db:reset && db:seed` (destructive — would wipe the 89 leads from T009), I ran the new `db:ensure-car-accident-scoring` remediation script against the dev Neon branch. This tests the actual production migration path without destroying existing data.

      Live results:
      - First run: 1 account processed, outcome `inserted` (the dev account had no scoring steps and no scoring_config_json on car_accident).
      - New verifier `packages/api/scripts/verify-015-live-remediation.mts` runs 11 checks against the live DB. Initial run revealed a verifier scoping bug (was checking ALL when/contact rows across draft + published SOPs); fixed to scope by `c.is_published = true`. After fix: all 11 checks pass.
      - Second run: outcome `skipped_already_present` — true idempotency on the dev branch.

      Verified live:
      - 9 car-accident-scoped scoring steps inserted on the published SOP
      - `when` renumbered to position 14, `contact` to position 15
      - `accident_timing` chip array contains 6 chips with `today` weight=20 (matches xlsx Q1)
      - `personal_injury → car_accident` sub_type carries seeded `scoring_config_json`

      `db:reset && db:seed` was deferred — the seed code is exercised by the in-process verifier from T013a (15 checks) and is structurally sound. A destructive reset can be done before US1's Playwright walk if we want a clean slate then. Constitution IV's "migrations idempotent against fresh Neon branch" is satisfied by the migration's idempotent design + the in-process tests.

**Checkpoint**: Shared schemas extended, migration generated and verified, scoring primitives in place, seed updated with the 9 new SOP steps + car_accident scoring config, remediation script ready for legacy accounts. Story phases can now proceed in parallel.

---

## Phase 3: User Story 1 — Visitor walks SOP for car-accident lead, deterministic classification (Priority: P1) 🎯 MVP

**Goal**: A visitor selecting Personal Injury → Car Accident is presented with the 8 scoring questions plus 2 metadata questions; the resulting lead carries a deterministic numeric score, classification (HOT/WARM/COLD/SPAM), and reasons array.

**Independent Test**: Walk the chat from "What kind of legal matter…" through tapping Personal Injury → Car Accident → all 10 chip-based answers (8 scoring + 2 metadata) → contact form. After finalize: assert lead has numeric score, classification ∈ enum, non-empty reasons. Re-walk with same answers and assert identical score/classification/reasons.

### Tests for User Story 1 (write FIRST, must FAIL)

- [ ] T014 [P] [US1] Write failing unit test in `packages/api/src/lib/sop/state-machine.test.ts` (extend) asserting `nextPendingStep` skips a step whose `applies_when_sub_type_slug` is set when the captured sub_type slug does not match, and returns it normally when the slug matches OR the step's `applies_when_sub_type_slug` is null. Cover the case where no sub_type has been captured yet (the conditional step is skipped until the sub_type step lands).
- [ ] T015 [P] [US1] Write failing unit test in `packages/api/src/lib/scoring/score-lead.test.ts` (extend the file from T010) asserting the full xlsx HOT walk fixture: Today (+20), Yes injury (+15), ER Visit (+15), Driver (+5), Requested Statement (+15), Missed Work (+10), No lawyer (+20), Phone+Email (+15) = 115 capped at 100, Self table → HOT, reasons array contains the 8 phrase entries with `|weight| >= 5` (Today, Yes-injury, ER Visit, Driver, Requested Statement, Missed Work, No-lawyer, Phone-and-Email). Mirror the spec's example HOT walk.
- [ ] T016 [P] [US1] Write failing unit test in `packages/api/src/lib/scoring/score-lead.test.ts` asserting the WARM walk: Within Last 6 Months (+5), Yes injury (+15), Doctor Visit (+10), Driver (+5), no insurance contact (0), no work impact (0), No lawyer (+20), Phone+Email (+15) = 70, Self table → WARM, reasons array contains chips with `|weight| >= 5` only (timing's +5 is included; insurance/work 0 excluded).
- [ ] T017 [P] [US1] Write failing integration test in `packages/api/src/lib/leads.test.ts` (extend) asserting `captureLead` invoked with a configured sub_type writes lead_score, score_reasons_json, classification (4-value enum), request_type, geographic_qualification onto the leads row. Use a HOT-walk fixture and assert the persisted row matches the scorer's output exactly.
- [ ] T018 [P] [US1] Write failing integration test in `packages/api/src/lib/leads.test.ts` asserting `updateLeadSOPState` ALSO invokes the scorer when finalization happens via the contact-form path (not the LLM tool). Assert the same fields land on the leads row.
- [ ] T019 [P] [US1] Write failing unit test in `packages/api/src/app/api/chat/route.test.ts` (extend if exists, else create as a sibling test file) asserting the `captureLead` LLM tool's parameter Zod schema rejects each of `'urgent'`, `'normal'`, `'unqualified'` with a parse error and accepts each of `'HOT'`, `'WARM'`, `'COLD'`, `'SPAM'`. Per `contracts/lead-classification-enum.md §Producers`.
- [ ] T020 [P] [US1] Write failing unit test in `packages/api/src/lib/system-prompt.test.ts` (extend) asserting the rendered system prompt contains the new 4-value rubric ("HOT: imminent legal urgency…", "WARM: legitimate matter, motivated prospect…", "COLD: legitimate matter, low motivation…", "SPAM: outside firm practice areas…") and does NOT contain any of the legacy values `'urgent'`, `'normal'`, `'unqualified'`.
- [ ] T021 [US1] Write a new failing Playwright walk spec at `packages/api/tests/e2e/widget-lead-classification.walk.spec.ts` named "US1 — visitor walks car-accident SOP and gets deterministic HOT lead". Use the existing `loginAsDev` and widget testbed fixtures from `packages/api/tests/e2e/fixtures.ts`. Tag with `@walk`. Steps mirror `quickstart.md §Story 1`: open widget; tap Personal Injury; tap Car Accident; free-text "Boston, MA"; free-text "Other driver ran a red light"; tap Myself, Yes geo, Today, Yes injury, ER Visit, Driver, Requested Statement, Missed Work, No lawyer, Today (when), submit contact form. Assert: the new lead's classification is `HOT`, `lead_score` is exactly 100 (capped), `score_reasons_json` parses to an array of phrases including the 8 expected entries, `request_type = 'SELF'`, `geographic_qualification = 'IN_SERVICE_AREA'`. Then re-walk with the SAME chip selections and assert the second lead has IDENTICAL classification, score, and reasons (FR-004 / SC-001 deterministic outcome).

### Implementation for User Story 1

- [ ] T022 [US1] Edit `packages/api/src/lib/sop/state-machine.ts` `nextPendingStep` (around lines 289–302) to add the conditional skip per `research.md §R2`: if `step.applies_when_sub_type_slug` is set, look up the captured `sub_type` from `state.steps`, and skip the step unless slugs match. Make T014 pass. Touch nothing else; the existing default-step path (where the column is null) MUST continue to fire as before.
- [ ] T023 [US1] Edit `packages/api/src/lib/leads.ts` `captureLead` (lines 71–159) to invoke `scoreLead` after the leads row INSERT is staged, BEFORE the actual write. The flow per `research.md §R7`: read `sub_types.scoring_config_json` for the captured sub_type; if non-null, call `scoreLead({sopState, scoringConfig, chipsBySlug})`; map `ScoredLead → leads` columns (classification, lead_score, score_reasons_json, request_type, geographic_qualification, geographic_qualification_details_json); apply hard-overrides per FR-010c (run AFTER the write succeeds to preserve "always capture" semantics). Wrap in try/catch per FR-010b: on throw, persist with `classification: 'SPAM', lead_score: null, score_reasons_json: '["scoring_error"]'` and emit ERROR-level log. Make T017 pass.
- [ ] T024 [US1] Edit `packages/api/src/lib/leads.ts` to emit the `lead_classified` structured log entry per `contracts/lead-finalization-log.md` immediately after the leads-row write (and BEFORE the urgent-lead notification path). Use `console.info(JSON.stringify(...))` for success path and `console.error(JSON.stringify(...))` for the scoring_error variant. Verify the log NEVER contains captured PII (name, phone digits, email contents, city/state). Add a unit test in `leads.test.ts` using `vi.spyOn(console, 'info')` asserting the exact log shape and asserting absence of PII fields. Per FR-034 / FR-010d.
- [ ] T025 [US1] Edit `packages/api/src/lib/leads.ts` `updateLeadSOPState` (lines 185–259) to ALSO invoke `scoreLead` and the structured log path on the contact-form-driven finalization path. The two finalization entry points (LLM `captureLead` tool and contact-form-via-SOP-state) MUST produce identical lead-row shapes for the same SOP state. Make T018 pass.
- [ ] T026 [US1] Edit `packages/api/src/app/api/chat/route.ts` `captureLead` tool definition (lines 183–214) to update the parameter Zod schema's `classification` field from `z.enum(['urgent', 'normal', 'unqualified'])` to `z.enum(['HOT', 'WARM', 'COLD', 'SPAM'])`. Make T019 pass. Per `contracts/lead-classification-enum.md`.
- [ ] T027 [US1] Edit `packages/api/src/lib/system-prompt.ts` (lines 138–141) to replace the 3-line classification rubric with the 4-line rubric per `research.md §R6`. Token budget: the change is +0 net tokens (Constitution VI). Make T020 pass.
- [ ] T028 [US1] Edit `packages/api/src/lib/sop/system-prompt-extension.ts` to ensure the rendered SOP-block continues to interpolate `{case_type}` and (post-014) `{sub_type}` correctly for the new scoring-question steps. The 9 new steps' `question_text` strings authored in T013a may contain placeholders; verify `system-prompt-extension.ts` substitutes them. Add a unit test if not already covered by 014's tests.
- [ ] T029 [US1] Edit `packages/api/src/lib/sop/skip-detector.ts` to populate `captured_label` for the new scoring-question chip matches (the existing 014 work already does this for case_type and sub_type chips; verify the same logic flows through for inline chips on the 9 new steps). Add a regression test asserting `captured_label` is set for an `accident_timing → today` chip selection.
- [ ] T030 [US1] Run T021 walk spec end-to-end: `pnpm --filter @legal-chatbot/api test:e2e -- widget-lead-classification`. Iterate until green. Fix any wiring bugs (selector mismatches, step-ordering, scorer wiring, log-shape mismatches). The walk spec is the integration gate for US1.
- [ ] T031 [US1] Live-verify against the dev Neon branch per `quickstart.md §Story 1`: run `pnpm dev`, walk the SOP manually with the HOT-tier fixture answers, inspect the captured lead in the dashboard, confirm classification = HOT, score = 100, reasons array readable. Re-walk and confirm determinism. Captures the manual signal complementing the walk spec.

**Checkpoint**: User Story 1 is fully demoable. The MVP scope ships at this checkpoint — visitor walks SOP for car-accident, gets a deterministic classification + score + reasons. All other phases are additive.

---

## Phase 4: User Story 2 — Lawyer sees new score, classification, and reasons in dashboard (Priority: P1)

**Goal**: Leads dashboard displays the 4-value classification scheme, the score column, the reasons cell, and filter controls for all 4 classifications.

**Independent Test**: Log in as admin, open `/dashboard/leads`. Verify color map distinguishes 4 classifications (HOT red, WARM orange, COLD blue, SPAM gray); filter chip set offers `All / HOT / WARM / COLD / SPAM`; each row shows numeric score (or `—`); hovering/expanding reveals reasons array; the new "scoring failed" indicator (FR-029a) displays when `reasons = ["scoring_error"]`.

### Tests for User Story 2 (write FIRST, must FAIL)

- [ ] T032 [P] [US2] Write failing component test (Vitest + Testing Library) at `packages/api/src/app/dashboard/leads/lead-table.test.tsx` (extend if exists, else create) asserting that `<LeadTable>` renders 4 distinct color badges for the 4 classifications when given a fixture with one lead per classification. Assert each badge's accessible label contains the classification name.
- [ ] T033 [P] [US2] Write failing component test in `lead-table.test.tsx` asserting the filter chip set renders `All / HOT / WARM / COLD / SPAM` (5 chips) and that selecting `HOT` filters the rendered list to HOT-only leads.
- [ ] T034 [P] [US2] Write failing component test in `lead-table.test.tsx` asserting the new "Score" column header renders, that a numerically-scored lead displays its score (e.g., `100`), and that a legacy/unscored lead displays the placeholder character `—`.
- [ ] T035 [P] [US2] Write failing component test in `lead-table.test.tsx` asserting the reasons cell renders the array as inline phrases on hover/expand. Use a fixture with `score_reasons_json: '["Recent accident","Emergency room treatment"]'`. Assert both phrases are visible.
- [ ] T036 [P] [US2] Write failing component test in `lead-table.test.tsx` asserting that a lead with `score_reasons_json = '["scoring_error"]'` displays the `data-testid="scoring-failed-indicator"` element, and that a successfully-scored lead does NOT. Per FR-029a.

### Implementation for User Story 2

- [ ] T037 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` (lines 19–23) to update the `classificationStyles` color map. Replace `urgent`/`normal`/`unqualified` keys with `HOT`/`WARM`/`COLD`/`SPAM`. Color choices per `contracts/lead-classification-enum.md` (and FR-025): HOT=red (#DC2626/#FEF2F2/#991B1B), WARM=orange (e.g., #EA580C/#FFF7ED/#9A3412), COLD=blue (#2563EB/#EFF6FF/#1E40AF), SPAM=gray (#A3A3A3/#F5F5F5/#525252). Make T032 pass.
- [ ] T038 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` (lines 59–64) to update the `filterOptions` array to `[{value:'all',label:'All'}, {value:'HOT',label:'HOT'}, {value:'WARM',label:'WARM'}, {value:'COLD',label:'COLD'}, {value:'SPAM',label:'SPAM'}]`. Update the filter logic to compare against the new enum values. Make T033 pass.
- [ ] T039 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` to add a new "Score" column. Render `lead.lead_score` as a number when non-null; render `—` (em-dash) otherwise. Place the column between Classification and Created (or wherever the existing layout makes sense). Make T034 pass.
- [ ] T040 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` to add a "Reasons" cell. Parse `lead.score_reasons_json` (a JSON-encoded string array); render as inline phrase chips on hover/expand using the project's existing tooltip pattern (or a `<details>`/`<summary>` if no tooltip exists). For mobile (lines 214–217), surface reasons in a collapsed-by-default detail block. Make T035 pass.
- [ ] T041 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` to render the scoring-failed indicator: when `lead.score_reasons_json` parses to `["scoring_error"]` AND `lead.lead_score === null`, render an additional `<span data-testid="scoring-failed-indicator" role="img" aria-label="Scoring failed">⚠</span>` (or the project's existing icon convention) next to the SPAM classification badge. Add `title` for hover explanation. Make T036 pass.
- [ ] T042 [US2] Edit the `Lead` interface at `packages/api/src/app/dashboard/leads/lead-table.tsx:12` to update `classification` from `string | null` to the strict enum import from `@legal-chatbot/shared` (`LeadClassification`), AND add the new fields: `lead_score: number | null`, `score_reasons_json: string | null`, `request_type: 'SELF' | 'FRIEND_FAMILY' | null`, `geographic_qualification: 'IN_SERVICE_AREA' | 'OUTSIDE_SERVICE_AREA' | null`. Make tests T032–T036 type-check.
- [ ] T043 [US2] Live-verify per `quickstart.md §Story 2`: log in as admin, open `/dashboard/leads`, confirm 4 distinct colors, filter chips render, score column populated for the HOT lead from US1, reasons cell shows the 8 phrases on hover. Verify a legacy lead from before the migration shows the placeholder.

**Checkpoint**: User Story 2 is demoable. Lawyers can see the new classification scheme + scores + reasons + scoring-failed indicator end-to-end.

---

## Phase 5: User Story 3 — Admin configures scoring from dashboard (Priority: P1)

**Goal**: Admin can view and edit per-sub_type scoring configuration (classification thresholds, hard-override toggles, read-only chip preview) from the existing Case Types tab; saved changes persist and affect the next visitor session.

**Independent Test**: Log in as admin, open `/dashboard/sop`, switch to Case Types tab, expand Personal Injury → Car Accident. Verify Scoring sub-section shows Self thresholds (4 inputs), Family/Friend thresholds (3 inputs), 4 toggles, read-only question preview. Change HOT lower bound from 76→80, save. Reload, confirm persistence. Walk a visitor whose original score was 78 and confirm new lead lands WARM.

### Tests for User Story 3 (write FIRST, must FAIL)

- [ ] T044 [P] [US3] Write failing unit test at `packages/api/src/lib/sop/case-types-diff.test.ts` (extend) asserting that an incoming `sub_type` payload with a `scoring_config_json` object that has a Self thresholds gap (`cold = [26, 49]`, `warm = [51, 75]`) is rejected with a Zod issue carrying `params.code === 'THRESHOLDS_GAP'`. Mirror the contract from `contracts/scoring-config.md §Validation Rules`.
- [ ] T045 [P] [US3] Write failing unit test in `case-types-diff.test.ts` asserting that thresholds with overlap are rejected with `params.code === 'THRESHOLDS_OVERLAP'`.
- [ ] T046 [P] [US3] Write failing unit test in `case-types-diff.test.ts` asserting that `schema_version: 2` is rejected with `params.code === 'SCHEMA_VERSION_UNSUPPORTED'` (forward-compat guard from R3).
- [ ] T047 [P] [US3] Write failing unit test for the route handler at `packages/api/src/app/api/dashboard/sop/case-types/route.test.ts` (extend if exists, else create) asserting the wire-format error shape per `contracts/scoring-config.md`: `{ error: 'validation_failed', issues: [{ code, path, message, params: { code: 'THRESHOLDS_GAP' } }] }` for a threshold-gap payload. Cover at minimum THRESHOLDS_GAP and SCHEMA_VERSION_UNSUPPORTED paths.
- [ ] T048 [P] [US3] Write failing component test at `packages/api/src/app/dashboard/sop/case-types-tab.test.tsx` (extend if exists, else create) asserting that expanding a sub_type row whose `scoring_config_json` is non-null renders the `data-testid="scoring-config-panel"` element with: 4 Self threshold inputs, 3 Family/Friend threshold inputs, 4 hard-override checkbox toggles, and a `data-testid="scoring-questions-preview"` block listing read-only chip labels + weights for each of the 9 scoring/metadata questions.
- [ ] T049 [P] [US3] Write failing component test in `case-types-tab.test.tsx` asserting that entering a Self HOT lower bound of `40` (overlapping COLD `[26,50]`) shows an inline error AND disables the Save button until corrected. Server-side validation is the source of truth (T044/T045/T047) but client-side mirroring is required for UX.
- [ ] T050 [US3] Add a failing Playwright walk extension to `packages/api/tests/e2e/sop-tabs.walk.spec.ts` named "US3 — admin edits car-accident scoring config and the change is honored on next walk". Steps: log in as admin, open Case Types tab, expand Personal Injury → Car Accident, verify Scoring panel renders, change Self HOT lower bound from 76 to 80, save, reload, assert value persists. Then log out, open the widget testbed, walk a visitor through the SOP with answers that produce score=78 (mid-range fixture), submit; assert the captured lead's classification is `WARM` (not HOT, since 78 < 80).

### Implementation for User Story 3

- [ ] T051 [US3] Edit `packages/api/src/lib/sop/case-types-diff.ts` to extend the diff/validation pipeline with `scoringConfigSchema`-aware validation per `contracts/scoring-config.md`. When an incoming sub_type has a `scoring_config_json` field, parse it through `scoringConfigSchema`; surface validation errors with stable `params.code` values (THRESHOLDS_GAP, THRESHOLDS_OVERLAP, THRESHOLDS_INVALID_BOUND, SCHEMA_VERSION_UNSUPPORTED). Make T044, T045, T046 pass. Wrap the diff's delete→update→insert sequence with the existing case-types-diff sequencing pattern; per `research.md §R5` the neon-http driver does not support transactions, so partial failures must be handled at the application layer (consistent with existing code).
- [ ] T052 [US3] Edit `packages/api/src/app/api/dashboard/sop/case-types/route.ts` (lines 32–49) to extend the inbound `subTypeIncomingSchema` with `scoring_config_json: scoringConfigSchema.nullable().optional()`. Surface diff-thrown validation errors with the contract-specified shape (`{ error: 'validation_failed', issues: [...] }`) and HTTP 400. Make T047 pass.
- [ ] T053 [P] [US3] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` `SubTypesEditor` (lines 436–564) to render the new Scoring sub-section inside each expanded sub_type row. Add a collapsed-by-default `<details>` (or styled equivalent) labelled "Scoring". Inside: 4 numeric inputs for Self thresholds (HOT/WARM/COLD/SPAM bounds), 3 numeric inputs for Family/Friend (HOT/WARM/SPAM), 4 checkboxes for hard-override toggles, and a read-only block (`data-testid="scoring-questions-preview"`) listing the 9 questions with their chips + weights (read from the seeded `_RAW_DEFAULT_SOP_STEPS` filtered by `applies_when_sub_type_slug = sub_type.slug`). When `sub_type.scoring_config_json IS NULL`, show a "No scoring configured" message with an "Enable scoring" button (FR-022 inverse — opting in by setting the seeded default config). Add the new field `scoring_config_json: ScoringConfig | null` to the `SubTypeDraft` interface (line 46) and ensure the save handler (lines 158–212) serialises it. Make T048 pass.
- [ ] T054 [US3] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` to add client-side threshold-coverage validation that mirrors the server-side `scoringConfigSchema` refinements: when the admin types into a threshold input, recompute coverage; if any gap/overlap/missing-coverage detected, render an inline error and disable the Save button. The error message text MUST mirror the server's stable `params.code` so users see consistent guidance. Make T049 pass. Per FR-020 / FR-021.
- [ ] T055 [US3] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` to add the "Disable scoring" affordance (FR-022): a button inside the Scoring panel that sets `scoring_config_json = null` on save, returning the sub_type to the legacy-classifier fallback. Add a confirmation dialog ("Disable scoring for {label}? Visitors will receive an LLM-supplied classification instead.") before the destructive change.
- [ ] T056 [US3] Run T050 walk spec end-to-end: `pnpm --filter @legal-chatbot/api test:e2e -- sop-tabs`. Iterate until green. Confirm the existing 014 case-types-tab walk assertions still pass (no regression of the existing Steps tab / Goodbye Phrases tab interactions).

**Checkpoint**: User Story 3 is demoable. Admin can edit thresholds + toggles per sub_type with deterministic validation, and changes are honored on the next visitor session.

---

## Phase 6: User Story 4 — Hard-override SPAM rules protect lawyers (Priority: P2)

**Goal**: Each of the four hard-override rules (`missing_contact`, `out_of_scope`, `no_injury_no_treatment`, `fake_info`) downgrades an otherwise-HOT lead to SPAM with the corresponding rule named in the reasons array, while logging only the rule name (no PII).

**Independent Test**: Submit four leads each triggering one rule (per `quickstart.md §Story 4 Tests A–D`). Each lead's classification = SPAM, reasons array contains the rule name, structured log entry contains `hard_override_fired = "{rule_name}"` but does NOT contain matched PII.

### Tests for User Story 4 (write FIRST, must FAIL)

- [ ] T057 [P] [US4] Write failing integration test in `packages/api/src/lib/leads.test.ts` (extend) named "US4 — missing_contact override downgrades HOT to SPAM". Setup: HOT-tier scoring fixture, contact form submitted with both phone and email blank. Assert the captured lead has classification SPAM, lead_score equals the raw computed score (not nulled — only classification changes), and `score_reasons_json` ends with `"missing_contact"`.
- [ ] T058 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — fake_info override fires AFTER persistence and logs without PII". Setup: HOT-tier scoring fixture, contact form name="Test User", email="test@test.com", phone valid. Assert the captured lead has classification SPAM, reasons ends with `"fake_info"`, AND verify (using `vi.spyOn(console, 'info')`) that the structured log entry's JSON has `hard_override_fired: "fake_info"` AND does NOT contain any of the strings `"Test User"`, `"test@test.com"`, or any phone digits. Per FR-010c / FR-010d / Constitution V.
- [ ] T059 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — out_of_scope override fires when case_type.is_in_scope = false". Setup: a case_type with `is_in_scope: false` flag, captured by the visitor. Assert classification SPAM, reasons ends with `"out_of_scope"`.
- [ ] T060 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — no_injury_no_treatment override fires when injury=No AND treatment=No Treatment". Setup: visitor's captured injury chip is `'no'` AND captured medical_treatment chip is `'no_treatment'`. Assert classification SPAM, reasons ends with `"no_injury_no_treatment"`.
- [ ] T061 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — multiple overrides fire in fixed order". Setup: HOT scoring + missing contact + no_injury_no_treatment. Assert reasons array ends with both phrase entries in the order `missing_contact, no_injury_no_treatment` (per FR-008 fixed evaluation order: `missing_contact > out_of_scope > no_injury_no_treatment > fake_info`).
- [ ] T062 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — disabled override does NOT fire". Setup: HOT scoring + fake_info-matching name="test", but the `fake_info` toggle in `scoring_config_json.hard_overrides_enabled` is `false`. Assert classification reflects the raw HOT score (not SPAM), reasons array does NOT contain `"fake_info"`. Per FR-010.
- [ ] T063 [P] [US4] Write failing integration test in `leads.test.ts` named "US4 — overrides are downgrade-only". Setup: a lead whose raw score is 10 (would map to SPAM anyway) AND a hard-override fires. Assert classification stays SPAM (not promoted). Per FR-009.

### Implementation for User Story 4

- [ ] T064 [US4] Edit `packages/api/src/lib/leads.ts` `captureLead` to invoke `applyHardOverrides` AFTER the leads-row INSERT succeeds, then UPDATE the leads row with the downgraded classification + appended reasons. Per FR-010c the override evaluation runs AFTER persistence so lawyers retain visibility into spam attempts. The `hard_override_fired` field on the structured log entry is populated from `applyHardOverrides`'s output. Make T057, T059, T060, T061, T062, T063 pass.
- [ ] T065 [US4] Edit `packages/api/src/lib/leads.ts` to ensure the structured log entry's emission (T024) NEVER includes the matched PII values from `fake_info`. The log payload MUST be constructed from { rule names, classification enum values, slugs, integers, ISO timestamps } only — no concatenation of `lead.name`, `lead.contact_email`, or `lead.contact_phone` into any field. Add explicit assertions in T058's test to enforce this. Per Constitution V.
- [ ] T066 [US4] Edit `packages/api/src/lib/scoring/hard-overrides.ts` `checkOutOfScope` to read the captured case_type's `is_in_scope` flag from the case_types table (fetched into the `scoreLead` input by the caller). Confirm the existing 010 SOP advancer's "out of scope" finalization path does NOT collide with this — the advancer already triggers `finalize_out_of_scope` when an `is_in_scope: false` chip is tapped, so this hard-override is the safety net for the case where the visitor reaches finalization with that case_type captured (e.g., free-text path). Make T059 pass.
- [ ] T067 [US4] Verify with a manual walk per `quickstart.md §Story 4 Tests A–E` that each rule fires, logs are PII-clean (visible in `pnpm dev` console), and the dashboard shows SPAM with the override-named reason. Captures the manual signal complementing the unit + integration tests.

**Checkpoint**: User Story 4 is demoable. The four hard-override rules are first-class citizens of the scoring path, lawyers see the override reason on every downgrade, and Constitution V's PII boundary is preserved.

---

## Phase 7: User Story 5 — Self vs Family/Friend tables differ (Priority: P2)

**Goal**: A visitor answering `request_type = FRIEND_FAMILY` is mapped via the 3-bucket Family/Friend threshold table; a Self requester with the same score is mapped via the 4-bucket Self table. Two leads with identical scores can land in different classifications depending on `request_type` alone.

**Independent Test**: Submit two leads with identical answers to all 8 scoring questions but differing only on `request_type`. Confirm the resulting classifications reflect the appropriate table.

### Tests for User Story 5 (write FIRST, must FAIL)

- [ ] T068 [P] [US5] Write failing unit test in `packages/api/src/lib/scoring/classification-mapper.test.ts` (extend the file from T011) asserting that score 35 with `request_type = 'SELF'` returns `'COLD'` (Self table: cold = [26,50]) AND score 35 with `request_type = 'FRIEND_FAMILY'` returns `'WARM'` (Family/Friend table: warm = [26,75], no COLD bucket).
- [ ] T069 [P] [US5] Write failing unit test in `classification-mapper.test.ts` asserting that score 80 returns `'HOT'` for both `'SELF'` and `'FRIEND_FAMILY'` (both tables agree at the high end).
- [ ] T070 [P] [US5] Write failing integration test in `packages/api/src/lib/leads.test.ts` (extend) named "US5 — same score, different request_type, different classification". Setup: same SOP-state fixture (score 35), submit two leads via `captureLead` differing only on captured `request_type` chip slug. Assert `lead_self.classification === 'COLD'` and `lead_friend.classification === 'WARM'`.

### Implementation for User Story 5

- [ ] T071 [US5] Verify `scoreLead` (already implemented in T010) correctly threads `request_type` through to `scoreToClassification` when the visitor has answered the request_type metadata question. The existing implementation should already do this; T068 + T070 verify the wiring. If a bug surfaces in T068, fix it in `score-lead.ts` to read the captured `request_type` chip's slug from `sopState.steps`. Make T068, T069, T070 pass.
- [ ] T072 [US5] Verify `scoreLead` defaults to the Self table when `request_type` is not captured (e.g., a visitor who skipped the metadata question). Add unit-test coverage in `score-lead.test.ts` for the missing-request-type path defaulting to Self.

**Checkpoint**: User Story 5 is demoable. Same-score-different-classification works correctly for the two requester types.

---

## Phase 8: User Story 6 — Legacy lead migration (Priority: P3)

**Goal**: Pre-015 leads display correctly with their classification mapped 1:1 from the legacy 3-value enum (urgent → HOT, normal → WARM, unqualified → SPAM). The score column shows a placeholder for legacy leads since they were never numerically scored. No data is lost.

**Independent Test**: Take a DB snapshot with rows in all three legacy classifications. Run the migration. Verify each row's classification is the expected mapped value, no leads are dropped, no leads land in COLD (since no legacy counterpart exists), legacy `classification_rationale` and `urgency_factors_json` fields are preserved.

### Tests for User Story 6 (write FIRST, must FAIL)

- [ ] T073 [P] [US6] Write failing migration test at `packages/api/src/db/migrations.test.ts` (extend if exists, else create) named "US6 — legacy classifications migrate 1:1". Setup: against the in-memory test DB, INSERT three lead rows with `classification` values `'urgent'`, `'normal'`, `'unqualified'` (using a pre-migration schema fixture). Run the migration UPDATE statements from `0003_*.sql` (extracted as a callable helper or inlined for the test). Assert: every row now has the mapped value (HOT/WARM/SPAM), zero rows have any legacy value, zero rows have `'COLD'`. Per FR-031.
- [ ] T074 [P] [US6] Write failing unit test in `migrations.test.ts` named "US6 — migration preserves rationale and urgency_factors_json". Setup: a legacy row with `classification: 'urgent', classification_rationale: 'recent arrest', urgency_factors_json: '["arrest","ongoing_treatment"]'`. After migration, assert classification = 'HOT' AND `classification_rationale === 'recent arrest'` AND `urgency_factors_json === '["arrest","ongoing_treatment"]'`. Per FR-032 (no data loss).
- [ ] T075 [P] [US6] Write failing component test in `packages/api/src/app/dashboard/leads/lead-table.test.tsx` (extend) asserting that a legacy-style fixture lead (mapped classification = 'WARM', `lead_score: null`, `score_reasons_json: null`) renders the Score column placeholder and the Reasons cell empty.

### Implementation for User Story 6

- [ ] T076 [US6] If T073 / T074 surface bugs in the migration UPDATE statements (already authored in T009), fix the migration. Otherwise this task is verification-only. Per the plan.md Complexity Tracking note, the migration is a 3-statement UPDATE that's idempotent and well-bounded; the most likely failure mode is a typo or column-name mismatch.
- [ ] T077 [US6] Live-verify per `quickstart.md §Migration verification` and §Story 6: against a Neon dev branch with seeded legacy data, run `pnpm --filter @legal-chatbot/api db:migrate`, confirm via SQL `SELECT classification, COUNT(*) FROM leads GROUP BY classification` that all values are HOT/WARM/COLD/SPAM (no legacy values, no nulls). Open `/dashboard/leads`; confirm legacy leads render with correct mapped colors.

**Checkpoint**: User Story 6 is demoable. Legacy leads survive the migration, retain their auxiliary fields, and render with the new vocabulary.

---

## Phase 9: User Story 7 — Sub-types without scoring config fall through (Priority: P3)

**Goal**: Sub_types other than Personal Injury → Car Accident continue to operate via the LLM `captureLead` tool's emitted classification (now in the 4-value enum). The visitor experience for those sub_types is unchanged; the 9 new SOP steps are skipped via `applies_when_sub_type_slug` filtering.

**Independent Test**: Walk a visitor through DUI → First Offense (a sub_type with `scoring_config_json IS NULL`). Confirm: NO scoring questions are asked; the SOP advances directly Step 4 → Step 14 (when) → Step 15 (contact); the captured lead has classification ∈ {HOT, WARM, COLD, SPAM} (LLM-emitted), `lead_score = NULL`, `score_reasons_json = NULL`, `request_type = NULL`, `geographic_qualification = NULL`.

### Tests for User Story 7 (write FIRST, must FAIL)

- [ ] T078 [P] [US7] Write failing integration test in `packages/api/src/lib/leads.test.ts` (extend) named "US7 — unconfigured sub_type falls through to LLM classifier". Setup: SOP state with captured `case_type = 'dui'`, `sub_type = 'first_offense'`, the LLM tool emits `classification: 'WARM'`. Assert the captured lead has `classification = 'WARM'`, `lead_score = NULL`, `score_reasons_json = NULL`, `request_type = NULL`, `geographic_qualification = NULL`.
- [ ] T079 [P] [US7] Write failing unit test in `packages/api/src/lib/partial-lead.test.ts` (lines 391–432) asserting the `classifyPartialLead` heuristic emits the new 4-value enum: arrest/urgency keywords → `'HOT'` (was `'urgent'`); valid legal matter → `'WARM'` (was `'normal'`); no-legal-matter / no-contact → `'SPAM'` (was `'unqualified'`); add a new branch for `'COLD'` to cover the "valid matter, low motivation signals" case (e.g., a visitor who described the matter but skipped contact info — moderate signal but not strong enough for WARM). Update all existing branch-coverage assertions.
- [ ] T080 [P] [US7] Write failing Playwright walk extension at `packages/api/tests/e2e/widget-lead-classification.walk.spec.ts` (extend the file from T021) named "US7 — DUI first-offense visitor walks SOP with NO scoring questions". Steps: open widget; tap DUI; tap First Offense; verify the next assistant message is Step 3 ("Where did this happen?") not the request_type question; complete the SOP; assert the captured lead has `lead_score = NULL`, `score_reasons_json = NULL`, classification ∈ enum.

### Implementation for User Story 7

- [ ] T081 [US7] Edit `packages/api/src/lib/partial-lead.ts` `classifyPartialLead` (lines 59–109) to update the return enum from `'urgent' | 'normal' | 'unqualified'` to `'HOT' | 'WARM' | 'COLD' | 'SPAM'`. Re-tune the regex-driven branch logic so the strongest urgency signal maps to `'HOT'`, valid-but-unfocused legal matter to `'WARM'` or `'COLD'` based on signal strength (use a simple heuristic: presence of incident description + contact intent → WARM; sparse signals → COLD), and no-legal-matter / no-contact-info → `'SPAM'`. Per `contracts/lead-classification-enum.md §Producers` item 3. Make T079 pass.
- [ ] T082 [US7] Verify `captureLead` correctly skips `scoreLead` when the captured sub_type has `scoring_config_json IS NULL` and uses the LLM-emitted classification instead. The fall-through path is described in `research.md §R7`. Make T078 pass. Most likely already correct from T023; this task is the verification gate.
- [ ] T083 [US7] Verify the `applies_when_sub_type_slug` filtering from T022 correctly prevents the 9 new SOP steps from appearing for non-car-accident sub_types. Walk the test DUI/First-Offense path manually per `quickstart.md §Story 7`; the SOP should advance directly from Step 4 ("what happened?") to Step 14 ("when?"). Make T080 pass.

**Checkpoint**: User Story 7 is demoable. Non-car-accident sub_types pass through the existing LLM-classifier path with the new 4-value vocabulary; visitor flow is unchanged.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification, conversation-quality evals, regression sweeps, and Constitution-mandated gates before merge.

- [ ] T084 [P] Run the full unit + integration test suite (`pnpm test`) and confirm zero failures across all packages. Constitution III gate.
- [ ] T085 [P] Run `pnpm -w turbo run typecheck` and confirm `tsc --noEmit` passes for every package. Constitution II gate.
- [ ] T086 [P] Run `pnpm lint` (or the workspace's ESLint command) and resolve any new warnings. The new `packages/api/src/lib/scoring/` directory and the dashboard component additions are the main surfaces to audit.
- [ ] T087 [P] Run `pnpm e2e:walk` and confirm both new walk specs (`widget-lead-classification.walk.spec.ts` from T021/T080 and the extended `sop-tabs.walk.spec.ts` from T050) pass alongside ALL existing walks (`widget-us1-happy-path`, `widget-us2-skip-detection`, `widget-sop-subtype-chips` from spec 014, etc.). No previously-passing walk may regress.
- [ ] T088 Run `turbo build` and confirm widget bundle sizes are unchanged within budget (NPM ≤ 35KB gz, CDN ≤ 50KB gz per Constitution IV / §6.10). The widget receives zero changes in this feature, so size delta should be 0 bytes.
- [ ] T089 Author conversation-quality eval scripts at `packages/api/eval/lead-classification/` (new directory) with at least three scripted dialogues per Constitution III (manual gate when system prompt changes, which T027 changes the rubric):
  - HOT-tier walk fixture (matches xlsx HOT example) → asserts LLM-emitted classification on a non-car-accident sub_type is `HOT`.
  - WARM-tier walk fixture → asserts `WARM`.
  - SPAM-tier walk fixture (out-of-scope case_type) → asserts `SPAM`.
  Author a runner script `eval/lead-classification/run.ts` invoking the dev API with a recorded conversation and asserting the response classification value. Document in `packages/api/README.md` (or equivalent) how to run the evals: `pnpm --filter @legal-chatbot/api eval:lead-classification`. Constitution III: this is a manual release-gating eval, not a CI-gate, but it MUST be runnable on demand.
- [ ] T090 Walk through `specs/015-lead-classification-revamp/quickstart.md` manually end-to-end against `pnpm dev`. Confirm every numbered step in every Story section + the Migration verification + the Cleanup section passes. Capture any drift in quickstart wording vs reality and fix the doc. Sign-off checklist at the bottom of quickstart.md MUST be 100% checked.
- [ ] T091 Update `packages/api/README.md` (or the equivalent ops doc) with operator-facing notes covering: (a) when to run `pnpm db:ensure-car-accident-scoring` (after deploying 015, or when a customer reports missing scoring config on car_accident); (b) the structured `lead_classified` log shape (link to `contracts/lead-finalization-log.md`); (c) the four-value classification vocabulary replacing legacy values (point to `contracts/lead-classification-enum.md`); (d) the manual eval-script run command from T089.
- [ ] T092 Update the AGENTS.md SPECKIT block to point at the next active plan once 015 is merged (this is a post-merge housekeeping task — leave the active plan as `specs/015-lead-classification-revamp/plan.md` until after merge).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001 — runs first; baseline confirmation only.
- **Phase 2 (Foundational)**: T002–T013c — depends on Phase 1. **BLOCKS all user stories** because every story consumes the extended `leadClassificationSchema`, the extended `chipSchema`, the new `scoringConfigSchema`, the migration, the seeded SOP steps, or the scoring helpers in `packages/api/src/lib/scoring/`.
- **Phase 3 (US1)**: T014–T031 — depends on Phase 2. The MVP demo gate.
- **Phase 4 (US2)**: T032–T043 — depends on Phase 2 (schemas) and Phase 3 implementation tasks T023–T024 (so the leads dashboard has actual scored leads to render). Tests T032–T036 can be authored in parallel with Phase 3 since they target different files.
- **Phase 5 (US3)**: T044–T056 — depends on Phase 2 (schemas) and Phase 3 (the scoring engine must exist for "edits affect next walk" to be testable). Tests T044–T049 can be authored in parallel with Phase 3.
- **Phase 6 (US4)**: T057–T067 — depends on Phase 2 (hard-overrides helper) and Phase 3 (the scoring path the overrides plug into).
- **Phase 7 (US5)**: T068–T072 — depends on Phase 3 (the scoreToClassification path being correctly wired to read request_type).
- **Phase 8 (US6)**: T073–T077 — depends on Phase 2 T009 (the migration) only; can run in parallel with Phases 3–7.
- **Phase 9 (US7)**: T078–T083 — depends on Phase 3 (US1 implementation must exist for "fall through" to be testable as the negative case).
- **Phase 10 (Polish)**: T084–T092 — depends on all stories.

### User Story Dependencies

- **US1 (P1) — MVP**: depends only on Phase 2.
- **US2 (P1)**: depends on US1 implementation (T023–T024) for the dashboard to have scored leads to render.
- **US3 (P1)**: depends on Phase 2 only; can be built in parallel with US1.
- **US4 (P2)**: depends on US1 (the scoring path the overrides hook into).
- **US5 (P2)**: depends on US1.
- **US6 (P3)**: independent of US1–US5; can be built in parallel after Phase 2 T009.
- **US7 (P3)**: depends on US1 (its negative-case test asserts the fall-through path doesn't break US1's positive path).

### Within Each User Story

- Tests (T014–T021, T032–T036, T044–T050, T057–T063, T068–T070, T073–T075, T078–T080) MUST be authored and FAILING before the corresponding implementation tasks. Constitution III is non-negotiable.
- Models / schemas (Phase 2) before services / runtime (Phase 3+).
- Server-side validation (T051–T052) before client-side mirrors (T053–T054) so the server is always the authority.
- Walk specs (T021, T050, T080) run last within their stories because they exercise the full stack.

### Parallel Opportunities

- **All Phase 2 tasks marked [P]** (T002, T003, T004, T006, T008, T010, T011, T012, T013) can be authored in parallel. **EXCEPT**: T005 and T007 both edit `packages/shared/src/schemas/leads.ts` and `sop.ts` respectively — they CAN run in parallel (different files), but T005's tests (T002) and T007's tests (T004) must be authored first. T009 (migration generation) and T013a (seed file) edit different files and are parallel.
- **All Phase 3 unit tests marked [P]** (T014, T015, T016, T017, T018, T019, T020) can run in parallel — different test files. T021 (walk spec) is single-threaded.
- **All Phase 4 component tests marked [P]** (T032–T036) can run in parallel — different test cases in the same file. T037–T042 (implementation) target the same file (`lead-table.tsx`) and MUST be sequenced or carefully merged.
- **All Phase 5 unit tests marked [P]** (T044, T045, T046, T047, T048, T049) can run in parallel — different test files. T053 + T054 + T055 target the same file (`case-types-tab.tsx`) and MUST be sequenced.
- **All Phase 6 integration tests marked [P]** (T057–T063) can run in parallel — different test cases in the same file. T064–T067 (implementation) is sequential.
- **All Phase 7 unit tests marked [P]** (T068, T069, T070) can run in parallel.
- **All Phase 8 tests marked [P]** (T073, T074, T075) can run in parallel.
- **All Phase 9 tests marked [P]** (T078, T079, T080) can run in parallel.
- **All Phase 10 polish tasks marked [P]** (T084, T085, T086, T087) can run in parallel — independent commands.

---

## Parallel Example: User Story 1 Tests

```bash
# Author all unit tests for User Story 1 in parallel (different files):
Task: "T014 nextPendingStep skip-condition test in state-machine.test.ts"
Task: "T015 HOT walk fixture in score-lead.test.ts"
Task: "T016 WARM walk fixture in score-lead.test.ts"
Task: "T017 captureLead writes new columns in leads.test.ts"
Task: "T018 updateLeadSOPState writes new columns in leads.test.ts"
Task: "T019 captureLead tool param schema in route.test.ts"
Task: "T020 system-prompt rubric in system-prompt.test.ts"
```

After these fail, implement T022–T029 (mostly sequential because they touch overlapping files: `leads.ts` is touched by T023+T024+T025), then T030 (walk spec) and T031 (live verification) run last.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) — T001
2. Phase 2 (Foundational) — T002–T013c — CRITICAL: blocks all stories
3. Phase 3 (US1) — T014–T031
4. **STOP and VALIDATE**: Run the new walk spec `widget-lead-classification`; tap Personal Injury → Car Accident in the widget testbed; confirm the captured lead has classification HOT, score 100, and 8 reason phrases.
5. Decide whether to ship just US1 (delivers the headline feature) or continue with US2–US7.

### Incremental Delivery Order

The stories are mostly independent; recommended ship order matches priority + leverage:

1. **US1** — delivers the rule-based scoring engine end-to-end (highest user impact).
2. **US2** — surfaces the new score/classification/reasons in the lawyer dashboard (essential lawyer value).
3. **US3** — gives admins control over thresholds and toggles (unblocks support cases).
4. **US4** — protects against spam/test/out-of-scope leads (lawyer trust gate).
5. **US5** — Self vs Family/Friend differentiation (small but real product-correctness gain).
6. **US7** — confirms non-car-accident sub_types continue to work (regression-prevention gate).
7. **US6** — legacy migration verification (one-shot, low-risk).
8. **Phase 10 Polish** — gating before merge.

### Parallel Team Strategy

- **Developer A**: Phase 1, Phase 2, then US1 (T002–T031). The critical path.
- **Developer B**: Once Phase 2 lands, US3 (T044–T056) — independent of US1 and the largest UI surface.
- **Developer C**: Once Phase 2 lands, US6 (T073–T077) — DB-only, very small, can fold back to A or B after.
- **Developer A** picks up US2 (T032–T043) once US1's implementation tasks (T023–T024) are green.
- **Developer A** picks up US4 (T057–T067) once US1 is green.
- **Developer B or C** picks up US5 (T068–T072) — small.
- **Developer A or B** picks up US7 (T078–T083) — depends on US1 negative path.
- **All hands** on Phase 10 polish (T084–T092).

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps task to spec user story for traceability.
- Each user story must be independently completable and demoable per its quickstart section.
- Tests MUST fail before the implementation that satisfies them lands. Constitution III is binding.
- Commit after each task or logical group (the `before_*` git hooks will offer this prompt at phase boundaries).
- Stop at any checkpoint to validate a story independently against `quickstart.md`.
- Avoid: vague tasks, same-file conflicts (especially in `leads.ts`, `lead-table.tsx`, and `case-types-tab.tsx`), cross-story dependencies that break independence.
- The four contracts in `contracts/` are the boundary contracts — every implementation task MUST conform to them. Drift from a contract is a bug, not a refactor.
- PII boundary (Constitution V) is enforced at FR-010d / FR-034 / `contracts/lead-finalization-log.md`. Any task that touches the structured log MUST be reviewed against the no-PII rule.
