# Research: Forward-Only SOP Workflow (018)

**Branch**: `018-remove-multi-answer-volunteer`
**Date**: 2026-06-20
**Source spec**: `specs/018-remove-multi-answer-volunteer/spec.md`

---

## R1 — Scope of skip-detection code

**Decision**: `skip-detector.ts` is the primary module to delete, and `advancer.ts` is its caller — that file becomes the re-ask orchestrator instead.

**Rationale**: All multi-step inference logic lives in `packages/api/src/lib/sop/skip-detector.ts`. The `advancer.ts` module (`advanceForVisitorMessage`) calls `detectSkippedSteps` and applies every match as a `capture_step` action. Under the forward-only model the advancer must still call the skip-detector for one purpose only: capture the **current pending step** (single-step mode). The chip and date-inference capabilities inside `skip-detector.ts` must not be deleted wholesale — they handle chip-tap and "When" date normalization for the current pending step. What changes is the call site in `advancer.ts`: instead of applying every match returned by `detectSkippedSteps`, only the match for `pendingStepBefore` is applied; future-step matches are ignored.

**Alternatives considered**:
- Delete `skip-detector.ts` entirely and inline a simplified chip/date matcher into `advancer.ts`. Rejected: would duplicate the LLM-backed date-inferer wire-up and the `chipSlugToIsoDate` fast-path; more risk for minimal gain.
- Keep `skip-detector.ts` as-is and gate its output in `advancer.ts`. Selected approach — minimal diff, easier to test, no logic duplication.

---

## R2 — What changes in `advancer.ts`

**Decision**: Filter `detectSkippedSteps` output to only the match whose `step_id` equals `pendingStepBefore.id`. Discard any additional matches.

**Rationale**: `detectSkippedSteps` already scans all pending steps. Under the new model we only ever want the match for the currently-pending step. The contact-form short-circuit path at the top of `advanceForVisitorMessage` is unchanged (it already only handles the pending `contact_form` step). The correction-signal path (re-capture of completed `case_type`/`sub_type` on "actually..." messages) is **also removed** — it is a form of backward correction that re-opens closed steps, which conflicts with the forward-only model. We keep correction detection as a **best-effort free-text capture** rather than a distinct state-machine action.

**What stays**:
- Contact-form short-circuit (handles Step 6 contact step explicitly)
- `autoFinalizeIfReady` call
- Out-of-scope termination after a case_type chip capture
- `pendingStepBefore` return value (used by off-SOP detour detector in `route.ts`)

**What changes**:
- After calling `detectSkippedSteps`, only apply the match for `pendingStepBefore.id`
- Remove the `caseTypeCorrection`/`subTypeAlsoCorrected` correction-signal block
- Remove the `reset_step` action trigger for stale sub_type on case_type correction

---

## R3 — Re-ask counter placement in state

**Decision**: Add `reask_count` as a field per step in `SOPStateStep` (inside the `steps` array in `sopStateSchema`), not as a top-level field.

**Rationale**: Re-ask count is per-step, not per-SOP. The existing `contact_retry_count` on `SOPState` is a special-case counter for the contact step — a different pattern. Adding `reask_count` per step mirrors how `inferred` already lives per step, keeps the state shape symmetric, and avoids a second parallel array for tracking re-ask counts.

**Backwards compatibility**: `sopStateStepSchema` adds `reask_count: z.number().int().min(0).optional().default(0)`. Sessions serialized before this change deserialize cleanly with `reask_count = 0` (Zod's `.default(0)` handles missing field on parse).

**Where the counter increments**: Inside `advancer.ts` — when `detectSkippedSteps` returns no match for the pending step, before returning `{ state: input.state, matches: [], pendingStepBefore }`, the advancer increments `reask_count` on the pending step's state entry. When the counter reaches the configured limit, the advancer applies a `skip_step` action and resets the counter.

---

## R4 — Re-ask limit configuration location

**Decision**: Expose the re-ask limit as a named constant `SOP_REASK_LIMIT` in `packages/shared/src/constants/sop.ts` (new file). Default value: `3`. Minimum: `1`. Validated at module import time (throw if env override sets it below 1).

**Rationale**: The spec says "internally configured." A named constant in the shared package is the appropriate location per the project's pattern (Constitution II: shared types in `packages/shared`). An environment-variable override (`SOP_REASK_LIMIT_OVERRIDE`) is not required for MVP but the constant's module can be the extension point.

**Alternatives considered**:
- Hardcode `3` directly in `advancer.ts`. Rejected: makes testing re-ask-limit edge cases (value = 1, value = 5) harder without mock injection.
- Add a database-backed per-account setting now. Rejected: explicitly out of scope (spec section "Out of Scope"). Post-feature upgrade path is clear.

---

## R5 — Effect on `system-prompt-extension.ts`

**Decision**: No changes to `composeSopBlock` content. Minor change: remove the note in the comment that references "skip-detector inferred captures" since `inferred: true` steps will no longer exist in new sessions.

**Rationale**: The system-prompt block already shows completed steps with `[✓]` regardless of whether they were inferred or directly answered. The `inferred` field on `SOPStateStep` is preserved in the schema (it still exists for historical sessions and for chip-tap direct captures where `inferred: false`). Under the new model every captured step will have `inferred: false` because skip-detector matches for future steps are discarded — chip taps of the pending step still come through as `source: 'chip'` from the detector, which maps to `inferred: true` in `advancer.ts`. This is a minor semantic shift but does not break the system prompt block.

**Post-feature cleanup** (out of scope): the `inferred` flag on `SOPStateStep` could be removed entirely, but that requires a migration and is deferred.

---

## R6 — `sop_step_inferred` log event removal

**Decision**: Remove `sop_step_inferred` from the structured-log event enum in `packages/api/src/lib/sop/branch-events.ts` (or wherever the SOP log-event types are defined). The log call site inside `advancer.ts` that emits it is also removed.

**Rationale**: FR-005 requires this. Without the underlying logic the event would never fire anyway, but removing the type keeps the log schema clean.

**Verification**: Grep for `sop_step_inferred` after implementation to confirm zero remaining references.

---

## R7 — E2E test cleanup

**Decision**: Delete `packages/api/tests/e2e/widget-us2-skip-detection.walk.spec.ts`. References to skip-detection in other E2E specs (`widget-us1-happy-path.walk.spec.ts`, `widget-sop-subtype-chips.walk.spec.ts`, `smoke-016-personal-injury.walk.spec.ts`) are retained or updated to reflect the forward-only model — they use the skip-detector as a chip-tap recognizer for the *current* step which continues to work.

**Rationale**: The US2 walk spec specifically tests multi-step skip detection — FR-016 scenarios — which are removed by this feature. Other walk specs may reference the skip-detector incidentally but their core assertion (US1 happy path, sub-type chip rendering, personal-injury branch) does not depend on multi-step detection.

---

## R8 — `state-machine.ts` changes

**Decision**: Remove the `reset_step` action type. It is only used by the correction-signal path in `advancer.ts` (which is removed in R2). The `finalize` guard that checks `requiredPending` calls `applyFinalize` — that stays unchanged.

**Rationale**: `reset_step` has no other callers. Removing it shrinks the action union from 5 to 4 members and simplifies the exhaustiveness check. If correction-signal re-opens steps in a future feature, it can be re-added.

**Alternative**: Leave `reset_step` as an unused-but-harmless action. Rejected: dead code increases maintenance burden and contradicts spec FR-004 ("all skip-detection code paths introduced by the former User Story 2 MUST be removed").

---

## R9 — `pending_contact` stash in `route.ts`

**Decision**: The `pending_contact` stash logic in `route.ts` (spec 016 US3) is **unchanged**. It scans every visitor message for volunteered contact info independently of the SOP step sequence. This is not part of the removed User Story 2; it is a 016 feature. The spec for 018 explicitly says "Out of Scope: Changes to…any other 010-sop-workflow behavior not listed."

---

## R10 — Summary of file changes

| File | Change |
|------|--------|
| `packages/api/src/lib/sop/skip-detector.ts` | No content deletion — only call-site filtering changes in `advancer.ts`. The module is kept as-is. |
| `packages/api/src/lib/sop/advancer.ts` | Filter `detectSkippedSteps` output to pending step only; remove correction-signal block; add re-ask counter increment logic. |
| `packages/api/src/lib/sop/state-machine.ts` | Remove `reset_step` action and its handler. |
| `packages/shared/src/schemas/sop.ts` | Add `reask_count` field to `sopStateStepSchema`. |
| `packages/shared/src/constants/sop.ts` | NEW — exports `SOP_REASK_LIMIT = 3`, `SOP_REASK_LIMIT_MIN = 1`. |
| `packages/api/src/lib/sop/advancer.test.ts` | Update: remove multi-step detection test cases; add re-ask counter tests. |
| `packages/api/src/lib/sop/skip-detector.test.ts` | No change (pure unit tests for the chip/date detector still valid). |
| `packages/api/tests/e2e/widget-us2-skip-detection.walk.spec.ts` | **DELETE** |
| `packages/api/src/app/api/chat/route.ts` | No change (advancer interface unchanged). |
| `packages/api/src/lib/sop/branch-events.ts` (or equivalent log-event file) | Remove `sop_step_inferred` event type. |
| Agent context file | Update `<!-- SPECKIT -->` block to point to this plan. |
