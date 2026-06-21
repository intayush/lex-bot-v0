---
description: "Task list for 022-version-history-ui"
---

# Tasks: Version History UI

**Input**: Design documents from `/specs/022-version-history-ui/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/config-history-api.md, contracts/sop-history-api.md, quickstart.md

**Tests**: Tests ARE required by Constitution III. Unit tests for new route handlers; one e2e walk for the restore golden path.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2, US3)
- Every task lists exact file paths

## Path Conventions

This feature touches `packages/api/` only. All paths are repo-root-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Migration and schema changes that both US1 and US2 depend on. No UI or route work yet.

- [X] T001 Confirm branch `022-version-history-ui` is checked out and the working tree is clean.
- [X] T002 Run `pnpm db:migrate` to confirm migration tooling is healthy before writing new migrations.
- [X] T003 Edit `packages/api/src/db/schema.ts`: add `label: text('label')` (nullable) to the `configurations` table definition and add `uniqueIndex('configurations_account_version_unique').on(table.account_id, table.version)` in the table constraints. Mirror the existing `sop_configurations` pattern on lines 174-176.
- [X] T004 Edit `packages/api/src/db/schema.ts`: add `label: text('label')` (nullable) to the `sop_configurations` table definition (same column, same position).
- [X] T005 Run `pnpm --filter @legal-chatbot/api db:generate` to generate the Drizzle migration file for the two schema changes (label columns + unique index on configurations).
- [X] T006 Inspect the generated migration file in `packages/api/src/db/migrations/` and verify it adds the `label` column to both tables and the unique index to `configurations` — no data-destructive statements. Rename the file with a descriptive suffix if the auto-name is unclear (e.g., `XXXX_add_version_labels.sql`).
- [X] T007 Run `pnpm --filter @legal-chatbot/api db:migrate` against the dev Neon DB and confirm it applies cleanly with no errors.

**Checkpoint**: Schema migration is applied. Both tables have a `label` column. `configurations` has the unique constraint. All subsequent tasks can proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend helper and shared UI component that both US1 and US2 depend on.

- [X] T008 [P] Edit `packages/api/src/lib/config.ts`: add `getConfigHistory(accountId: string): Promise<ConfigVersionSummary[]>` that queries `configurations` for the account ordered by `version DESC`, returning `id, version, label, is_published, created_at` (no `config_json`). Add the `ConfigVersionSummary` type export. Follow the pattern of `getLatestConfig` in the same file.
- [X] T009 [P] Create `packages/api/src/app/dashboard/config/version-history.tsx` as a new client component `VersionHistory`. It accepts `type: 'config' | 'sop'`, `versions: VersionSummary[]`, `latestVersionId: string`, and callbacks `onRestore(versionId: string): void` and `onLabelChange(versionId: string, label: string | null): void`. Renders a list: each row shows version number, label (inline-editable text field on click), creation date formatted as `MMM D, YYYY`, published status badge, and a "Restore" button (hidden for the row whose id === latestVersionId). Use the same Tailwind class vocabulary as the existing `sop-editor.tsx` component for visual consistency.

**Checkpoint**: `getConfigHistory` is implemented and typed. The shared `VersionHistory` component exists and renders correctly with mock data. US1 and US2 implementation can now begin.

---

## Phase 3: User Story 1 — Browse and restore a past configuration version (Priority: P1) 🎯 MVP

**Goal**: Lawyers can view all saved configuration versions in a panel on the Configuration page and restore any past version as a new draft in one click.

**Independent Test**: Log in to the dashboard. Open the Configuration page. Confirm the version history panel lists all versions ordered newest-first. Click "Restore" on an older version. Confirm a new draft is created and the editor reloads with the restored content.

### Tests for User Story 1 ⚠️

- [X] T010 [P] [US1] In `packages/api/src/app/api/dashboard/config/route.test.ts` (create if absent), add a unit test for `GET /api/dashboard/config` that asserts the response shape matches `{ versions: ConfigVersionSummary[] }` ordered by version DESC, including the `label` field.
- [X] T011 [P] [US1] In the same test file, add a unit test for `POST /api/dashboard/config` with `action: 'restore'`: assert a new row is inserted with `config_json` copied from the source, `is_published = false`, `label = null`, and the response returns `{ success: true, new_version: N }`.
- [X] T012 [P] [US1] In the same test file, add a unit test for `PATCH /api/dashboard/config/label` that asserts: (a) label update succeeds and the row's label column is updated; (b) a label longer than 80 characters returns 400; (c) `null` label clears the field.

### Implementation for User Story 1

#### Backend

- [X] T013 [US1] Edit `packages/api/src/app/api/dashboard/config/route.ts`: add a `GET` handler that calls `getConfigHistory(session.accountId)` and returns `{ versions }`. Reuse the existing `getAuthSession` pattern from the POST handler for auth.
- [X] T014 [US1] Edit `packages/api/src/app/api/dashboard/config/route.ts`: add `action: 'restore'` case to the POST handler switch. Validate `source_version_id` with Zod (non-empty string). SELECT `config_json` from `configurations WHERE id = source_version_id AND account_id = session.accountId` — return 404 if not found. INSERT a new row at `getMaxVersion(accountId) + 1` with `is_published = false`, `label = null`, copied `config_json`. Call `invalidateConfigCache` and `invalidateSystemPromptCache`. Return `{ success: true, new_version }`.
- [X] T015 [US1] Create `packages/api/src/app/api/dashboard/config/label/route.ts` with a `PATCH` handler. Parse body `{ version_id: string, label: string | null }` with Zod (label max 80 chars). UPDATE `configurations SET label = ? WHERE id = ? AND account_id = ?`. Return 404 if no row matched. Return `{ success: true }`.

#### Frontend

- [X] T016 [US1] Edit `packages/api/src/app/dashboard/config/page.tsx`: fetch the version history server-side using `getConfigHistory(session.accountId)` and pass it as a `history` prop to `ConfigForm`. Also pass `latestVersionId` (the `id` of the most recently saved version).
- [X] T017 [US1] Edit `packages/api/src/app/dashboard/config/config-form.tsx`: import the shared `VersionHistory` component (T009). Render it below the existing tab form with `type="config"`, the `history` prop, and `latestVersionId`. Wire `onRestore`: POST to `/api/dashboard/config` with `{ action: 'restore', source_version_id }`, then `router.refresh()` to reload the page with the restored draft. Wire `onLabelChange`: PATCH to `/api/dashboard/config/label`.

**Checkpoint**: US1 is fully functional. A lawyer can view config history, restore any version as a new draft, and label any version from the Configuration page.

---

## Phase 4: User Story 2 — Browse and restore a past SOP version (Priority: P1)

**Goal**: Lawyers can view all saved SOP versions in a panel on the SOP page and restore any past version as a new draft in one click.

**Independent Test**: Log in. Open the SOP page. Confirm the SOP version history panel lists all versions with step counts. Click "Restore" on an older version. Confirm a new SOP draft is created with the restored steps and the editor reloads.

### Tests for User Story 2 ⚠️

- [X] T018 [P] [US2] In `packages/api/src/app/api/dashboard/sop/route.test.ts` (create if absent), add a unit test asserting that `GET /api/dashboard/sop` returns `history` entries including the new `label` and `step_count` fields.
- [X] T019 [P] [US2] In the same file, add a unit test for `POST /api/dashboard/sop` with `action: 'rollback'`: assert the new draft has `label = null` (not inherited from source) and that all source `sopSteps` are duplicated to the new config id.

### Implementation for User Story 2

#### Backend

- [X] T020 [US2] Edit `packages/api/src/app/api/dashboard/sop/route.ts` `GET` handler: add `label` to the `history` array entries by including it in the SELECT query (it defaults to null for rows pre-migration). Add `step_count` by joining or subquerying `sopSteps` count per `sop_configuration_id`. The existing history query (lines ~66-92) already fetches `id, version, is_published, created_at` — extend it.
- [X] T021 [US2] Create `packages/api/src/app/api/dashboard/sop/label/route.ts` with a `PATCH` handler. Mirror the config label route (T015) but update `sop_configurations`. Parse `{ version_id, label }` with Zod (label max 80 chars). UPDATE and return `{ success: true }` or 404.

#### Frontend

- [X] T022 [US2] Edit `packages/api/src/app/dashboard/sop/page.tsx`: the page already fetches `sop` (current published) — extend it to also call `GET /api/dashboard/sop` (or a new `getSopHistory(accountId)` helper) to get the full history array. Pass `history` and `latestVersionId` as props to `SopEditor`.
- [X] T023 [US2] Edit `packages/api/src/app/dashboard/sop/sop-editor.tsx`: import the shared `VersionHistory` component. Render it below the existing tab sections with `type="sop"`, the `history` prop, and `latestVersionId`. Wire `onRestore`: POST to `/api/dashboard/sop` with `{ action: 'rollback', version_id }`, then `router.refresh()`. Wire `onLabelChange`: PATCH to `/api/dashboard/sop/label`.

**Checkpoint**: US2 is fully functional. A lawyer can view SOP history, restore any version, and label any version from the SOP page.

---

## Phase 5: User Story 3 — Name a version for easy identification (Priority: P2)

**Goal**: Inline label editing works correctly for both config and SOP versions. Labels persist immediately on blur/Enter without a page reload, and appear in the history list.

**Independent Test**: In the version history panel, click the label cell of any unlabelled version, type "Test Label", press Enter. Confirm the label appears immediately in the row. Refresh the page and confirm the label persists.

*Note: The inline edit wire-up is already included in T009 (`VersionHistory` component) and the `onLabelChange` wiring in T017 and T023. This phase covers validation, edge cases, and the optional label field at save time.*

### Implementation for User Story 3

- [X] T024 [US3] Edit `packages/api/src/app/dashboard/config/config-form.tsx`: add an optional `label` text input to the "Save draft" flow. The input appears below the form's save button with placeholder "Version label (optional)". When the user clicks Save Draft, include the `label` value in the POST body as `{ action: 'save', ..., label }`. Update the save handler in `packages/api/src/app/api/dashboard/config/route.ts` to write `label` to the new row on `action: 'save'`.
- [X] T025 [US3] Edit `packages/api/src/app/dashboard/sop/sop-editor.tsx`: add the same optional label input to the Save draft flow. Update `packages/api/src/app/api/dashboard/sop/route.ts` `action: 'save'` handler to write the `label` to the new row.
- [X] T026 [US3] Verify the `VersionHistory` component (T009) handles the label edit UX correctly: (a) clicking label cell opens an `<input>` pre-filled with current label; (b) blur or Enter fires `onLabelChange` and reverts to text display; (c) Escape cancels without calling `onLabelChange`; (d) empty string submits as `null`; (e) inputs longer than 80 chars are rejected with an inline character counter.

**Checkpoint**: All three user stories are fully functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T027 [P] Run `pnpm --filter @legal-chatbot/api typecheck` and fix any new type errors introduced by the schema changes (nullable `label` column) and new route handlers.
- [X] T028 [P] Run `pnpm --filter @legal-chatbot/api test` (Vitest) and confirm 100% pass including new tests T010–T012, T018–T019.
- [X] T029 Execute the quickstart.md validation steps (Steps 1–6) end-to-end against the local dev server. Record results.
- [X] T030 Verify SC-006 (immutability): after a restore, confirm the source version row's `config_json` and `label` are unchanged in the DB.
- [X] T031 [P] Run `pnpm --filter @legal-chatbot/api typecheck` for the widget package to confirm no widget regressions (this feature should not touch `packages/widget`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup/Migration)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (migration applied) — BLOCKS US1 and US2.
- **Phase 3 (US1)**: Depends on Phase 2 complete.
- **Phase 4 (US2)**: Depends on Phase 2 complete. Can run in parallel with US1 after Phase 2.
- **Phase 5 (US3)**: Depends on Phase 2 complete (the label column exists). Can start after T009 (VersionHistory component) is done.
- **Phase 6 (Polish)**: Depends on Phases 3, 4, 5 complete.

### User Story Dependencies

- **US1 and US2** are fully independent of each other — both only depend on Phase 2.
- **US3** label-at-save-time work depends on US1/US2 save flows existing, but the inline edit in VersionHistory (T009) can be built before US1/US2 are wired up.

### Within Phase 3 (US1) — internal ordering

- T010, T011, T012 (tests) can run in parallel with each other.
- T013 (GET handler) is independent of T014 (restore action) — both can run in parallel.
- T015 (label PATCH route) is independent of T013/T014.
- T016 (page server-side fetch) depends on T013 being green.
- T017 (config-form wiring) depends on T009 (VersionHistory component) and T014+T015 (routes).

### Within Phase 4 (US2) — internal ordering

- T018, T019 (tests) can run in parallel.
- T020 (GET update) and T021 (label route) can run in parallel.
- T022 (page) depends on T020.
- T023 (sop-editor wiring) depends on T009, T020, T021.

### Parallel Opportunities

- T008 (`getConfigHistory`) and T009 (`VersionHistory` component) — different files, no dependency.
- T010, T011, T012 (US1 tests) — all different test cases.
- T013, T014, T015 (US1 backend routes) — different route handlers/files.
- T018, T019 (US2 tests) — different test cases.
- T020, T021 (US2 backend) — different files.

---

## Parallel Example: Foundational Phase

```bash
# Two developers can split Phase 2 cleanly:
# Developer A:
Task: "getConfigHistory helper in packages/api/src/lib/config.ts"

# Developer B:
Task: "VersionHistory client component in packages/api/src/app/dashboard/config/version-history.tsx"
```

## Parallel Example: US1 backend tasks

```bash
# Three tasks can run simultaneously after migration:
Task: "GET /api/dashboard/config handler (T013)"
Task: "POST action: 'restore' handler (T014)"
Task: "PATCH /api/dashboard/config/label handler (T015)"
```

---

## Implementation Strategy

### MVP Scope

**MVP = US1 (Phase 1 + Phase 2 + Phase 3)**. Config version restore is the highest-value deliverable and fully demonstrates the pattern. US2 (SOP restore) can follow immediately after since the backend for SOP restore already exists.

### Incremental Delivery

1. Phase 1 (Migration) → schema ready, no visible change.
2. Phase 2 (Foundational) → `getConfigHistory` + `VersionHistory` component exist, not yet wired.
3. Phase 3 (US1) → Config version history panel live, restore and label working. **Ship-ready point.**
4. Phase 4 (US2) → SOP version history panel live, restore and label working.
5. Phase 5 (US3) → Label-at-save-time flow added to both editors.
6. Phase 6 (Polish) → Typecheck, tests, e2e validation complete.

### Recommended Sequencing for a Single Developer

```text
T001 → T002 → T003 → T004 → T005 → T006 → T007   (Migration)
T008 + T009 in parallel                             (Foundational)
T010 → T011 → T012 (write tests; may fail until routes exist)
T013 + T014 + T015 in parallel                     (US1 backend)
T016 → T017                                         (US1 frontend)
Re-run T010–T012 (should pass now)
T018 → T019 (write tests)
T020 + T021 in parallel                             (US2 backend)
T022 → T023                                         (US2 frontend)
Re-run T018–T019 (should pass now)
T024 → T025 → T026                                  (US3 label UX)
T027 → T028 → T029 → T030 → T031                   (Polish)
```

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` label is required on US1/US2/US3 tasks; Setup, Foundational, and Polish tasks omit it.
- Constitution III: tests T010–T012 and T018–T019 should be written before their corresponding implementations and observed failing first.
- The `VersionHistory` component (T009) is the most reusable piece — build it first and test it in isolation with mock data before wiring to real routes.
- The SOP `action: 'rollback'` handler already exists in the route — T023 is purely a UI wiring task, not new backend logic.
- Migration is additive (nullable columns + index) — safe to apply to production without downtime.
