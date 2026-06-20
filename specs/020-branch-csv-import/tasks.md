---
description: "Task list for Branch Configuration CSV Import (020-branch-csv-import)"
---

# Tasks: Branch Configuration CSV Import

**Input**: Design documents from `specs/020-branch-csv-import/`

**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Constitution III requires test-first. Tests are included for the pure utility (branch-csv.ts) and the two API route handlers.

**Organization**: The plan has 3 phases. Phase 0 (pure utility) is foundational and blocks Phases 1 and 2. Phase 1 (API routes) blocks Phase 2 (UI). US1–US4 map to the 4 user stories in the spec.

---

## Phase 1: Foundational — Pure CSV Utility (blocks all user stories)

**Purpose**: `branch-csv.ts` is the shared engine for parsing, validation, and template generation. All API routes and the UI depend on it. Must complete before any route or UI work.

- [x] T001 Write failing unit tests for `parseAndValidateCsv` happy path (2 questions × 3 chips) in `packages/api/src/lib/branch-csv.test.ts` — assert correct `BranchQuestion[]` output with 0-indexed positions
- [x] T002 Write failing unit tests for `parseAndValidateCsv` error cases in `packages/api/src/lib/branch-csv.test.ts`: bad slug (space), out-of-range score_weight, empty chip_label, duplicate chip_slug within question, question with no chips and free_text_allowed=NO, empty CSV (headers only), missing required column
- [x] T003 Write failing unit test for UTF-8 BOM stripping and CRLF line ending acceptance in `packages/api/src/lib/branch-csv.test.ts`
- [x] T004 Create `packages/api/src/lib/branch-csv.ts` — implement `CsvError` type and `parseAndValidateCsv(csvString: string)` function: strip BOM, split rows, validate headers, group rows by `question_position`, apply all FR-011 field validations, return `{ ok: true, questions: BranchQuestion[] }` or `{ ok: false, errors: CsvError[] }` (depends on T001–T003 tests being written first)
- [x] T005 Add `generateTemplateCsv(caseTypeSlug: string, subTypeSlug: string): string` to `packages/api/src/lib/branch-csv.ts` — returns static UTF-8 CSV with 7 header columns and 3 example Car Accident question blocks (9 example rows), filename-safe slugs in the content (depends on T004)
- [x] T006 Write unit test for `generateTemplateCsv` in `packages/api/src/lib/branch-csv.test.ts` — assert correct headers, at least 9 data rows, all 7 columns present per row (depends on T005)

**Checkpoint**: `pnpm --filter @legal-chatbot/api exec vitest run src/lib/branch-csv.test.ts` — all tests pass.

---

## Phase 2: User Story 1 — Template Download (Priority: P1) 🎯 MVP

**Goal**: Lawyer can download a pre-filled CSV template from the branch editor.

**Independent Test**: `curl -b <session-cookie> http://localhost:3000/api/dashboard/branches/personal_injury/car_accident/template` downloads a file with correct headers and example data. Quickstart Scenario 1.

- [x] T007 [US1] Create `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/template/route.ts` — `GET` handler: authenticate session, call `generateTemplateCsv(caseType, subType)`, return `Response` with `Content-Type: text/csv`, `Content-Disposition: attachment; filename="branch-template-[caseType]-[subType].csv"` (depends on T005)
- [x] T008 [US1] Write integration test for the template GET route in `packages/api/src/app/api/dashboard/branches/handler.test.ts` (or a new sibling `template-import.test.ts`) — assert 200 status, correct Content-Disposition header, CSV body contains the 7 required column headers (depends on T007)

**Checkpoint**: Template endpoint returns a downloadable CSV with correct headers. Quickstart Scenario 1 passes.

---

## Phase 3: User Story 2 + US3 + US4 — CSV Import API (Priority: P1)

**Goal**: The import endpoint validates the uploaded CSV and returns either a preview payload or a structured error list. This covers the happy path (US2), validation errors (US3), and format errors (US4) at the API level.

**Independent Test**: `curl -X POST -F "file=@test.csv" http://localhost:3000/api/dashboard/branches/personal_injury/car_accident/import` returns `{ok:true, questions:[...]}` for a valid file and `{ok:false, errors:[...]}` for an invalid one. Quickstart Scenarios 2–4.

### Tests (write before implementation)

- [x] T009 [P] [US2] Write integration test for the import POST route — happy path: valid 2-question CSV → 200 `{ok:true, questions:[...]}` in `packages/api/src/app/api/dashboard/branches/handler.test.ts` or new sibling file (depends on T004)
- [x] T010 [P] [US3] Write integration test for the import POST route — validation errors: CSV with bad slug + out-of-range weight → 422 `{ok:false, errors:[{row,column,message},...]}` (depends on T004)
- [x] T011 [P] [US4] Write integration tests for format errors in `packages/api/src/app/api/dashboard/branches/handler.test.ts`: wrong file type → 400, missing required column → 400, file > 500 KB → 413 (depends on T004)

### Implementation

- [x] T012 [US2] Create `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/import/route.ts` — `POST` handler: authenticate session, read `multipart/form-data` `file` field, check content-length/size (reject > 500 KB with 413), check `.csv` extension or `text/csv` content-type (reject with 400), call `parseAndValidateCsv`, return 200 `{ok:true, questions}` or 422 `{ok:false, errors}` (depends on T009–T011 tests written; T004 for the parser)

**Checkpoint**: All T009–T011 tests pass. Quickstart Scenarios 2–4 pass at the API level.

---

## Phase 4: User Story 2 — Dashboard UI (Priority: P1)

**Goal**: Lawyer sees Import and Template Download buttons in the branch editor, can upload a CSV, see a preview, and save as a new draft.

**Independent Test**: Open branch editor in the dashboard → click "Download CSV Template" → file downloads. Click "Import from CSV" → pick the valid test CSV → preview renders → "Save as Draft" creates a new branch version. Quickstart Scenario 2.

- [x] T013 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — add `importState: 'idle' | 'uploading' | 'error' | 'preview'`, `importErrors: CsvError[]`, and `importedQuestions: BranchQuestion[] | null` to component state; add `CsvError` import from `../../lib/branch-csv` (type-only import; no runtime dependency on the server util)
- [x] T014 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — add **"Download CSV Template"** as an `<a>` element: `href="/api/dashboard/branches/[caseTypeSlug]/[subTypeSlug]/template"` with `download` attribute; place alongside the existing Save/Publish buttons (depends on T013)
- [x] T015 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — add **"Import from CSV"** button: on click, trigger a hidden `<input type="file" accept=".csv" ref={...} />` programmatically; on file selection, `POST` file to import route via `fetch` with `FormData`, set `importState` to `'uploading'` during request (depends on T013)
- [x] T016 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — handle import response: on success set `importState='preview'` and `importedQuestions`; on failure set `importState='error'` and `importErrors` (depends on T015)
- [x] T017 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — render **error table** when `importState === 'error'`: columns "Row", "Column", "Issue"; one row per error from `importErrors`; show re-upload prompt below the table (depends on T016)
- [x] T018 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — render **preview table** when `importState === 'preview'`: list each question in position order with question text, free-text/multi-select flags, and a chip list showing label + score weight; include "Save as Draft" and "Cancel" buttons (depends on T016)
- [x] T019 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — wire **"Save as Draft"** from the preview state: call the existing `handleSave` function with `importedQuestions` replacing the current `questions` state; existing thresholds and overrides from component state are preserved (depends on T018)
- [x] T020 [US2] In `packages/api/src/app/dashboard/sop/branch-editor.tsx` — wire **"Cancel"** from the preview state: reset `importState` to `'idle'`, clear `importedQuestions`; add `beforeunload` / navigation guard warning when `importState === 'preview'` (depends on T018)

**Checkpoint**: Quickstart Scenario 2 (full happy path) passes end-to-end. Quickstart Scenario 5 (thresholds preserved) passes.

---

## Phase 5: Polish & Verification

- [x] T021 Run `pnpm --filter @legal-chatbot/api exec tsc --noEmit` — zero TypeScript errors across all new and changed files
- [x] T022 Run `pnpm --filter @legal-chatbot/api exec vitest run` — all tests pass (branch-csv.test.ts + handler integration tests)
- [x] T023 Manual validation: Quickstart Scenarios 1–5 all pass
- [x] T024 Verify `CsvError` type is not accidentally included in the widget bundle — confirm no `branch-csv` import in any widget-side file

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: T001–T003 can run in parallel (all in the same test file, but each is a distinct describe block); T004 depends on T001–T003; T005 depends on T004; T006 depends on T005.
- **Phase 2 (US1 Template)**: T007 depends on T005; T008 depends on T007. Can start after T005 is done.
- **Phase 3 (API Routes)**: T009–T011 can run in parallel (different test cases, same file); T012 depends on all three tests. Phase 3 can start after Phase 1 is complete.
- **Phase 4 (UI)**: T013–T020 are sequential within `branch-editor.tsx` (same file). Phase 4 depends on Phase 3 being complete (T012 done).
- **Phase 5 (Polish)**: All prior phases complete.

### User Story Dependencies

- **US1 (P1, template download)**: Depends on Phase 1 (T005) only.
- **US2 (P1, valid import flow)**: Depends on Phase 1 (T004) and Phase 3 (T012) for the API; UI (T013–T020) depends on the API route existing.
- **US3 (P1, validation errors)**: API test T010 is parallel to T009/T011; same T012 implementation handles it.
- **US4 (P2, format errors)**: API test T011 is parallel; same T012 implementation handles it.

### Parallel Opportunities

- T001, T002, T003 (Phase 1 test-writing): different test cases, can be written simultaneously
- T009, T010, T011 (Phase 3 integration tests): different scenarios, truly parallel
- T007 (template route) and T009–T011 (import tests): different files, can proceed in parallel after Phase 1

---

## Parallel Example: Phase 1

```bash
# These test-writing tasks can start simultaneously (distinct describe blocks):
Task T001: "Write happy-path test for parseAndValidateCsv"
Task T002: "Write error-case tests for parseAndValidateCsv"
Task T003: "Write BOM/CRLF acceptance tests"
# Then T004 (implementation) after all three are written
```

---

## Implementation Strategy

### MVP First (US1 + US2 API only)

1. Complete Phase 1 (foundational utility)
2. Complete Phase 2 (US1 template download)
3. Complete Phase 3 (US2–US4 API import)
4. **STOP and VALIDATE** at API level using `curl` (Quickstart Scenarios 1–4)
5. Proceed to Phase 4 (UI) once API is confirmed working

### Full Delivery Order

1. Phase 1 → Pure utility complete and tested
2. Phase 2 → Template download live
3. Phase 3 → Import API live (all error cases handled)
4. Phase 4 → Dashboard UI complete
5. Phase 5 → Verification

---

## Notes

- `branch-csv.ts` is a pure function module — no `fetch`, no `db`, no `req`. This makes it trivially unit-testable.
- The `CsvError` type from `branch-csv.ts` is used in the dashboard UI component as a type-only import. It is never bundled into the widget.
- `question_position` is 1-indexed in the CSV (user-friendly) and 0-indexed in `BranchQuestion.position` (schema). The parser handles the conversion.
- The template `<a download>` approach requires no JavaScript — the browser handles the file download natively when the user is authenticated (session cookie is sent automatically on same-origin requests).
- All 24 tasks are within `packages/api` — no changes to `packages/shared`, `packages/widget`, or `packages/crawler`.
