---
description: "Task list for Forward-Only SOP Workflow (018-remove-multi-answer-volunteer)"
---

# Tasks: Forward-Only SOP Workflow

**Input**: Design documents from `specs/018-remove-multi-answer-volunteer/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, quickstart.md ✅

**Tests**: Tests are included per Constitution III (test-first is NON-NEGOTIABLE).

**Organization**: Tasks are grouped by user story. US1 (forward-only) and US2 (re-ask counter) both modify `advancer.ts` — US1 must complete first since it restructures the function body that US2 extends.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks in this phase)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Schema additions and constant file that US1 and US2 depend on. `reset_step` removal also here — it is a prerequisite for Phase 2 (US1 removes the only caller).

**⚠️ CRITICAL**: All Phase 2+ work depends on this phase being complete.

- [x] T001 [P] Create `packages/shared/src/constants/sop.ts` — export `export const SOP_REASK_LIMIT = 3` and `export const SOP_REASK_LIMIT_MIN = 1` as plain number constants; no runtime logic in this file
- [x] T002 [P] Add `reask_count: z.number().int().min(0).optional().default(0)` field to `sopStateStepSchema` in `packages/shared/src/schemas/sop.ts` (position: after the `captured_label` field)
- [x] T003 Add `reask_count: 0` to each step object built inside `initSOPState` in `packages/api/src/lib/sop/state-machine.ts` (depends on T002 — the SOPStateStep type must include the field first)
- [x] T004 Remove the `reset_step` action type from the `SOPAction` union, remove the `applyReset` function, and remove its `case 'reset_step'` branch from `advanceSOP` in `packages/api/src/lib/sop/state-machine.ts`; confirm the exhaustiveness check still compiles with the 4 remaining action types (depends on T003 — same file, sequential)

**Checkpoint**: `pnpm tsc --noEmit` passes. `sopStateStepSchema` includes `reask_count`. `reset_step` is gone from state-machine.ts.

---

## Phase 2: User Story 1 — Forward-Only Progression (Priority: P1) 🎯 MVP

**Goal**: The SOP advances at most one step per turn; future pending steps are never proactively captured from a single visitor message.

**Independent Test**: See quickstart.md Scenario 1 — send a rich multi-detail opening message; verify progress bar shows `1/6` and Step 2 is asked next.

### Tests for User Story 1 ⚠️ Write and confirm FAIL before T007–T008

- [x] T005 [US1] Write failing test `"does not apply future-step matches — bar advances by 1 only"` in `packages/api/src/lib/sop/advancer.test.ts`: craft a message matching Steps 1 + 3 + 5 simultaneously (case_type + where + date phrase); assert only Step 1 (the pending step) is captured, Steps 3 and 5 remain `pending`, `current_progress === 1`
- [x] T006 [US1] Write failing test `"off-SOP turn does not capture future steps"` in `packages/api/src/lib/sop/advancer.test.ts`: craft a message that is off-topic but contains a sub_type chip substring; assert Step 2 (sub_type) remains `pending` when Step 1 is still the pending step

### Implementation for User Story 1

- [x] T007 [US1] In `packages/api/src/lib/sop/advancer.ts`: after `detectSkippedSteps` returns `allMatches`, add a filter — `const currentMatch = allMatches.find(m => m.step_id === pendingStepBefore?.id) ?? null` — and discard all other entries; replace the existing loop `for (const m of matches)` with a single-match apply using `currentMatch`; the `AdvanceForVisitorMessageResult.matches` field now contains at most one entry (depends on T004 — `reset_step` must be removed before touching advancer)
- [x] T008 [US1] In `packages/api/src/lib/sop/advancer.ts`: remove the correction-signal block — delete the `caseTypeCorrection`, `subTypeAlsoCorrected` variable declarations and the `if (caseTypeCorrection && !subTypeAlsoCorrected)` block that dispatched `reset_step` (same file, sequential after T007)

**Checkpoint**: T005 and T006 tests now pass. `pnpm --filter @legal-chatbot/api test -- src/lib/sop/advancer.test.ts` green. US1 quickstart Scenario 1 validated manually.

---

## Phase 3: User Story 2 — Re-Ask Counter (Priority: P1)

**Goal**: When a pending SOP step receives no usable answer, the assistant re-asks it; after `SOP_REASK_LIMIT` (default 3) unanswered turns the step is marked `skipped` and the SOP advances.

**Independent Test**: See quickstart.md Scenario 2 — send 3 non-answers to Step 1; on turn 4, Step 1 is skipped and Step 2 is asked.

### Tests for User Story 2 ⚠️ Write and confirm FAIL before T012

- [x] T009 [US2] Write failing test `"increments reask_count on unanswered turn"` in `packages/api/src/lib/sop/advancer.test.ts`: unanswered turn → `state.steps[0].reask_count === 1` (depends on T005/T006 being written — same file, sequential)
- [x] T010 [US2] Write failing test `"skips step when reask_count reaches SOP_REASK_LIMIT"` in `packages/api/src/lib/sop/advancer.test.ts`: 3 consecutive unanswered turns → `state.steps[0].status === 'skipped'`; verify next pending step advances to Step 2
- [x] T011 [US2] Write failing test `"resets reask_count to 0 on step completion"` in `packages/api/src/lib/sop/advancer.test.ts`: 2 unanswered turns followed by a valid answer → `state.steps[0].status === 'complete'` and `state.steps[0].reask_count === 0`

### Implementation for User Story 2

- [x] T012 [US2] In `packages/api/src/lib/sop/advancer.ts`: add a private `incrementReaskCount` helper function (see data-model.md "incrementReaskCount helper" for the algorithm); import `SOP_REASK_LIMIT` from `@legal-chatbot/shared/constants/sop`; in the `if (currentMatch === null)` branch (no capture for pending step), replace the bare `return { state: input.state, matches: [], pendingStepBefore }` with a call to `incrementReaskCount(input.state, pendingStepBefore.id, SOP_REASK_LIMIT, sopConfig)` and return its result; reset `reask_count` to `0` on the `capture_step` path by spreading `reask_count: 0` onto the updated step in `applyCapture` in `state-machine.ts` (depends on T007/T008)

**Checkpoint**: T009, T010, T011 tests now pass. `pnpm --filter @legal-chatbot/api test -- src/lib/sop/advancer.test.ts` fully green. Quickstart Scenarios 2 and 3 validated manually.

---

## Phase 4: User Story 3 — Remove Skip-Detection Code (Priority: P1)

**Goal**: All test artifacts and code paths specific to the former multi-step US2 behavior are deleted; structured-log event `sop_step_inferred` is confirmed absent.

**Independent Test**: See quickstart.md Scenario 6 — `ls packages/api/tests/e2e/widget-us2-skip-detection.walk.spec.ts` returns "No such file". Grep for `reset_step`, `caseTypeCorrection`, `sop_step_inferred` returns zero hits.

- [x] T013 [P] [US3] Delete `packages/api/tests/e2e/widget-us2-skip-detection.walk.spec.ts` entirely
- [x] T014 [P] [US3] In `packages/api/src/lib/sop/advancer.test.ts`: remove any remaining test cases that assert multi-step skip-detection behavior (cases inherited from the pre-018 advancer tests that verify `matches.length > 1` or `current_progress > 1` per turn for a single-turn multi-step message)
- [x] T015 [US3] Update the comment on Turn 1 in `packages/api/tests/e2e/smoke-016-personal-injury.walk.spec.ts` — change "skip-detected from 'car accident'" to "forward-only detection for pending case_type step" (preserves the test assertion, corrects the terminology)

**Checkpoint**: `widget-us2-skip-detection.walk.spec.ts` is absent. Full grep verification (T016) finds zero dead references.

---

## Phase 5: Polish & Verification

**Purpose**: Type safety, dead-code confirmation, and full test suite validation.

- [x] T016 Run grep to confirm zero remaining references: `grep -rn "reset_step\|caseTypeCorrection\|subTypeAlsoCorrected\|sop_step_inferred" packages --include="*.ts" --include="*.tsx" | grep -v "node_modules\|\.d\.ts"`; fix any matches found
- [x] T017 Run `pnpm tsc --noEmit` across all packages; resolve any type errors introduced by the `reset_step` removal or `reask_count` addition
- [x] T018 Run `pnpm --filter @legal-chatbot/api test` and `pnpm --filter @legal-chatbot/shared test`; all tests must pass; confirm no test still references `FR-016` or `FR-018` multi-step skip logic
- [x] T019 Run `pnpm eslint .`; resolve any linting errors

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No external dependencies — start immediately
  - T001 and T002 can run in parallel (different files)
  - T003 depends on T002 (same file, `reask_count` type must exist)
  - T004 depends on T003 (same file, sequential)
- **US1 (Phase 2)**: Depends on Phase 1 completion (T004 must be done before T007)
  - T005 and T006 can start immediately after Phase 1 (writing tests)
  - T007 depends on T004 and T005
  - T008 depends on T007
- **US2 (Phase 3)**: Depends on Phase 2 completion (T007/T008 must be done before T012)
  - T009, T010, T011 are sequential (same file, adding tests)
  - T012 depends on T011 (implementation after tests written)
- **US3 (Phase 4)**: T013 and T015 can run in parallel with Phase 3 (different files); T014 depends on Phase 3 being complete (test file changes must not conflict)
- **Polish (Phase 5)**: Depends on all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 1 (Foundational) — No dependency on US2 or US3
- **US2 (P1)**: Depends on US1 completion (same file, advancer.ts refactored first)
- **US3 (P1)**: Mostly parallel — E2E deletion (T013) can happen any time; advancer test cleanup (T014) should follow US2

### Within Each User Story

- Tests MUST be written and confirmed FAILING before implementation
- Same-file tasks are always sequential
- Implementation follows test writing

### Parallel Opportunities

- T001 and T002 (Phase 1): different files, run in parallel
- T013 and T015 (Phase 4): different files, run in parallel with US2 implementation
- T016 through T019 (Phase 5): each is independent, can run in parallel

---

## Parallel Example: Foundational Phase

```bash
# These two can launch simultaneously (different files):
Task T001: "Create packages/shared/src/constants/sop.ts"
Task T002: "Add reask_count to sopStateStepSchema in packages/shared/src/schemas/sop.ts"

# After both complete, run T003 then T004 sequentially in state-machine.ts
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: Foundational
2. Complete Phase 2: US1 (forward-only)
3. **STOP and VALIDATE**: Run quickstart.md Scenario 1 manually — rich message no longer skips steps
4. The re-ask counter (US2) and removal cleanup (US3) can follow

### Full Delivery Order

1. Phase 1 (Foundational) → Schema ready
2. Phase 2 (US1) → Forward-only behavior active; tests green
3. Phase 3 (US2) → Re-ask counter active; tests green
4. Phase 4 (US3) → Dead code removed
5. Phase 5 (Polish) → TypeScript clean, full suite green

---

## Notes

- `skip-detector.ts` is NOT deleted or changed — it still serves as the chip/date matcher for the single current pending step. Only its call site in `advancer.ts` changes.
- The `inferred` field on `SOPStateStep` is retained for backwards compatibility with existing sessions; it is not removed by this feature.
- `sop_step_inferred` was never emitted in code (FR-058 was specified but not implemented); T016 grep confirms this with zero hits — no code change required.
- `pending_contact` stash in `route.ts` (spec 016) is out of scope and unchanged.
- All 19 tasks are in this feature's `packages/api` and `packages/shared` scope — no widget, dashboard, or crawler changes.
