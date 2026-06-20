# Data Model: Forward-Only SOP Workflow (018)

**Branch**: `018-remove-multi-answer-volunteer`
**Date**: 2026-06-20
**Parent**: `specs/010-sop-workflow/data-model.md`

This document covers only the delta from the 010 data model. All entities not mentioned here are unchanged.

---

## Changed Entity: SOPStateStep

**Location**: `packages/shared/src/schemas/sop.ts` — `sopStateStepSchema`

### Delta

Add one new field to the per-step runtime state:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reask_count` | `integer ≥ 0` | `0` | Number of assistant turns in which this step has been re-asked without receiving a usable answer. Initialized to 0 when the step becomes the current pending step. Increments by 1 for each turn that produces no capture for this step (including off-SOP turns). Resets to 0 when the step transitions to `complete`. Does NOT reset on `skipped`. |

### Backwards Compatibility

`reask_count` is declared `optional().default(0)` in the Zod schema. Sessions serialized before this feature deploy will parse successfully; missing field is coerced to `0`.

### State Transitions for `reask_count`

```text
STATE: pending (reask_count = n)
  ├── visitor answers step correctly         → status = complete, reask_count = 0
  ├── visitor does not answer (reask_count < SOP_REASK_LIMIT)
  │                                          → status = pending, reask_count = n + 1
  └── visitor does not answer (reask_count ≥ SOP_REASK_LIMIT)
                                             → status = skipped, reask_count = n + 1
                                               (SOP advances to next pending step)

STATE: complete                              → reask_count irrelevant (frozen at 0)
STATE: skipped                              → reask_count irrelevant (frozen at limit)
```

---

## New Constant: SOP_REASK_LIMIT

**Location**: `packages/shared/src/constants/sop.ts` (new file)

| Name | Value | Description |
|------|-------|-------------|
| `SOP_REASK_LIMIT` | `3` | Maximum number of turns a step can be re-asked without a capture before it is skipped. |
| `SOP_REASK_LIMIT_MIN` | `1` | Minimum permitted value. Any configured value below this must be rejected at startup. |

---

## Removed: `reset_step` Action

**Location**: `packages/api/src/lib/sop/state-machine.ts` — `SOPAction` union

The `reset_step` action type is removed. Its only caller was the correction-signal path in `advancer.ts` (case_type correction → stale sub_type reset), which is also removed.

The `SOPAction` union after this change:

```text
SOPAction =
  | { type: 'capture_step'; step_id; value; capturedAt; inferred?; capturedLabel? }
  | { type: 'skip_step'; step_id }
  | { type: 'finalize' }
  | { type: 'finalize_out_of_scope' }
```

---

## Removed: Multi-Step Capture from `advancer.ts`

The `advanceForVisitorMessage` result type retains the same interface shape — `{ state, matches, pendingStepBefore }` — but `matches` will now always contain at most one entry (the current pending step's match, if any). Callers that inspect `matches.length` continue to work; the off-SOP detour detector in `route.ts` uses `matches.length === 0 && pendingStep != null` which remains correct.

### Updated Logic Flow in `advancer.ts`

```text
advanceForVisitorMessage(input):
  pendingStepBefore = nextPendingStep(state, config)

  if state.is_finalized → return unchanged

  // Contact-form short-circuit (unchanged from 010)
  if pendingStepBefore?.chip_source === 'contact_form':
    ...handle contact form...

  // Detect match for CURRENT PENDING STEP ONLY
  allMatches = await detectSkippedSteps(...)
  currentMatch = allMatches.find(m => m.step_id === pendingStepBefore.id) ?? null

  if currentMatch is null:
    // No capture — increment reask_count
    newState = incrementReaskCount(state, pendingStepBefore.id, SOP_REASK_LIMIT)
    return { state: newState, matches: [], pendingStepBefore }

  // Apply capture for the pending step only
  newState = advanceSOP(state, { type: 'capture_step', step_id: currentMatch.step_id, ... })

  // Handle out-of-scope termination
  if currentMatch.out_of_scope:
    newState = advanceSOP(newState, { type: 'finalize_out_of_scope' })
  else:
    newState = autoFinalizeIfReady(newState, config)

  return { state: newState, matches: [currentMatch], pendingStepBefore }
```

### `incrementReaskCount` helper (internal to `advancer.ts`)

```text
incrementReaskCount(state, stepId, limit):
  stepIndex = state.steps.findIndex(s => s.step_id === stepId)
  currentCount = state.steps[stepIndex].reask_count ?? 0
  newCount = currentCount + 1
  if newCount >= limit:
    // Skip the step
    newState = advanceSOP(state, { type: 'skip_step', step_id: stepId })
    // reask_count on the now-skipped step is frozen at newCount (informational)
    return { ...newState, steps: newState.steps.map(s =>
      s.step_id === stepId ? { ...s, reask_count: newCount } : s
    )}
  else:
    return { ...state, steps: state.steps.map(s =>
      s.step_id === stepId ? { ...s, reask_count: newCount } : s
    )}
```

---

## No Changes Required

The following entities are **unchanged** by this feature:

- `SOPConfiguration` / `SOPStep` — no schema changes
- `SOPState` top-level fields — no new fields
- `CaseType`, `SubType`, `GoodbyePhrase` — no changes
- `SOPStateHeaderPayload` (wire format to widget) — `current`, `total`, `pending_step_id`, etc. all unchanged
- Database schema — `sop_state_json` column persists `SOPState` as JSON; the added `reask_count` field serializes transparently
- `sessions` table — no column additions
- `leads` table — no changes
