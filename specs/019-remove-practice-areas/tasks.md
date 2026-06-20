---
description: "Task list for Remove Practice Areas — Consolidate on Case Types (019)"
---

# Tasks: Remove Practice Areas — Consolidate on Case Types

**Input**: Design documents from `specs/019-remove-practice-areas/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Constitution III requires test-first. Test updates are included inline with each story phase.

**Organization**: US1 (remove PA tab), US2 (out-of-scope field), US3 (greeting chips from case types), and US4 (system prompt simplification) share a common foundational dependency (schema change). US3 and US4 can proceed in parallel once the foundation is done.

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Schema change and read-time migration that all user stories depend on. Must complete before any dashboard, widget, or system-prompt work.

- [x] T001 [P] Add `out_of_scope_response: z.string().default('')` as a top-level field to `configurationSchema` in `packages/shared/src/schemas/configuration.ts` (place after `persona` field, before `practice_areas`)
- [x] T002 [P] Make `practice_areas` optional in `configurationSchema` in `packages/shared/src/schemas/configuration.ts` — change `practice_areas: practiceAreasSchema` to `practice_areas: practiceAreasSchema.optional()`
- [x] T003 Add read-time migration shim in `packages/api/src/lib/config.ts` — after parsing `config_json`, if `config.out_of_scope_response` is absent or empty AND `config.practice_areas?.out_of_scope_response` is non-empty, copy the nested value to the top-level field (depends on T001/T002 — type must exist first)
- [x] T004 Rebuild shared package to update dist types: run `pnpm --filter @legal-chatbot/shared build` and verify `pnpm --filter @legal-chatbot/shared exec tsc --noEmit` passes (depends on T001/T002)

**Checkpoint**: `Configuration` TypeScript type has `out_of_scope_response: string` at top level; `practice_areas` is `PracticeAreas | undefined`. Shared package builds clean.

---

## Phase 2: User Story 1 — Remove Practice Areas Tab (Priority: P1) 🎯 MVP

**Goal**: The Configuration page no longer has a "Practice Areas" tab; the UI section is gone entirely.

**Independent Test**: Navigate to `/dashboard/config`. Verify the tab bar shows exactly 6 tabs: Persona, Questions, Boundaries, Escalation, Contact, Custom — no "Practice Areas" tab present.

### Tests for User Story 1

- [x] T005 [US1] Update `defaultConfig` in `packages/api/src/app/dashboard/config/config-form.tsx` — remove the `practice_areas` key from the default state object; add `out_of_scope_response: ''` at the top level (must do before removing the section to avoid runtime errors)

### Implementation for User Story 1

- [x] T006 [US1] In `packages/api/src/app/dashboard/config/config-form.tsx` — remove `'Practice Areas'` from the `tabs` array; the new tabs array is `['Persona', 'Questions', 'Boundaries', 'Escalation', 'Contact', 'Custom']` (depends on T005)
- [x] T007 [US1] In `packages/api/src/app/dashboard/config/config-form.tsx` — remove the `{activeTab === 1 && <PracticeAreasSection config={config} setConfig={setConfig} />}` render branch; shift all subsequent `activeTab === N` comparisons down by 1 (e.g., old index 2 becomes 1, etc.) (depends on T006)
- [x] T008 [US1] In `packages/api/src/app/dashboard/config/config-form.tsx` — delete the `PracticeAreasSection` component function (lines ~170–228) and the `DEFAULT_PRACTICE_AREAS` constant (depends on T007)

**Checkpoint**: Dashboard Config page renders with 6 tabs. No Practice Areas tab. `pnpm --filter @legal-chatbot/api exec tsc --noEmit` passes.

---

## Phase 3: User Story 2 — Out-of-Scope Response Field (Priority: P1)

**Goal**: The out-of-scope response text is editable from the Configuration page → Boundaries tab as a standalone field.

**Independent Test**: Open Configuration → Boundaries tab. Verify "Out-of-Scope Response" textarea is present, pre-populated with the account's saved value. Edit and save; start a chat and ask an out-of-scope question; verify the chatbot uses the updated text.

### Implementation for User Story 2

- [x] T009 [US2] In `packages/api/src/app/dashboard/config/config-form.tsx` — in `BoundariesSection`, add "Out-of-Scope Response" textarea at the bottom reading from/writing to `config.out_of_scope_response` (not `config.practice_areas.out_of_scope_response`) (depends on T008 — `defaultConfig` must have the field and Practice Areas tab must be gone)
- [x] T010 [US2] Update `packages/api/src/db/seed.ts` — remove the `practice_areas` object from the seeded config; add `out_of_scope_response: "I'm not able to help with that area, but I'd recommend reaching out to another attorney who specializes in that practice area."` at the top level of the config object (depends on T001/T002)

**Checkpoint**: Boundaries tab shows the out-of-scope textarea. Editing it and saving persists the new value. Old `practice_areas.out_of_scope_response` data is not corrupted.

---

## Phase 4: User Story 3 — Greeting Chips from Case Types (Priority: P1)

**Goal**: The `/api/config` endpoint returns `in_scope_case_types` (not `practice_areas`); the widget greeting screen quick-reply chips reflect in-scope case types.

**Independent Test**: Mark a case type out-of-scope in SOP → Case Types tab. Open widget; verify that case type chip is absent from the greeting screen. Mark it back in-scope; verify chip appears.

### Tests for User Story 3

- [x] T011 [P] [US3] In `packages/widget/src/components/ChatPanel.test.tsx` — rename `practice_areas` → `in_scope_case_types` in all 5 test fixture objects (these tests will fail until T014 renames the prop; write the rename first so the intent is captured)
- [x] T012 [P] [US3] In `packages/widget/src/components/ChatWidget.test.tsx` — rename `practice_areas: []` → `in_scope_case_types: []` in the 1 fixture object

### Implementation for User Story 3

- [x] T013 [US3] In `packages/api/src/app/api/config/route.ts` — replace `practice_areas: [...config.practice_areas.active, ...config.practice_areas.custom.filter(Boolean)]` with `in_scope_case_types: caseTypes.filter(ct => ct.is_in_scope).sort((a, b) => a.position - b.position).map(ct => ct.label)` (depends on T001/T002 — `config.practice_areas` is now optional so the old access would fail TypeScript)
- [x] T014 [US3] In `packages/widget/src/components/ChatPanel.tsx` — rename `practice_areas: string[]` → `in_scope_case_types: string[]` in the `WidgetConfig` interface; update `options={widgetConfig.practice_areas}` → `options={widgetConfig.in_scope_case_types ?? []}` (depends on T013 — API must return the new field name first)
- [x] T015 [US3] In `packages/widget/src/components/ChatWidget.tsx` — rename the `practice_areas` field in the `WidgetConfig` type/interface to `in_scope_case_types` (depends on T014 — same type, sequential)
- [x] T016 [US3] In `packages/widget/src/components/QuickReplies.tsx` — add `?? []` default guard to the `options` prop usage if not already present, so `undefined` renders no chips rather than crashing (depends on T015)
- [x] T017 [US3] In `packages/widget/src/components/QuickReplies.test.tsx` — update comment text from "firm with no practice_areas" to "firm with no in_scope_case_types" (parallel with T016, different concern)

**Checkpoint**: `/api/config` returns `in_scope_case_types` array. All widget tests pass. Greeting chips match in-scope case types.

---

## Phase 5: User Story 4 — System Prompt Simplification (Priority: P1)

**Goal**: The system prompt always derives in-scope areas from case types; the legacy fallback is removed; `out_of_scope_response` is read from the promoted field.

**Independent Test**: Inspect the system prompt for a chat session (structured logs). Confirm "Practice Areas (In Scope)" block lists in-scope case type labels. With all case types out-of-scope, confirm the block is empty (no fallback to old `practice_areas.active` strings).

### Tests for User Story 4

- [x] T018 [US4] In `packages/api/src/lib/system-prompt.test.ts` — update `testConfig` fixture to add `out_of_scope_response: 'Test deflection'` at the top level (depends on T001/T002 — the type must accept the field)
- [x] T019 [US4] In `packages/api/src/lib/system-prompt.test.ts` — remove the test `'SOP path with empty case_types falls back to legacy practice_areas'` entirely (this behavior is being deleted)
- [x] T020 [US4] In `packages/api/src/lib/system-prompt.test.ts` — update test `'out-of-scope deflection text remains from config.practice_areas...'` to assert `config.out_of_scope_response` (renamed field); update assertion to match `testConfig.out_of_scope_response`
- [x] T021 [US4] In `packages/api/src/lib/system-prompt.test.ts` — update test `'legacy path (no SOP) uses config.practice_areas...'` — this test now should verify that in-scope list comes from case types (empty list yields empty "Practice Areas" block); remove reference to `practice_areas.active` fallback

### Implementation for User Story 4

- [x] T022 [US4] In `packages/api/src/lib/system-prompt.ts` — remove the `computeInScopeAreas` function entirely; replace its call site with inline: `const inScopeAreas = (caseTypes ?? []).filter(ct => ct.is_in_scope).sort((a, b) => a.position - b.position).map(ct => ct.label);` (depends on T018–T021 — tests must be updated first)
- [x] T023 [US4] In `packages/api/src/lib/system-prompt.ts` — change `config.practice_areas.out_of_scope_response` → `config.out_of_scope_response` at the "Out of Scope Response" line (depends on T022 — same file, sequential)
- [x] T024 [US4] In `packages/api/src/lib/system-prompt.ts` — remove the `sopActive` variable (it was only used to switch in-scope source, now unused) (depends on T023)

**Checkpoint**: System prompt tests pass. `composeSystemPrompt` no longer references `config.practice_areas`. `pnpm --filter @legal-chatbot/api exec tsc --noEmit` clean.

---

## Phase 6: Polish & Verification

- [x] T025 Run `pnpm --filter @legal-chatbot/shared exec vitest run` — all shared tests pass
- [x] T026 Run `pnpm --filter @legal-chatbot/api exec vitest run` — all 596+ api tests pass
- [x] T027 Run `pnpm --filter @legal-chatbot/widget exec vitest run` — all widget tests pass
- [x] T028 Run TypeScript check across all three packages: `pnpm --filter @legal-chatbot/api exec tsc --noEmit`, `pnpm --filter @legal-chatbot/shared exec tsc --noEmit`, `pnpm --filter @legal-chatbot/widget exec tsc --noEmit` — zero errors
- [x] T029 Grep verification — zero unguarded references remain: `grep -rn "practice_areas\.out_of_scope_response\|widgetConfig\.practice_areas" packages --include="*.ts" --include="*.tsx" | grep -v "node_modules\|\.d\.ts"` must return no matches
- [x] T030 Manual validation per quickstart.md Scenarios 1–6

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No external dependencies — T001 and T002 run in parallel; T003 depends on T001/T002; T004 depends on T003.
- **US1 (Phase 2)**: Depends on Phase 1 (T001/T002 must be done so `defaultConfig` can omit `practice_areas`).
- **US2 (Phase 3)**: Depends on Phase 2 (T008 must be complete — Practice Areas section must be removed before adding the out-of-scope field to Boundaries).
- **US3 (Phase 4)**: Depends on Phase 1 (T001/T002 for TypeScript; T013 can run immediately after). Can proceed in parallel with US2 since they touch different files.
- **US4 (Phase 5)**: Depends on Phase 1 (schema types). Can proceed in parallel with US2/US3 for test tasks (T018–T021); implementation tasks (T022–T024) depend on test tasks.
- **Polish (Phase 6)**: Depends on all prior phases complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 1 only.
- **US2 (P1)**: Depends on US1 (out-of-scope field goes where Practice Areas section was).
- **US3 (P1)**: Depends on Phase 1 only — runs in parallel with US1/US2 on different files.
- **US4 (P1)**: Depends on Phase 1 only — runs in parallel with US1/US2/US3 on different files.

### Within Each User Story

- Test updates before implementation for US4.
- Same-file tasks sequential; cross-file tasks parallel.

### Parallel Opportunities

- T001 + T002 (Phase 1): different lines of same file — logically parallel, but since they're in the same file do them sequentially.
- T011 + T012 (Phase 4 tests): different files, truly parallel.
- US3 (Phase 4) + US4 (Phase 5 test tasks T018–T021): different files, parallel after Phase 1.

---

## Parallel Example: Phase 4 (US3) + Phase 5 test prep (US4)

```bash
# These can launch simultaneously after Phase 1 completes:
Task T011: "Rename practice_areas in ChatPanel.test.tsx fixtures"
Task T012: "Rename practice_areas in ChatWidget.test.tsx fixture"
Task T018: "Add out_of_scope_response to system-prompt.test.ts testConfig"
Task T019: "Remove legacy fallback test from system-prompt.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Phase 1 (Foundational schema changes)
2. Complete Phase 2 (US1 — remove Practice Areas tab)
3. Complete Phase 3 (US2 — add out-of-scope response field to Boundaries)
4. **STOP and VALIDATE**: Configuration page has 6 tabs; out-of-scope textarea in Boundaries; no data loss
5. Deploy/demo the Config page change independently

### Full Delivery Order

1. Phase 1 → Schema types ready
2. Phase 2 (US1) → Tab removed
3. Phase 3 (US2) → Field relocated
4. Phase 4 (US3) → Chips from case types (can overlap with 3)
5. Phase 5 (US4) → System prompt simplified (can overlap with 3/4)
6. Phase 6 → Verification

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in the phase
- Every task has an exact file path
- `practiceAreasSchema` export is preserved (deprecated) — it is still needed for the optional type in the schema and for the migration shim in T003
- The `sopActive` variable removal (T024) is cosmetic but important — it references `config.practice_areas` indirectly via `computeInScopeAreas` and its removal completes the cleanup
- Widget bundle size impact: removing `practice_areas` string from the API response is trivial; no bundle size concern
