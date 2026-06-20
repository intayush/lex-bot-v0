# Data Model: Branch Configuration CSV Import (020)

**Branch**: `020-branch-csv-import`
**Date**: 2026-06-20

This feature introduces **no new database entities**. The import creates `BranchVersion` rows via the existing `handleSaveBranch` path. The data model delta is entirely in the API response shapes and the CSV schema.

---

## CSV Row Schema (input)

Each row in the uploaded CSV represents one chip within a question block. The parser groups rows by `question_position` to reconstruct `BranchQuestion[]`.

| Column | Type | Required | Validation |
|---|---|---|---|
| `question_position` | integer string | yes | Positive integer (`> 0`); rows sharing the same `question_position` must have identical `question_text`, `free_text_allowed`, and `multi_select` values |
| `question_text` | string | yes | Non-empty; max 500 characters |
| `free_text_allowed` | string | yes | Case-insensitive `YES` or `NO` |
| `multi_select` | string | yes | Case-insensitive `YES` or `NO` |
| `chip_label` | string | yes | Non-empty; max 100 characters |
| `chip_slug` | string | yes | Pattern `[a-z0-9_]+`; unique within its question block |
| `score_weight` | integer string | yes | Integer in `[-50, +50]` inclusive |

**Constraint**: A question where `free_text_allowed = NO` MUST have at least one chip row.

---

## API Response Shapes (new)

### POST `/api/dashboard/branches/[caseType]/[subType]/import`

**Success response** (`200 OK`):
```json
{
  "ok": true,
  "questions": [
    {
      "id": "nanoid",
      "position": 0,
      "text": "Were you the driver or a passenger?",
      "preface": null,
      "chips": [
        { "label": "Driver", "slug": "driver", "score_weight": 10 },
        { "label": "Passenger", "slug": "passenger", "score_weight": 5 }
      ],
      "free_text_allowed": false,
      "multi_select": false
    }
  ],
  "warnings": []
}
```

**Failure response** (`422 Unprocessable Entity`):
```json
{
  "ok": false,
  "errors": [
    { "row": 4, "column": "score_weight", "message": "Must be an integer between -50 and 50" },
    { "row": 7, "column": "chip_slug", "message": "Slug must contain only lowercase letters, digits, and underscores" }
  ]
}
```

**Format/size error response** (`400 Bad Request`):
```json
{
  "ok": false,
  "errors": [
    { "row": 0, "column": "file", "message": "Please upload a CSV file (.csv)" }
  ]
}
```

### GET `/api/dashboard/branches/[caseType]/[subType]/template`

Returns the template CSV file as a download.

**Headers**:
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="branch-template-[caseType]-[subType].csv"`

**Body**: UTF-8 CSV string with headers + 3 example question blocks.

---

## Unchanged Entities

The following entities from `016-multi-branch-sop` are unchanged:

- `branches` table — no new columns
- `branch_versions` table — no new columns; import creates rows via existing path
- `BranchQuestion` Zod schema — used as-is for the parsed output
- `BranchChip` Zod schema — used as-is for chip validation

---

## Client-Side Transient State (not persisted)

The `BranchEditor` component tracks import state in React memory only:

| State key | Type | Description |
|---|---|---|
| `importState` | `'idle' \| 'uploading' \| 'error' \| 'preview'` | Controls which UI is shown |
| `importErrors` | `Array<{row, column, message}>` | Error list from failed parse |
| `importedQuestions` | `BranchQuestion[] \| null` | Parsed questions pending "Save as Draft" |

None of these are stored in `sessionStorage` or sent to the server until the lawyer clicks "Save as Draft."
