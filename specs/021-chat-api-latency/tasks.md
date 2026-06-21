---
description: "Task list for 021-chat-api-latency"
---

# Tasks: Chat API Latency Reduction

**Input**: Design documents from `/specs/021-chat-api-latency/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests ARE required by Constitution III (Test-First, Layered Testing Strategy). New unit + integration tests are part of every implementation phase below; the behavior-equivalence diff and existing e2e walks gate the work overall.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2, US3)
- Every task lists exact file paths

## Path Conventions

This feature touches `packages/api/` only. All paths are repo-root-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the workspace for the change; no production code touched yet.

- [X] T001 Confirm branch `021-chat-api-latency` is checked out and the working tree is clean: `git status` should show no uncommitted changes outside this feature's spec dir.
- [X] T002 Re-read the four contracts in `specs/021-chat-api-latency/contracts/` (chat-route-flow, system-prompt-cache, deferred-writes, session-append) and the data model so every later task references the canonical interface.
- [X] T003 [P] Add two perf-measurement scripts as deliverables for Phase N (do NOT implement yet; just place TODO stubs so Phase 1 has clear handoffs): `packages/api/scripts/measure-chat-latency.ts` and `packages/api/scripts/diff-latency.ts` — used by quickstart.md Step 4.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the two new building blocks (cache module, defer helper) that US1 depends on. **MUST complete before any user story task.**

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Defer helper (used by US1)

- [X] T004 [P] Create `packages/api/src/lib/run-after-response.ts` exporting `runAfterResponse(fn, onError)` per `contracts/deferred-writes.md`. Use a dynamic import for `after` from `next/server` and check `typeof after === 'function'`; fall back to inline `await fn().catch(onError)` when unavailable. Keep the implementation ≤30 lines and zero new dependencies.
- [X] T005 [P] Create `packages/api/src/lib/run-after-response.test.ts` covering: (a) inline fallback under Vitest awaits and observes completion; (b) `onError` is invoked when `fn` rejects and no rejection bubbles to the caller; (c) calling twice for the same request enqueues both callbacks. Tests MUST run against Vitest with no Next.js server context.

### System-prompt cache (used by US1)

- [X] T006 [P] Create `packages/api/src/lib/system-prompt-cache.ts` exporting `getCachedStaticPrompt(args)`, `invalidateSystemPromptCache(accountId)`, `__resetSystemPromptCacheForTests()` per `contracts/system-prompt-cache.md`. Mirror the in-process `Map` + TTL + LRU pattern in `packages/api/src/lib/auth.ts:30-72` and `packages/api/src/lib/config.ts:20-66`. Use `CACHE_TTL_MS = 60_000` and `CACHE_MAX_ENTRIES = 256`.
- [X] T007 [P] Create `packages/api/src/lib/system-prompt-cache.test.ts` covering each row in the contract's test surface: miss-then-hit (producer called once), TTL expiry triggers recompute, explicit invalidation drops all entries for the account, account isolation, version isolation, preview isolation, LRU eviction at >256 entries.

**Checkpoint**: T004 + T005 green, T006 + T007 green → user story implementation can begin.

---

## Phase 3: User Story 1 — Faster first-token feedback during intake (Priority: P1) 🎯 MVP

**Goal**: Trim avoidable work out of the chat route so a representative SOP-driven turn sees P50 TTFB drop ≥150ms and P50 `done`-event drop ≥200ms, with byte-equal DB state vs. `main` (modulo timestamps).

**Independent Test**: Run a scripted SOP intake against `/api/chat` on `main` and on the feature branch, diff TTFT and `done`-event timings, diff final DB state. Latency thresholds met AND DB diff empty → US1 passes.

### Tests for User Story 1 (written first, MUST fail before implementation) ⚠️

- [X] T008 [P] [US1] In `packages/api/src/lib/system-prompt.test.ts`, add a test that calls `composeSystemPrompt(config, undefined, sopState, sopConfig, goodbyePhrases, caseTypes)` (note: NO `isOffTopicNow` argument) and asserts the output equals the cached-prefix + dynamic-suffix concatenation. Expect this test to fail until T015 lands.
- [X] T009 [P] [US1] In `packages/api/src/lib/session.test.ts`, add a test asserting that `appendMessagesAndSOPState(sessionId, history, newMessages, sopState)` issues exactly ONE database operation (an UPDATE) — use a Drizzle query spy or in-memory SQLite query log. Expect this to fail until T017 lands.
- [X] T010 [P] [US1] In `packages/api/src/lib/session.test.ts`, add a test covering the cold-session path: `appendMessagesAndSOPState(sessionId, [], [newUserMessage, newAssistantMessage], sopState)` writes `messages_json = JSON.stringify([newUserMessage, newAssistantMessage])`.
- [X] T011 [P] [US1] In `packages/api/src/app/api/chat/route.test.ts`, add a "deferred-writes ordering" integration test: after `POST /api/chat` resolves, assert (a) the `sessions` row contains the new messages immediately, and (b) the `leads` row reflects `updateLeadSOPState` + branch-finalization + `applyAndPersistHardOverrides` + `savePartialLead` after a brief await. Use the Vitest inline-fallback path so writes are observable.
- [X] T012 [P] [US1] In `packages/api/src/app/api/chat/route.test.ts`, add a "behavior-equivalence smoke" test: for a fixed scripted turn, assert the assistant text + final DB state match a captured baseline. Use a small fixture file `tests/fixtures/behavior-baseline.json` produced from `main` (capture by hand during this task).

### Implementation for User Story 1

#### Remove off-SOP detour detector

- [X] T013 [US1] Delete `packages/api/src/lib/sop/off-sop-detour.ts` and `packages/api/src/lib/sop/off-sop-detour.test.ts`.
- [X] T014 [US1] Delete `packages/api/tests/e2e/widget-us3-off-sop-detour.walk.spec.ts`.
- [X] T015 [US1] Edit `packages/api/src/lib/sop/system-prompt-extension.ts`: remove the `isOffTopicNow` parameter from `composeSopBlock`'s signature, remove the `### Detour required NOW` block (lines ~167-179 in the current file), and update the JSDoc on the `composeSopBlock` parameter list accordingly. Keep the static `### Off-SOP detour rule` block intact.
- [X] T016 [US1] Edit `packages/api/src/lib/sop/system-prompt-extension.test.ts`: remove every test case that asserts on the `### Detour required NOW` block or sets `isOffTopicNow=true`.

#### Refactor `composeSystemPrompt` to use the cache

- [X] T017 [US1] Edit `packages/api/src/lib/system-prompt.ts`: drop the `isOffTopicNow` parameter (last positional arg). Split into `composeSystemPromptStatic(config, caseTypes)` (the cacheable prefix) and the existing `composeSystemPrompt` which now reads `composeSystemPromptStatic` through `getCachedStaticPrompt({ accountId, configVersionId, isPreview, produce })` and concatenates the SOP block + branch directive. Caller signature: `composeSystemPrompt(config, guardrailsMarkdown, sopState, sopConfig, goodbyePhrases, caseTypes, opts: { accountId, configVersionId, isPreview })`. The `opts` object is REQUIRED — no implicit fallback.
- [X] T018 [US1] Edit `packages/api/src/lib/system-prompt.test.ts`: add cases for cache hit / miss, version isolation, preview isolation, and per-account isolation. Confirm the prefix string from `composeSystemPromptStatic` is identical to what today's monolithic `composeSystemPrompt` produces for the static portion (snapshot-compare against a captured `main` output for a fixture config).

#### Wire cache invalidation

- [X] T019 [US1] Audit and edit `packages/api/src/app/api/dashboard/config/route.ts`: add `invalidateSystemPromptCache(accountId)` adjacent to every existing `invalidateConfigCache(accountId)` call (save + publish + save_theme paths).
- [X] T020 [US1] Audit and edit `packages/api/src/app/api/dashboard/sop/route.ts`: add `invalidateSystemPromptCache(accountId)` adjacent to any config-cache invalidation it does today.
- [X] T021 [US1] Grep the repo for any other `invalidateConfigCache(` call sites and add the prompt-cache invalidator next to each. Document the final audit list in a one-line comment near `invalidateSystemPromptCache`'s export so a future reader can verify coverage.

#### Update `appendMessagesAndSOPState` signature

- [X] T022 [US1] Edit `packages/api/src/lib/session.ts`: change `appendMessagesAndSOPState(sessionId, messages, sopState)` to `appendMessagesAndSOPState(sessionId, existingHistory, newMessages, sopState)`. Remove the internal SELECT; compute the final array as `[...existingHistory, ...newMessages]`. Keep `appendMessages` (non-chat callers) unchanged.

#### Edit the chat route

- [X] T023 [US1] Edit `packages/api/src/app/api/chat/route.ts`: remove the `isOffTopic` import, the `isOffTopicNow` local, the `isOffTopic({...})` call inside the SOP advancement block, and the `isOffTopicNow` argument to `composeSystemPrompt`. Pass the new `opts` object (`{ accountId: auth.accountId, configVersionId: <stable id>, isPreview }`) to `composeSystemPrompt`. **Note**: `getPublishedConfig` returns only the `Configuration`; if the row id isn't on the returned shape, plumb it through (preferred — adjust `getPublishedConfig` to return `{ id, config }` like `getLatestConfig` already does, so the chat route has a stable `configVersionId` for both preview and published paths). Document this change in the PR description.
- [X] T024 [US1] In the same file, move `branchDeps` literal construction (including the `whenChipWeights` / `whenChipWeightsByLabel` IIFEs and the `goodbyePhrases` reference) inside an `if (sopState?.is_finalized)` block. Skip the `runBranchOrchestrator` call entirely outside the block (today it's called and no-ops; the no-op call is now dead work avoided).
- [X] T025 [US1] In the same file, refactor `onFinish`: await `appendMessagesAndSOPState(sessionId, history, [newUserMessage, { role: 'assistant', content: text }], sopState)` on the critical path. Wrap the leads-side chain (`updateLeadSOPState` → branch-finalization UPDATE → `applyAndPersistHardOverrides` → `savePartialLead`) in a single `runAfterResponse(async () => { … }, (err) => console.error('[chat] deferred-writes failed', { sessionId, accountId: auth.accountId, err: { name: err?.name, message: err?.message } }))` call. Remove the existing `Promise.all([sessionsWrite, leadsWrite])`.

#### Adjust `lib/config.ts` to expose `configVersionId` consistently

- [X] T026 [US1] Edit `packages/api/src/lib/config.ts`: change `getPublishedConfig` to return `{ id, version, config } | null` instead of `Configuration | null` so the chat route can pass `configVersionId` to the prompt cache uniformly across preview/published paths. Update existing call sites in `packages/api/` to read `.config` off the result. Keep `latestCache` / `publishedCache` shapes unchanged internally; just expand the return type. Add unit tests for the new return shape.

**Checkpoint**: At this point, US1 is fully functional. All existing tests pass (minus the deleted off-SOP detour walk). Run the perf measurement from `quickstart.md` Step 4 to confirm SC-001 and SC-002 thresholds.

---

## Phase 4: User Story 2 — Side questions during intake still get answered (Priority: P1)

**Goal**: Verify the removal of the dynamic detour block did NOT regress side-question handling. The static "Off-SOP detour rule" continues to govern the behavior.

**Independent Test**: Run a scripted intake that injects a side question between two SOP steps; confirm the assistant answers the side question and re-asks the pending step. Diff against `main` baseline for the same fixture.

### Tests for User Story 2 ⚠️

- [X] T027 [P] [US2] In `packages/api/tests/e2e/`, identify the existing walk(s) that cover the side-question detour scenario (NOT the deleted `widget-us3-off-sop-detour.walk.spec.ts` — look for incidental coverage in `widget-sop-subtype-chips.walk.spec.ts` and the smoke walks). If no walk covers it, add a new `widget-side-question-detour.walk.spec.ts` that scripts: greeting → case-type → "what are your hours?" (side question mid-SOP) → confirm assistant answers + re-asks pending step. The mocked LLM fixture should mirror the static rule's expected behavior.
- [X] T028 [P] [US2] In `packages/api/src/app/api/chat/route.test.ts`, add an integration test that posts a message with minimal keyword overlap to the pending step's question text but which is in fact a legitimate answer (synonym/paraphrase). Assert the SOP advancer captures the answer and the assistant does NOT re-ask the same question. This guards against the regression mode the deleted dynamic block sometimes caused.

### Implementation for User Story 2

US2 is mostly a verification phase — there is no new production code beyond what US1 delivered. The acceptance criteria are met by the static rule already in the SOP block (`packages/api/src/lib/sop/system-prompt-extension.ts:181-188`).

- [X] T029 [US2] Run the surviving e2e walk suite (`pnpm --filter @legal-chatbot/api test:e2e`) and confirm every walk passes. Document the run in the PR description.
- [X] T030 [US2] Run a mocked conversation-quality eval (per Constitution III's manual gate for prompt-affecting changes) that exercises side-question + return-to-SOP across 3-5 fixture conversations. Record findings in the PR.

**Checkpoint**: US2 verified. Behavior preservation is documented.

---

## Phase 5: User Story 3 — Concurrent message sends don't corrupt session state (Priority: P2)

**Goal**: Confirm the removal of the duplicate SELECT in `appendMessagesAndSOPState` doesn't introduce a new race window vs. `main` under realistic widget timing (50ms gap, not nanosecond-simultaneous).

**Independent Test**: A Vitest integration test fires two `POST /api/chat` requests for the same session ID ~50ms apart and asserts that all four messages are present in the final session row, in chronological order.

### Tests for User Story 3 ⚠️

- [X] T031 [P] [US3] In `packages/api/src/app/api/chat/route.test.ts`, add the "concurrent double-send" integration test described in `research.md` R7: fire two `POST /api/chat` calls for the same `sessionId` with a 50ms gap, await both, then assert `sessions.messages_json` contains all four expected messages (two visitor + two assistant) and `leads` reflects the later turn. Run against in-memory SQLite per Constitution III.

### Implementation for User Story 3

No new production code — US3 is a regression-protection phase guarding the change in T022/T025.

- [X] T032 [US3] Verify T031 passes against the feature branch. If it fails, investigate whether the failure is a real race introduced by the change, or a test-harness artifact (SQLite serialization). Document the finding.

**Checkpoint**: US3 verified. Concurrent-send safety regression-tested.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final cleanup, perf scripts, observability checks, and PR-readiness.

- [X] T033 [P] Implement `packages/api/scripts/measure-chat-latency.ts` per quickstart.md Step 4a/4b. The script POSTs N=50 turns through a complete scripted SOP intake, measures TTFT and `done`-event timing per turn, and emits a JSON file with `{ p50, p90, p99 }` per metric. Use a local Next.js dev server URL via env var `CHAT_API_URL`.
- [X] T034 [P] Implement `packages/api/scripts/diff-latency.ts` per quickstart.md Step 4c. Reads two JSON files produced by `measure-chat-latency.ts` and prints a diff table; exits non-zero if SC-001 (≥150ms P50 TTFT drop) or SC-002 (≥200ms P50 `done` drop) thresholds are not met.
- [X] T035 [P] Implement `packages/api/scripts/dump-walk-fixtures.ts` per quickstart.md Step 5. Runs the surviving e2e walks against a deterministic mocked LLM, dumps the final DB state per fixture to JSONL for byte-equal diffing against `main`.
- [X] T036 Run `tsc --noEmit` across the workspace (`pnpm -w typecheck` or equivalent) and fix any new type errors introduced by the signature changes in T022 and T026.
- [X] T037 Run `eslint .` and fix any new lint warnings.
- [X] T038 Run the full Vitest suite (`pnpm --filter @legal-chatbot/api vitest run`) and confirm 100% pass.
- [ ] T039 Run the surviving Playwright e2e suite (`pnpm --filter @legal-chatbot/api test:e2e`) and confirm 100% pass.
- [ ] T040 Execute quickstart.md Steps 4 (latency), 5 (behavior-equivalence diff), 6 (publish-cache invalidation), and 7 (concurrent test) end-to-end. Record numbers + diff results in the PR description.
- [ ] T041 Update the PR description with: (a) Constitution Check confirmation from `plan.md`; (b) measured latency improvements from T040; (c) behavior-equivalence diff result; (d) the audit list of `invalidateConfigCache` call sites that were paired with `invalidateSystemPromptCache`; (e) explicit confirmation that no agent tool, `maxSteps`, schema, or shared type was touched.
- [X] T042 [P] Search the codebase for any lingering references to `isOffTopic`, `off-sop-detour`, `isOffTopicNow`, or "Detour required NOW" and delete or update them (comments, doc strings, README entries, spec back-references — but DO NOT touch files under `specs/010-sop-workflow/` or other historical specs).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies — can start immediately.
- **Phase 2 (Foundational)**: depends on Phase 1 — BLOCKS Phases 3-5.
- **Phase 3 (US1)**: depends on Phase 2 complete.
- **Phase 4 (US2)**: depends on Phase 3 complete (US2 is verification of US1's removal).
- **Phase 5 (US3)**: depends on Phase 3 complete (US3 regression-tests the session-append change in T022/T025).
- **Phase 6 (Polish)**: depends on Phases 3, 4, 5 complete.

### Within Phase 3 (US1) — internal ordering

- Tests T008-T012 are written first (Constitution III) and MUST fail.
- T013, T014 (deletions) can run in parallel with each other.
- T015 (edit `system-prompt-extension.ts`) must complete before T016 (test edits there).
- T017 (edit `system-prompt.ts`) depends on Foundational T006 (cache module).
- T022 (edit `session.ts`) is independent of T017 and can run in parallel.
- T023, T024, T025 (chat route edits) depend on T017, T022, T015, and Foundational T004.
- T026 (config.ts return-shape change) is required by T023; do T026 just before T023.
- T019, T020, T021 (invalidation wiring) depend on T006 only (the cache module) and can run in parallel with T023-T025.

### Within Phase 4 (US2)

- T027 + T028 (tests) can run in parallel.
- T029 + T030 (verification runs) must run after Phase 3 is fully green.

### Within Phase 5 (US3)

- T031 then T032 (sequential).

### Within Phase 6 (Polish)

- T033, T034, T035, T042 are all `[P]` (different files).
- T036-T041 are sequential and gate the final PR.

### Parallel Opportunities

- **Foundational**: T004+T005 (defer helper) and T006+T007 (cache module) are completely independent — two developers can split them.
- **US1 tests**: T008, T009, T010, T011, T012 can all be authored in parallel.
- **US1 deletions**: T013 and T014 can run in parallel.
- **US1 invalidation wiring**: T019, T020, T021 can run in parallel.
- **Polish scripts**: T033, T034, T035 can be implemented in parallel.

---

## Parallel Example: Phase 2 Foundational

```bash
# Two developers can split Foundational cleanly:
# Developer A:
Task: "Create packages/api/src/lib/run-after-response.ts per contracts/deferred-writes.md"
Task: "Create packages/api/src/lib/run-after-response.test.ts covering inline fallback + error routing"

# Developer B:
Task: "Create packages/api/src/lib/system-prompt-cache.ts per contracts/system-prompt-cache.md"
Task: "Create packages/api/src/lib/system-prompt-cache.test.ts covering miss/hit/TTL/invalidate/isolation/LRU"
```

## Parallel Example: User Story 1 tests-first wave

```bash
# All five US1 tests can be authored at once (different files / different cases):
Task: "Add cache-aware composeSystemPrompt test in packages/api/src/lib/system-prompt.test.ts"
Task: "Add one-UPDATE-no-SELECT test in packages/api/src/lib/session.test.ts"
Task: "Add cold-session path test in packages/api/src/lib/session.test.ts"
Task: "Add deferred-writes ordering test in packages/api/src/app/api/chat/route.test.ts"
Task: "Add behavior-equivalence smoke test in packages/api/src/app/api/chat/route.test.ts"
```

---

## Implementation Strategy

### MVP Scope

**MVP = US1 (Phase 1 + Phase 2 + Phase 3)**. US1 delivers the latency win and the behavior-equivalence guarantee. US2 and US3 are verification phases that protect against regressions introduced by US1.

### Incremental Delivery

1. Phase 1 (Setup) → no user-visible change.
2. Phase 2 (Foundational) → cache + defer helper exist with tests; not yet wired.
3. Phase 3 (US1) → wired; latency drops; behavior-equivalence diff empty against `main`. **Ship-ready point.**
4. Phase 4 (US2) → verification documented in PR.
5. Phase 5 (US3) → concurrent-send safety net in place.
6. Phase 6 (Polish) → perf scripts, lint/type clean, PR description complete.

### Recommended Sequencing for a Single Developer

```text
T001 → T002 → T003                    (Setup)
T004 → T005, then T006 → T007          (Foundational; can interleave with above)
T008..T012 (write tests; all should fail)
T013 → T014                            (deletions)
T015 → T016                            (off-SOP extension edits)
T017 → T018                            (composeSystemPrompt split)
T019 → T020 → T021                     (invalidation wiring)
T022                                   (session.ts signature change)
T026                                   (config.ts return shape)
T023 → T024 → T025                     (chat route edits — biggest single PR moment)
Re-run T008..T012 (should pass now)
T027..T030                             (US2 verification)
T031 → T032                            (US3 regression)
T033..T035                             (perf scripts)
T036 → T037 → T038 → T039              (gates)
T040 → T041                            (perf measurement + PR doc)
T042                                   (final grep cleanup)
```

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` label is required on US1/US2/US3 tasks; Setup, Foundational, and Polish tasks omit it.
- Tests are required by Constitution III; T008-T012, T027-T028, T031 are first-class deliverables, not afterthoughts.
- Every new test MUST be observed failing before its corresponding implementation lands.
- Constitution V account-isolation: verify in T007 that no entry for account A is readable with account B's key, even when `configVersionId` and `isPreview` match.
- Constitution VI: no agent tool added, removed, or modified; `maxSteps` stays at 5; token budget improved (one dynamic block removed).
- Commit cadence: prefer one commit per task (or per closely-related pair like T013+T014). Squash-or-not at PR time per repo convention.
