# Quickstart & Validation Guide: Forward-Only SOP Workflow (018)

**Branch**: `018-remove-multi-answer-volunteer`
**Date**: 2026-06-20

---

## Prerequisites

- Local dev stack running: `pnpm dev` (API + widget test app + context store)
- Database migrated and seeded: `pnpm db:migrate && pnpm db:seed`
- No `SOP_REASK_LIMIT_OVERRIDE` env var set (tests use the default of 3)

---

## Validation Scenarios

### Scenario 1 — Forward-Only: Multi-Detail Message Does NOT Skip Steps

**What it proves**: Spec US1 / FR-001 to FR-003

**Steps**:
1. Open the widget on the test app.
2. Send: `"Hi, I was hit by a driver running a red light at 5th and Main last week. I think I have a personal-injury case."`
3. Observe the assistant's response.

**Expected**:
- The progress bar shows `1/6` (only case_type captured — Step 1 was presented, the message answers it).
- The assistant asks Step 2 (sub-type): something like "What kind of personal injury matter is this?"
- The progress bar does NOT show `4/6` or higher.

**What would fail (old behavior)**:
- Progress bar jumps to `4/6` (case_type + where + what + when all captured at once).
- Assistant asks Step 5 or Step 6 immediately.

---

### Scenario 2 — Re-Ask: Unanswered Step Gets Re-Asked Up To 3 Times

**What it proves**: Spec US2 / FR-006 to FR-009

**Steps**:
1. Start a fresh chat. Let the assistant present Step 1 (case type).
2. Send 3 non-answer messages, e.g.:
   - Turn 1: `"Can you tell me about your fees?"`
   - Turn 2: `"What are your office hours?"`
   - Turn 3: `"Do you work on weekends?"`
3. Observe each response: the assistant should answer the off-topic question AND re-ask Step 1 at the end.
4. Send a 4th non-answer message.

**Expected after turns 1–3**: Step 1 remains pending; `reask_count` for Step 1 is incrementing (visible via the pending_step_id in the `x-sop-state` header staying `step_1`).

**Expected on turn 4 (the 4th non-answer — reask_count hits limit)**:
- Step 1 is marked `skipped`; progress bar stays at `0/6`.
- The assistant asks Step 2 (sub-type).

---

### Scenario 3 — Re-Ask Resets on Correct Answer

**What it proves**: Spec US2 / FR-011 (counter resets on completion)

**Steps**:
1. Start a fresh chat. Get to Step 1.
2. Send 2 non-answers (reask_count becomes 2).
3. Send `"DUI"` as the next message.

**Expected**:
- Step 1 is marked `complete` with `captured_value = 'dui'`.
- The assistant asks Step 2.
- `reask_count` for Step 1 is frozen at 0 (reset on completion).

---

### Scenario 4 — Chip Tap Still Works for Current Pending Step

**What it proves**: Skip-detector chip matching still works for the single pending step

**Steps**:
1. Open the widget. Let the assistant ask Step 1 (case type).
2. Click the "DUI" chip (or type "DUI").

**Expected**:
- Step 1 captured as `dui`.
- Progress bar: `1/6`.
- Step 2 (sub-type) asked next.

---

### Scenario 5 — Date Inference Still Works for "When" Step

**What it proves**: Date inferrer still works when "when" IS the current pending step

**Steps**:
1. Drive the chat through Steps 1–4 (case_type, sub_type, where, what).
2. When Step 5 ("When did it happen?") is asked, type: `"It happened last Tuesday."`

**Expected**:
- Step 5 captured with an inferred ISO date.
- Progress bar reaches `5/6`.
- Step 6 (contact form) presented.

---

### Scenario 6 — US2 Walk Spec Is Deleted

**What it proves**: FR-017 (old US2 tests removed)

**Steps**:
```bash
ls packages/api/tests/e2e/widget-us2-skip-detection.walk.spec.ts
```

**Expected**: File not found (`No such file or directory`).

---

### Scenario 7 — Unit Test: Re-Ask Counter in State Machine

**What it proves**: FR-014 to FR-016 (state field), FR-006 to FR-009 (advancer logic)

**Steps**:
```bash
pnpm --filter @legal-chatbot/api test -- src/lib/sop/advancer.test.ts
```

**Expected**: All tests pass. Specifically look for tests named:
- `"increments reask_count when step not answered"`
- `"skips step after reask_count reaches limit"`
- `"resets reask_count to 0 on step completion"`
- `"does not apply future-step matches"`

---

### Scenario 8 — Type Check Passes

**What it proves**: No TypeScript errors from removing `reset_step` and adding `reask_count`

**Steps**:
```bash
pnpm tsc --noEmit
```

**Expected**: Zero type errors.

---

### Scenario 9 — Full Test Suite Passes

**Steps**:
```bash
pnpm test
```

**Expected**: All unit and integration tests pass. If the old skip-detection tests were removed correctly, no test references `FR-016`/`FR-018` multi-step capture behavior.

---

## Key Files to Inspect

| File | What to verify |
|------|----------------|
| `packages/shared/src/schemas/sop.ts` | `sopStateStepSchema` has `reask_count` field |
| `packages/shared/src/constants/sop.ts` | Exports `SOP_REASK_LIMIT = 3` and `SOP_REASK_LIMIT_MIN = 1` |
| `packages/api/src/lib/sop/advancer.ts` | No `caseTypeCorrection` block; `detectSkippedSteps` result filtered to pending step only; `incrementReaskCount` helper present |
| `packages/api/src/lib/sop/state-machine.ts` | No `reset_step` case in switch; `SOPAction` union has 4 members |
| `packages/api/tests/e2e/` | `widget-us2-skip-detection.walk.spec.ts` is absent |
