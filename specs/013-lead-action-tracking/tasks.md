---

description: "Tasks for Lead Action Tracking"
---

# Tasks: Lead Action Tracking

**Input**: Design documents from `/specs/013-lead-action-tracking/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are REQUIRED per Constitution Principle III (Test-First). The shared Zod schema gets a Vitest test file authored before the implementation. The route handler gets a Vitest test file (using the dependency-injection pattern established in 011-preflight-phrase's `handler.ts`) covering all auth/authz/Zod paths. One walk-tagged Playwright spec covers the full UX (US1 + US2 together).

**Organization**: Tasks group by user story. US1 (record an action) carries the substantive work — schema + migration + route + picker + detail-page edit. US2 (table column) builds on top of US1's data layer and adds only the table edit. Both are P1 in spec.md; tasks.md keeps them as separate phases for traceability but US2 is small.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1 or US2); not used for Setup, Foundational, or Polish phases
- Include exact file paths in descriptions

## Path Conventions

- **Repository root**: `/Users/ayushsingh/spikes/legal-chatbot`
- All paths in this file are repo-relative (e.g., `packages/api/src/db/schema.ts`)
- New top-level directories created by this feature: none — every file lives inside an existing workspace package per plan.md Structure Decision

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify the environment is ready. No new dependencies are required (`drizzle-orm`, `zod`, `iron-session`, `@neondatabase/serverless` all already installed for prior features). No new directories needed (`packages/api/src/app/api/dashboard/leads/[id]/` exists from 007; we add the `action/` sub-route under it). The setup phase is minimal but explicit so the foundational phase starts cleanly.

- [ ] T001 Verify the existing dev DB has at least one captured lead (needed for US1 + US2 walk-through to be exercise-able). Run `pnpm --filter @legal-chatbot/api exec tsx -e "import {db, schema} from './src/db'; const r = await db.select().from(schema.leads).limit(1); console.log('leads in dev DB:', r.length)"` — exit 0 with `leads in dev DB: 1` (or higher) means good. If 0, either run a SOP-completion via the widget OR seed via the existing `db:seed` flow.
- [ ] T002 [P] Confirm `packages/api/src/app/api/dashboard/leads/[id]/action/` directory does NOT exist yet. If it does (stale from a prior aborted attempt), remove it.

**Checkpoint**: After Phase 1 the local toolchain is verified and the target paths are clear. No runtime changes yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema migration + shared Zod schema. Both US1 and US2 depend on the new columns existing in the DB AND on the type-checked enum being importable from `@legal-chatbot/shared`. Land these first so the rest can be authored in parallel without type drift.

**⚠️ CRITICAL**: No US1/US2 implementation work can begin until this phase is complete.

### Foundation 2A — Shared schema (Constitution II)

- [ ] T003 Create `packages/shared/src/schemas/lead-action.ts` containing `leadActionEnum` (`z.enum(['contacted', 'call_no_answer', 'meeting_fixed'])`), `leadActionUpdateSchema` (`z.object({ action: leadActionEnum.nullable() })`), and `LEAD_ACTION_LABELS` constant map per data-model.md. Export `LeadAction` and `LeadActionUpdate` types via `z.infer`. Include a JSDoc comment explaining the slug → label convention.
- [ ] T004 Update `packages/shared/src/schemas/index.ts` to re-export everything from `./lead-action`.
- [ ] T005 [P] Write Vitest tests for `packages/shared/src/schemas/lead-action.test.ts` covering: each of the 3 enum slugs accepted; `null` accepted; invalid slug rejected (e.g., `'foo'`); missing `action` field rejected; non-object body rejected; extra fields don't reject (Zod default is to strip, not error). **NOTE**: this requires standing up Vitest in `packages/shared` (which has none today). Use the same minimal config as `packages/widget/vitest.config.ts` from 011-preflight-phrase rev2 (node environment, `include: ['src/**/*.test.ts']`).
- [ ] T006 Run `pnpm --filter @legal-chatbot/shared build` and confirm the new types appear in `packages/shared/dist/schemas/lead-action.d.ts`.

### Foundation 2B — Drizzle schema migration (Constitution VII)

- [ ] T007 Extend `packages/api/src/db/schema.ts` to add two new nullable columns to the `leads` table per data-model.md: `follow_up_action: text('follow_up_action')` and `follow_up_action_changed_at: text('follow_up_action_changed_at')`. Both nullable, no default.
- [ ] T008 [P] Mirror the schema changes in `packages/api/src/db/test-schema.ts` (SQLite mirror used by Vitest).
- [ ] T009 Generate the migration with `pnpm --filter @legal-chatbot/api db:generate`. Commit the auto-generated SQL file under `packages/api/drizzle/` (filename auto-numbered by drizzle-kit).
- [ ] T010 Run `pnpm --filter @legal-chatbot/api db:migrate` against the local Neon dev DB to verify the migration applies cleanly. Verify via `pnpm --filter @legal-chatbot/api exec tsx -e "import {sql} from 'drizzle-orm'; import {db} from './src/db'; const r = await db.execute(sql\`SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name LIKE 'follow_up_%'\`); console.log(r.rows)"` — output should list both new columns.

**Checkpoint**: After Phase 2 the shared types are committed and consumable from `packages/api`, the schema migration is applied to the dev DB, and existing leads have `NULL` for both new columns. US1 + US2 implementation can now proceed.

---

## Phase 3: User Story 1 — Lawyer Records Follow-Up Action (Priority: P1) 🎯 MVP

**Goal**: A lawyer opens a lead detail page, picks an action from a `<select>`, clicks Save, sees confirmation + a timestamp. Reload preserves the choice. Cross-account access returns 404.

**Independent Test**: From `quickstart.md` US1: open `/dashboard/leads/[id]` (any lead), see the new "Follow-up action" section, change the picker from "No action yet" to "Contacted", click Save, see the timestamp render. Reload — choice persists.

### Tests for User Story 1 (TDD — write FIRST, ensure FAIL before implementation)

- [ ] T011 [P] [US1] Write Vitest tests for `packages/api/src/app/api/dashboard/leads/[id]/action/route.test.ts` covering ALL contract paths from `contracts/lead-action-route-contract.md`: 200 happy paths (each of `contacted`, `call_no_answer`, `meeting_fixed`, AND `null`-clears-the-action); 401 when iron-session is missing; 404 when lead id doesn't exist; 404 when lead exists but `lead.account_id !== session.accountId` (the cross-account guard — privacy-critical per Constitution V); 400 when body fails Zod (missing `action` field, invalid enum value, non-object body); response body shape (`{success, follow_up_action, follow_up_action_changed_at}`); timestamp is a valid ISO string when action is non-null; timestamp is `null` when action is `null`. Use the dependency-injection pattern from 011-preflight-phrase's `handler.ts` (export the testable handler from a sibling `handler.ts`, leave `route.ts` as the minimal Next.js shell). Tests MUST fail initially.

### Implementation for User Story 1

- [ ] T012 [US1] Implement `packages/api/src/app/api/dashboard/leads/[id]/action/handler.ts` per `contracts/lead-action-route-contract.md` "Behavior" section: exports `handleLeadActionUpdate(req, params, deps)` testable function + `PRODUCTION_DEPS` + `LeadActionDeps` interface. Deps include `getAuthSession` + a function that performs the SELECT-then-UPDATE round-trip on the `leads` table. The handler validates iron-session → Zod-parses body → SELECTs lead by `id AND account_id` → UPDATEs both `follow_up_action` + `follow_up_action_changed_at` (timestamp = `new Date().toISOString()` when action is non-null, `null` when action is null) → returns 200 with the new values. T011 tests pass.
- [ ] T013 [US1] Implement `packages/api/src/app/api/dashboard/leads/[id]/action/route.ts` as the minimal Next.js shell: imports `handleLeadActionUpdate` + `PRODUCTION_DEPS` from `./handler`; exports `POST(req, ctx)` that pulls `params.id` from the route context and calls the handler. Same shell pattern as 011's `route.ts`.
- [ ] T014 [P] [US1] Implement `packages/api/src/app/dashboard/leads/[id]/action-picker.tsx` (client component) per research.md R5: native `<select>` with options "No action yet", "Contacted", "Call didn't answer", "Client meeting fixed"; small "Save" button; on Save, POST to `/api/dashboard/leads/${leadId}/action` with `{action: selectedSlug | null}`; on success, render a "Saved" confirmation that fades after ~2s AND update the locally-displayed timestamp from the response body; on error, render a small "Failed to save" message (silent retry not needed — the lawyer can click Save again). Component takes `{leadId: string; initialAction: LeadAction | null; initialChangedAt: string | null}` props. Uses `'use client';` directive. Pure UI — no Drizzle imports.
- [ ] T015 [US1] Edit `packages/api/src/app/dashboard/leads/[id]/page.tsx` to render `<ActionPicker>` in a new section between the existing lead-info section and the conversation-snapshot section (or wherever fits naturally per the existing page layout). Pass `initialAction={lead.follow_up_action as LeadAction | null}` and `initialChangedAt={lead.follow_up_action_changed_at}` from the SELECT result. Above the picker, render a heading like "Follow-up action". Below the picker, render a small italicized line showing the formatted timestamp (e.g., "Contacted on May 24, 2026, 2:14 PM") via `new Date(initialChangedAt).toLocaleString('en-US', {month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true})` per research.md R6. When `follow_up_action_changed_at` is null, render "No action recorded yet."
- [ ] T016 [US1] Live verify locally: start the API + dashboard dev server (`pnpm --filter @legal-chatbot/api dev`), sign in to `/dashboard`, click into any captured lead, change the action to "Contacted", click Save, observe the success confirmation + timestamp. Reload the page — choice persists. Open DevTools Network tab — the POST to `/api/dashboard/leads/[id]/action` returns 200 with the expected shape.

**Checkpoint**: After Phase 3, US1 is functionally complete. Lawyer can record / change / clear actions via the detail page; data persists; cross-account guard works (verified by T011 unit test).

---

## Phase 4: User Story 2 — Lawyer Scans Leads List for Actionable Leads (Priority: P2)

**Goal**: A lawyer opens `/dashboard/leads` and scans the table. A new "Action" column shows each lead's current action as a colored badge OR an em-dash placeholder for the null-state.

**Independent Test**: From `quickstart.md` US2: with multiple leads in mixed action states (set up via US1 walk-through OR by manually updating a few leads via the picker), open the leads list. Verify each row shows its action in the new column; em-dash is visible for the null state.

### Implementation for User Story 2

- [ ] T017 [US2] Edit `packages/api/src/app/dashboard/leads/lead-table.tsx` to add a new "Action" `<th>` column header AND a corresponding `<td>` cell per row, positioned immediately after the existing "Status" column. The Lead type interface at the top of the file gains `follow_up_action: string | null` (no need to add `follow_up_action_changed_at` here — only the picker page uses it). The cell renders: a small badge with the display label (looked up from `LEAD_ACTION_LABELS` in `@legal-chatbot/shared`) when the action is non-null, OR an em-dash `—` (with muted color, e.g., `#A3A3A3`) when null. Match the existing badge styling pattern from `statusStyles` map. New `actionStyles` map provides per-slug colors:
  - `contacted` → green dot + "Contacted" text on light green background
  - `call_no_answer` → amber dot + "Call didn't answer" text on light amber background
  - `meeting_fixed` → blue dot + "Client meeting fixed" text on light blue background
  - null → em-dash, muted grey
- [ ] T018 [US2] Edit `packages/api/src/app/dashboard/leads/page.tsx` to ensure the `db.select().from(leads)...` query includes the new `follow_up_action` column. Drizzle `.select()` with no field list returns all columns, so this MAY already work — verify by adding a `console.log(allLeads[0])` and confirming `follow_up_action` is present. If the page uses `.select({...})` with a specific field map, add `follow_up_action: leads.follow_up_action`.
- [ ] T019 [US2] Live verify locally: open `/dashboard/leads`, observe the new "Action" column on every row. For leads where US1's walk-through set a specific action, confirm the badge renders. For leads with no action, confirm the em-dash renders. The column does not break responsive layout on a typical 1440px desktop viewport.

**Checkpoint**: After Phase 4, US2 is functionally complete. Lawyer can scan the list and immediately see action state per lead.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Walk-spec coverage of the full UX (US1 + US2 in one flow), production deploy + verification, and final task-list bookkeeping.

### 5A — Walk spec

- [ ] T020 Add a Playwright walk-tagged spec at `packages/api/tests/e2e/dashboard-lead-action.walk.spec.ts` covering US1 + US2: (1) sign in to dashboard via existing `loginAsDev` fixture, (2) navigate to `/dashboard/leads`, (3) click into any lead row, (4) set the action picker to "Contacted" + Save, (5) assert the success confirmation appears AND the timestamp text appears, (6) navigate back to `/dashboard/leads`, (7) assert the row for that lead shows the "Contacted" badge in the new "Action" column, (8) assert at least one OTHER row shows the em-dash placeholder. `@walk` tag for headed `pnpm e2e:walk` runs. Cleanup: at end of spec, set the action back to `null` so the dev DB stays in a clean state.
- [ ] T021 Run `pnpm --filter @legal-chatbot/api e2e -- dashboard-lead-action` against the local dev server. Should pass green. Record the run time.

### 5B — Full pre-deploy verification

- [ ] T022 Stop dev servers; run the full pre-deploy sweep: `pnpm -r typecheck` (all 5 packages), `pnpm --filter @legal-chatbot/api test` (full unit suite — should be 297 + new tests passing), `pnpm --filter @legal-chatbot/api e2e` (full e2e suite — should be 17 + 1 new = 18 passing). Production builds: `pnpm --filter @legal-chatbot/shared build` + `pnpm --filter @legal-chatbot/widget build` + `pnpm --filter @legal-chatbot/api build`. All clean.

### 5C — Production deploy

- [ ] T023 Apply the migration to the production Neon DB. The dev account uses the same Neon DB as production for this MVP setup, so `pnpm --filter @legal-chatbot/api db:migrate` against the dev `DATABASE_URL` (which IS production for this project) is what's needed. Running this from the local shell is the same operation that would run during a Netlify build's `db:migrate` if that were wired in (it's not today; manual apply is the convention).
- [ ] T024 Merge `013-lead-action-tracking` → `main` (fast-forward) and push to GitHub. Netlify auto-rebuilds the dashboard site within ~3-5 min.
- [ ] T025 Run the full E2E suite against the deployed Netlify URLs: `E2E_BASE_URL=https://lex-bot-v0.netlify.app E2E_WIDGET_URL=https://lex-bot-chatbot.netlify.app pnpm --filter @legal-chatbot/api e2e`. Should be 18/18 green. Sanity check: open https://lex-bot-v0.netlify.app/dashboard in incognito, sign in, navigate to a lead, set the action, observe the persistence.

### 5D — Final sweep

- [ ] T026 Update `specs/013-lead-action-tracking/tasks.md` to mark all tasks `[X]` and append a "Branch totals" line at the bottom mirroring the convention used in 010/011/012 tasks.md.
- [ ] T027 Update `AGENTS.md` SPECKIT block per the established convention: stays on 013 until the next `/speckit.specify` lands. (No-op edit; verify the pointer is correct.)

**Checkpoint**: After Phase 5, the feature is production-ready and verified end-to-end against the live Netlify deploy.

---

## Dependencies

```text
Phase 1 (Setup) ───────────┐
                           ▼
                   Phase 2 (Foundational)
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        Phase 3 (US1 — MVP)    Phase 4 (US2)
                │                     │
                └──────────┬──────────┘
                           ▼
                   Phase 5 (Polish + Deploy)
```

**Hard dependencies** (cannot start until prerequisite completes):

- Phase 2 blocks Phases 3 + 4 (every implementation file imports from `@legal-chatbot/shared` AND queries the new DB columns). T010 (migration applied) specifically must land before any route or page that reads the new columns is invoked at runtime.
- Phase 3 (US1) and Phase 4 (US2) are mostly independent after Phase 2 — they edit different files (route + picker + detail-page vs. lead-table). The ONE shared concern: the Lead type interface in `lead-table.tsx` (T017) needs the `follow_up_action` field, which is a single line. Either phase can land first; no merge conflict expected.
- Phase 5 (Polish) depends on Phases 3 + 4 completing — the walk spec (T020) exercises both stories in one flow, and the production-deploy verification (T025) tests against the deployed code.
- Within Phase 3: T011 (route tests) blocks T012 (route handler impl) — TDD red-then-green. T013 (route shell) trivially follows T012 (one import). T014 (picker component) is independent of T012/T013 — can land in parallel; the picker only needs the route to exist at runtime, not at compile time. T015 (detail-page edit) imports `<ActionPicker>` so it depends on T014.
- Within Phase 4: T017 (table edit) is one self-contained file change. T018 (page query verification) is independent. T019 (manual verify) sequential after both.
- Within Phase 5: T020 (walk spec authoring) is independent of the rest. T021 (run walk) sequential after T020. T022 (full sweep) sequential after both phase-3 and phase-4 implementations land. T023 (migration to prod) sequential after T022. T024 (deploy) sequential after T023. T025 (production e2e) sequential after T024 + the Netlify build window. T026 + T027 are bookkeeping.

**Soft dependencies** within phases noted via `[P]` markers; non-`[P]` tasks within a phase are sequential because they share a file (T012/T013 share `route.ts`/`handler.ts` directory; T015 imports T014's component) or because the next task verifies the prior one.

---

## Parallel Execution Examples

### Within Phase 1 (Setup)

T001 + T002 are independent (DB query vs. directory check):

```text
T001 (verify dev DB has leads)        ┐
T002 [P] (cleanup stale dir)          ┘  parallel
```

### Within Phase 2 (Foundational)

T003 → T004 → T005 + T006 in parallel; T007 + T008 in parallel after T004; T009 sequential; T010 sequential:

```text
T003 (shared schema)
       │
       ▼
T004 (shared index re-export)
       │
       ├──► T005 [P] (shared schema unit tests)
       │
       ├──► T007 (extend api db schema)
       │       │
       │       ▼
       │    T008 [P] (extend test-schema)
       │
       └──► T006 (verify shared build)
              │
              ▼
            T009 (generate migration)
              │
              ▼
            T010 (apply migration to dev DB)
```

### Within Phase 3 (US1 — MVP)

After Phase 2:

```text
T011 (route tests, TDD red)
       │
       ▼
T012 (handler.ts impl)              ┐
       │                            │
       ▼                            ├─── T012 + T014 in parallel:
T013 (route.ts shell)               │    handler is server-side,
                                    │    picker is client-side,
T014 [P] (action-picker.tsx)        ┘    different files.
       │
       ▼
T015 (detail-page edit; imports T014's component)
       │
       ▼
T016 (live verify)
```

### Within Phase 4 (US2)

```text
T017 (lead-table.tsx edit)           ┐
T018 [P] (verify page.tsx query)     ┘  parallel; different files
       │
       ▼
T019 (live verify)
```

### Within Phase 5

```text
T020 (walk spec)
       │
       ▼
T021 (run walk against local) → T022 (full pre-deploy sweep)
                                      │
                                      ▼
                                T023 (migrate prod) → T024 (deploy) → T025 (prod e2e)
                                                                       │
                                                                       ▼
                                                                T026 + T027 (bookkeeping)
```

---

## Implementation Strategy

### MVP Scope

**The MVP is Phase 1 + Phase 2 + Phase 3 only.** This delivers:

- The schema migration applied to the dev DB.
- The shared Zod schema importable from `@legal-chatbot/shared`.
- The POST `/api/dashboard/leads/[id]/action` route with full auth + authz coverage.
- The `<ActionPicker>` client component on the lead detail page.
- The lawyer can record / change / clear actions per lead.

**What's DEFERRED in MVP**:
- US2 (table column) — Phase 4. Adds the at-a-glance scan UX.
- Walk spec coverage — Phase 5A.
- Production deploy + verification — Phase 5B-5C.
- Bookkeeping — Phase 5D.

**Why the MVP excludes US2**: US2 is genuinely small (~15 LOC of table edit) and could be folded into the MVP. It's split out for traceability + because someone reviewing might want to ship US1 alone first if the table-column UX needs more design discussion (e.g., colors, badge style). In practice US1 + US2 typically land together; the split is documentation hygiene.

**MVP exit criteria**:
- T011 (route tests) green: 200/400/401/404/cross-account-404 all assert correctly.
- T016 (live local verify) shows the picker round-trips persist.
- No constitution invariant failures (typecheck clean; no Server Actions; no native deps).

### Incremental Delivery

After MVP, ship in the following sequence:

1. **Phase 4 (US2 table column)** — ~30 min. Adds the at-a-glance value.
2. **Phase 5A walk spec (T020-T021)** — ~30 min. Hardens regression coverage.
3. **Phase 5B full pre-deploy sweep (T022)** — ~5 min. Catches anything stale.
4. **Phase 5C production deploy + verify (T023-T025)** — ~10 min active + ~5 min Netlify wait.
5. **Phase 5D bookkeeping (T026-T027)** — ~5 min.

Each phase is a green-CI mergeable commit. Phase 5 is broken into ~4 sub-commits (5A / 5B / 5C / 5D) to keep PRs reviewable.

### Test-First Gate

Per Constitution III + the "Tests" preamble of this file: every implementation task is preceded by its corresponding TDD task in the same phase. The implementer MUST verify the test fails before writing the implementation, and MUST verify the test passes before marking the task complete.

For US1: T011 (route tests) MUST be authored AND failing before T012 (route handler impl) is started. T011's cross-account-404 test in particular is the privacy-critical assertion.

For US2: there's no Vitest test pair (the change is presentational on top of an existing component). The walk spec at T020 covers it.
