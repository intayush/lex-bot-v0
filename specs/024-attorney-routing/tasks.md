---
description: "Task list for 024-attorney-routing"
---

# Tasks: Attorney Management & Hot Lead Email Routing

**Input**: Design documents from `/specs/024-attorney-routing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/attorneys-api.md, contracts/routing-queue-contract.md, quickstart.md

**Tests**: Constitution III applies. Unit tests for routing logic (attorney-case-type matching); integration test for email dispatch using a mocked Resend client.

**Organization**: Tasks grouped by user story. US1 (attorney management) and US2 (email routing) are independently deliverable. US2 depends on US1 data existing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete task dependencies)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2)
- Every task lists exact file paths (repo-root-relative)

## Path Conventions

This feature touches `packages/api` only. All paths are repo-root-relative.

---

## Phase 1: Setup

**Purpose**: Install Resend, update schema, generate and apply migration. No business logic yet.

- [X] T001 Confirm branch `024-attorney-routing` is checked out and working tree is clean: `git status`
- [X] T002 Add `resend` to `packages/api/package.json` dependencies and run `pnpm install` from repo root. Verify `packages/api/node_modules/resend` exists.
- [X] T003 Edit `packages/api/src/db/schema.ts`: add `attorneys` table with columns: `id` (text PK, nanoid), `account_id` (text NOT NULL FK → accounts.id), `name` (text NOT NULL), `email` (text NOT NULL), `mobile` (text nullable), `created_at` (text NOT NULL), `updated_at` (text NOT NULL). Add `uniqueIndex('attorneys_account_email_unique').on(table.account_id, table.email)`.
- [X] T004 Edit `packages/api/src/db/schema.ts`: add `attorney_case_type_assignments` table with columns: `id` (text PK, nanoid), `attorney_id` (text NOT NULL FK → attorneys.id with cascade delete), `account_id` (text NOT NULL FK → accounts.id), `case_type_slug` (text NOT NULL), `created_at` (text NOT NULL). Add `uniqueIndex('attorney_assignment_unique').on(table.attorney_id, table.case_type_slug)`.
- [X] T005 Edit `packages/api/src/db/schema.ts`: add `attorney_id` nullable text column to the `notifications` table with FK reference to `attorneys.id`. This serves as the link between a routing notification and the attorney it targets.
- [X] T006 Edit `packages/api/src/db/test-schema.ts`: add the same `attorneys` and `attorney_case_type_assignments` tables (SQLite-compatible: use `sqliteTable`, `integer` for booleans) and add `attorney_id` nullable text column to the `leads` table mock. Mirror the production schema exactly.
- [X] T007 Run `pnpm --filter @legal-chatbot/api db:generate` to generate the Drizzle migration. Rename the generated file to `packages/api/drizzle/0007_add_attorney_tables.sql` and update `packages/api/drizzle/meta/_journal.json` with the new tag.
- [X] T008 Inspect the generated migration: confirm it contains CREATE TABLE for `attorneys`, CREATE TABLE for `attorney_case_type_assignments`, ADD COLUMN `attorney_id` on `notifications`, and the two unique indexes. No destructive statements. Then run `pnpm --filter @legal-chatbot/api db:migrate` to apply.

**Checkpoint**: Migration applied. Schema has attorney tables. No business logic yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Email helper and attorney CRUD library that both US1 and US2 depend on.

- [X] T009 [P] Create `packages/api/src/lib/email.ts`: export `sendEmail({ to, subject, html }: { to: string; subject: string; html: string }): Promise<void>`. Import `Resend` from `'resend'`. Use `process.env.RESEND_API_KEY` and `process.env.EMAIL_FROM ?? 'noreply@legalchatbot.com'`. If `RESEND_API_KEY` is not set, log a warning and return without throwing. Catch Resend errors, log `{ to, error }`, and rethrow so the caller can handle or record failure.
- [X] T010 [P] Create `packages/api/src/lib/attorneys.ts`: export the following functions using Drizzle ORM queries:
  - `getAttorneys(accountId: string): Promise<Attorney[]>` — SELECT all attorneys for account with their case_type_slugs (join `attorney_case_type_assignments`)
  - `createAttorney(accountId: string, data: { name: string; email: string; mobile?: string | null; case_type_slugs: string[] }): Promise<string>` — INSERT attorney + assignments, return new attorney id
  - `updateAttorney(accountId: string, attorneyId: string, data: { name?: string; email?: string; mobile?: string | null; case_type_slugs?: string[] }): Promise<void>` — UPDATE attorney fields; if `case_type_slugs` provided, DELETE existing assignments and re-INSERT
  - `deleteAttorney(accountId: string, attorneyId: string): Promise<void>` — DELETE attorney (cascade deletes assignments)
  - `getAttorneysForCaseType(accountId: string, caseTypeSlug: string): Promise<Array<{ id: string; name: string; email: string }>>` — used by routing: SELECT attorneys WHERE case_type_slug matches
  - Export `Attorney` interface: `{ id, account_id, name, email, mobile, case_type_slugs, created_at, updated_at }`

**Checkpoint**: Email helper and attorney CRUD library exist. US1 and US2 can now be implemented.

---

## Phase 3: User Story 1 — Lawyer manages the firm's attorney roster (Priority: P1) 🎯 MVP

**Goal**: Lawyers can add, edit, delete, and view attorneys from the Configuration page. Each attorney has a name, email, optional mobile, and a set of case type assignments from the firm's catalog.

**Independent Test**: Open Configuration → Attorneys tab. Add attorney "Test Attorney" with email "test@gmail.com" and case type "DUI". Confirm they appear in the list. Edit to add "Criminal Defense". Delete them and confirm removal. Run quickstart.md Steps 1–3.

### Implementation for User Story 1

#### API layer

- [X] T011 [P] [US1] Create `packages/api/src/app/api/dashboard/attorneys/route.ts`: implement `GET` (returns `{ attorneys }` via `getAttorneys(session.accountId)`) and `POST` (validates body with Zod: `{ name: string, email: string, mobile?: string, case_type_slugs?: string[] }`, validates email format, checks all case_type_slugs exist in the account's `case_types` table, calls `createAttorney()`, returns 201 `{ success: true, id }`). Return 409 on duplicate email. Use `getAuthSession()` for auth.
- [X] T012 [P] [US1] Create `packages/api/src/app/api/dashboard/attorneys/[id]/route.ts`: implement `PATCH` (validates body, calls `updateAttorney()`, returns 200 or 404) and `DELETE` (calls `deleteAttorney()`, returns 200 or 404). Both verify the attorney's `account_id` matches the session before mutating.

#### Frontend

- [X] T013 [US1] Create `packages/api/src/app/dashboard/config/attorneys-tab.tsx` as a new `'use client'` component `AttorneysTab`. Props: `initialAttorneys: Attorney[]`, `caseTypes: CaseType[]`. Renders a list of attorney rows (name, email, mobile, case type chips, Edit and Delete buttons) and an "Add attorney" button that opens an inline form. The form has: name text input, email text input, mobile text input, multi-select for case types (checkboxes from `caseTypes` prop). Save POSTs to `/api/dashboard/attorneys`. Edit pre-fills the form and PATCHes to `/api/dashboard/attorneys/{id}`. Delete calls DELETE with a browser `confirm()` guard. Page reloads on success. Style consistently with the existing case-types-tab.tsx component.
- [X] T014 [US1] Edit `packages/api/src/app/dashboard/config/page.tsx`: add `getAttorneys(session.accountId)` and `getCaseTypes(session.accountId)` to the parallel fetch (alongside existing `getLatestConfig` and `getConfigHistory`). Pass the results as `initialAttorneys` and `caseTypes` props to `ConfigForm`.
- [X] T015 [US1] Edit `packages/api/src/app/dashboard/config/config-form.tsx`: add `'Attorneys'` to the `tabs` array (after `'Custom'`). Add `initialAttorneys: Attorney[]` and `caseTypes: CaseType[]` to the `ConfigFormProps` interface. Import `AttorneysTab`. Render `{activeTab === 5 && <AttorneysTab initialAttorneys={initialAttorneys} caseTypes={caseTypes} />}`.

**Checkpoint**: US1 complete. Attorneys tab visible and functional. CRUD operations work.

---

## Phase 4: User Story 2 — HOT lead triggers attorney email routing (Priority: P1)

**Goal**: When `captureLead()` classifies a lead as HOT, a routing notification is enqueued for each attorney whose case type matches the lead's case type. After the HTTP response is returned, the notification is consumed and an email is sent via Resend to each matching attorney.

**Independent Test**: Add attorney "Test Attorney" with case type "DUI". Submit a DUI HOT lead via the widget. Within 60 seconds, "test@gmail.com" receives an email with the lead details. Verify `notifications` table has a row with `type='attorney_lead_routing'`, `delivered_at` non-null. Run quickstart.md Steps 4–6.

### Implementation for User Story 2

#### Routing logic

- [X] T016 [US2] Create `packages/api/src/lib/attorney-routing.ts`: export `enqueueAttorneyRoutingNotifications(input: { accountId: string; leadId: string; caseTypeSlug: string; leadName: string | null; leadEmail: string | null; leadPhone: string | null; leadDescription: string | null; capturedAt: string }): Promise<void>`. This function:
  1. Calls `getAttorneysForCaseType(accountId, caseTypeSlug)` to find matching attorneys.
  2. If none found, returns immediately (no-op, no error).
  3. For each matching attorney, INSERTs a `notifications` row: `type = 'attorney_lead_routing'`, `delivery_channel = 'email'`, `attorney_id = attorney.id`, `lead_id = leadId`, `account_id = accountId`, `title = 'New HOT lead: {caseTypeSlug}'`, `body = JSON.stringify(RoutingNotificationPayload)`, `read = false`, `delivered_at = null`.
  4. Then calls `dispatchAttorneyRoutingEmails(notificationIds)` (defined below) via `runAfterResponse()` so email dispatch happens after the HTTP response.

- [X] T017 [US2] In `packages/api/src/lib/attorney-routing.ts`: export `dispatchAttorneyRoutingEmails(notificationIds: string[]): Promise<void>`. For each notification ID:
  1. SELECT the notification row (with attorney JOIN for name and email).
  2. Parse `body` as `RoutingNotificationPayload`.
  3. Build email HTML (simple template: attorney salutation, lead name, contact email, contact phone, case type, description, captured_at, link to `/dashboard/leads`).
  4. Call `sendEmail({ to: attorney.email, subject: ..., html: ... })`.
  5. On success: UPDATE `notifications SET delivered_at = now()` for this row.
  6. On failure: UPDATE `notifications SET delivered_at = 'FAILED'` and `console.error({ notificationId, error })`. Do NOT rethrow — failures are logged but do not propagate.

#### Wire into lead capture

- [X] T018 [US2] Edit `packages/api/src/lib/leads.ts`: in `captureLead()`, after the existing `urgent_lead` notification INSERT (inside the `if (wasNotUrgent && isStillUrgent)` block, after `emitLeadClassifiedLog()`), add a call to `enqueueAttorneyRoutingNotifications({ accountId, leadId, caseTypeSlug: input.caseType ?? '', ... })`. Also add the same call to the first-time INSERT branch (lines ~479-510) when `finalClassification === 'HOT'`. Wrap both calls in `runAfterResponse()` using the existing pattern. Import `enqueueAttorneyRoutingNotifications` from `'./attorney-routing'` and `runAfterResponse` from `'./run-after-response'`.

**Checkpoint**: US2 complete. HOT leads trigger attorney emails. Non-HOT leads are unaffected.

---

## Phase 5: Tests

**Purpose**: Unit tests for routing matching logic; integration test for email dispatch.

- [X] T019 [P] Create `packages/api/src/lib/attorney-routing.test.ts`: unit test for `getAttorneysForCaseType` — given two attorneys (one with DUI, one with Personal Injury), assert only the DUI attorney is returned when querying for DUI. Use in-memory SQLite (same pattern as leads.test.ts). Add `attorneys` and `attorney_case_type_assignments` CREATE TABLE SQL inline.
- [X] T020 [P] In the same test file, add a unit test for `enqueueAttorneyRoutingNotifications`: given a HOT DUI lead with one matching attorney, assert one `notifications` row is written with `delivery_channel = 'email'` and `delivered_at = null`. Assert zero rows when no attorneys match.
- [X] T021 [P] Create `packages/api/src/lib/email.test.ts`: mock the `resend` module. Test that `sendEmail()` calls `resend.emails.send()` with the correct `to`, `subject`, and `from`. Test that when `RESEND_API_KEY` is not set, `sendEmail()` logs a warning and returns without throwing.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T022 [P] Run `pnpm --filter @legal-chatbot/api typecheck` and fix any new TypeScript errors from the new tables, attorney library, routing module, and config-form changes.
- [X] T023 [P] Run `pnpm --filter @legal-chatbot/api test` and confirm all tests pass including T019–T021. Fix any inline SQL in existing test files that create a `notifications` table (add `attorney_id text` column to match updated schema).
- [X] T024 Add `RESEND_API_KEY=` and `EMAIL_FROM=` (both empty) to `packages/api/.env.local` as documented stubs so developers know to fill them. Add a comment: `# Get your API key from https://resend.com`.
- [X] T025 Execute quickstart.md Steps 1–6 end-to-end against the local dev server with a valid `RESEND_API_KEY`. Record the result (email received / not received) and note any deviations.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (tables must exist for DB queries in library). BLOCKS US1 and US2.
- **Phase 3 (US1)**: Depends on Phase 2. Can start as soon as T010 is complete.
- **Phase 4 (US2)**: Depends on Phase 2 and Phase 3 complete (routing needs attorney data to exist).
- **Phase 5 (Tests)**: Can start after Phase 2 (T019-T021 test the library functions).
- **Phase 6 (Polish)**: Depends on Phases 3, 4, 5 complete.

### Within Phase 3 (US1)

- T011 + T012 can run in parallel (different route files).
- T013 (AttorneysTab component) can run in parallel with T011/T012.
- T014 (page.tsx data fetch) depends on T010 (getAttorneys function exists).
- T015 (config-form.tsx tab wiring) depends on T013.

### Within Phase 4 (US2)

- T016 + T017 are in the same file but T017 is called from T016 — write sequentially.
- T018 (leads.ts wiring) depends on T016 and T017 complete.

### Parallel Opportunities

- T009 (email.ts) and T010 (attorneys.ts) — different files, fully independent.
- T011 and T012 — different route files.
- T011, T012, T013 — different files, same phase.
- T019, T020, T021 — different test files (T019+T020 share a file but can be authored together).
- T022, T023 — different validation commands.

---

## Parallel Example: Foundational Phase

```bash
# Developer A:
Task: "Create packages/api/src/lib/email.ts Resend wrapper (T009)"

# Developer B:
Task: "Create packages/api/src/lib/attorneys.ts CRUD functions (T010)"
```

## Parallel Example: US1 Backend + Frontend

```bash
# Developer A (backend):
Task: "Create packages/api/src/app/api/dashboard/attorneys/route.ts (T011)"
Task: "Create packages/api/src/app/api/dashboard/attorneys/[id]/route.ts (T012)"

# Developer B (frontend):
Task: "Create packages/api/src/app/dashboard/config/attorneys-tab.tsx (T013)"
```

---

## Implementation Strategy

### MVP Scope

**MVP = US1 (Phase 1 + Phase 2 + Phase 3)** — the attorney roster UI ships and is useful for managing firm contacts before routing is live.

### Incremental Delivery

1. Phase 1 (Schema + Resend) → tables exist, dependency installed
2. Phase 2 (Libraries) → CRUD functions + email helper ready
3. Phase 3 (US1) → Attorney management tab live. **Ship-ready point.**
4. Phase 4 (US2) → HOT lead routing live. Attorneys receive emails.
5. Phase 5 (Tests) → Full test coverage.
6. Phase 6 (Polish) → All gates green.

### Recommended Single-Developer Sequence

```text
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008    (Schema + migration)
T009 + T010 in parallel                                     (Libraries)
T011 + T012 + T013 in parallel                             (US1 API + UI)
T014 → T015                                                (US1 page wiring)
T016 → T017 → T018                                         (US2 routing)
T019 + T020 + T021 in parallel                             (Tests)
T022 + T023 → T024 → T025                                  (Polish)
```

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` label is required on US1/US2 tasks; Setup, Foundational, and Polish tasks omit it.
- Constitution III: T019–T021 are first-class deliverables. Tests should be observed failing before the corresponding implementation lands.
- The `notifications` table already has `attorney_id` after T005/T008 — all existing inline SQL in test files that create the `notifications` table need this column added (T023 catches this).
- Resend requires a verified sending domain in production. `EMAIL_FROM` should use a domain the firm controls.
- The routing does NOT replace the existing `urgent_lead` dashboard notification — both fire for HOT leads.
