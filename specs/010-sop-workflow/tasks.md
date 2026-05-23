---

description: "Tasks for SOP Workflow"
---

# Tasks: SOP Workflow

**Input**: Design documents from `/specs/010-sop-workflow/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED per Constitution Principle III (Test-First). Each helper module gets a Vitest unit test file authored before the implementation; widget components get React component tests; the full default-SOP flow gets a Playwright E2E spec; observability is verified via 4 new eval scenarios in the existing `evals/` suite from Phase 8.

**Organization**: Tasks are grouped by user story (US1–US6) to enable independent implementation and testing. Phase 2 (Foundational) is the only gating prerequisite — once schema + shared schemas + seed are in place, US1–US6 can proceed in parallel where dependencies permit.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6); not used for Setup, Foundational, or Polish phases
- Include exact file paths in descriptions

## Path Conventions

- **Repository root**: `/Users/ayushsingh/spikes/legal-chatbot`
- All paths in this file are repo-relative (e.g., `packages/api/src/lib/sop/...`)
- New top-level directories created by this feature: none — every file lives inside an existing workspace package per plan.md Structure Decision

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install the new dashboard drag-and-drop dependency and stub out the new directory tree so subsequent tasks have file-paths to write into. No runtime behavior changes here.

- [X] T001 Add `@dnd-kit/sortable`, `@dnd-kit/core`, `@dnd-kit/accessibility` as dependencies of `packages/api` via `pnpm --filter @legal-chatbot/api add @dnd-kit/sortable @dnd-kit/core @dnd-kit/accessibility`; verify `package.json` lists them under `dependencies` (NOT devDependencies, per plan.md Constitution IV note)
- [X] T002 [P] Verify `@dnd-kit/sortable` ships no native binaries by running `find packages/api/node_modules/@dnd-kit -name "*.node"`; output MUST be empty (Constitution IV invariant); record verification in plan.md Complexity Tracking note if any binary appears
- [X] T003 [P] Create empty directory `packages/api/src/lib/sop/` with a `.gitkeep` placeholder
- [X] T004 [P] Create empty directory `packages/api/src/db/seed-defaults/` with a `.gitkeep` placeholder
- [X] T005 [P] Create empty directory `packages/api/src/app/dashboard/sop/` with a `.gitkeep` placeholder
- [X] T006 [P] Create empty directory `packages/api/src/app/api/dashboard/sop/` with a `.gitkeep` placeholder
- [X] T007 [P] Create empty directory `packages/api/tests/e2e/` if absent (it should exist from Phase 8); idempotent

**Checkpoint**: After Phase 1 the repo has the new dep, the directory tree exists, and the constitution-required pure-JS check has passed. No runtime changes yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema migration, shared Zod schemas, default-SOP seed, system-prompt composer wiring, and CORS header exposure. Every user story depends on these landing first because (a) no SOP code paths can run without `sop_state_json`, (b) every helper module imports from `@legal-chatbot/shared`, (c) the widget cannot consume the `x-sop-state` header without the CORS update, and (d) the dev account must have a published SOP for any quickstart flow to work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Foundation 2A — Shared Schemas (Constitution II)

- [X] T008 Create `packages/shared/src/schemas/sop.ts` containing `sopStepSchema`, `sopConfigurationSchema`, `caseTypeSchema`, `subTypeSchema`, `goodbyePhraseSchema`, `sopStateSchema`, `sopStateHeaderSchema` per `contracts/sop-state-contract.md`; export all types from the file
- [X] T009 Update `packages/shared/src/schemas/index.ts` to re-export everything from `./sop`
- [X] T010 [P] Update `packages/shared/src/schemas/configuration.ts` to mark `qualifying_questions` as deprecated via JSDoc (`@deprecated Use SOP via 010-sop-workflow`); do NOT remove the field — R11 lazy migration depends on it remaining readable

### Foundation 2B — Drizzle Schema Migration (Constitution VII)

- [X] T011 Extend `packages/api/src/db/schema.ts`: add 5 new table definitions (`sopConfigurations`, `sopSteps`, `caseTypes`, `subTypes`, `goodbyePhrases`) per `data-model.md` "New Tables"; include all FK constraints and unique indexes
- [X] T012 Extend `packages/api/src/db/schema.ts`: add `sopStateJson: text('sop_state_json')` column to `sessions` table (nullable)
- [X] T013 Extend `packages/api/src/db/schema.ts`: add `sopStateSnapshot: text('sop_state_snapshot')` column to `leads` table (nullable)
- [X] T014 [P] Mirror schema changes in `packages/api/src/db/test-schema.ts` (SQLite mirror used by Vitest)
- [X] T015 Generate migration with `pnpm --filter @legal-chatbot/api db:generate`; commit the generated SQL file under `packages/api/drizzle/` (filename auto-numbered by drizzle-kit)
- [~] T016 Run `pnpm --filter @legal-chatbot/api db:migrate` against local PG to verify migration applies without errors **— DEFERRED.** Local Docker not running and no compose file exists in this repo (Foundation quickstart claim was aspirational). Migration was statically validated at generation time by drizzle-kit (12 tables resolved, FKs + indexes recorded, no diff conflicts). Re-attempt when Foundation's Docker compose lands OR run against staging Neon during deploy. Tracked here so we don't ship to prod without verification.

### Foundation 2C — Default SOP Seed (R1)

- [X] T017 [P] Create `packages/api/src/db/seed-defaults/sop.ts` exporting the `DEFAULT_SOP_STEPS`, `DEFAULT_CASE_TYPES`, `DEFAULT_GOODBYE_PHRASES` constants per `data-model.md` "Default Seed (TS Constants)"; constants MUST be Zod-validated at module-load time via `sopStepSchema.array().parse(...)` etc. (Constitution II)
- [X] T018 Extend `packages/api/src/db/seed.ts` to invoke a new `seedSopForAccount(accountId)` helper for the dev account; helper inserts one `sop_configurations` row (`version=1, is_published=true, qualified_lead_threshold=5`), 5 `sop_steps` rows from `DEFAULT_SOP_STEPS`, 6 `case_types` rows + nested sub_types from `DEFAULT_CASE_TYPES`, 7 `goodbye_phrases` rows from `DEFAULT_GOODBYE_PHRASES`. Idempotent: if account already has an `sop_configurations` row, skip.
- [~] T019 Run `pnpm --filter @legal-chatbot/api db:seed` and confirm via `db:query` that the dev account has 1 SOP, 5 steps, 6 case types, ≥18 sub-types, 7 goodbye phrases **— DEFERRED.** Same constraint as T016 (Docker not running locally; seed depends on T016 migration which itself is deferred). The seed code is statically typed against the same shared schemas and runs Zod validation on module-load (T017's `Object.freeze(...parse(...))` pattern). Re-run after T016 lands.

### Foundation 2D — CORS Header Exposure (Constitution IV)

- [X] T020 Update CORS module `packages/api/src/app/api/chat/cors.ts` (plan.md said `lib/cors.ts` — path correction noted) to add `x-sop-state` to the `Access-Control-Expose-Headers` response header (per `contracts/sop-state-contract.md` "Wire Shape"); add a Vitest assertion in `cors.test.ts` that the header value contains `x-sop-state`

### Foundation 2E — System-Prompt Composer Hook (Block 4 stub)

- [X] T021 Refactor `packages/api/src/lib/system-prompt.ts → composeSystemPrompt` signature to accept three new optional params: `sopState?: SOPState`, `sopConfig?: SOPConfiguration`, `goodbyePhrases?: string[]`; preserve all existing behavior when params are undefined (legacy `composeLegacyIntakeBlock` path remains as-is); add unit test in `packages/api/src/lib/system-prompt.test.ts` covering both branches

**Checkpoint**: After Phase 2 the schema is migrated, shared schemas exist, the dev account has a published SOP with case types + sub-types + goodbye phrases, the CORS header is exposed, and the system-prompt composer accepts the new optional SOP params (still no-op). User stories can now proceed in parallel.

---

## Phase 3: User Story 1 - Default SOP Happy Path (Priority: P1) 🎯 MVP

**Goal**: A visitor completes the 5 default SOP steps end-to-end (case-type → sub-type → where → what → when), Step 6 generates 2-5 follow-up questions, the lead is captured with the SOP-state snapshot persisted to `leads.sop_state_snapshot`.

**Independent Test**: From `quickstart.md` US1: open the widget, walk through "DUI → First Offense → 5th and Main → I was pulled over... → Yesterday", answer follow-ups, and verify (a) progress bar advanced 0/5 → 5/5, (b) `lead_captured` event in logs with `sop_finalization_reason='step_6_finalize'`, (c) `leads.sop_state_snapshot` is non-null and Zod-valid.

### Tests for User Story 1 (TDD — write FIRST, ensure FAIL before implementation)

- [X] T022 [P] [US1] Write Vitest tests for `packages/api/src/lib/sop/state-machine.test.ts` covering: init from published SOP → all-pending; `capture_step` action flips status; `skip_step` flips to skipped; `finalize` with all required complete sets `is_finalized=true`; `finalize` with required pending throws; `out_of_scope_termination` action sets both flags; current_progress only counts steps with `counts_toward_threshold=true`. Tests MUST fail initially.
- [X] T023 [P] [US1] Write Vitest tests for `packages/api/src/lib/sop/system-prompt-extension.test.ts` covering: all-pending state lists steps with [ ]; mid-flow shows [✓] + truncated captured values; all-complete instructs `analyzeAndFollowUp` tool; finalized omits step list; PII redaction strips email/phone/name patterns from displayed captured values; 20-step SOP block ≤ 1100 tokens (token regression test). Tests MUST fail initially.
- [X] T024 [P] [US1] Write Vitest tests for `packages/api/src/lib/sop/follow-up-tool.test.ts` covering: `mode='follow_up'` returns 2-5 questions; output >5 questions truncated to 5 (FR-026); LLM error → fallback `mode='finalize'` with generic message (FR-028, R6). Tests MUST fail initially.
- [X] T025 [P] [US1] Write Vitest tests for `packages/api/src/lib/sop/date-inferer.test.ts` covering: "yesterday" relative to a fixed conversation_anchor returns correct ISO date; ambiguous "couple weekends ago" with confidence < 0.6 returns null; future-date input returns null with low confidence; date is computed against `conversation_anchor_iso` not `Date.now()`. Tests MUST fail initially.
- [X] T026 [P] [US1] Write Vitest tests for `packages/api/src/lib/leads.test.ts` extension covering: `captureLead` with `sop_state=null` (legacy backward compat) → row inserted with `sop_state_snapshot=null`; with populated `sop_state` → row inserted with JSON-serialized snapshot; roundtrip read back parses Zod-valid; `out_of_scope_termination` flag preserved. Tests MUST fail initially.

### Implementation for User Story 1

- [X] T027 [P] [US1] Implement `packages/api/src/lib/sop/state-machine.ts` exporting `initSOPState(sopConfig, conversationAnchorIso)`, `advanceSOP(state, action, sopConfig)` (signature includes sopConfig as 3rd arg so `current_progress` can be computed from `counts_toward_threshold` and `finalize` can validate `is_required`), `nextPendingStep(state, sopConfig)` per `contracts/sop-state-contract.md` "Persistent Shape" + `data-model.md` "State Transitions"; pure-functional immutable updates; T022 tests pass
- [X] T028 [P] [US1] Implement `packages/api/src/lib/sop/date-inferer.ts` exporting `inferDate({ userText, conversationAnchorIso }) → { iso_date, confidence }`; uses `@ai-sdk/google` Gemini provider with structured-output prompt per R3; threshold 0.6; T025 tests pass
- [X] T029 [P] [US1] Implement `packages/api/src/lib/sop/follow-up-tool.ts` exporting `analyzeAndFollowUp` Vercel AI SDK tool definition per `contracts/system-prompt-extension-contract.md` R6; hard cap 5 questions; LLM-error fallback to finalize mode; T024 tests pass
- [X] T030 [US1] Implement `packages/api/src/lib/sop/system-prompt-extension.ts` exporting `composeSopBlock(sopState, sopConfig, goodbyePhrases)` returning Markdown per `contracts/system-prompt-extension-contract.md` "Block Layout"; PII redaction helper for captured values; T023 tests pass
- [ ] T031 [US1] Wire SOP state load + persist into the chat route at `packages/api/src/app/api/chat/route.ts`: on each turn (a) load `sessions.sop_state_json`, init from published SOP if absent, (b) call `composeSystemPrompt` with new SOP params, (c) register `analyzeAndFollowUp` tool, (d) on `onFinish` persist updated `sop_state_json` and emit the `x-sop-state` response header (using `sopStateHeaderSchema`). Reuse existing `appendMessages` write path for atomicity (Constitution VII).
- [X] T032 [US1] Extend `captureLead` tool in `packages/api/src/lib/leads.ts`: add `sop_state` parameter to schema (nullable), persist as JSON to `leads.sop_state_snapshot`, extend log payload with `sop_finalization_reason`; T026 tests pass; existing Phase 5 tests continue to pass
- [ ] T033 [US1] Update `/api/config` route in `packages/api/src/app/api/config/route.ts` to include current published SOP's chip data for the visitor's pending step: `{ step_id, step_label, chips: Array<{label, slug}> | null, accepts_free_text: boolean }`; chips reference live `case_types`/`sub_types` rows or `inline_chips_json`; gracefully handles accounts with no published SOP (omits SOP fields)
- [ ] T034 [P] [US1] Implement `packages/widget/src/hooks/useSOPState.ts` exporting `useSOPState()` hook that parses `x-sop-state` from each `useChat` response and returns `{ current, total, isFinalized, pendingStepId, pendingStepSlug }`; falls back to last-known on missing header; sessionStorage-persisted between page reloads
- [ ] T035 [P] [US1] Implement `packages/widget/src/components/Chips.tsx` rendering chip-buttons that on click dispatch the chip label as user message text (works with existing `useChat`); accessible (button role, aria-label); reads chip data from `/api/config` response shared via context
- [ ] T036 [P] [US1] Write component tests for `packages/widget/src/components/Chips.test.tsx` covering render with chips list; click dispatches label; empty chips array renders nothing; aria attributes present
- [ ] T037 [US1] Wire `<Chips>` into `packages/widget/src/components/ChatPanel.tsx` so chips render after the latest assistant message when the current pending SOP step has chips and visitor has not yet answered the step
- [ ] T038 [US1] Create Playwright E2E spec `packages/api/tests/e2e/sop.spec.ts → "default SOP happy path (US1)"`: walks DUI → First Offense → free-text where → free-text what → Yesterday chip → answers follow-ups; asserts progress bar text 0/5 → 5/5; asserts a `leads` row inserted with non-null `sop_state_snapshot` matching `sopStateSchema`

**Checkpoint**: After Phase 3 the default 5-step SOP runs end-to-end for the dev account, Step 6 follow-up generation works, leads are captured with snapshot, and the Playwright happy-path E2E passes deterministically.

---

## Phase 4: User Story 2 - Multi-Detail Skip Detection (Priority: P1)

**Goal**: When a visitor answers multiple SOP steps in a single message, the skip-detector marks all answered steps complete and the agent asks only the earliest still-pending step next.

**Independent Test**: From `quickstart.md` US2: open fresh chat, type "I was in a car accident last week downtown and need help. It was a hit-and-run on 5th avenue.", verify ≥ 2 `sop_step_inferred` events in logs from a single turn AND the next pending step in the response is the earliest unfilled.

### Tests for User Story 2 (TDD)

- [ ] T039 [P] [US2] Write Vitest tests for `packages/api/src/lib/sop/skip-detector.test.ts` covering: Phase A pattern match — "I had a DUI" matches case_type slug; "first offense DUI" matches both case_type AND sub_type; "5th and Main" extracted as where; "yesterday" extracted as when via date-inferer; Phase B LLM disambiguation — "drunk driving offense" maps to DUI case_type after Phase A produces 0 high-confidence matches; ambiguous matches with confidence < 0.6 are dropped (FR-018); detector is stateless w.r.t. session DB. Tests MUST fail initially.

### Implementation for User Story 2

- [ ] T040 [P] [US2] Implement `packages/api/src/lib/sop/skip-detector.ts` exporting `detectSkippedSteps({ message, sopState, sopConfig, caseTypes, subTypes }) → Array<{ step_id, captured_value, confidence, source: 'pattern' | 'llm' }>`; Phase A regex/keyword pass against case_types.slug, sub_types.slug, date-inferer for date expressions, free-text extraction for where/what (proper nouns + location keywords); Phase B LLM disambiguation gated to ≤1 LLM call per turn (only when Phase A returns 0 matches AND ≥2 pending steps); T039 tests pass
- [ ] T041 [US2] Wire skip-detector into `packages/api/src/app/api/chat/route.ts` BEFORE the LLM call: run `detectSkippedSteps` on the visitor's latest message, apply matches as `capture_step` actions to SOP state, log each capture as `sop_step_inferred` with source. Re-runs idempotently — already-complete steps are skipped.
- [ ] T042 [US2] Add Playwright E2E case in `packages/api/tests/e2e/sop.spec.ts → "skip detection (US2)"`: types "I was in a car accident last week downtown and need help. It was a hit-and-run on 5th avenue." as the first message; asserts progress bar advances by ≥ 2 in one turn; asserts the next pending step is the earliest unanswered

**Checkpoint**: Visitors who volunteer information out of order are not asked redundant questions; the SOP advances naturally.

---

## Phase 5: User Story 3 - Off-SOP Detour (Priority: P1)

**Goal**: When a visitor asks an off-topic question mid-SOP, the agent answers it AND ends the response by re-prompting the pending SOP step.

**Independent Test**: From `quickstart.md` US3: in mid-flow at the sub_type step, type "What are your office hours?"; verify the response includes office hours AND ends with "What kind of Personal Injury matter is this?"; progress bar unchanged.

### Tests for User Story 3 (TDD)

- [ ] T043 [P] [US3] Write Vitest tests for `packages/api/src/lib/sop/off-sop-detour.test.ts` covering: message with 0 R4 captures + no chip-slug match for pending step + ≤ 1 keyword overlap with pending step's question → classified as off-topic; message that DOES partially answer the pending step → NOT classified as off-topic; message at SOP-finalized state → never classified as off-topic (no detour needed). Tests MUST fail initially.

### Implementation for User Story 3

- [ ] T044 [P] [US3] Implement `packages/api/src/lib/sop/off-sop-detour.ts` exporting `isOffTopic({ message, pendingStep, skipDetectorMatches }) → boolean` per R5 heuristic; T043 tests pass
- [ ] T045 [US3] Wire off-SOP detour signal into `packages/api/src/lib/sop/system-prompt-extension.ts → composeSopBlock`: when `isOffTopic === true` AND state is not finalized, the block adds an explicit "Off-SOP detour rule" instruction telling the agent to answer the visitor question first, then re-prompt the pending step
- [ ] T046 [US3] Emit `sop_off_topic_detour` log event from `packages/api/src/app/api/chat/route.ts` whenever `isOffTopic` returns true; payload `{ pending_step_id, message_token_count }` per data-model.md
- [ ] T047 [US3] Add Playwright E2E case in `packages/api/tests/e2e/sop.spec.ts → "off-SOP detour (US3)"`: in mid-flow types "What are your office hours?"; asserts response contains the configured office hours phrase AND the pending step's question_text; asserts progress bar value unchanged; asserts at least one `sop_off_topic_detour` event in captured server logs

**Checkpoint**: Visitors can ask any guardrail-allowed question mid-SOP without breaking the qualification flow.

---

## Phase 6: User Story 4 - Progress Bar Engagement (Priority: P1)

**Goal**: A thin shiny green progress bar at the top of the chat panel advances visibly with each captured SOP step, supporting `prefers-reduced-motion`, and stays at 100% post-completion.

**Independent Test**: From `quickstart.md` US4: open chat, observe bar at 0/N, answer steps, observe smooth fill animation + shimmer; toggle `prefers-reduced-motion: reduce` in DevTools, observe instant updates without animation; complete all steps, observe bar stays at 100%.

### Tests for User Story 4 (TDD)

- [ ] T048 [P] [US4] Write component tests for `packages/widget/src/components/ProgressBar.test.tsx` per `contracts/progress-bar-contract.md` "Tests": ARIA attributes correct; current=3/total=5 → ratio 0.6; current=0 → ratio 0 visible; current=5/total=5 → 1.0; current=8/total=5 → 1.0 (capped); total=0 → returns null; reducedMotion=true → no transition + no shimmer; label aria-hidden=true; verbose ARIA label. Tests MUST fail initially.

### Implementation for User Story 4

- [ ] T049 [P] [US4] Implement `packages/widget/src/components/ProgressBar.tsx` per `contracts/progress-bar-contract.md` "Component Surface" + "DOM Structure": 3px height, `transform: scaleX` fill mechanism, 300ms ease-out, shimmer keyframes; reads `--lc-progress-color`, `--lc-progress-bg`, `--lc-progress-label-color` CSS custom props; T048 tests pass
- [ ] T050 [P] [US4] Add CSS keyframes + class definitions for `.lc-progress-bar`, `.lc-progress-bar-track`, `.lc-progress-bar-fill`, `.lc-progress-bar-fill::after` (shimmer pseudo), `.lc-progress-bar-label` to `packages/widget/src/styles/widget.css`; include `@media (prefers-reduced-motion: reduce)` block disabling transition + shimmer; viewport `< 360px` hides label per research.md R8
- [ ] T051 [US4] Wire `<ProgressBar>` into `packages/widget/src/components/ChatPanel.tsx`: render at top of panel above sticky header (mobile) / above panel header (tablet/desktop), reading `current` and `total` from `useSOPState()` hook (T034); passes `reducedMotion` prop from existing `useReducedMotion` hook from Phase 4
- [ ] T052 [US4] Run `pnpm --filter @legal-chatbot/widget size` (Phase 8 size-limit gate) and confirm widget bundle stays within ≤ 35 KB NPM / ≤ 50 KB CDN gz budgets after `<ProgressBar>` + `<Chips>` additions; if budget exceeded, profile + trim before declaring story complete

**Checkpoint**: Visual progress bar engagement works across all breakpoints, respects reduced motion, and the widget bundle stays under budget.

---

## Phase 7: User Story 5 - No-Goodbye Behavior (Priority: P2)

**Goal**: The bot does not bid goodbye unless the visitor explicitly says one of the configured goodbye phrases. Otherwise every response ends with the next pending SOP step (or, when finalized, an open re-prompt).

**Independent Test**: From `quickstart.md` US5: type "Okay great, that's helpful info." mid-flow → response does NOT close with a goodbye; type "thanks!" → response uses the configured polite closing.

### Tests for User Story 5 (TDD)

- [ ] T053 [P] [US5] Write Vitest tests for `packages/api/src/lib/sop/goodbye-detector.test.ts` covering: substring word-boundary match against configured phrases; case-insensitive ("Thanks" matches "thanks"); "byelaw" does NOT match "bye" (word boundary); empty phrase list returns no match; returns matched phrase string; multibyte / smart-quote phrase ("that's all" with U+2019) matches when message uses straight ASCII apostrophe (normalize before match). Tests MUST fail initially.

### Implementation for User Story 5

- [ ] T054 [P] [US5] Implement `packages/api/src/lib/sop/goodbye-detector.ts` exporting `detectGoodbye(message: string, configuredPhrases: string[]) → { matched: boolean, phrase?: string }`; word-boundary regex per R7; Unicode-normalize both sides (NFC + smart-quote → ASCII apostrophe) before match; T053 tests pass
- [ ] T055 [US5] Wire `detectGoodbye` into `packages/api/src/app/api/chat/route.ts` BEFORE skip-detection (R7 order); pass result into `composeSystemPrompt` so the goodbye block in the system prompt instructs the agent: "matched=true → use configured polite closing; matched=false → end with next pending SOP step OR open re-prompt if finalized"
- [ ] T056 [US5] Add Playwright E2E case in `packages/api/tests/e2e/sop.spec.ts → "no goodbye behavior (US5)"`: types "Okay great, that's helpful info." mid-flow; asserts response does NOT contain "goodbye" / "have a great day" / "bye"; then types "thanks!"; asserts response contains the configured closing phrase

**Checkpoint**: Conversations stay open until the visitor explicitly disengages.

---

## Phase 8: User Story 6 - Lawyer Configures Custom SOP (Priority: P1)

**Goal**: From the dashboard, a lawyer can view, edit, reorder, and publish a custom SOP via drag-and-drop; the live widget immediately uses the published version.

**Independent Test**: From `quickstart.md` US6: open `/dashboard/sop`, drag-reorder a step, add a custom step, Save, Preview & Test, Publish; verify a new `sop_configurations` row exists with `is_published=true`, prior versions `is_published=false`, fresh widget chat uses the new step list.

### Tests for User Story 6 (TDD — route + UI)

- [ ] T057 [P] [US6] Write Vitest tests for `packages/api/src/app/api/dashboard/sop/route.test.ts` covering: GET returns published SOP + history; POST `action='save'` validates body via `sopActionSchema`, rejects missing positions, rejects threshold > eligible-step count, inserts new version with `is_published=false`; POST `action='publish'` flips published flag exclusively; POST `action='rollback'` copies historical steps into a new version; 401 when unauthenticated; 400 on Zod failure. Tests MUST fail initially.
- [ ] T058 [P] [US6] Write Vitest tests for `packages/api/src/app/api/dashboard/sop/case-types/route.test.ts` covering: GET returns case-types + nested sub-types; POST `action='save'` validates uniqueness within case-type list AND sub-types; transactional diff (insert new, update existing by slug, cascade-delete missing); Zod failures return 400. Tests MUST fail initially.
- [ ] T059 [P] [US6] Write Vitest tests for `packages/api/src/app/api/dashboard/sop/goodbye-phrases/route.test.ts` covering: GET returns phrase list; POST replaces list transactionally; max 50 phrases enforced; min length 1 / max 50 chars per phrase. Tests MUST fail initially.

### Implementation for User Story 6 — Routes

- [ ] T060 [P] [US6] Implement `packages/api/src/app/api/dashboard/sop/route.ts` per `contracts/sop-config-routes-contract.md` `/api/dashboard/sop`: GET, POST with `action='save'|'publish'|'rollback'` discriminated union; iron-session auth guard; T057 tests pass
- [ ] T061 [P] [US6] Implement `packages/api/src/app/api/dashboard/sop/case-types/route.ts` per `contracts/sop-config-routes-contract.md` `/api/dashboard/sop/case-types`: GET, POST `action='save'`; cascade-delete sub_types in the same transaction; T058 tests pass
- [ ] T062 [P] [US6] Implement `packages/api/src/app/api/dashboard/sop/goodbye-phrases/route.ts` per `contracts/sop-config-routes-contract.md` `/api/dashboard/sop/goodbye-phrases`: GET, POST; T059 tests pass

### Implementation for User Story 6 — UI

- [ ] T063 [US6] Implement `packages/api/src/app/dashboard/sop/page.tsx`: server-rendered shell with iron-session auth guard; fetches initial SOP + case-types + goodbye phrases; renders three tabs (SOP Steps, Case Types, Goodbye Phrases); reuses dashboard layout from Phase 6
- [ ] T064 [P] [US6] Implement `packages/api/src/app/dashboard/sop/sop-editor.tsx` (client component): renders ordered step cards using `@dnd-kit/sortable` `SortableContext` + `useSortable` hooks; drag-reorder updates local state; Save button POSTs to `/api/dashboard/sop` with `action='save'`; Publish button POSTs `action='publish'`; loading + error states; reuses Phase 6 dashboard styling
- [ ] T065 [P] [US6] Implement `packages/api/src/app/dashboard/sop/step-form.tsx` (client component): inline form (or modal) for adding/editing a single step; fields per `contracts/sop-config-routes-contract.md` save schema (slug, position, question_text, chip_source, inline_chips_json, accepts_free_text, is_required, counts_toward_threshold); slug regex validation `^[a-z][a-z0-9_]*$`; chip_source dropdown with conditional `inline_chips_json` text-area
- [ ] T066 [P] [US6] Implement `packages/api/src/app/dashboard/sop/case-types-tab.tsx` (client component): drag-and-drop case-types list, expand-to-edit sub-types, toggle `is_in_scope`; Save button POSTs to `/api/dashboard/sop/case-types`
- [ ] T067 [P] [US6] Implement `packages/api/src/app/dashboard/sop/goodbye-phrases-tab.tsx` (client component): simple add/remove chip-style list editor; Save button POSTs to `/api/dashboard/sop/goodbye-phrases`
- [ ] T068 [US6] Add navigation link to the SOP page from the Phase 6 dashboard sidebar at `packages/api/src/app/dashboard/layout.tsx` (or equivalent navigation component)
- [ ] T069 [US6] Verify Phase 6 Preview & Test (§8.10) automatically picks up the latest unpublished SOP version when `x-preview: true` header is set; if not, extend Preview-mode logic at `packages/api/src/lib/preview-mode.ts` to read latest sop_configurations row regardless of `is_published`
- [ ] T070 [US6] Add Playwright E2E case in `packages/api/tests/e2e/sop.spec.ts → "lawyer configures custom SOP (US6)"`: signs in to dashboard; reorders a step via DnD (Playwright `dragTo`); adds a custom step; Save → asserts new `sop_configurations` row with `is_published=false`; Publish → asserts published flag flipped; opens fresh widget chat in a new context and asserts the new step list is in use

**Checkpoint**: Lawyers can self-serve SOP customization end-to-end. The R11 legacy migration runs automatically on first dashboard load for accounts with legacy `qualifying_questions`.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Legacy migration, observability instrumentation, eval-suite scenarios, documentation, and Constitution invariants verification. Each task touches code outside any single user story.

### 9A — Legacy `qualifying_questions` Migration (R11)

- [ ] T071 Implement `packages/api/src/db/migrate-legacy-qualifying-questions.ts` exporting `migrateLegacyQualifyingQuestions(accountId)` per R11: idempotent — skip if account already has `sop_configurations`; reads latest published `configurations.config_json.qualifying_questions`; inserts new SOP version with 5 default steps + 1 custom step per legacy question; sets `derived_from_legacy=true`; emits `legacy_sop_migration` log event with `{ account_id, migrated_step_count }`
- [ ] T072 [P] Write Vitest tests for `packages/api/src/db/migrate-legacy-qualifying-questions.test.ts` covering: idempotent re-run is a no-op; legacy 3-question config produces SOP with 5 default + 3 custom steps; `derived_from_legacy=true` set; account with no legacy questions still gets default SOP; account with no published configuration is skipped (no SOP created)
- [ ] T073 Wire migration trigger into `packages/api/src/app/dashboard/sop/page.tsx`: server-side, BEFORE rendering, call `migrateLegacyQualifyingQuestions(session.accountId)` if no SOP exists for the account; render the page after migration completes

### 9B — Observability (R12, FR-058 to FR-060)

- [ ] T074 [P] Extend Foundation logger redaction list at `packages/api/src/lib/logger.ts` (or shared logger) to redact email/phone/name patterns from any payload field named `captured_value_summary`, `captured_value`, or `brief_description` (the real Phase 5 field name); existing redaction tests extended to verify
- [ ] T075 [P] Add structured-log emissions at the appropriate code-path call sites in `packages/api/src/app/api/chat/route.ts` for the 9 events documented in `data-model.md` "Logging" / `contracts/sop-state-contract.md`: `sop_step_completed`, `sop_step_skipped`, `sop_step_inferred`, `sop_off_topic_detour`, `sop_finalized`, `sop_follow_up_generated`, `sop_qualified`, `sop_out_of_scope_termination`, `legacy_sop_migration` (the migration event is in T071)
- [ ] T076 [P] Add Vitest assertion in `packages/api/src/lib/logger.test.ts` that captured-value summaries emitted via the SOP log events (the 9 events in T075) are stripped of email/phone/name patterns; provides a sanity check that complements the redaction in T074

### 9C — Eval Suite (Phase 8 R5 extension)

- [ ] T077 [P] Author `evals/scenarios/sop-default-happy-path.yml`: 5-turn conversation matching the US1 Playwright spec; expectations cover progress bar advance, follow-up generation, lead capture
- [ ] T078 [P] Author `evals/scenarios/sop-skip-detection.yml`: single-turn message with multiple SOP captures; expectation is ≥ 2 `sop_step_inferred` events + correct earliest pending step in next response
- [ ] T079 [P] Author `evals/scenarios/sop-off-sop-detour.yml`: mid-flow off-topic question; expectation is response answers question AND ends with the pending step's question_text
- [ ] T080 [P] Author `evals/scenarios/sop-no-goodbye.yml`: visitor says "okay great" (NOT a goodbye phrase); expectation is response continues with next step (no goodbye phrasing); follow-up turn says "thanks" → expectation is configured closing message
- [ ] T081 Add the four new scenario filenames to the eval suite's index file (`evals/index.yml` or equivalent from Phase 8 R5)

### 9D — Documentation

- [ ] T082 [P] Create user-facing docs page `docs/sop-workflow.md` covering: what the SOP is, how the default 5 steps work, how to customize from the dashboard, how the progress bar works, how the legacy `qualifying_questions` migration works; cross-link to spec.md
- [ ] T083 [P] Update `docs/dashboard-guide.md` (from Phase 6) with a new "SOP Editor" section pointing to `docs/sop-workflow.md`
- [ ] T084 [P] Update `packages/widget/README.md` to document the three new CSS custom properties (`--lc-progress-color`, `--lc-progress-bg`, `--lc-progress-label-color`) and the conditional progress-bar render behavior (hidden when no SOP threshold)

### 9E — Constitution Invariants Verification

- [ ] T085 Update Phase 8 invariants script `scripts/verify-deploy-invariants.sh` to additionally check that the `@dnd-kit/*` packages contain no `*.node` files post-install (Constitution IV); the existing native-binary scanner should already cover this — verify by running `pnpm verify-invariants` after T001 lands
- [ ] T086 Run `pnpm --filter @legal-chatbot/api test` AND `pnpm --filter @legal-chatbot/widget test` AND `pnpm --filter @legal-chatbot/api test:e2e -- sop.spec.ts`; ensure all green; capture results for the release notes
- [ ] T087 Run the four new eval scenarios via `pnpm eval scenarios/sop-*.yml` and capture pass/fail; failures block the feature from being merged

### 9F — Final Sweep

- [ ] T088 Update `AGENTS.md` SPECKIT block to point at this feature's plan (already done at planning time; verify it still does after merge: `specs/010-sop-workflow/plan.md`)
- [ ] T089 Run `pnpm typecheck` across the monorepo (`pnpm -r typecheck`); fix any remaining TS errors introduced by SOP integration
- [ ] T090 Update `product-spec-legal-chatbot.md` §7.5 + §6.5 with a note pointing to `specs/010-sop-workflow/spec.md` as the active SOP authority; deprecate the §7.5 "qualifying questions" terminology (preserve text for historical reference)

**Checkpoint**: After Phase 9 the SOP feature is production-ready: legacy accounts auto-migrate, all 9 log events flow, the eval suite covers regressions, docs explain the new behavior to lawyers, and Constitution invariants are verified.

---

## Dependencies

```text
Phase 1 (Setup) ─────────────────────┐
                                     ▼
                              Phase 2 (Foundational)
                                     │
                ┌─────────────┬──────┼───────────┬────────────────┐
                ▼             ▼      ▼           ▼                ▼
        Phase 3 (US1)  Phase 4 (US2)  Phase 5 (US3)  Phase 6 (US4)  Phase 7 (US5)
                │             │              │           │              │
                │             │              │           │              │
                ▼             ▼              ▼           ▼              ▼
        ─── all merge ──▶ Phase 8 (US6) ──▶ Phase 9 (Polish)
```

**Hard dependencies** (cannot start until prerequisite completes):

- Phase 2 blocks Phases 3–8 (every story consumes shared schemas + DB tables + composer hook).
- Phase 3 (US1) is the MVP — Phases 4–7 build on the SOP runtime it ships, but their helpers (`skip-detector.ts`, `off-sop-detour.ts`, `goodbye-detector.ts`) are independent of US1's helpers and can be authored in parallel by different engineers.
- Phase 8 (US6 dashboard editor) depends on Phase 2 only — can run in parallel with Phases 3–7.
- Phase 9 depends on Phases 3–8 completing (legacy migration only meaningful once SOP runtime exists; eval scenarios verify all stories together).

**Soft dependencies** within phases noted via `[P]` markers; non-`[P]` tasks within a phase are sequential.

---

## Parallel Execution Examples

### Within Phase 2 (Foundational)

After T015 (migration generated), the following are independent:

```text
T017 (seed-defaults TS constants)   ┐
T020 (CORS update)                  ├─── all parallel
T021 (composeSystemPrompt refactor) ┘
```

T018 (seed.ts wiring) depends on T017 + T011-T015. T019 depends on T018.

### Across Phases 3-7 (US1-US5)

Once Phase 2 is complete, five independent engineer-pairs can each take one phase:

```text
Phase 3 (US1) — engineer A: state-machine + system-prompt-extension + chat route + ProgressBar wiring + Chips
Phase 4 (US2) — engineer B: skip-detector + chat route hook
Phase 5 (US3) — engineer C: off-sop-detour + system-prompt extension addition
Phase 6 (US4) — engineer D: ProgressBar component + CSS + ChatPanel wiring
Phase 7 (US5) — engineer E: goodbye-detector + chat route hook
```

Conflict points (require coordination):
- All three of Phase 3, 4, 5, 7 touch `packages/api/src/app/api/chat/route.ts` — sequence the merges via discrete commits and re-test after each.
- All three of Phase 3 (T030) and Phase 5 (T045) and Phase 7 (T055) touch `system-prompt-extension.ts` — sequence the merges; T030 lands first as the base composer, T045 and T055 add directives on top.

### Within Phase 8 (US6)

After T060–T062 routes land (parallel), the four UI components T064–T067 are independent:

```text
T064 (sop-editor.tsx)            ┐
T065 (step-form.tsx)             ├─── all parallel after T060-T063
T066 (case-types-tab.tsx)        │
T067 (goodbye-phrases-tab.tsx)   ┘
```

---

## Implementation Strategy

### MVP Scope

**The MVP is Phase 1 + Phase 2 + Phase 3 (US1) only.** This delivers:

- The full default 5-step SOP runs end-to-end for the dev account.
- Step 6 follow-up generation works.
- Leads are captured with SOP-state snapshots.
- The progress bar is wired but minimally styled (US4 polish comes later).
- Skip detection, off-SOP detour, no-goodbye behavior, dashboard editor are all DEFERRED.

**Why this MVP scope**: it's the smallest slice that proves the SOP runtime end-to-end. Lawyers using the dashboard see no UI for SOP customization yet (their default SOP just works); customization arrives with US6.

**MVP exit criteria**:
- T038 (US1 Playwright E2E) passes deterministically
- A lead row inserted via the SOP flow has a Zod-valid `sop_state_snapshot`
- No Constitution gate failures in `pnpm verify-invariants`

### Incremental Delivery

After MVP, ship in the following sequence (priorities P1 first):

1. **Phase 4 (US2 skip detection)** — single most-impactful UX improvement; saves visitor frustration on rich first messages
2. **Phase 5 (US3 off-SOP detour)** — unblocks visitors with side questions
3. **Phase 6 (US4 progress bar engagement)** — visual polish; small bundle impact
4. **Phase 8 (US6 lawyer dashboard)** — unlocks self-service customization; biggest scope but independent of US1-US5
5. **Phase 7 (US5 no-goodbye)** — P2 priority; smallest scope; ship last among story phases
6. **Phase 9 (Polish)** — legacy migration + observability + evals + docs

Each phase is a green-CI mergeable commit. Phase 9 is broken into ~6 sub-commits (one per 9A-9F section) to keep PRs reviewable.

### Test-First Gate

Per Constitution III + the "Tests" preamble of this file: every implementation task is preceded by its corresponding TDD task in the same phase. The implementer MUST verify the test fails before writing the implementation, and MUST verify the test passes before marking the task complete. CI enforces via `pnpm test --reporter=verbose` on every PR.

