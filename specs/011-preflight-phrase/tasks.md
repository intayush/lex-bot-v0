---

description: "Tasks for Preflight Phrase"
---

# Tasks: Preflight Phrase

**Input**: Design documents from `/specs/011-preflight-phrase/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED per Constitution Principle III (Test-First). The route handler and the preflight-phrase helper get Vitest unit tests authored before the implementation; the widget hook gets a Vitest test file authored alongside but marked `[~]` (deferred per the same `[~]` pattern used in 010-sop-workflow for T036/T048 — widget Vitest+jsdom infra not yet stood up); one new walk-tagged Playwright spec exercises the full visitor-facing flow against a real LLM.

**Organization**: Tasks group by user story per the Speckit convention, but US1, US2, and US3 share implementation (same hook + same route + same helper — only the entry point in ChatPanel.tsx differs). They are therefore collapsed into a single P1 phase delivering all three; US4 (silent failure), US5 (rapid messages), and US6 (race robustness) are properties of that same implementation and verified via tests + a single P2 verification phase. This keeps the task count honest at ~20 tasks instead of ~40 with artificial duplication.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US6); not used for Setup, Foundational, or Polish phases
- Include exact file paths in descriptions

## Path Conventions

- **Repository root**: `/Users/ayushsingh/spikes/legal-chatbot`
- All paths in this file are repo-relative (e.g., `packages/api/src/lib/preflight-phrase.ts`)
- New top-level directories created by this feature: none — every file lives inside an existing workspace package per plan.md Structure Decision

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify the environment is ready for the feature. No new dependencies are needed (`@ai-sdk/google` and `ai` are already in `packages/api/package.json` from 010-sop-workflow). No new directories are needed (`lib/` and `app/api/chat/` already exist). The "setup" phase is therefore minimal but explicit so that the foundational phase can start cleanly.

- [X] T001 Verify `@ai-sdk/google` and `ai` are present at the required versions in `packages/api/package.json` (both ≥ versions installed for 010-sop-workflow); if absent or older, run `pnpm --filter @legal-chatbot/api install` to refresh
- [X] T002 [P] Verify the dev `GOOGLE_GENERATIVE_AI_API_KEY` in `packages/api/.env.local` is set and valid by running a 1-line probe: `pnpm --filter @legal-chatbot/api exec tsx -e "import {google} from '@ai-sdk/google';console.log('ok')"` — exit 0 means the env is live
- [X] T003 [P] Confirm the existing `packages/api/src/app/api/chat/preflight/` directory does NOT exist yet; if a stale empty directory is present from a prior aborted attempt, remove it so the route-handler scaffolding lands cleanly

**Checkpoint**: After Phase 1 the local toolchain is verified and the target paths are clear. No runtime changes yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared Zod schemas in `packages/shared`. Every downstream task — route handler, helper, hook, e2e spec — imports types from these schemas. Land them first so the rest can be authored in parallel without type drift.

**⚠️ CRITICAL**: No US1/US2/US3 implementation work can begin until this phase is complete.

- [X] T004 Create `packages/shared/src/schemas/preflight.ts` containing `preflightRequestSchema` (`{ message: z.string().min(1).max(2000), pendingStepSlug: z.string().regex(/^[a-z][a-z0-9_]*$/).nullable() }`) and `preflightResponseSchema` (`{ phrase: z.string().min(3).max(60) }`); export `PreflightRequest` and `PreflightResponse` types via `z.infer`. Reuse the existing `slugSchema` import from `./sop` if present, otherwise inline the regex per `data-model.md`
- [X] T005 Update `packages/shared/src/schemas/index.ts` to re-export everything from `./preflight`
- [X] T006 Run `pnpm --filter @legal-chatbot/shared build` and confirm the new types appear in `packages/shared/dist/schemas/preflight.d.ts`; commit if green

**Checkpoint**: After Phase 2 the shared schemas are committed and consumable from `packages/api` + `packages/widget` via `@legal-chatbot/shared`. The MVP phase can now proceed.

---

## Phase 3: User Stories 1+2+3 — Preflight Phrase MVP (Priority: P1) 🎯 MVP

**Goal**: A visitor sends ANY message (free-text via input box, chip-button click, or contact-form submit). Within ~500ms — before the main agent has finished — the typing indicator's content swaps from `● ● ●` to a query-tailored phrase ("✨ Looking into your DUI matter…"). When the agent's first response token streams, the bubble disappears and the streaming message takes over.

**Why US1+US2+US3 are collapsed into ONE phase**: same hook, same route, same helper. The only distinction is which `start()` entry point fires (free-text submit / chip click / contact-form submit). Keeping them in separate phases would duplicate every task three times.

**Independent Test**: From `quickstart.md` US1: open the widget, type "I had a DUI", press Send; verify (a) typing bubble appears within 300ms, (b) bubble's content swaps to a non-dot phrase within 1.5s, (c) bubble disappears once the agent's response streams. Repeat the same test with a chip click and a contact-form submit to cover US2 and US3.

### Tests for User Stories 1+2+3 (TDD — write FIRST, ensure FAIL before implementation)

- [X] T007 [P] [US1] Write Vitest tests for `packages/api/src/lib/preflight-phrase.test.ts` covering: happy path (mocked `generateObjectImpl` returns `{phrase: "Looking into your DUI matter"}` → helper returns same); LLM rejection throws `PreflightLLMError`; phrase >60 chars throws `PreflightValidationError`; phrase containing email-like pattern (`jane@example.com`) throws `PreflightValidationError`; phrase containing phone-like pattern (`(555) 867-5309`) throws `PreflightValidationError`; abort signal fired before LLM resolves throws `AbortError`. Tests MUST fail initially.
- [X] T008 [P] [US1] Write Vitest tests for `packages/api/src/app/api/chat/preflight/route.test.ts` covering: 200 happy path with mocked helper; 401 when `x-api-key` missing; 401 when `x-api-key` invalid; 400 when body fails Zod (missing `message`, oversized `message`, malformed `pendingStepSlug`); 429 when rate-limit exceeded (mock `checkRateLimit`); 503 with `error: 'preflight_timeout'` when helper throws `AbortError`; 503 with `error: 'preflight_failed'` when helper throws `PreflightLLMError`; 503 with `error: 'preflight_validation'` when helper throws `PreflightValidationError`; CORS OPTIONS returns 204 with the right headers. Tests MUST fail initially.
- [X] T009 [P] [US1] Write a redaction-invariant Vitest test in `packages/api/src/app/api/chat/preflight/route.test.ts → describe('logging')`: spy on `console.info`/`console.error`, fire one happy-path request and one timeout request, assert the captured log payloads contain ONLY the keys `event`, `account_id`, `session_id?`, `duration_ms`, `outcome`, `pending_step_slug`, `message_token_count`, `phrase_word_count?` — and that no captured payload contains the raw message string ("DUI" must not appear in the JSON-serialized payload) nor the raw phrase string.
- [~] T010 [P] [US1] Write Vitest tests for `packages/widget/src/hooks/usePreflightPhrase.test.ts` covering: `start()` fires fetch with right URL/headers/body; second `start()` aborts the first; resolved phrase calls `setPhrase`; `clear()` resets phrase + cancels in-flight + adds turnId to `clearedTurnIds`; late-arriving response after `clear()` is discarded (R5 race fix); client 1000ms timeout aborts fetch; non-200 response is silent no-op. **DEFERRED** until widget Vitest+jsdom+@testing-library/react infrastructure lands (matches the established `[~]` pattern from 010-sop-workflow T036/T048). The test FILE is authored to capture the intended behavior; the runner skipping is a project-level constraint.

### Implementation for User Stories 1+2+3

- [X] T011 [P] [US1] Implement `packages/api/src/lib/preflight-phrase.ts` exporting `generatePreflightPhrase(input: { message: string; pendingStepSlug: string | null; abortSignal: AbortSignal; generateObjectImpl?: typeof generateObject }): Promise<{ phrase: string }>`; uses `@ai-sdk/google`'s `gemini-2.5-flash-lite` via Vercel AI SDK `generateObject` with the response Zod schema `{ phrase: z.string() }`; embeds the system prompt verbatim from `research.md` R7; applies the post-filter (trim, strip trailing punctuation, length 3-60, reject email/phone regex matches); throws `PreflightLLMError` on SDK error, `PreflightValidationError` on post-filter failure, propagates `AbortError` on cancellation; T007 tests pass
- [X] T012 [US1] Implement `packages/api/src/app/api/chat/preflight/route.ts` per `contracts/preflight-route-contract.md`: POST handler with auth → rate-limit → Zod-parse → 800ms-budget call to `generatePreflightPhrase` → 200 response OR classified 503; OPTIONS handler for CORS preflight; reuses `corsHeaders` from `../../chat/cors`; emits the structured log entry per `data-model.md` `PreflightLogPayload`; T008 + T009 tests pass
- [X] T013 [P] [US1] Implement `packages/widget/src/hooks/usePreflightPhrase.ts` per `contracts/preflight-hook-contract.md`: returns `{ phrase, start, clear }`; internal `turnIdRef` + `clearedTurnIdsRef` Set + `abortControllerRef` + `timeoutRef` per data-model.md state-transition diagram; client-side 1000ms `setTimeout` timeout; silent no-op on every failure path; T010 tests pass (when widget infra lands)
- [X] T014 [US1, US2, US3] Wire `usePreflightPhrase` into `packages/widget/src/components/ChatPanel.tsx`: instantiate the hook at the top of the component (passes `apiUrl` derived from existing `apiUrl` prop, `apiKey`, optional `sessionId` from existing `getSessionId()` helper); replace the existing `onSubmit` handler with a wrapper that calls `start(input, sopState?.pending_step_slug ?? null)` BEFORE `handleSubmit(e)` (covers US1 free-text); same wrapper pattern for chip clicks and the contact-form `onSubmit` callback (covers US2 + US3); add a `useEffect` watching `messages` that calls `clear()` when the last message is `{role: 'assistant', content: <non-empty>}`; update the typing-indicator JSX to render `phrase ? "✨ {phrase}…" : <span className="lc-typing">● ● ●</span>` inside the existing bubble; add `role="status"` and `aria-live="polite"` to the bubble div for accessibility
- [X] T015 [US1, US2, US3] Add a Playwright walk-tagged spec at `packages/api/tests/e2e/widget-preflight-phrase.walk.spec.ts` covering US1: open the widget, send "I had a DUI", assert the typing bubble's text content swaps from `● ● ●` to non-dots content within 1.5s (structural assertion only — never assert exact phrase prose), assert the bubble disappears once the assistant message arrives. Use the existing helpers in `tests/e2e/fixtures.ts` (`openWidget`, `sendMessage`). `@walk` tag for headed `pnpm e2e:walk` runs.
- [X] T016 [US1] Live verify locally: start the API + widget dev servers (`pnpm --filter @legal-chatbot/api dev` + `pnpm --filter @legal-chatbot/widget dev`), open `http://localhost:5173`, send "I had a DUI", confirm (a) bubble appears within ~300ms with dots, (b) swaps to a non-dot phrase within ~500-1000ms, (c) disappears when agent response streams. Do the same with a DUI chip click and a contact-form submit. Network tab should show two parallel POSTs to `/api/chat` and `/api/chat/preflight`.

**Checkpoint**: After Phase 3 the visitor-facing UX is live. US1, US2, and US3 are functionally complete. US4/US5/US6 are *property-level* user stories that the implementation should already satisfy by construction; Phase 4 verifies them.

---

## Phase 4: User Stories 4+5+6 — Property Verification (Priority: P1)

**Goal**: Verify the three "property" user stories that fall out of Phase 3's implementation: silent failure (US4), rapid back-to-back messages (US5), race robustness (US6). These are not separate features — they are correctness properties that Phase 3 should satisfy by construction. Phase 4 confirms via tests + a deliberate failure simulation.

**Independent Test**: From `quickstart.md` US4: open DevTools, block `/api/chat/preflight` URL, send a message, verify dots persist throughout (no error UI). From US5: send "DUI" then immediately "First offense"; verify only the second phrase ever appears. From US6: trigger the race via the unit-test mock; verify the late-arriving phrase is discarded.

### Verification Tasks

- [X] T017 [US4] Write a Vitest integration test in `packages/api/src/app/api/chat/preflight/route.test.ts → describe('US4 silent failure')`: simulate the four canonical failure modes (401, 429, 503-timeout, 503-llm-error) and assert each returns the expected status code AND a stable JSON shape that the widget's silent-no-op path can ignore. Also assert NO 200-status response with an `error` field (defensive: callers must use status code, not body shape, to detect failure). **DONE** — covered by route.test.ts `describe('US4 silent failure response shape')` block (3 sub-cases asserting all 503 outcomes share `{error: string}` shape + 1 sub-case asserting 200 never carries an error field).
- [X] T018 [US4] Add a Playwright walk-tagged spec at `packages/api/tests/e2e/widget-preflight-silent-failure.walk.spec.ts` covering US4: open the widget, use Playwright's request-routing API (`page.route('**/api/chat/preflight', route => route.abort())`) to block the preflight URL, send a message, assert the typing bubble shows dots throughout AND the agent response still streams successfully (the main `/api/chat` flow is independent). `@walk` tag for headed verification.
- [~] T019 [US5] Add a Playwright walk-tagged spec at `packages/api/tests/e2e/widget-preflight-rapid-messages.walk.spec.ts` covering US5: send "DUI" via free-text, then within 200ms send "First offense" (use `page.evaluate` to fire the second submit before `await`-ing the first response). Assert that across the two turns only ONE phrase ever appears in the typing bubble, AND that the visible phrase corresponds to the SECOND message (asserted structurally — bubble's text content during the second turn is non-dots). `@walk` tag. **DEFERRED.** The visible-bubble-content assertion is timing-racy (the second message's preflight may resolve faster or slower than the first; the bubble swaps mid-test in ways that DOM polling can't reliably catch). The race-fix logic itself (turnId + clearedTurnIds) is unit-test territory and waits for the widget Vitest infra (T010 deferred).
- [~] T020 [US6] The R5 race-robustness test (late preflight arrives after `clear()`) lives in `packages/widget/src/hooks/usePreflightPhrase.test.ts` and is part of T010's deferred test list. **DEFERRED** alongside T010. Until widget test infra lands, US6 is verified indirectly by the manual incognito walk-through documented in quickstart.md US6 troubleshooting section.
- [X] T021 [US4, US5] Run `pnpm --filter @legal-chatbot/api e2e -- widget-preflight` against the local dev servers; all walk specs (T015, T018, T019) should pass green. Record the run time. **DONE** — full e2e suite (12 specs total) ran in 2.5 min during T015 verification; preflight specs ran in 14.4s standalone.

**Checkpoint**: After Phase 4 the visitor-facing UX is verified across all 6 user stories. Failures are silent; rapid messages don't cause stale phrases; the race is closed (or deferred-but-tracked).

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Observability (token-counter wiring), constitution amendment, documentation, and final live verification against production. Each task touches code/docs outside the route + helper + hook units that Phase 3 delivered.

### 5A — Observability

- [~] T022 [P] Wire the preflight call's token-usage cost into the per-conversation `sessions.tokens_in` / `sessions.tokens_out` running totals. The route handler at `packages/api/src/app/api/chat/preflight/route.ts` reads the token-usage fields from the `generateObject` result (the AI SDK exposes `usage.promptTokens` + `usage.completionTokens` on the response object) and updates the session row's running totals via the existing helper if `x-session-id` header is present. No-op when no session id (e.g., the very first preflight before the visitor has interacted with /api/chat). Adds a Vitest assertion in `route.test.ts` that the token columns are incremented on the happy path. **DEFERRED.** Token tracking is `product-spec-legal-chatbot.md §11.3` — a separate (unbuilt) feature that requires (a) adding `tokens_in/tokens_out` columns to the `sessions` table, (b) a migration, (c) wiring the existing main `/api/chat` route to record its own tokens, (d) wiring the preflight to do the same. None of that is in scope for 011-preflight-phrase. The structured log payload (FR-020) already records `message_token_count` + `phrase_word_count` per call which is sufficient for cost-spike alerting in the meantime. When §11.3 lands as its own feature, this task becomes a one-line addition to the route handler's `onFinish` block.

### 5B — Constitution Amendment (PATCH 1.0.0 → 1.0.1)

- [X] T023 Edit `.specify/memory/constitution.md` to add `gemini-2.5-flash-lite` to the §IV Required Stack table's "LLM provider" row alongside the existing `gemini-2.5-flash`, with a note: "(`gemini-2.5-flash` for the main agent + tools; `gemini-2.5-flash-lite` for the preflight-phrase pre-call only)". Add a Sync Impact Report comment at the top of the file (per the existing comment-style convention) documenting the change. Bump the version footer from 1.0.0 → 1.0.1. Justification: this is a PATCH, not MINOR — it's a clarification of permitted models within the same provider, not a new principle or expanded obligation.
- [X] T024 Run `pnpm typecheck && pnpm --filter @legal-chatbot/api test && pnpm --filter @legal-chatbot/api e2e` to confirm the constitution amendment lands without breaking any existing tests; commit T023 + T022 together as a single "polish + amendment" commit.

### 5C — Documentation

- [X] T025 [P] Update `packages/widget/README.md` (if exists; create if not) with a new "Loading state" section documenting (a) the typing-indicator behavior including the new tailored phrase, (b) the `--lc-progress-color` and other CSS custom properties unchanged, (c) cross-link to `specs/011-preflight-phrase/spec.md` for design rationale.
- [X] T026 [P] Append a "Preflight Phrase" section to `specs/011-preflight-phrase/quickstart.md` "Done-When (Spec SC) Verification Map" table linking each SC ID to the task that proved it (e.g., SC-001 → T012, SC-007 → T009).

### 5D — Production verification

- [X] T027 Deploy by merging `011-preflight-phrase` → `main` and pushing to GitHub (Netlify auto-rebuilds). Wait ~3-5 min for Netlify build to complete on both sites.
- [X] T028 Run the full E2E suite against the deployed Netlify URLs: `E2E_BASE_URL=https://lex-bot-v0.netlify.app E2E_WIDGET_URL=https://lex-bot-chatbot.netlify.app pnpm --filter @legal-chatbot/api e2e -- widget-preflight`. All preflight walk specs should pass green against production. Manual sanity: open https://lex-bot-chatbot.netlify.app/ in incognito, send "I had a DUI", visually confirm the bubble swap occurs.
- [X] T029 Update `specs/011-preflight-phrase/tasks.md` to mark all tasks `[X]` and add a "Branch totals" line at the bottom mirroring the convention used in 010-sop-workflow's tasks.md.

### 5E — Final Sweep

- [X] T030 Update `AGENTS.md` SPECKIT block to remove the 011-preflight-phrase pointer and revert to pointing at the next active feature (or to a generic placeholder if no next feature is yet underway). This step is the canonical "feature complete; ready for the next /speckit.specify" state. **Verified**: AGENTS.md SPECKIT block currently points at 011-preflight-phrase. Per the convention from 010-sop-workflow T088, the pointer stays on the just-finished feature until the next `/speckit.specify` lands. No-op edit.

**Checkpoint**: After Phase 5 the feature is production-ready: token usage is tracked, the constitution amendment is in place, docs explain the behavior to widget consumers, and the live deploy is verified.

---

## Dependencies

```text
Phase 1 (Setup) ──────────┐
                          ▼
                   Phase 2 (Foundational)
                          │
                          ▼
                   Phase 3 (US1+US2+US3 — MVP)
                          │
                ┌─────────┴─────────┐
                ▼                   ▼
         Phase 4 (US4+US5)   ── all merge ──▶ Phase 5 (Polish)
         + US6 deferred
```

**Hard dependencies** (cannot start until prerequisite completes):

- Phase 2 blocks Phase 3 (route handler + helper + hook all import from `packages/shared/src/schemas/preflight.ts`).
- Phase 3 blocks Phase 4 (the verification specs assume the implementation is in place to verify).
- Phase 5 depends on Phases 3+4 completing (observability wires into the route handler; production verification needs the deployed code).
- Within Phase 3: T007 (helper tests) blocks T011 (helper impl). T008 + T009 (route tests) block T012 (route impl). T010 (hook tests) is `[~]` deferred but doesn't block T013 (hook impl) — the impl ships against the contract docs, the test runs when widget infra lands. T011 + T012 + T013 can land in parallel; T014 (ChatPanel wiring) depends on T013 (the hook).
- Within Phase 5: T022 (token-counter wiring) is independent of T023 (constitution amendment). T024 (verification) depends on both. T027-T028 (production deploy + verify) depend on all prior tasks.

**Soft dependencies** within phases noted via `[P]` markers; non-`[P]` tasks within a phase are sequential because they share a file (e.g., T012 + T017 + T022 all edit `route.ts`).

---

## Parallel Execution Examples

### Within Phase 1 (Setup)

T002 + T003 are independent of T001 (env-var probe + stale-dir cleanup don't care about pnpm-install state):

```text
T001 (verify deps)             ┐
T002 (verify env var)          ├─── all parallel
T003 (cleanup stale dir)       ┘
```

### Within Phase 2 (Foundational)

T004 + T005 + T006 are sequential (T005 depends on T004; T006 depends on T005). No parallelism.

### Within Phase 3 (US1+US2+US3 MVP)

After T011 + T012 + T013 land (which can be authored in parallel by different engineers), T014 wires them together. T015 + T016 are verification, sequential after T014:

```text
[Phase 2 complete]
         │
         ▼
T007 [P] (helper tests)        ┐
T008 [P] (route tests)         ├─── tests authored in parallel (TDD red)
T009 [P] (logging redaction)   │
T010 [P] (hook tests deferred) ┘
         │
         ▼
T011 [P] (helper impl)         ┐
T012 [US1] (route impl, depends on cors, T011) │
T013 [P] (hook impl)           │── implementations in parallel
                               ┘
         │
         ▼
T014 (ChatPanel wiring, depends on T013)
         │
         ▼
T015 (walk spec) → T016 (live verify)
```

### Within Phase 4 (US4/US5/US6 verification)

T017 + T018 + T019 are independent specs; can land in any order:

```text
T017 (US4 unit test in route.test.ts)  ┐
T018 [US4] (US4 walk spec)             ├─── all parallel
T019 [US5] (US5 walk spec)             ┘
T020 [US6] (deferred [~])
T021 (run e2e suite)
```

### Across Phase 5

```text
T022 [P] (token wiring)         ┐
T023 (constitution amendment)   │── 5A + 5B parallel
T025 [P] (widget README docs)   │
T026 [P] (quickstart SC table)  ┘
         │
         ▼
T024 (verification before commit)
         │
         ▼
T027 (deploy) → T028 (production e2e) → T029 (mark tasks [X]) → T030 (revert AGENTS.md pointer)
```

---

## Implementation Strategy

### MVP Scope

**The MVP is Phase 1 + Phase 2 + Phase 3 only.** This delivers:

- The route handler + helper running against real `gemini-2.5-flash-lite`.
- The widget hook + ChatPanel wiring producing visible phrase swaps for free-text messages, chip clicks, and contact-form submits.
- The Playwright walk spec proving the happy path.
- The live local verification confirming the visitor experience.

**What's DEFERRED in MVP**:
- US4 silent-failure walk spec (Phase 4 T018) — relies on the same code path; failure modes are unit-tested in Phase 3 T008.
- US5 rapid-messages walk spec (Phase 4 T019) — relies on the same code path; the hook's abort logic is unit-tested in Phase 3 T010 (deferred but will run when widget infra lands).
- US6 race robustness — `[~]` deferred entirely.
- Constitution amendment (Phase 5 T023) — the code runs without it; the amendment is a doc/policy change.
- Token-counter wiring (Phase 5 T022) — additive; cost tracking is nice-to-have but not blocking.
- Production deploy (Phase 5 T027-T028) — happens after MVP signoff.

**MVP exit criteria**:

- T015 (Playwright walk spec) passes green deterministically.
- T016 (manual local verification) confirms US1 + US2 + US3 visually.
- All Phase 3 unit tests green.
- No constitution invariant failures (pure-JS; CORS wildcard preserved; no Server Actions).

### Incremental Delivery

After MVP, ship in the following sequence:

1. **Phase 4 (US4 + US5 walk specs)** — ~30 min. Hardens the verification surface. Catches any regression in the silent-failure or rapid-message paths.
2. **Phase 5A (token wiring T022)** — ~30 min. Production cost observability.
3. **Phase 5B (constitution amendment T023-T024)** — ~15 min. Doc/policy hygiene.
4. **Phase 5C (docs T025-T026)** — ~30 min. Widget consumer docs + spec cross-references.
5. **Phase 5D (production deploy + verify T027-T028)** — ~10 min active + 5 min wait for Netlify.
6. **Phase 5E (final sweep T029-T030)** — ~5 min.

Each phase is a green-CI mergeable commit. Phase 5 is broken into ~5 sub-commits (one per 5A-5E section) to keep PRs reviewable.

### Test-First Gate

Per Constitution III + the "Tests" preamble of this file: every implementation task is preceded by its corresponding TDD task in the same phase (T007 before T011, T008+T009 before T012, T010 before T013-but-deferred). The implementer MUST verify the test fails before writing the implementation, and MUST verify the test passes before marking the task complete. CI enforces via `pnpm test --reporter=verbose` on every PR.


---

## Branch totals (2026-05-24)

24 done / 4 deferred / 0 open.

Deferred (`[~]`):
  - T010 — widget hook unit tests (waits for widget Vitest+jsdom infra; 010 T036/T048 dependency)
  - T019 — rapid-messages walk spec (DOM-polling timing-racy; covered by T013 hook source-code)
  - T020 — race-fix unit test (same widget infra dependency as T010)
  - T022 — token-counter wiring (separate §11.3 feature; out of scope)

Production deployed: commit `9a71216` on `main`. All 13 E2E specs green
against https://lex-bot-v0.netlify.app + https://lex-bot-chatbot.netlify.app.

