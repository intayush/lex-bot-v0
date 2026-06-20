# Research: Branch Configuration CSV Import (020)

**Branch**: `020-branch-csv-import`
**Date**: 2026-06-20
**Source spec**: `specs/020-branch-csv-import/spec.md`

---

## R1 — Existing `PUT /api/dashboard/branches/[caseType]/[subType]` save contract

**Decision**: The CSV import reuses the existing `handleSaveBranch` handler by constructing a `BranchQuestion[]` from the parsed CSV and calling the same `PUT` endpoint. No new database route is needed.

**Rationale**: `handleSaveBranch` already handles first-save (create branch + auto-publish v1), subsequent saves (stack new draft), and all DB writes atomically. Duplicating this logic in a new import route would create divergence risk.

**What the PUT body expects** (from `handler.ts` and `contracts/branches-admin-api.md`):
```json
{
  "questions": BranchQuestion[],
  "classification_thresholds": { "self": ThresholdsSelf, "family_friend": ThresholdsFamilyFriend },
  "hard_override_toggles": HardOverridesEnabled,
  "is_active": boolean
}
```

**Import-specific behavior**: The import only sends the `questions` field. The `classification_thresholds` and `hard_override_toggles` are inherited from the latest existing branch version (per spec FR-022). If no prior version exists (first import for this pair), the handler's built-in defaults are used.

---

## R2 — CSV parsing location: client-side vs server-side

**Decision**: Parse and validate the CSV **server-side** via a new `POST /api/dashboard/branches/[caseType]/[subType]/import` endpoint. The client sends the raw file bytes; the server returns either an error report or a parsed `BranchQuestion[]` preview payload. The client never parses the CSV itself.

**Rationale**:
- Server-side parsing keeps the validation logic (slug format, weight range, question structure) co-located with the Zod schemas in `packages/shared` — no validation duplication.
- Client-side CSV parsing would require bundling a CSV library into the dashboard, increasing bundle size. The dashboard is a Next.js app served by Netlify Functions where bundle size is less critical, but server parsing is still cleaner.
- Server-side parsing aligns with Constitution IV (serverless-compatible): the import endpoint is a stateless route handler that reads the file, validates, and returns a JSON response. No persistent filesystem writes.

**Request shape**: `multipart/form-data` with a single `file` field (the CSV bytes).

**Response shapes**:
- Success: `{ ok: true, questions: BranchQuestion[], warnings: string[] }`
- Failure: `{ ok: false, errors: Array<{ row: number, column: string, message: string }> }`

---

## R3 — CSV row-to-BranchQuestion mapping

**Decision**: One row per chip, grouped by `question_position`. The parser groups all rows sharing the same `question_position` (and `question_text`) into one `BranchQuestion`.

**Mapping**:
| CSV column | BranchQuestion field | Notes |
|---|---|---|
| `question_position` | `position` | 1-indexed in CSV → 0-indexed in the schema; parser subtracts 1 |
| `question_text` | `text` | Validated non-empty, max 500 chars |
| `free_text_allowed` | `free_text_allowed` | "YES"/"NO" → boolean (case-insensitive) |
| `multi_select` | `multi_select` | "YES"/"NO" → boolean (case-insensitive) |
| `chip_label` | `chips[n].label` | Max 100 chars |
| `chip_slug` | `chips[n].slug` | Must match `[a-z0-9_]+` |
| `score_weight` | `chips[n].score_weight` | Integer, -50 to +50 |

**Generated fields** (not in CSV):
- `id`: the parser generates a fresh `nanoid()` for each question. This is correct because the import always creates a new branch version with new stable IDs.
- `preface`: not in the CSV template (out of scope for the initial version); defaults to `null`.

---

## R4 — Template download implementation

**Decision**: The template is generated **statically** — a hardcoded CSV string in the API route handler, not derived from an existing branch version. It includes 3 pre-filled example questions with 4 chips each (based on the Car Accident branch scoring questions).

**Rationale**:
- Generating the template from the existing branch version ("export current") would be useful but is explicitly out of scope per spec.
- A static template is simpler, requires no DB read, and is always consistent regardless of whether a branch exists for the target pair.
- The filename encodes the branch identity: `branch-template-[caseType]-[subType].csv` (per FR-004).

**Content-Type**: `text/csv; charset=utf-8`
**Content-Disposition**: `attachment; filename="branch-template-[caseType]-[subType].csv"`

---

## R5 — Preview state management (client-side)

**Decision**: After the import endpoint returns a successful parse result, the dashboard stores the `BranchQuestion[]` in local React state and renders the preview. Clicking "Save as Draft" POSTs to the existing `PUT` branch save endpoint with the stored questions. No sessionStorage or server-side temporary storage is used.

**Rationale**: The preview is ephemeral (discarded if the user navigates away) and small (<200 KB even for a large branch). React state is sufficient. Server-side temporary storage would require TTL management and cleanup logic — unnecessary for this use case.

---

## R6 — Integration point in `branch-editor.tsx`

**Decision**: Add an "Import from CSV" button and a "Download CSV Template" button to the existing `BranchEditor` component. The import flow (file pick → upload → show preview/errors → save as draft) is wired inline in `BranchEditor` as a new state machine within the component.

**State machine within BranchEditor** (new states added alongside existing ones):
```
idle → importing (file picked, upload in progress) →
  import_error (validation failed, show error table) →
  import_preview (valid parse, show preview) →
  idle (after Save as Draft or Cancel)
```

**Alternative rejected**: A separate modal/page for the import. This would require routing changes and a new page component. Inline state within `BranchEditor` keeps the change contained and consistent with how the existing Save/Publish flow works.

---

## R7 — File size enforcement

**Decision**: The 500 KB limit is enforced at the API layer by reading the content-length header and/or checking the parsed file size before parsing. The client-side file picker does not enforce the limit (no JavaScript validation before upload) — this simplifies the client and avoids inconsistency between client and server limits.

---

## R8 — UTF-8 BOM handling

**Decision**: The server parser strips the UTF-8 BOM (`\xEF\xBB\xBF`) from the start of the file before parsing. Excel exports commonly include this BOM and most CSV parsers in Node.js handle it, but explicit stripping prevents issues with header column name matching.

---

## R9 — Summary of file changes

| File | Change |
|---|---|
| `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/import/route.ts` | NEW — POST handler for CSV import |
| `packages/api/src/app/api/dashboard/branches/[caseType]/[subType]/template/route.ts` | NEW — GET handler for template download |
| `packages/api/src/app/api/dashboard/branches/handler.ts` | ADD `handleImportBranch` and `handleDownloadTemplate` to the handler module (or keep as separate utilities) |
| `packages/api/src/app/dashboard/sop/branch-editor.tsx` | ADD import/template buttons and import state machine |
| `packages/api/src/lib/branch-csv.ts` | NEW — pure CSV parser/validator and template generator (no I/O) |
| `packages/api/src/lib/branch-csv.test.ts` | NEW — unit tests for parser, validator, and template generator |
