# Tasks: Fix SOP Case Sub-Type Chips

**Input**: Design documents from `/specs/014-fix-sop-case-subtypes/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Required per Constitution III (NON-NEGOTIABLE) — every feature task that produces production code MUST have at least one failing test written first.

**Organization**: Tasks are grouped by user story (US1–US4) so each story can be completed and demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Maps task to spec user story (US1, US2, US3, US4)
- All paths are repo-relative (e.g., `packages/api/src/lib/sop/...`)

## Path Conventions

This is a pnpm + Turborepo monorepo. All work lands in three existing packages:

- `packages/shared` — shared Zod schemas
- `packages/api` — Next.js API + dashboard + DB + tests
- `packages/widget` — embeddable chat widget

No new workspace packages, no SQL migration, no new top-level directories.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No project initialization needed (existing monorepo). Confirm environment is healthy before starting.

- [ ] T001 Verify `pnpm install` completes cleanly on branch `014-fix-sop-case` and all existing tests pass (`pnpm test` and `pnpm -w turbo run typecheck`). Establishes a green baseline before introducing any code change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema-level extensions that all four user stories consume. Per Constitution II, shared schemas must be the single source of truth, so these land first.

**⚠️ CRITICAL**: User stories MUST NOT begin until Phase 2 completes — every story consumes at least one of these shared types or helpers.

- [ ] T002 [P] Write failing unit test in `packages/shared/src/schemas/sop.test.ts` (extend if exists, otherwise create) asserting that `SOPStateStep` parses payloads with and without the new optional `captured_label` field, defaulting to `null` when absent, and rejects non-string non-null values.
- [ ] T003 Extend `packages/shared/src/schemas/sop.ts` to add `captured_label: z.string().nullable().optional().default(null)` to `SOPStateStep`. Make T002 pass. Re-export the inferred type unchanged externally.
- [ ] T004 [P] Write failing unit test in `packages/shared/src/schemas/sop.test.ts` asserting `sopStateHeaderPayloadSchema` accepts payloads with and without `captured_case_type_label` and rejects non-string non-null values.
- [ ] T005 Extend `packages/shared/src/schemas/sop.ts` to add `captured_case_type_label: z.string().nullable().optional().default(null)` to `sopStateHeaderPayloadSchema`. Make T004 pass.
- [ ] T006 [P] Create new helper file `packages/api/src/lib/sop/case-type-label.ts` exporting a pure function `resolveCaseTypeLabel(slug: string | null, caseTypes: CaseType[]): string | null` that returns the matching case-type label, or `null` if slug is `null` or not found. Co-locate `case-type-label.test.ts` with three failing tests (null slug, found, not found); make them pass in the same task.
- [ ] T007 [P] Create new helper file `packages/api/src/lib/sop/derive-slug.ts` exporting `deriveSlugFromLabel(label: string): string` implementing the rule from data-model.md (lowercase ASCII-fold, non-`[a-z0-9]` runs → `_`, strip leading digits, assert against `^[a-z][a-z0-9_]*$` and throw `SlugDerivationError` on failure). Co-locate `derive-slug.test.ts` with failing tests covering: typical label "First Offense" → `first_offense`, label with punctuation/accents → folded slug, all-non-alpha label → throws, leading digit → stripped or throws per the rule, empty/whitespace label → throws. Make all tests pass.

**Checkpoint**: Shared schemas extended, helper functions in place. Story phases can now proceed in parallel.

---

## Phase 3: User Story 1 — Visitor sees correct sub-type chips after picking a case type (Priority: P1) 🎯 MVP

**Goal**: When a visitor picks a case type (chip-tap or free-text), the next chip row shows that case type's sub-types only — never case-type chips re-rendered.

**Independent Test**: Walk the widget end-to-end: tap **DUI** → assert next chip row contains `First Offense`, `Repeat Offense`, `DUI with Injury`, `DUI with Property Damage` and zero case-type labels. Repeat for Personal Injury and Drug Crime.

### Tests for User Story 1 (write FIRST, must FAIL)

- [ ] T008 [P] [US1] Write failing unit test in `packages/api/src/lib/sop/skip-detector.test.ts` extending the existing `matchCaseTypeChip` cases to assert that the returned `SkipDetectorMatch` now carries `captured_label` equal to `ct.label` (not `null`) for both exact-slug and substring-label match paths.
- [ ] T009 [P] [US1] Write failing unit test in `packages/api/src/lib/sop/skip-detector.test.ts` asserting `matchSubTypeChip` returns `captured_label` equal to `st.label` for both exact-slug and substring-label match paths.
- [ ] T010 [P] [US1] Write failing unit test in `packages/api/src/lib/sop/skip-detector.test.ts` asserting that the `inferCaseTypeFromSubType` emission path includes `captured_label` for the synthesized case_type match.
- [ ] T011 [P] [US1] Write failing unit test in `packages/api/src/lib/sop/system-prompt-extension.test.ts` asserting that when the SOP block renders Step 2 with `case_type` already captured (slug `dui`, label `DUI`), the rendered `question_text` substitutes `{case_type}` → `DUI` and contains no literal `{case_type}` token. Cover the passthrough case (no captured case type) where the placeholder remains intact.
- [ ] T012 [P] [US1] Write failing unit test for `buildSOPStateHeader` in `packages/api/src/app/api/chat/route.test.ts` (extend if exists, else create as `buildSOPStateHeader.test.ts` next to the route or in a sibling helper). Assert that when the case_type step is `complete` and the captured slug resolves in `caseTypes`, the header's `captured_case_type_label` equals the live label; when slug refers to a deleted case type, `captured_case_type_label` is `null`; when case_type step is pending, it is `null`.
- [ ] T013 [P] [US1] Write failing unit test in `packages/widget/src/hooks/computeActiveChips.test.ts` (extend or create) asserting: pending step `sub_type` + `capturedCaseTypeSlug='dui'` + DUI in `caseTypes` returns DUI's sub_types in `position` order; pending step `sub_type` with no captured slug returns `[]`; pending step `sub_type` with captured slug not in `caseTypes` (deleted) returns `[]`.
- [ ] T014 [US1] Write a new failing Playwright walk spec at `packages/api/tests/e2e/widget-sop-subtype-chips.walk.spec.ts` named "US1 — visitor sees DUI sub-type chips after tapping DUI". Use the existing `loginAsDev` and widget testbed fixtures from `packages/api/tests/e2e/fixtures.ts`. Tag with `@walk`. Steps: open widget, wait for case-type chips, tap `DUI`, wait for next assistant message, assert the chip row's accessible labels are exactly `['First Offense', 'Repeat Offense', 'DUI with Injury', 'DUI with Property Damage']` in that order, and that none of `['DUI','Personal Injury','Drug Crime','Criminal Defense','Family Law','Estate Planning']` appear in the chip row. Also assert the assistant text contains the literal string `DUI` (not `{case_type}`).

### Implementation for User Story 1

- [ ] T015 [P] [US1] Edit `packages/api/src/lib/sop/skip-detector.ts` `matchCaseTypeChip` (around lines 276–306) to populate `captured_label: ct.label` on every emitted `SkipDetectorMatch`. Make T008 pass. Do NOT alter `captured_value` (must remain `ct.slug`).
- [ ] T016 [P] [US1] Edit `packages/api/src/lib/sop/skip-detector.ts` `matchSubTypeChip` (around lines 309–343) to populate `captured_label: st.label` on every emitted match. Make T009 pass.
- [ ] T017 [US1] Edit `packages/api/src/lib/sop/skip-detector.ts` so the `inferCaseTypeFromSubType` emission path (around lines 113–128) includes `captured_label` for the synthesized case_type match by looking up `ct.label` for the inferred slug. Make T010 pass. Depends on T015 (extends the same emission shape).
- [ ] T018 [US1] Extend the `SkipDetectorMatch` type (likely in `packages/api/src/lib/sop/skip-detector.ts` or shared types) to include the new `captured_label` field. Update the advancer call site in `packages/api/src/lib/sop/advancer.ts` (around lines 128–145) to forward `m.captured_label` into the `capture_step` action. Update the state-machine reducer in `packages/api/src/lib/sop/state-machine.ts` to write `captured_label` onto the SOP state step when applying `capture_step`. Existing tests continue to pass; the new schema field default (`null`) means non-chip captures still serialize cleanly.
- [ ] T019 [US1] Edit `packages/api/src/lib/sop/system-prompt-extension.ts` (around line 102 where `earliestPending.question_text` is rendered) to add a deterministic interpolation step: replace `{case_type}` with the captured case-type label looked up via `resolveCaseTypeLabel` (T006). When no label is available, leave the placeholder intact (LLM remains the fallback). Make T011 pass.
- [ ] T020 [US1] Edit `packages/api/src/app/api/chat/route.ts` `buildSOPStateHeader` (around lines 47–60) to populate the new `captured_case_type_label` field by calling `resolveCaseTypeLabel` against the captured slug and the freshly loaded `caseTypes` array. Make T012 pass.
- [ ] T021 [US1] Add a JSDoc cross-reference comment in `packages/widget/src/hooks/computeActiveChips.ts` referencing FR-001/FR-002/FR-003. No behavioral change. Verifies T013 still passes (sanity check; the existing hook already returns the correct chips when the captured slug resolves).
- [ ] T022 [US1] Run the new walk spec from T014 (`pnpm --filter @legal-chatbot/api test:e2e -- widget-sop-subtype-chips`) and confirm it passes against the dev seed (which provides DUI sub-types). Fix any wiring bugs (e.g., test selectors, header propagation) until green.

**Checkpoint**: User Story 1 is fully demoable. The visitor sees the correct sub-type chips for every case type that has sub-types configured. The `{case_type}` placeholder is interpolated server-side and the chip row never re-shows case-type labels.

---

## Phase 4: User Story 2 — Default sub-types ship for every case type (Priority: P1)

**Goal**: Every default case type ships with at least 3 sensible sub-types out of the box, AND existing accounts that pre-date this feature get those defaults filled in via a one-time, idempotent remediation.

**Independent Test**: Provision a fresh dev account → every default case type has its default sub-types present. Then manually empty one account's sub-types → run remediation → defaults restored, customizations untouched.

> Note: The defaults already exist in `packages/api/src/db/seed-defaults/sop.ts:120–195` (six case types, 3–4 sub-types each). This story's work is the *remediation* path for existing accounts, plus reinforcing tests.

### Tests for User Story 2 (write FIRST, must FAIL)

- [ ] T023 [P] [US2] Write failing unit test in `packages/api/src/db/seed-defaults/sop.test.ts` (extend if exists, else create) asserting `DEFAULT_CASE_TYPES` has exactly the slugs `['dui','criminal_defense','personal_injury','family_law','drug_crime','estate_planning']` and that every entry's `sub_types.length >= 3`. Failing today only if the seed file changes; keeps the contract from regressing.
- [ ] T024 [US2] Create new failing test file `packages/api/src/db/ensure-default-sub-types.test.ts` with the following cases against an in-memory SQLite test DB (use the existing `db/test-schema.ts` mirror and the test bootstrap pattern from `packages/api/src/db/ensure-contact-step.test.ts` if present, otherwise use the same scaffolding as `seed.test.ts`):
  1. Account whose case_type slug matches a default and has empty sub_types → outcome `inserted`, exact default sub_types persisted in the correct order.
  2. Account whose case_type has at least one custom sub_type already → outcome `skipped_has_customizations`, no rows added or removed.
  3. Account whose case_type slug does NOT match any default (e.g., `traffic_violations`) with empty sub_types → outcome `skipped_unknown_default`, no rows added.
  4. Idempotency: running the helper twice in a row produces `inserted` then `skipped_already_present` for the same case_type.
  5. Multi-account: helper iterates all accounts and returns one `MigrationResult` per (account, case_type) pair, never crossing account boundaries.

### Implementation for User Story 2

- [ ] T025 [US2] Create new file `packages/api/src/db/ensure-default-sub-types.ts` exporting `ensureDefaultSubTypesForAccount(accountId: string): Promise<MigrationResult[]>` and `ensureDefaultSubTypesForAllAccounts(): Promise<MigrationResult[]>`. Mirror the structure of `packages/api/src/db/ensure-contact-step.ts`. Behavior: for each `case_types` row owned by the account whose `slug` matches a default case-type slug AND whose `sub_types` count is 0, insert the default sub_types from `DEFAULT_CASE_TYPES` in their declared order with `nanoid()` IDs and `created_at: new Date().toISOString()`. Skip case_types with any existing sub_types. Use a single Drizzle transaction per account so partial failures roll back. Make T024 pass.
- [ ] T026 [US2] Add a `db:ensure-default-sub-types` script to `packages/api/package.json` invoking `tsx src/db/ensure-default-sub-types.ts` (mirror the `db:seed` script). The script's main entry should run `ensureDefaultSubTypesForAllAccounts()` and pretty-print results to stdout (one line per `MigrationResult`).
- [ ] T027 [US2] Add a CLI wrapper at the bottom of `packages/api/src/db/ensure-default-sub-types.ts` guarded by `if (import.meta.url === ...)` (or the existing pattern used by `ensure-contact-step.ts`) that invokes `ensureDefaultSubTypesForAllAccounts()`, prints results, and exits non-zero on any unexpected error.
- [ ] T028 [US2] Run `pnpm --filter @legal-chatbot/api db:reset && pnpm --filter @legal-chatbot/api db:seed` and verify (per quickstart.md Story 2) that every default case type has its sub_types after a fresh seed. Then manually empty `dui`'s sub_types, run `pnpm --filter @legal-chatbot/api db:ensure-default-sub-types`, and confirm the defaults are restored. Captures the manual signal that complements the unit tests.

**Checkpoint**: User Story 2 is demoable. New accounts always have defaults; legacy accounts can be remediated with a single command.

---

## Phase 5: User Story 3 — Lawyer edits sub-types from the dashboard (Priority: P1)

**Goal**: Admins can add, rename, reorder, and remove sub-types from the dashboard, with deterministic slug derivation, label-uniqueness validation, and atomic save semantics.

**Independent Test**: Open `/dashboard/sop` Case Types tab → expand Personal Injury → add `Workplace Accident` (slug auto-fills) → reorder → rename → save → reload → confirm persistence; tap chip in widget → confirm visitor sees the new list.

### Tests for User Story 3 (write FIRST, must FAIL)

- [ ] T029 [P] [US3] Write failing unit test in `packages/api/src/lib/sop/case-types-diff.test.ts` asserting that an incoming case-type list with two sub_types under the same parent that share a label (case-insensitive: `Theft` vs `theft `) is rejected with a Zod issue carrying `params.code === 'LABEL_DUPLICATE'`, including the parent label in the message.
- [ ] T030 [P] [US3] Write failing unit test in `packages/api/src/lib/sop/case-types-diff.test.ts` asserting that an incoming sub_type with empty/whitespace-only label is rejected with `params.code === 'LABEL_EMPTY'`.
- [ ] T031 [P] [US3] Write failing unit test in `packages/api/src/lib/sop/case-types-diff.test.ts` asserting that a NEW sub_type (slug not present in persisted state) whose `slug` does not match `deriveSlugFromLabel(label)` is rejected with `params.code === 'SLUG_MISMATCH'`.
- [ ] T032 [P] [US3] Write failing unit test in `packages/api/src/lib/sop/case-types-diff.test.ts` asserting that an existing sub_type (matched by ID/slug in persisted state) whose incoming `slug` differs from the persisted `slug` is rejected with `params.code === 'SLUG_LOCKED'` (renames are label-only).
- [ ] T033 [P] [US3] Write failing unit test for the route handler at `packages/api/src/app/api/dashboard/sop/case-types/route.test.ts` (extend if exists, else create) asserting the wire-format error shape per `contracts/case-types-api.md`: `{ error: 'validation_failed', issues: [{ code, path, message, params: { code: 'LABEL_DUPLICATE' } }] }` for a label collision. Cover at minimum the LABEL_DUPLICATE and SLUG_MISMATCH paths.
- [ ] T034 [US3] Add a failing Playwright walk extension to `packages/api/tests/e2e/sop-tabs.walk.spec.ts` named "US3 — slug auto-derivation, label uniqueness, and persistence". Steps: log in, open Case Types tab, expand Personal Injury, type `Workplace Accident` into the new-sub_type label input, assert the slug field renders `workplace_accident` AND is read-only (e.g., `disabled` attribute or `data-testid="derived-slug"`); click Add; reload; assert the row appears. Then type `dog bite` (collision with existing) and assert an inline error with text containing `already exists`. Then click Save (the topmost save button) and assert that the page does NOT reload with the duplicate row added (i.e., the duplicate is rejected client-side AND server-side: confirm by reading the persisted list from the DB via a fixture helper or a follow-up GET).

### Implementation for User Story 3

- [ ] T035 [US3] Edit `packages/api/src/lib/sop/case-types-diff.ts` to add label-uniqueness validation per parent (case-insensitive `toLocaleLowerCase('en-US')` comparison), label trim/non-empty validation, slug-mismatch validation for new sub_types (using `deriveSlugFromLabel` from T007), and slug-locked validation for existing sub_types. All four error paths throw a Zod-shaped issue with `params.code` matching the contract. Make T029–T032 pass. Wrap the existing delete→update→insert sequence in a Drizzle transaction so the save is atomic per FR-014.
- [ ] T036 [US3] Edit `packages/api/src/app/api/dashboard/sop/case-types/route.ts` to extend the inbound Zod schema with `label: z.string().trim().min(1, { params: { code: 'LABEL_EMPTY' } }).max(80, { params: { code: 'LABEL_TOO_LONG' } })` for both case_types and sub_types. Surface diff-thrown validation errors with the contract-specified shape (`{ error: 'validation_failed', issues: [...] }`) and HTTP 400. Make T033 pass.
- [ ] T037 [P] [US3] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` `SubTypesEditor` (around lines 436–564) to replace the side-by-side `slug` + `label` inputs with a single label input. Render the derived slug in a read-only span (or `<input disabled />` with `data-testid="derived-slug"`) updated live as the admin types. On Add, compute slug via `deriveSlugFromLabel`; if derivation throws, show the validation error inline and do not append the row. Update the rename input (existing label `<input>`) to NOT regenerate the slug on change (slug stays stable per FR-016).
- [ ] T038 [US3] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` to enforce client-side label uniqueness (case-insensitive within the parent) before allowing Add — when the typed label matches an existing sibling label, show an inline error and disable the Add button. Mirror the server-side error message. Allow the user to fix and retry without losing typed input.
- [ ] T039 [US3] Run T034 walk spec end-to-end and iterate until green. Also run the existing `sop-tabs.walk.spec.ts` tests to confirm the side-by-side input change didn't break the legacy assertions; if any did, update them to target the new `data-testid` selectors.

**Checkpoint**: User Story 3 is demoable. The lawyer can edit sub-types with deterministic slugs, label-uniqueness enforced at both layers, atomic saves, and a friendly error UX.

---

## Phase 6: User Story 4 — Visitor flow stays correct when a case type has no sub-types (Priority: P2)

**Goal**: When a case type has zero sub-types, the SOP automatically marks the sub-type step as skipped and advances to Step 3, the chip row never displays an empty/stale row, and the dashboard surfaces a warning indicator on the affected case type.

**Independent Test**: As an admin, delete every sub-type for one case type → save. As a visitor, start a new SOP session, tap that case type → confirm the next assistant question is "Where did this happen?" (Step 3), the chip row is empty/hidden cleanly, and progress reaches `2 / 6` (case_type complete + sub_type skipped both contribute).

### Tests for User Story 4 (write FIRST, must FAIL)

- [ ] T040 [P] [US4] Write failing unit test in `packages/api/src/lib/sop/state-machine.test.ts` asserting that `applySkip` on a step whose `counts_toward_threshold` is `true` increments `state.current_progress` by 1; on a step where the flag is `false` it does NOT increment. Also assert `applySkip` sets the step's `status` to `'skipped'` and `captured_value` to `null`. Existing assertions must continue to hold.
- [ ] T041 [P] [US4] Write failing unit test in `packages/api/src/lib/sop/advancer.test.ts` named "auto-skip sub_type step when captured case_type has empty sub_types". Setup: published SOP has all 6 default steps; the test fixture's `caseTypes` has one entry `{ slug: 'estate_planning', is_in_scope: true, sub_types: [] }`; SOP state is fresh (all steps pending). Visitor types `estate planning`. Expected: after `advanceForVisitorMessage`, the case_type step is `complete` with `captured_value: 'estate_planning'` AND the sub_type step is `skipped`, AND `current_progress === 2`, AND the next pending step is `where`.
- [ ] T042 [P] [US4] Write failing unit test in `packages/api/src/lib/sop/advancer.test.ts` named "no auto-skip when sub_types is non-empty" — same setup but `sub_types: [{ slug: 'will', label: 'Will', position: 1 }]`. Expected: case_type complete, sub_type step remains `pending`, `current_progress === 1`.
- [ ] T043 [P] [US4] Write failing unit test in `packages/api/src/lib/sop/advancer.test.ts` named "auto-skip + finalize cascade" — setup as in T041 but with the SOP partially advanced (where/what/when/contact already complete via fixture). Expected: after the case_type capture and sub_type auto-skip, `state.is_finalized === true` (auto-finalization triggered because all steps satisfied with skip counted toward threshold).
- [ ] T044 [P] [US4] Write failing unit test in `packages/api/src/lib/sop/advancer.test.ts` named "auto-skip is idempotent on subsequent turns" — after the auto-skip turn, send another visitor message; the sub_type step must remain `skipped` (no double-skip, no transition back to pending).
- [ ] T045 [P] [US4] Write failing extension to `packages/widget/src/hooks/computeActiveChips.test.ts` asserting that when `pendingStepSlug` is `'where'` (a free-text step) and the SOP advanced past a skipped sub_type step, the hook returns `[]` (no chips). Existing pending=`sub_type`+empty path test (T013) is unchanged.
- [ ] T046 [P] [US4] Add a failing test to `packages/api/tests/e2e/sop-tabs.walk.spec.ts` named "US4 — empty-sub_types warning indicator" asserting that after deleting all sub_types from a case type and saving, the case-type row displays an element with `data-testid="empty-sub-types-warning"` and that the element's accessible name (or tooltip) contains the phrase "skip Step 2". Adding any sub_type and saving removes the indicator.
- [ ] T047 [US4] Extend the walk spec at `packages/api/tests/e2e/widget-sop-subtype-chips.walk.spec.ts` (created in T014) with a second test named "US4 — empty-sub_types case type auto-skips Step 2". Steps: log in as admin, navigate to Case Types tab, delete all sub_types under Estate Planning, save; sign out; open the widget testbed; tap the **Estate Planning** chip; wait for the next assistant message; assert the message text matches the Step 3 question (`Where did this happen?` or its current published wording), assert the chip row is hidden or empty, assert the progress indicator reads `2/6` (or whatever the spec exposes via `data-testid="sop-progress"`).

### Implementation for User Story 4

- [ ] T048 [US4] Edit `packages/api/src/lib/sop/state-machine.ts` `applySkip` (around lines 174–195) to increment `current_progress` by 1 when the skipped step's `counts_toward_threshold` is `true`. Look up the step's flag from the `sopConfig.steps` argument already passed to the reducer. Make T040 pass.
- [ ] T049 [US4] Edit `packages/api/src/lib/sop/advancer.ts` `advanceForVisitorMessage` to add an empty-sub_types auto-skip pass after the capture loop (around lines 128–145) and before `autoFinalizeIfReady` (line 163). Logic: detect any match where `m.slug === 'case_type'` (or where any case_type step transitioned to `'complete'` in this turn). For each such case_type capture, look up `caseTypes.find(c => c.slug === capturedSlug)`. If found and `ct.sub_types.length === 0`, identify the SOP config step whose `chip_source === 'sub_types'` and whose state is currently `pending`, then dispatch `advanceSOP(next, { type: 'skip_step', step_id })`. Skip if no such step is pending (handles the case where sub_type was already skipped or is already complete). Make T041–T044 pass. Order: this pass MUST run before `autoFinalizeIfReady` so a same-turn skip can satisfy the threshold.
- [ ] T050 [US4] Edit `packages/api/src/app/dashboard/sop/case-types-tab.tsx` to render an empty-list warning indicator on each case-type row when its `sub_types.length === 0`. Use a `<span data-testid="empty-sub-types-warning" role="img" aria-label="Visitors who pick this case type will skip Step 2">⚠</span>` (or the project's existing icon convention if there is one — check the dashboard for prior `role="img"` patterns first). Add a tooltip via `title` attribute matching the aria-label so admins see the explanation on hover. Make T046 pass.
- [ ] T051 [US4] Run T047 walk spec end-to-end. Iterate until green. The full Story 4 flow now exercises advancer auto-skip + threshold accounting + widget chip suppression + dashboard warning together.

**Checkpoint**: User Story 4 is demoable. Empty sub-type lists are a first-class supported configuration, with a visible warning to admins and a smooth visitor experience.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: End-to-end verification, regression checks, and Constitution-mandated gates before merge.

- [ ] T052 [P] Run the full unit + integration test suite (`pnpm test`) and confirm zero failures across all packages. Constitution III gate.
- [ ] T053 [P] Run `pnpm -w turbo run typecheck` and confirm `tsc --noEmit` passes for every package. Constitution II gate.
- [ ] T054 [P] Run `pnpm lint` (or the workspace's ESLint command) and resolve any new warnings.
- [ ] T055 [P] Run `pnpm e2e:walk` and confirm both the new walk spec (`widget-sop-subtype-chips.walk.spec.ts`) and the extended `sop-tabs.walk.spec.ts` pass alongside existing walks (`widget-us1-happy-path`, `widget-us2-skip-detection`, etc.). No previously-passing walk may regress.
- [ ] T056 Run `turbo build` and confirm widget bundle sizes are unchanged within budget (NPM ≤ 35KB gz, CDN ≤ 50KB gz per Constitution IV / §6.10). The widget changes in this feature are docstring-only, so size delta should be ~0 bytes.
- [ ] T057 Walk through `specs/014-fix-sop-case-subtypes/quickstart.md` manually end-to-end against `pnpm dev`. Confirm every numbered step in every Story section passes. Capture any drift in quickstart wording vs reality and fix the doc.
- [ ] T058 Manually run conversation-quality eval scripts touching the SOP system prompt (Constitution III: required when system prompt changes; the `{case_type}` interpolation in T019 is a system prompt change). If eval scripts don't exist for this surface, document why in the PR description so reviewers can decide whether a new script is needed.
- [ ] T059 Update `packages/api/src/db/seed-defaults/sop.ts:6-8` and the `seed.ts:28-31` doc-only forward references so the comment about "lazy seed for legacy accounts" points to the new `ensure-default-sub-types.ts` (created in T025) instead of the non-existent `migrate-legacy-qualifying-questions.ts`. Documentation hygiene; no code change.
- [ ] T060 Add a brief operator-facing note in `packages/api/README.md` (or the equivalent ops doc) describing the new `pnpm db:ensure-default-sub-types` script: when to run it (after deploying this feature for the first time, or any time a customer reports missing sub-types on a default case type), and what its idempotency guarantees are.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001 — runs first; baseline confirmation only.
- **Phase 2 (Foundational)**: T002–T007 — depends on Phase 1. **BLOCKS all user stories** because every story consumes the extended `SOPStateStep`, `sopStateHeaderPayloadSchema`, `resolveCaseTypeLabel`, or `deriveSlugFromLabel`.
- **Phase 3 (US1)**: T008–T022 — depends on Phase 2 (T003 schema, T005 schema, T006 helper).
- **Phase 4 (US2)**: T023–T028 — depends on Phase 2 (none of the foundational pieces are strictly required, but Phase 2's schema changes must be in place to keep CI green when this phase runs).
- **Phase 5 (US3)**: T029–T039 — depends on Phase 2 (T007 `deriveSlugFromLabel`).
- **Phase 6 (US4)**: T040–T051 — depends on Phase 2 AND on Phase 3 implementation tasks T015–T020 because Story 4's walk spec exercises both the auto-skip and the chip-rendering pipeline together. Story 4 unit tests (T040–T046) can be authored in parallel with Phase 3 since they live in different test files.
- **Phase 7 (Polish)**: T052–T060 — depends on all stories.

### User Story Dependencies

- **US1 (P1) — MVP**: depends only on Phase 2.
- **US2 (P1)**: independent of US1, US3, US4. Can be built in parallel with US1.
- **US3 (P1)**: independent of US1, US2, US4. Can be built in parallel.
- **US4 (P2)**: implementation depends on US1's chip-rendering pipeline being correct (so the empty-sub_types auto-skip's effect is observable in the widget). Tests for US4 are independent and can be written in parallel.

### Within Each User Story

- Tests (T008–T014, T023–T024, T029–T034, T040–T047) MUST be authored and FAILING before the corresponding implementation tasks. Constitution III is non-negotiable.
- Models / schemas (Phase 2) before services / runtime (Phase 3+).
- Server-side validation (T035–T036) before client-side mirrors (T037–T038) so the server is always the authority.
- Walk specs (T014, T034, T047) run last within their stories because they exercise the full stack.

### Parallel Opportunities

- **All Phase 2 tasks marked [P]** (T002, T004, T006, T007) can run in parallel against the shared schema file with care: T003 and T005 both edit `packages/shared/src/schemas/sop.ts` and therefore should NOT run in parallel with each other. T006 and T007 create new files and are fully parallel.
- **All Phase 3 unit tests marked [P]** (T008, T009, T010, T011, T012, T013) can run in parallel — different test files. T014 (walk spec) is single-threaded.
- **Skip-detector implementation tasks T015 and T016** target the same file but different functions; they can be authored in parallel and merged carefully.
- **All Phase 5 unit tests marked [P]** (T029, T030, T031, T032, T033) can run in parallel — different cases in the same test file.
- **Phase 5 dashboard tasks T037 and T038** target the same file and MUST be sequenced (T037 before T038).
- **Phase 6 tests T040–T046 marked [P]** can run in parallel — different test files / different test cases.
- **Phase 7 polish tasks T052–T055 marked [P]** can run in parallel — independent commands / files.

---

## Parallel Example: User Story 1 Tests

```bash
# Author all unit tests for User Story 1 in parallel (different files):
Task: "T008 captured_label on matchCaseTypeChip in skip-detector.test.ts"
Task: "T009 captured_label on matchSubTypeChip in skip-detector.test.ts"
Task: "T010 captured_label on inferCaseTypeFromSubType emission in skip-detector.test.ts"
Task: "T011 {case_type} interpolation in system-prompt-extension.test.ts"
Task: "T012 buildSOPStateHeader captured_case_type_label in route.test.ts"
Task: "T013 computeActiveChips sub_types ordering in computeActiveChips.test.ts"
```

After these fail, implement T015–T020 in parallel where possible (T015 + T016 against `skip-detector.ts`, T019 against `system-prompt-extension.ts`, T020 against `route.ts` are different files), then T017 (sequenced after T015) and T018 (which touches three files: skip-detector type, advancer, state-machine — must be sequenced because it consumes T015/T016/T017's output shape).

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 (Setup) — T001
2. Phase 2 (Foundational) — T002–T007 — CRITICAL: blocks all stories
3. Phase 3 (US1) — T008–T022
4. **STOP and VALIDATE**: Run the new walk spec; tap DUI in the widget testbed; confirm sub-type chips render correctly.
5. Decide whether to ship just US1 (delivers the headline fix the user reported) or continue with US2–US4.

### Incremental Delivery Order

The stories are independent; recommended ship order matches priority + leverage:

1. **US1** — fixes the visible bug (highest user-perceived impact).
2. **US3** — enables admins to fix their own sub-type lists (unblocks support cases).
3. **US2** — backfills defaults for legacy accounts (proactive remediation).
4. **US4** — handles the zero-sub_types edge case gracefully (defends US3 customizations).
5. **Phase 7 Polish** — gating before merge.

### Parallel Team Strategy

- **Developer A**: Phase 1, Phase 2, then US1 (T008–T022).
- **Developer B**: Once Phase 2 lands, US3 (T029–T039) — independent of US1 and the largest dashboard surface.
- **Developer C**: Once Phase 2 lands, US2 (T023–T028) — DB-only, very small, can fold back to A or B after.
- **Developer A** picks up US4 (T040–T051) after US1 lands because US4 builds on the chip-rendering pipeline US1 fixes.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps task to spec user story for traceability.
- Each user story must be independently completable and demoable per its quickstart section.
- Tests MUST fail before the implementation that satisfies them lands. Constitution III is binding.
- Commit after each task or logical group (the `before_*` git hooks will offer this prompt at phase boundaries).
- Stop at any checkpoint to validate a story independently against `quickstart.md`.
- Avoid: vague tasks, same-file conflicts (especially in `case-types-tab.tsx` and `case-types-diff.ts`), cross-story dependencies that break independence.

