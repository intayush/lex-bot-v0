---
description: "Task list for Platform Admin Console implementation"
---

# Tasks: Platform Admin Console

**Input**: Design documents from `/specs/027-platform-admin-console/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED — the spec's Constitution Check (Principle III, NON-NEGOTIABLE)
requires test-first, layered testing (Vitest unit/integration + Playwright E2E).

**Organization**: Grouped by user story (US1–US6) for independent implementation
and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US6 (user story phase tasks only)
- All paths are repo-relative. API app is `packages/api/`; shared schemas are
  `packages/shared/src/`.

## Conventions (from plan.md / research.md)

- IDs: `text` PK + `nanoid()`. Timestamps: ISO-string `text` columns.
- Every new Postgres table MUST also be mirrored in
  `packages/api/src/db/test-schema.ts` AND in the per-test `CREATE TABLE` SQL,
  or in-memory SQLite tests won't have it.
- Route Handlers only (no Server Actions). `bcryptjs` + Node `crypto` (no native
  binaries). All boundaries validated by Zod in `packages/shared`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, env, and migration scaffolding shared by all stories.

- [X] T001 Add `@ai-sdk/anthropic` and `@ai-sdk/openai` to `packages/api/package.json` and run `pnpm install`
- [X] T002 Create central fail-fast env module in `packages/api/src/lib/env.ts` reading + validating `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`, `ADMIN_SESSION_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (throw on absence, matching `db/index.ts` pattern)
- [X] T003 [P] Add defensive defaults for `ADMIN_SESSION_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` in `packages/api/vitest.setup.ts`
- [X] T004 [P] Document new env vars in `packages/api/.env.example` (or README env section) and note them for Netlify config

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, migration, encryption, and admin-auth primitives that ALL
user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Schema & migration

- [X] T005 Add `super_admins`, `account_llm_config`, `usage_events`, `admin_audit_log` tables and extend `accounts` (`status`, `onboarding_status`, `deleted_at`) in `packages/api/src/db/schema.ts` per data-model.md
- [X] T006 Mirror all four new tables + `accounts` new columns in `packages/api/src/db/test-schema.ts` (SQLite; booleans via `integer(..., { mode: 'boolean' })`)
- [X] T007 Generate migration `0010` via `pnpm --filter @legal-chatbot/api db:generate`; verify `drizzle/0010_*.sql` + journal entry (`0010_brave_carlie_cooper.sql`, journal idx 10). NOTE: `db:migrate` apply requires a live Neon DB — not run in this environment; SQLite tests validate the shape.

### Shared Zod schemas

- [X] T008 [P] Create admin schemas (admin session, `WizardSubmission`, `TenantSummary`, `TenantMetrics`, `SopFlowView` DTOs) in `packages/shared/src/schemas/admin.ts` and export from the package index
- [X] T009 [P] Create LLM-config schema with provider enum (`google`|`anthropic`|`openai`) and the `(provider, model)` allow-list in `packages/shared/src/schemas/llm-config.ts`

### Encryption & admin auth primitives

- [X] T010 [P] Implement AES-256-GCM `encrypt()`/`decrypt()` (`iv:tag:ciphertext` base64) using Node `crypto` + `ENCRYPTION_KEY` in `packages/api/src/lib/crypto.ts`
- [X] T011 [P] Unit test crypto round-trip + tamper-detection (bad auth tag throws) in `packages/api/src/lib/crypto.test.ts` (5 tests pass)
- [X] T012 Create parallel super-admin iron-session (cookie `legal_chatbot_admin`, `ADMIN_SESSION_SECRET`, `SessionData = { adminId?, email? }`) in `packages/api/src/lib/admin-session.ts`
- [X] T013 Implement `requireSuperAdmin()` guard (returns 401 for absent/firm session, exposes `adminId`) in `packages/api/src/lib/admin-guard.ts`
- [X] T014 [P] Implement `recordAdminAction(adminId, action, targetAccountId?, metadata?)` writing `admin_audit_log` in `packages/api/src/lib/admin/audit.ts`
- [X] T015 [P] Create dev super-admin seed script in `packages/api/src/db/seed-super-admin.ts` (bcrypt hash, rounds 10)

**Checkpoint**: Schema live, admin session + guard + audit + crypto ready — user stories can begin.

---

## Phase 3: User Story 1 — Super-admin sign-in & fleet overview (Priority: P1) 🎯 MVP

**Goal**: A super-admin signs in on a dedicated login and sees a cross-tenant
fleet overview; firm logins are denied.

**Independent Test**: Seed ≥2 tenants + a super-admin; sign in → overview lists
all tenants with status/onboarding/lead-count/spend/last-activity; a firm session
gets 401 on `/api/admin/*`.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T016 [P] [US1] Integration test: `POST /api/admin/login` success/invalid + `requireSuperAdmin` returns 401 for firm session in `packages/api/src/app/api/admin/login/route.test.ts`
- [X] T017 [P] [US1] Integration test: `GET /api/admin/tenants` returns fleet summaries, excludes soft-deleted, denies firm session in `packages/api/src/app/api/admin/tenants/route.test.ts`

### Implementation for User Story 1

- [X] T018 [P] [US1] Implement `POST /api/admin/login` + `POST /api/admin/logout` in `packages/api/src/app/api/admin/login/route.ts` and `.../admin/logout/route.ts`
- [X] T019 [US1] Implement fleet aggregation (grouped queries: 30d lead count, estimated spend from `usage_events`, last activity) in `packages/api/src/lib/admin/fleet.ts`
- [X] T020 [US1] Implement `GET /api/admin/tenants` (list) guarded by `requireSuperAdmin`, `deleted_at IS NULL` in `packages/api/src/app/api/admin/tenants/route.ts`
- [X] T021 [P] [US1] Create admin login page in `packages/api/src/app/admin/login/page.tsx` (mirror `app/login/page.tsx`, POST to `/api/admin/login`)
- [X] T022 [US1] Create admin layout (guards on admin session, redirect `/admin/login`) + sidebar in `packages/api/src/app/admin/layout.tsx` and `packages/api/src/app/admin/sidebar.tsx`
- [X] T023 [US1] Create fleet overview page (tenant table, drill-in links) in `packages/api/src/app/admin/page.tsx`

**Checkpoint**: Super-admin can log in and view the fleet; firm logins blocked. MVP demonstrable.

---

## Phase 4: User Story 2 — Register & onboard a tenant via wizard (Priority: P1)

**Goal**: Register a new firm (widget key shown once), complete a guided wizard
generating a DRAFT config + SOP + branches, then publish to go live.

**Independent Test**: Register a firm → get one-time key + `draft` status; walk
wizard → finish generates draft config/SOP/branches; publish → `live` and chat
serves the published config.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T024 [P] [US2] Integration test: `POST /api/admin/tenants` creates account+apiKey, returns key once, 409 on duplicate email in `packages/api/src/app/api/admin/tenants/create.test.ts`
- [X] T025 [P] [US2] Unit test: `buildDraftFromWizard()` maps wizard answers → valid `configurationSchema`; missing required → error in `packages/api/src/lib/admin/tenant-provisioning.test.ts`
- [X] T026 [P] [US2] Integration test: onboarding finish runs seed/ensure chain (SOP + branches created) and publish flips `is_published` + `onboarding_status=live` in `packages/api/src/app/api/admin/tenants/onboarding.test.ts`

### Implementation for User Story 2

- [X] T027 [US2] Extract `provisionTenant({ email, firmName })` (create `accounts` w/ status=active, onboarding=draft + generate & hash `apiKeys` key, return plaintext once) from `seed()` into `packages/api/src/db/provision-tenant.ts`; refactor `seed.ts` to reuse it
- [X] T028 [US2] Implement `buildDraftFromWizard()` + `finishOnboarding()` (write draft `configurations`, then call `seedSopForAccount` → `ensureContactStepForAccount` → `ensureCarAccidentBranchForAccount` → `ensureDefaultBranchesForAccount`) in `packages/api/src/lib/admin/tenant-provisioning.ts`
- [X] T029 [US2] Implement `POST /api/admin/tenants` (register; 201 with one-time key; 409 duplicate) + `GET /api/admin/tenants/[id]` (detail) in `packages/api/src/app/api/admin/tenants/route.ts` and `.../tenants/[id]/route.ts`; audit `tenant.create`
- [X] T030 [US2] Implement `PUT /api/admin/tenants/[id]/onboarding` (save partial / finish with required-field 422) in `packages/api/src/app/api/admin/tenants/[id]/onboarding/route.ts`; audit `tenant.onboard`
- [X] T031 [US2] Implement `POST /api/admin/tenants/[id]/publish` (flip config+SOP `is_published`, set `onboarding_status=live`) in `packages/api/src/app/api/admin/tenants/[id]/publish/route.ts`; audit `tenant.publish`
- [X] T032 [P] [US2] Create register-tenant UI (one-time key reveal) in `packages/api/src/app/admin/tenants/new/page.tsx`
- [X] T033 [US2] Create multi-step onboarding wizard UI (identity → case types → persona → contact → escalation → finish → publish) in `packages/api/src/app/admin/tenants/[id]/onboarding/page.tsx`

**Checkpoint**: A brand-new firm can be registered, onboarded, published, and served (SC-001).

---

## Phase 5: User Story 3 — Per-tenant multi-provider LLM management (Priority: P2)

**Goal**: Set provider/model/(optional key) per tenant; chat resolves per tenant
with Gemini fallback; keys encrypted, never exposed.

**Independent Test**: Unconfigured tenant → Gemini default; set Anthropic+key →
chat uses Anthropic, `usage_events` records provider; `GET llm-config` never
returns key material; logs contain no key.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T034 [P] [US3] Unit test: `resolveModelForAccount` — no config → gemini-2.5-flash; config no key → platform key; config + key → decrypted key; cache invalidation in `packages/api/src/lib/llm/provider-resolver.test.ts`
- [X] T035 [P] [US3] Integration test: `PUT/GET /api/admin/tenants/[id]/llm-config` — upsert, allow-list rejection (400), `hasKey` reflects state, response never includes key in `packages/api/src/app/api/admin/tenants/llm-config.test.ts`

### Implementation for User Story 3

- [X] T036 [US3] Implement `resolveModelForAccount(accountId)` (read `account_llm_config`, instantiate provider via AI SDK, decrypt tenant key or use platform key, gemini fallback, 60s-TTL cache like `auth.ts`) in `packages/api/src/lib/llm/provider-resolver.ts`
- [X] T037 [US3] Implement `GET`/`PUT /api/admin/tenants/[id]/llm-config` (upsert, encrypt key on write, `clearKey`, invalidate resolver cache, never serialize key) in `packages/api/src/app/api/admin/tenants/[id]/llm-config/route.ts`; audit `llm_config.update` (provider+model only)
- [X] T038 [US3] Replace `model: google('gemini-2.5-flash')` with `await resolveModelForAccount(auth.accountId)` at `packages/api/src/app/api/chat/route.ts` (~L467), preserving `maxSteps: 5` and all bounds
- [X] T039 [P] [US3] Replace the `google('gemini-2.5-flash')` fallback in `packages/api/src/lib/sop/date-inferer.ts` (~L45) to accept a resolved model / use the resolver
- [X] T040 [P] [US3] Create LLM-config UI (provider/model select, optional key entry with write-only affordance) in `packages/api/src/app/admin/tenants/[id]/llm/page.tsx`

**Checkpoint**: Tenants use their configured provider/model; default preserved; keys secure (SC-004, SC-005).

---

## Phase 6: User Story 4 — Per-tenant metrics (Priority: P2)

**Goal**: Funnel, usage/cost, and routing-outcome metrics per tenant from
existing data + `usage_events`.

**Independent Test**: Seed sessions/leads/usage/routing → metrics match; zero-
traffic tenant → zeros, no error.

### Tests for User Story 4 ⚠️ (write first, must fail)

- [X] T041 [P] [US4] Unit test: metrics aggregation (funnel counts + conversion, usage/cost by provider/model with price map, routing outcomes) incl. zero-traffic in `packages/api/src/lib/admin/metrics.test.ts`
- [X] T042 [P] [US4] Integration test: `GET /api/admin/tenants/[id]/metrics?window=` returns correct shape + window filtering in `packages/api/src/app/api/admin/tenants/metrics.test.ts`

### Implementation for User Story 4

- [X] T043 [US4] Capture token usage: read `usage` in chat-route `onFinish` and write a `usage_events` row (provider+model+tokens) deferred post-stream (spec-021 `waitUntil` pattern) via `packages/api/src/lib/usage.ts` (`recordUsageEvent`)
- [X] T044 [P] [US4] Add provider/model price map constant in `packages/shared/src/constants/llm-pricing.ts`
- [X] T045 [US4] Implement metrics aggregators (funnel from `sessions`/`leads`; usage/cost from `usage_events` + price map; routing from spec-024 dispatch + spec-013 actions), account+window scoped, in `packages/api/src/lib/admin/metrics.ts`
- [X] T046 [US4] Implement `GET /api/admin/tenants/[id]/metrics` in `packages/api/src/app/api/admin/tenants/[id]/metrics/route.ts`
- [X] T047 [P] [US4] Create tenant metrics UI (funnel, usage/cost over time, routing outcomes) in `packages/api/src/app/admin/tenants/[id]/metrics/page.tsx`

**Checkpoint**: Accurate per-tenant metrics; fleet spend/lead figures (US1) now backed by real data (SC-006).

---

## Phase 7: User Story 5 — Read-only SOP flow visualization (Priority: P3)

**Goal**: Render a tenant's active SOP as a read-only flow (steps → case types →
sub-types → branches).

**Independent Test**: Published tenant → view shows steps/case types/sub-types/
branch questions; no-branch tenant → default flow; no edit controls.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [X] T048 [P] [US5] Unit/integration test: `GET /api/admin/tenants/[id]/sop-view` assembles `SopFlowView` from SOP/branch tables; no-branch → `branch:null` in `packages/api/src/app/api/admin/tenants/sop-view.test.ts`

### Implementation for User Story 5

- [X] T049 [US5] Implement SOP-view assembler (join `sopSteps`/`caseTypes`/`subTypes`/`branches`/`branchVersions` for the published SOP into `SopFlowView` DTO) in `packages/api/src/lib/admin/sop-view.ts`
- [X] T050 [US5] Implement `GET /api/admin/tenants/[id]/sop-view` in `packages/api/src/app/api/admin/tenants/[id]/sop-view/route.ts`
- [X] T051 [P] [US5] Create read-only SOP flow diagram UI (no edit controls) in `packages/api/src/app/admin/tenants/[id]/sop/page.tsx`, building on `packages/api/src/lib/sop/FLOW.md` + `diagrams/`

**Checkpoint**: Super-admin can visualize any tenant's active SOP (view-only).

---

## Phase 8: User Story 6 — Tenant lifecycle controls (Priority: P3)

**Goal**: Suspend/reactivate, rotate key, soft-delete with archival; every
mutation audited.

**Independent Test**: Suspend → chat 401; reactivate → serves; rotate → new key
works/old rejected; soft-delete → `archived_data` snapshot + leaves fleet;
audit rows recorded.

### Tests for User Story 6 ⚠️ (write first, must fail)

- [X] T052 [P] [US6] Integration test: `PATCH status` suspend revokes keys (chat rejected) / reactivate; `POST rotate-key` invalidates old + returns new once in `packages/api/src/app/api/admin/tenants/lifecycle.test.ts`
- [X] T053 [P] [US6] Integration test: `DELETE` writes `archived_data` snapshot, sets `deleted_at`, excludes from fleet, no hard delete; audit row exists in `packages/api/src/app/api/admin/tenants/delete.test.ts`

### Implementation for User Story 6

- [X] T054 [US6] Implement `PATCH /api/admin/tenants/[id]/status` (suspend → set status + revoke `apiKeys`; reactivate → set status + enable/issue key) in `packages/api/src/app/api/admin/tenants/[id]/status/route.ts`; audit `tenant.suspend`/`tenant.reactivate`
- [X] T055 [US6] Implement `POST /api/admin/tenants/[id]/rotate-key` (insert new key, revoke old, return plaintext once) in `packages/api/src/app/api/admin/tenants/[id]/rotate-key/route.ts`; audit `tenant.rotate_key`
- [X] T056 [US6] Implement `DELETE /api/admin/tenants/[id]` (write `archived_data` snapshot of leads/PII, set `deleted_at`) in `packages/api/src/app/api/admin/tenants/[id]/route.ts`; audit `tenant.delete`
- [X] T057 [P] [US6] Add lifecycle controls (suspend/reactivate/rotate/delete with confirm + one-time key reveal) to `packages/api/src/app/admin/tenants/[id]/page.tsx`

**Checkpoint**: Full tenant lifecycle manageable; every action attributable (SC-007).

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T058 [P] E2E (Playwright): admin login → register → wizard → publish → tenant live; firm login denied `/admin` — AUTHORED at `packages/api/tests/e2e/admin-console.walk.spec.ts`. Skips gracefully if the super-admin isn't seeded. Needs a live server + `db:seed-super-admin` to actually run (deferred to a live env).
- [X] T059 [P] Verify no secret leakage: assert per-tenant LLM keys + freshly generated widget keys never appear in logs or API responses (automated check) in `packages/api/src/lib/admin/secret-leakage.test.ts` (SC-005)
- [X] T060 [P] Add "Admin" entry/link wiring and ensure firm sidebar (`packages/api/src/app/dashboard/sidebar.tsx`) is unchanged (isolation regression guard)
- [X] T061 Run `tsc --noEmit`, `eslint .`, `vitest run`, `turbo build` across packages; fix failures
- [ ] T062 Execute `specs/027-platform-admin-console/quickstart.md` scenarios 1–6 end-to-end and record results — DEFERRED: requires a live Neon DB (`db:migrate` for migration 0010) + running server + real/dev provider keys, unavailable in this build environment. Static gates done instead: `tsc --noEmit` clean, 748 vitest tests pass, `next build` compiles all admin routes/pages.
- [X] T063 [P] Update `docs/superpowers/specs/2026-07-05-admin-console-design.md` status → implemented; note any deviations

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)**: no dependencies.
- **Foundational (P2)**: depends on Setup; **BLOCKS all user stories**.
- **US1 (P3)** → after Foundational. No dependency on other stories.
- **US2 (P4)** → after Foundational. Independent (produces tenants US4/US5/US6 can use, but each seeds its own test data).
- **US3 (P5)** → after Foundational. Independent.
- **US4 (P6)** → after Foundational. `usage_events` capture (T043) makes US1's spend column real, but US1 renders without it (zeros).
- **US5 (P7)** → after Foundational. Independent (reads existing SOP tables).
- **US6 (P8)** → after Foundational. Independent.
- **Polish (P9)**: after all desired stories.

### Within each story

- Tests written FIRST and failing before implementation (Constitution III).
- Models/schema → services (lib) → endpoints (routes) → UI.
- Shared foundational tables (T005–T007) unblock everything.

### Parallel opportunities

- Setup: T003, T004 in parallel.
- Foundational: T008, T009, T010/T011, T014, T015 in parallel after schema (T005–T007); T010–T011 independent of schema.
- Within a story, all `[P]` tasks (distinct files) run together — e.g. US2 tests T024/T025/T026; US3 T034/T035.
- Across teams: once Foundational done, US1–US6 can be staffed in parallel (distinct route/UI directories); only shared touch-point is chat `route.ts` (T038, T043 — sequence those two).

---

## Parallel Example: User Story 2

```bash
# Tests first (parallel, distinct files):
Task: "Integration test POST /api/admin/tenants in .../tenants/create.test.ts"        # T024
Task: "Unit test buildDraftFromWizard in .../admin/tenant-provisioning.test.ts"        # T025
Task: "Integration test onboarding finish+publish in .../tenants/onboarding.test.ts"   # T026

# Then implementation; UI tasks parallel to route tasks:
Task: "Register-tenant UI in app/admin/tenants/new/page.tsx"                            # T032 [P]
```

---

## Implementation Strategy

### MVP First

1. Phase 1 Setup → Phase 2 Foundational → Phase 3 **US1** (fleet + admin auth).
2. **STOP & VALIDATE**: super-admin login + fleet overview; firm login denied.
3. Add Phase 4 **US2** (register + onboard + publish) → the core operator loop; demo (SC-001).

### Incremental Delivery

US1 → US2 (MVP operator loop) → US3 (LLM) → US4 (metrics, backfills US1 spend) →
US5 (SOP view) → US6 (lifecycle). Each story ships independently and adds value.

### Shared-file caution

- Chat `route.ts` is touched by T038 (resolver) and T043 (usage capture) — do
  them in sequence, not parallel.
- Every new table (T005) must land in `test-schema.ts` (T006) before any
  story's tests run against SQLite.

---

## Notes

- `[P]` = different files, no incomplete-task dependency.
- `[Story]` labels map tasks to spec.md user stories for traceability.
- Verify tests fail before implementing (Constitution III, NON-NEGOTIABLE).
- Commit after each task or logical group.
- Every mutating `/api/admin/*` handler MUST call `recordAdminAction` (§VIII).
