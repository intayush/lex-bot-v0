---

description: "Task list for 016-multi-branch-sop"
---

# Tasks: Multi-Branch SOP Workflow

**Input**: Design documents from `specs/016-multi-branch-sop/`
**Prerequisites**: `plan.md` ✅ · `spec.md` ✅ · `research.md` ✅ · `data-model.md` ✅ · `contracts/` ✅ · `quickstart.md` ✅

**Tests**: Constitution III is NON-NEGOTIABLE — every production code task in this list has at least one failing test written first, visible in the diff before the implementation that satisfies it.

**Organization**: Tasks are grouped by user story per the spec's priority order (US1–US5). Each user story phase is independently completable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- File paths are absolute from repo root

## Path Conventions

Web monorepo (Constitution IV.2): `packages/{api,dashboard,widget,shared,crawler}/`. Tests are colocated with source as `*.test.ts` per the existing repo convention.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new dependencies (per plan.md). This phase only verifies the existing toolchain is green before changes land.

- [X] T001 Verify clean baseline: run `pnpm install --frozen-lockfile && pnpm tsc --noEmit && pnpm vitest run` from repo root and confirm zero failures on `main` BEFORE the first feature commit. Record baseline test count in `specs/016-multi-branch-sop/quickstart.md` (append a single line; no other changes).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, Zod contracts, and the database migration. Every user story depends on this phase.

**⚠️ CRITICAL**: No US1–US5 work begins until Phase 2 completes.

### Schemas (Constitution II)

- [X] T002 [P] Author `branchChipSchema` and `branchQuestionSchema` with Zod refinements (unique chip slugs per question, slug regex `^[a-z0-9_-]+$`, label length 1–80, weight is `z.number().int()`) in `packages/shared/src/schemas/branch.ts`. Co-locate failing schema tests in `packages/shared/src/schemas/branch.test.ts` covering: valid payload accepted; duplicate chip slug rejected; non-integer weight rejected; oversized label rejected.
- [X] T003 [P] Author `branchSchema`, `branchVersionSchema`, `branchSnapshotSchema` in `packages/shared/src/schemas/branch.ts` (same file as T002 — but T002 covers chip/question shapes, T003 covers branch/version/snapshot shapes). Add tests in the same `.test.ts` file. Tasks T002 and T003 share a file but write disjoint named exports, so they are coordinated as one PR even though logically [P]; if executed by different contributors, T002 lands first to define the imported types T003 reuses.
- [X] T004 [P] Author `branchesListResponseSchema`, `branchDetailResponseSchema`, `branchSaveRequestSchema`, `branchPublishResponseSchema` in `packages/shared/src/schemas/branch-api.ts`. Co-locate failing tests in `packages/shared/src/schemas/branch-api.test.ts`.
- [X] T005 [P] Extend `leadSchema` in `packages/shared/src/schemas/lead.ts` with optional `branch_snapshot_json: branchSnapshotSchema.nullable()` and required `branch_incomplete: z.boolean()` (default false). Update colocated `lead.test.ts` to verify default-only leads (snapshot null, incomplete false) and partial-branch leads (snapshot non-null, incomplete true) both round-trip. Also add a JSDoc `@deprecated` notice on `subTypeScoringConfigSchema` pointing at this spec.
- [X] T006 Re-export the new schemas from `packages/shared/src/index.ts`. Verify `pnpm --filter @legal-chatbot/shared build` succeeds and `pnpm tsc --noEmit` is green across the workspace.

### Database schema and migration

- [X] T007 Add `branches` and `branch_versions` Drizzle tables to `packages/api/src/db/schema.ts` per `data-model.md` §Branch / §BranchVersion (PKs, FKs, UNIQUE on `(firm_id, case_type_slug, sub_type_slug)`, indices). Mark `subTypes.scoringConfigJson` with a JSDoc `@deprecated` comment.
- [X] T008 Add `branchSnapshotJson` (text, nullable) and `branchIncomplete` (integer, NOT NULL DEFAULT 0) columns to the existing `leads` table in `packages/api/src/db/schema.ts`. Add a partial INDEX on `branchIncomplete` (where = 1) for fast filter queries.
- [X] T009 Generate the Drizzle migration: run `pnpm --filter @legal-chatbot/api drizzle:generate` and rename the output to `0004_multi_branch_sop.sql` under `packages/api/drizzle/`. Inspect SQL; ensure CREATE TABLE order is `branches` before `branch_versions` (FK ordering may need manual edit — `branch_versions.branch_id` FK requires `branches` to exist; `branches.current_version_id` is nullable so it can reference `branch_versions` defined-after via deferred FK or the column added in a follow-up `ALTER TABLE`. Adjust the SQL accordingly).
- [X] T010 Add a TypeScript migration body `packages/api/src/db/migrations/0004-multi-branch-sop.ts` that data-copies every existing `sub_types.scoring_config_json` row into a new `branches` row + a published `branch_versions` row. Idempotent via `INSERT ... ON CONFLICT DO NOTHING` against the UNIQUE index. Wire from `packages/api/src/db/migrate.ts`. Co-locate failing test `0004-multi-branch-sop.test.ts` covering: (a) seeded scoring_config copied to a Branch row, (b) re-running the migration is a no-op, (c) `sub_types.scoring_config_json` is NOT dropped.
- [X] T011 Run `pnpm db:migrate` against an empty in-memory SQLite to verify the schema applies cleanly. Then run against a database pre-seeded with spec 015 data to verify the data copy works. Add the second case as a test fixture in T010's test file if not already covered.

### Seed defaults

- [X] T012 Update `packages/api/src/db/seed-defaults/default-sop.ts` to add Step 6 (contact) at position 6 with the configurable prompt "What's your name and how can we reach you?" and threshold `N = 6`. Add tests in `default-sop.test.ts` (or sibling) verifying the seed produces a 6-step SOP with the expected slugs and order.
- [X] T013 Add `packages/api/src/db/seed-defaults/car-accident-branch.ts` containing the JSON fixture for the seeded Personal Injury → Car Accident Branch (eight questions, chips, weights, thresholds, hard-override toggles — all relocated verbatim from the spec 015 source-of-truth). Wire into `packages/api/src/db/seed.ts`. Failing test in `car-accident-branch.test.ts` asserts: chip count and weights per question match a hand-checked fixture; classification thresholds match spec 015 numbers exactly.

### Boot-time idempotent migration (FR-004 / FR-030)

- [X] T014 Replace `packages/api/src/db/ensure-car-accident-scoring.ts` with `ensure-car-accident-branch.ts` operating on the new `branches` table. Idempotent. Update the existing `ensure-car-accident-scoring.test.ts` → `ensure-car-accident-branch.test.ts` to assert the new behaviour.
- [X] T015 Extend `packages/api/src/db/ensure-contact-step.ts` to detect firms whose SOP matches the spec 010 seeded 5-step default fingerprint (per research.md R9) and insert Step 6 (contact) at position 6 + bump `N` from 5 to 6. Skip firms with custom SOPs. Failing test in `ensure-contact-step.test.ts` covers: (a) seeded firm gets Step 6 inserted, N becomes 6, (b) firm with custom step list is left alone, (c) firm with custom N=4 is left alone, (d) re-running is a no-op.

**Checkpoint**: schemas + DB migration + boot-time migrations green. User stories can begin.

---

## Phase 3: User Story 1 — Unconfigured sub-type skips branch questions and stays open (Priority: P1) 🎯 MVP

**Goal**: Fix the regression from `negative-sop-flow.json`. Visitors who pick a (case_type, sub_type) pair without a configured branch finish the default SOP and stay open for free-form follow-up — no car-accident questions leak.

**Independent Test**: Walk Criminal Defense → Assault Charges through Steps 1–6 in the local widget. Verify (a) no chip whose label contains "driver", "passenger", "insurance", or "missed work" ever renders, (b) the lead row is captured with classification + null score, (c) the assistant answers a follow-up free-form question without re-running the SOP.

### Tests for User Story 1 (Constitution III)

- [X] T016 [P] [US1] Add the structural tool-registry test `packages/api/src/app/api/chat/tool-registry.test.ts` per `contracts/tool-registry-contract.md`. Asserts the agent's tool map contains exactly `searchContext` and `captureLead`. Failing initially (the registry still has `analyzeAndFollowUp`).
- [X] T017 [P] [US1] Add the regression Playwright spec `tests/e2e/smoke-016-criminal-defense.spec.ts` that walks Criminal Defense → Assault Charges through Steps 1–6 with contact (`name@example.com`, `+15551234567`), asserts no chip label matches `/driver|passenger|insurance|missed work/i`, asserts the captured lead has `classification` set and `lead_score === null` and `branch_incomplete === false`, and asserts the assistant's post-finalization message ends with an open-ended re-prompt. Failing initially.
- [X] T018 [P] [US1] Add the unit test `packages/api/src/lib/sop/branch-lookup.test.ts` per `contracts/branch-runtime-contract.md` §branch-lookup.ts: returns null when no branch row exists; returns null when `is_active = 0`; returns null when current version has zero questions; returns the Branch + Version when all conditions met; isolates per-firm. Failing initially.

### Implementation for User Story 1

- [X] T019 [US1] Implement `packages/api/src/lib/sop/branch-lookup.ts` exporting `lookupBranch(args, deps): Promise<BranchLookupResult>` per the runtime contract. Single Drizzle query keyed by the UNIQUE index, joined to `branch_versions` on `current_version_id`. Returns null per the four cases enumerated in T018.
- [X] T020 [US1] Delete `packages/api/src/lib/sop/follow-up-tool.ts` and its test file. Search the repo for any remaining imports and delete them too (`grep -r 'follow-up-tool\|analyzeAndFollowUp' packages/`).
- [X] T021 [US1] Modify `packages/api/src/app/api/chat/route.ts` to remove the `analyzeAndFollowUp` registration from the agent tools map. Refactor the tool-map construction into a `buildAgentTools()` helper if not already separated, so T016's structural test can import it. Verify T016 turns green.
- [X] T022 [US1] Modify `packages/api/src/lib/sop/state-machine.ts` to: (a) remove the `step6_followup_ai` state, (b) add a `step6_contact` state after `step5_when`, (c) after `step6_contact` satisfies, transition to a new `branch_lookup` state that calls `lookupBranch` and dispatches to either `branch_running` (with branch state initialized) or `finalize_default_only`. Failing tests in `state-machine.test.ts` covering each transition.
- [X] T023 [US1] Modify `packages/api/src/lib/sop/advancer.ts` to call the new state-machine transitions per T022. After Step 6 satisfies, run `lookupBranch` and if null, route to the existing finalize-default path; emit a `branch_skipped` structured log with `reason: "no_branch_configured"` (or `"branch_inactive"` / `"branch_zero_questions"` as appropriate). Update `advancer.test.ts` to cover the unconfigured-pair path end-to-end.
- [X] T024 [US1] Verify `tests/e2e/smoke-016-criminal-defense.spec.ts` (T017) passes. Run `pnpm test:e2e -- smoke-016-criminal-defense` and capture the run as evidence in the PR description.

**Checkpoint**: User Story 1 is fully functional. The bug is fixed. The MVP is shippable here if all later stories are deferred.

---

## Phase 4: User Story 3 — Reordered default SOP captures contact before branch (Priority: P1)

**Goal**: Step 6 (contact) is captured before any branch fires. Lead row carries `name`, `email`, `phone` (with the partial-gate rule from Q1: ≥ 1 of email/phone, name optional) the moment the SOP transitions past Step 6.

**Note on ordering**: US3 is sequenced before US2 because US2 (configured branch) depends on Step 6 being firmly in place; the runtime branches off Step 6's satisfaction signal.

**Independent Test**: Walk any case_type + sub_type through Steps 1–6 in the widget. Provide only an email at Step 6. Confirm the lead row has `contact_email` populated and `contact_phone` null. Refuse both email and phone at Step 6 across two retries; on the third refusal, confirm no lead row is created and the conversation stays open.

### Tests for User Story 3 (Constitution III)

- [ ] T025 [P] [US3] Update `packages/api/src/lib/sop/contact-form.test.ts` with new failing tests for the partial-gate satisfaction predicate: name-only is NOT satisfied; email-only IS satisfied; phone-only IS satisfied; both email and phone IS satisfied; nothing is NOT satisfied. Add tests for the retry counter: 0 → 1 → 2 → terminate.
- [ ] T026 [P] [US3] Add failing tests to `packages/api/src/lib/sop/skip-detector.test.ts` for sequence-safe contact capture (FR-005a / R5): contact volunteered in turn 1 is stashed into `pending_contact` but Step 6 is NOT marked complete and bar does NOT advance to 6/6 until Steps 1–5 are also complete; on Step 6 arrival with non-empty `pending_contact`, the assistant emits the configurable confirmation prompt; visitor confirmation satisfies Step 6.

### Implementation for User Story 3

- [ ] T027 [US3] Modify `packages/api/src/lib/sop/contact-form.ts`: change the satisfaction predicate to `email != null || phone != null` (name optional). Add `contact_retry_count` handling: increment on each Step 6 turn that returns no email AND no phone; on third failure transition the SOP state to `terminated_no_contact` and emit a configurable polite acknowledgement (no `captureLead` invocation). Verify T025 turns green.
- [ ] T028 [US3] Modify `packages/api/src/lib/sop/skip-detector.ts` to add a `pending_contact` stash path: when contact extraction succeeds but the runtime is not yet at Step 6, store the parsed fields in `sopState.pending_contact` and DO NOT mark Step 6 complete. When the advancer reaches Step 6 with non-empty `pending_contact`, emit the confirmation prompt. Verify T026 turns green.
- [ ] T029 [US3] Add the SOP-state JSON shape extensions (`pending_contact`, `contact_retry_count`, `branch_state`) per `data-model.md` §SOP State. Update `packages/api/src/lib/sop/state-machine.ts` and `packages/shared/src/schemas/sop-state.ts` (or wherever the SOP state schema lives) with Zod validation for the new fields. Add round-trip tests.
- [ ] T030 [US3] Add a database CHECK at the application layer (Drizzle): before any `INSERT INTO leads`, the runtime validates `email != null || phone != null`. Add a unit test in `packages/api/src/lib/leads.test.ts` (or sibling) that asserts an attempted insert with both fields null throws. This enforces SC-003 invariantly.
- [ ] T031 [US3] Update the existing happy-path Playwright spec or add `tests/e2e/smoke-016-contact-step.spec.ts` to walk: (a) email-only contact is accepted, (b) phone-only is accepted, (c) refusing twice then refusing again terminates without `captureLead`. Run `pnpm test:e2e -- smoke-016-contact-step`.

**Checkpoint**: User Story 3 complete. Step 6 is firmly between Step 5 and the (still-default-only) finalization.

---

## Phase 5: User Story 2 — Configured Car Accident branch fires after contact capture (Priority: P1)

**Goal**: Once Step 6 satisfies for a (case_type, sub_type) pair with an active configured branch, the runtime executes the branch one question at a time, accumulates chip weights, and finalizes with score + classification + reasons + frozen `BranchSnapshot`.

**Independent Test**: Walk Personal Injury → Car Accident through Steps 1–6 in the widget, then through the eight branch questions. Confirm at finalization the lead row has a numeric `lead_score` (0–100), classification matching the configured thresholds, populated `reasons[]`, `branch_snapshot_json` non-null, and `branch_incomplete = false`.

### Tests for User Story 2 (Constitution III)

- [ ] T032 [P] [US2] Add failing unit tests to `packages/api/src/lib/sop/branch-advancer.test.ts` per `contracts/branch-runtime-contract.md` §branch-advancer.ts: first call returns `next_question` for position 0; subsequent calls advance through positions in order; last call returns `finalize` with the full chips array; free-text fuzzy-matching to a chip slug; free-text on a `free_text_allowed: false` question returns `awaiting_clarification`; multi-select questions accept multiple chip slugs.
- [ ] T033 [P] [US2] Add failing unit tests to `packages/api/src/lib/sop/branch-snapshot.test.ts` per the contract: `questions_snapshot` matches version's `questions_json` exactly; `captured_chips` order matches question position order; `branch_incomplete` is true iff fewer than `questions.length` answers are present; snapshot JSON-serializes round-trip identical.
- [ ] T034 [P] [US2] Add failing unit tests to `packages/api/src/lib/scoring/score-lead-partial.test.ts` per the contract: empty chips → score 0 + classification from lowest threshold band + `branch_incomplete: true`; partial chips compute a numeric score from the captured subset; wrapper does not modify `scoreLead`'s threshold logic.
- [ ] T035 [P] [US2] Add the happy-path Playwright spec `tests/e2e/smoke-016-personal-injury.spec.ts`: walks Personal Injury → Car Accident through Steps 1–6 + all eight branch questions, asserts at finalization that the lead has a numeric `lead_score`, a classification value in `{HOT, WARM, COLD, SPAM}`, a non-empty `reasons[]`, and `branch_incomplete === false`. This spec replaces the existing spec 015 happy-path smoke (delete `tests/e2e/smoke-015*.spec.ts` after confirmation).

### Implementation for User Story 2

- [ ] T036 [US2] Implement `packages/api/src/lib/sop/branch-advancer.ts` exporting `advanceBranch(input): BranchAdvanceResult` per the runtime contract. Pure function. Reuse the existing chip-matching logic from `packages/api/src/lib/sop/advancer.ts`. Verify T032 green.
- [ ] T037 [US2] Implement `packages/api/src/lib/sop/branch-snapshot.ts` exporting `freezeBranchSnapshot(args): BranchSnapshot` per the contract. Pure function. Verify T033 green.
- [ ] T038 [US2] Implement `packages/api/src/lib/scoring/score-lead-partial.ts` as a wrapper around the existing `score-lead.ts`. Always sets `branch_incomplete: true`. Empty `capturedChips` returns score 0. Verify T034 green.
- [ ] T039 [US2] Wire the branch-running state into `packages/api/src/lib/sop/state-machine.ts` and `packages/api/src/lib/sop/advancer.ts`: from `branch_lookup`, if `lookupBranch` returns a Branch, transition to `branch_running` and on each subsequent turn call `advanceBranch`. On `finalize`, run `scoreLead`, call `freezeBranchSnapshot`, write the lead with `branch_snapshot_json` populated and `branch_incomplete: 0`, then transition to `finalize_with_branch`. Update `state-machine.test.ts` and `advancer.test.ts` accordingly.
- [ ] T040 [US2] Implement session-end partial-branch finalizer in `packages/api/src/lib/session.ts` (or wherever session-expiry runs): when a session expires AND `branch_state` is non-null AND not finalized, call `scoreLeadPartial` with the captured chips and write the lead with `branch_snapshot_json` populated and `branch_incomplete: 1`. Add a test in `session.test.ts`.
- [ ] T041 [US2] Pin in-flight conversations to `branch_version_id` per FR-017 / R7: when a branch first activates for a session, store the resolved `branch_version_id` in the SOP state. On subsequent turns, load that exact version (do not look up the latest published). Add a test in `branch-lookup.test.ts` covering the pinned-version read path.
- [ ] T042 [US2] Verify `tests/e2e/smoke-016-personal-injury.spec.ts` (T035) passes. Run `pnpm test:e2e -- smoke-016-personal-injury`. Capture run output in PR description.

**Checkpoint**: User Story 2 complete. The Car Accident branch fires after contact capture and produces deterministic scored leads.

---

## Phase 6: User Story 4 — Admin configures branches and per-question weights from the dashboard (Priority: P1)

**Goal**: Admins can list all (case_type, sub_type) pairs in a Branches tab on `/dashboard/sop`, view the per-pair branch status, add/edit/reorder/remove questions, edit per-chip lead-score weights, edit thresholds and hard-override toggles, toggle active/inactive, delete branches, and Save + Publish.

**Independent Test**: Log in as admin, open `/dashboard/sop`, click the Branches tab, expand the Personal Injury → Car Accident branch, change the "Driver" chip weight from 10 to 15, Save, then Publish. Reload the page and confirm the new weight persists. Walk a visitor through Personal Injury → Car Accident, tap "Driver" at the role question, confirm the running lead score reflects the new weight.

### Tests for User Story 4 (Constitution III)

- [X] T043 [P] [US4] Add failing API tests for `GET /api/admin/branches` in `packages/api/src/app/api/admin/branches/route.test.ts` per `contracts/branches-admin-api.md`: returns 401 when no session; returns 403 when session lacks admin role; returns 200 with all (case_type, sub_type) pairs and per-pair branch status; performance: with 50 pairs in fixtures, response time is under 1s (SC-010).
- [X] T044 [P] [US4] Add failing API tests for `GET /api/admin/branches/:caseTypeSlug/:subTypeSlug` in `packages/api/src/app/api/admin/branches/[caseType]/[subType]/route.test.ts`: returns 200 with branch + current_version + draft_version fields per the contract; returns 404 when no branch exists.
- [X] T045 [P] [US4] Add failing API tests for `PUT /api/admin/branches/:caseTypeSlug/:subTypeSlug` (same file as T044): creates a new branch on first save when none exists; creates a new draft version when one exists; returns warnings array for out-of-range theoretical totals (FR-023); rejects malformed payloads with 400.
- [X] T046 [P] [US4] Add failing API tests for `POST /api/admin/branches/:caseTypeSlug/:subTypeSlug/publish`: publishes the draft version; returns 409 when no draft exists.
- [X] T047 [P] [US4] Add failing API tests for `DELETE /api/admin/branches/:caseTypeSlug/:subTypeSlug`: returns 204 on success; cascades `branch_versions`; preserves `leads.branch_snapshot_json` rows; returns 404 when no branch exists.
- [X] T048 [P] [US4] Add failing component tests for the Branches dashboard tab using Vitest + Testing Library: `packages/dashboard/src/app/dashboard/sop/branches-tab.test.tsx` (renders 50 pairs with status pills, click "Add branch" on an unconfigured pair) and `packages/dashboard/src/app/dashboard/sop/branch-editor.test.tsx` (renders questions list, edits a chip weight, drag-reorders questions, save calls the PUT endpoint).

### Implementation for User Story 4

- [X] T049 [US4] Implement `packages/api/src/app/api/admin/branches/route.ts` (GET — list pairs). Single SQL JOIN per research.md R1. Verify T043 green.
- [X] T050 [US4] Implement `packages/api/src/app/api/admin/branches/[caseType]/[subType]/route.ts` (GET, PUT, DELETE). Wire to the existing dashboard audit-log per FR-028. Verify T044, T045, T047 green.
- [X] T051 [US4] Implement `packages/api/src/app/api/admin/branches/[caseType]/[subType]/publish/route.ts` (POST). Atomically updates `branches.current_version_id` and `branch_versions.is_published` in a Drizzle transaction. Verify T046 green.
- [X] T052 [US4] Add the third tab "Branches" to `packages/dashboard/src/app/dashboard/sop/page.tsx`. Reuse the existing tab strip component from spec 014. No layout regressions for the existing two tabs.
- [X] T053 [US4] Implement `packages/dashboard/src/app/dashboard/sop/branches-tab.tsx`: server-fetches the list from `GET /api/admin/branches` (or via a Next.js Server Component), renders grouped rows with status pills, primary action (Edit / View / Add), secondary action (Delete with confirmation per FR-026). Verify T048's first test green.
- [X] T054 [US4] Implement `packages/dashboard/src/app/dashboard/sop/branch-editor.tsx`: opens as a side-panel or modal, renders the question list with drag handles, per-question chip editor with numeric weight inputs, threshold tables, hard-override toggle list, Save / Publish actions. Reuses the existing dashboard form patterns from spec 015. Verify T048's second test green.
- [X] T055 [US4] Wire the Branch editor's Preview & Test integration per FR-027: a "Preview" button opens the existing chat preview component pinned to the draft branch version (passes `branch_version_id` as a query parameter that the chat route honours).
- [X] T056 [US4] Add validation warnings UI per FR-023: when chip weights yield a theoretical max < 0 or > 100, the editor shows an inline warning above the Save button (does not block save). Add a test in `branch-editor.test.tsx`.

**Checkpoint**: User Story 4 complete. Admins have full branch-configuration surface from the dashboard.

---

## Phase 7: User Story 5 — Open-ended conversation continues after default-only finalization (Priority: P2)

**Goal**: After a default-only finalization, the conversation stays open. The assistant answers free-form follow-up questions within guardrails and ends each turn with an open-ended re-prompt. No goodbye is emitted unless the visitor uses a goodbye phrase.

**Independent Test**: Complete a default-only flow (Criminal Defense → Assault Charges through Step 6). Send three free-form follow-up questions. Verify each is answered within guardrails, no SOP question is re-asked, and the assistant never volunteers a goodbye until the visitor sends "thanks, bye".

### Tests for User Story 5 (Constitution III)

- [ ] T057 [P] [US5] Extend `tests/e2e/smoke-016-criminal-defense.spec.ts` (or add a sibling spec) to cover: after default-only finalization, send a free-form question ("What does Attorney Shrager charge for an initial consultation?"), assert the response is within guardrails and ends with an open-ended re-prompt; assert no SOP step is re-asked; send a goodbye phrase and assert the configured polite closing is emitted.

### Implementation for User Story 5

- [ ] T058 [US5] Verify the existing spec 010 FR Group G post-SOP behaviour applies uniformly to the new default-only path. Inspect `packages/api/src/lib/system-prompt.ts` and `packages/api/src/lib/sop/system-prompt-extension.ts` to confirm the post-finalization re-prompt + goodbye-phrase detection apply when the SOP terminates via `finalize_default_only`. If gaps exist, extend the system-prompt assembly accordingly. Add tests in `system-prompt.test.ts` covering the default-only path.

**Checkpoint**: User Story 5 complete. Conversational continuation works uniformly across default-only and configured-branch paths.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Logging, leads dashboard surfacing, documentation, and final QA.

### Structured logging (FR-033)

- [ ] T059 [P] Implement the five new structured-log event types per `contracts/branch-runtime-contract.md` §Logging contract: `branch_started`, `branch_question_answered`, `branch_completed`, `branch_skipped`, `branch_incomplete_finalized`. Wire emissions into `branch-lookup.ts` (skipped), `state-machine.ts` (started, completed), `branch-advancer.ts` (question_answered), and `session.ts` (incomplete_finalized). Add tests asserting (a) each event fires at the expected transition, (b) no PII is in any field — only chip slugs, question ids, rule names, and category-level metadata. Use the existing log-redaction helper from `packages/api/src/lib/sop/pii-redactor.ts`.

### Leads dashboard surfacing (FR-011b)

- [ ] T060 [P] Update `packages/dashboard/src/app/dashboard/leads/page.tsx` to surface a `Branch incomplete` badge on lead rows where `branch_incomplete = 1`. Add a filter chip "Show only branch-incomplete leads". Add a component test.
- [ ] T061 [P] Update the lead detail view in `packages/dashboard/src/app/dashboard/leads/lead-detail.tsx` to render the `branch_snapshot_json` payload: per-question text + captured chip slugs + chip labels + per-chip weight contribution + final score + classification + reasons. For default-only leads (`branch_snapshot_json = null`), render a simple "No branch was configured for this matter" notice. Add a component test for both states.

### Cleanup and regression sweep

- [ ] T062 Delete `tests/e2e/smoke-015*.spec.ts` after confirming `smoke-016-personal-injury.spec.ts` covers the same happy path. Run `pnpm test:e2e` to confirm no remaining references.
- [ ] T063 Verify all spec 015 unit tests for `score-lead.ts`, `hard-overrides.ts`, `classification-mapper.ts`, `reason-builder.ts` still pass unchanged. Constitution VII regression check: `pnpm vitest run` is fully green.
- [ ] T064 Update the existing `ensureCarAccidentScoring` references throughout the codebase to point at the new `ensureCarAccidentBranch` (T014). Run `grep -r 'ensureCarAccidentScoring\|scoring_config_json' packages/` and triage every remaining reference: leave the schema column reference (deprecated, intentional); update or delete every code reference.

### Documentation

- [ ] T065 [P] Update the existing dashboard help/onboarding text (if any) in `packages/dashboard/src/` to mention the new Branches tab. No new docs files.
- [ ] T066 [P] Verify `AGENTS.md` SPECKIT block points at `specs/016-multi-branch-sop/plan.md` (already done in Phase 1 of `/speckit.plan`; this task is the cross-check).

### Final validation

- [ ] T067 Run the full quickstart.md walkthrough §11–§12 from a fresh database (`rm packages/api/.local-test-db && pnpm db:migrate && pnpm db:seed`). Step through every manual verification checkpoint. Capture screenshots or transcripts in the PR description.
- [ ] T068 Run the full CI pipeline locally: `pnpm tsc --noEmit && pnpm eslint . && pnpm vitest run && pnpm turbo build && pnpm test:e2e`. All gates green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: T001. Single task; no dependencies.
- **Phase 2 (Foundational)**: T002–T015. Blocks every user story.
  - Within Phase 2: T002 → T003 (same file); T004 / T005 / T006 [P]; T007 / T008 [P]; T009 → T010 → T011 (migration sequence); T012 / T013 / T014 / T015 [P with each other but after T007–T011 land].
- **Phase 3 (US1)**: T016–T024. Depends on Phase 2.
- **Phase 4 (US3)**: T025–T031. Depends on Phase 2; can run in parallel with Phase 3 (different files; SOP state JSON shape extensions in T029 are coordinated with T022 via `state-machine.ts` — recommend US3 after US1 or single-developer ownership of `state-machine.ts`).
- **Phase 5 (US2)**: T032–T042. Depends on Phase 2 + Phase 3 (US1's `branch-lookup.ts`) + Phase 4 (US3's Step 6 satisfaction signal).
- **Phase 6 (US4)**: T043–T056. Depends on Phase 2 + Phase 5 (US2's runtime is needed for Preview & Test integration in T055; T049–T051 only need Phase 2).
- **Phase 7 (US5)**: T057–T058. Depends on Phase 3 (default-only path must exist).
- **Phase 8 (Polish)**: T059–T068. Depends on Phase 3 + Phase 5 (logging events fire from runtime modules in those phases). T060/T061 only depend on Phase 5 schema additions.

### User Story Dependencies (within MVP)

- **US1 (P1) — Bug fix**: First. The bug fix is the headline value of this feature.
- **US3 (P1) — Reorder default SOP with contact at Step 6**: Independent of US1's runtime changes; can land in parallel.
- **US2 (P1) — Configured Car Accident branch**: Depends on US1 + US3 (needs `branch-lookup.ts` from US1 and Step 6 satisfaction signal from US3).
- **US4 (P1) — Admin dashboard for branches**: Can begin API work (T049–T051) after Phase 2; UI integration (T052–T056) needs Phase 5 for Preview & Test.
- **US5 (P2) — Open-ended continuation**: Validation of pre-existing spec 010 behaviour against the new default-only path. Smallest story; depends only on US1.

### Within Each User Story

Per Constitution III: tests in the diff BEFORE implementation. Each user story's "Tests for User Story N" subsection MUST land in a commit that fails red before the subsequent implementation tasks land.

### Parallel Opportunities

- T002–T005 (Zod schema authoring) all live in different files within `packages/shared/`; fully [P].
- T007 and T008 (schema.ts edits) are in the SAME file but disjoint regions; coordinate via single PR.
- T012, T013, T014, T015 (seed + boot-time migrations) are all [P] once T007–T011 (DB schema + migration) land.
- T016–T018 (US1 tests) are [P] across three different files.
- T032–T035 (US2 tests) are [P] across four different files.
- T043–T048 (US4 tests) are [P] across six different files.
- T059, T060, T061, T065, T066 (Phase 8 [P] tasks) all hit different files.

### Cross-Story Dependencies (intentional, minimal)

- US2's T039 (state-machine integration) requires US1's T022 (state-machine refactor) and US3's T029 (SOP-state JSON shape). The integration commit lands once both predecessors are in.
- US4's T055 (Preview & Test integration) requires US2's branch_version_id pinning (T041).

---

## Parallel Example: Phase 2 Foundation Sprint

```bash
# Single dev or small team — Phase 2 all-hands sprint
# Day 1: schema authoring (all [P])
Task: "T002 Author branchChipSchema, branchQuestionSchema in packages/shared/src/schemas/branch.ts"
Task: "T004 Author branch-api response/request schemas in packages/shared/src/schemas/branch-api.ts"
Task: "T005 Extend leadSchema in packages/shared/src/schemas/lead.ts"

# Day 2: DB schema + migration (sequential)
Task: "T007 Add branches and branch_versions tables to packages/api/src/db/schema.ts"
Task: "T008 Add branch_snapshot_json + branch_incomplete columns to leads in packages/api/src/db/schema.ts"
Task: "T009 Generate Drizzle migration 0004_multi_branch_sop.sql"
Task: "T010 TypeScript migration body for spec 015 → spec 016 data copy"

# Day 3: seed + boot-time migrations (all [P] after Day 2)
Task: "T012 Update default-sop.ts seed to include Step 6"
Task: "T013 Add car-accident-branch.ts seed JSON fixture"
Task: "T014 Replace ensureCarAccidentScoring → ensureCarAccidentBranch"
Task: "T015 Extend ensure-contact-step.ts for boot-time SOP migration"
```

## Parallel Example: User Story 1 (the headline bug fix)

```bash
# Single PR; all three test tasks land in the same commit
Task: "T016 Tool-registry test in packages/api/src/app/api/chat/tool-registry.test.ts"
Task: "T017 Regression Playwright spec smoke-016-criminal-defense.spec.ts"
Task: "T018 branch-lookup.test.ts unit tests"

# Then implementation (sequential within US1)
Task: "T019 Implement branch-lookup.ts"
Task: "T020 Delete follow-up-tool.ts and references"
Task: "T021 Remove analyzeAndFollowUp from chat route tool map"
Task: "T022 State-machine adds step6_contact and removes step6_followup_ai"
Task: "T023 Advancer dispatches to branch_lookup after Step 6"
Task: "T024 Verify smoke-016-criminal-defense passes"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: T001 (baseline check).
2. Phase 2: T002–T015 (schemas + DB + boot-time migrations + seed).
3. Phase 3: T016–T024 (US1 — the bug fix).
4. **STOP and VALIDATE**: Run `pnpm test:e2e -- smoke-016-criminal-defense`. The regression is fixed.
5. Optional: deploy this MVP to staging. The widget no longer leaks Car Accident questions into other case types. Branches dashboard is not yet present, but the bug is fixed.

### Recommended incremental order (P1 stories first)

1. Setup + Foundation → Phase 2 checkpoint.
2. **US1 (T016–T024)** → MVP / bug fix shipped.
3. **US3 (T025–T031)** → Step 6 contact gating in place.
4. **US2 (T032–T042)** → Configured Car Accident branch live.
5. **US4 (T043–T056)** → Admin dashboard. Largest story.
6. **US5 (T057–T058)** → Continuation regression check.
7. **Phase 8 (T059–T068)** → Logging, leads dashboard surfacing, full validation.

### Parallel team strategy

With three developers and a deep familiarity with the spec 010 / 015 codebase:

1. All three complete Phase 2 together (T002–T015) — one day.
2. Once Phase 2 is in:
   - Dev A: US1 (T016–T024) — small, the headline bug fix.
   - Dev B: US3 (T025–T031) — Step 6 / contact gating.
   - Dev C: US4 backend (T043–T051) — API endpoints.
3. After A + B land:
   - All three converge on US2 (T032–T042) — depends on both A and B.
4. After US2 lands:
   - Dev C wraps US4 dashboard UI (T052–T056).
   - Dev A or B does US5 (T057–T058) and starts Phase 8.

---

## Notes

- Constitution III (NON-NEGOTIABLE): every implementation task in this list has at least one preceding test task. The task sequence reflects this — T016–T018 before T019–T023; T025–T026 before T027–T029; T032–T035 before T036–T041; T043–T048 before T049–T056.
- Constitution VI: T020–T021 (delete `analyzeAndFollowUp`) restore the agent to exactly two tools. T016 codifies this invariant in tests.
- Constitution V: T030 enforces the "every captured lead has at least one reachable contact channel" invariant at the application layer (DB-level CHECK is impractical cross-platform).
- All tasks include exact file paths. No vague "create model" entries.
- The plan.md estimated ~25 tasks; this list has 68 tasks at the granularity Constitution III's test-first rule requires. The MVP slice (Phase 1–3) is 24 tasks, matching the plan estimate.
- Commit cadence: commit after each task or each logical pair (test + implementation).
