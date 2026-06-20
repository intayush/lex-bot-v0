# Contract: Branch CSV Import & Template APIs

**Feature**: `020-branch-csv-import`

---

## POST `/api/dashboard/branches/[caseType]/[subType]/import`

Parses and validates a CSV file, returns either a structured `BranchQuestion[]` preview or a per-row error list. **Does not write to the database.**

### Request

- **Auth**: Dashboard session cookie (iron-session)
- **Content-Type**: `multipart/form-data`
- **Body field**: `file` — the CSV file bytes

### Constraints

- File must have `.csv` extension or `text/csv` content-type
- File size must not exceed 500 KB
- Required CSV columns (order-independent): `question_position`, `question_text`, `free_text_allowed`, `multi_select`, `chip_label`, `chip_slug`, `score_weight`

### Responses

| Status | Condition | Body |
|--------|-----------|------|
| `200 OK` | All rows valid | `{ ok: true, questions: BranchQuestion[], warnings: string[] }` |
| `400 Bad Request` | Wrong file format or missing columns | `{ ok: false, errors: [{ row: 0, column: "file", message: string }] }` |
| `413 Payload Too Large` | File exceeds 500 KB | `{ ok: false, errors: [{ row: 0, column: "file", message: "File exceeds 500 KB limit" }] }` |
| `422 Unprocessable Entity` | Row-level validation failures | `{ ok: false, errors: Array<{ row: number, column: string, message: string }> }` |
| `401 Unauthorized` | Missing/invalid session | `{ error: "Not authenticated" }` |

### Notes on row numbering

`row` in error objects is 1-indexed. Row 1 is the header row. First data row is row 2. This matches what a spreadsheet application would show.

---

## GET `/api/dashboard/branches/[caseType]/[subType]/template`

Downloads the pre-filled CSV template for a given (case_type, sub_type) pair.

### Request

- **Auth**: Dashboard session cookie
- **Method**: GET
- **No body**

### Response

- **Status**: `200 OK`
- **Content-Type**: `text/csv; charset=utf-8`
- **Content-Disposition**: `attachment; filename="branch-template-[caseType]-[subType].csv"`
- **Body**: UTF-8 CSV with header row + 3 example question blocks (12 data rows total)

### Example response body

```
question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight
1,Were you the driver or a passenger?,NO,NO,Driver,driver,10
1,Were you the driver or a passenger?,NO,NO,Passenger,passenger,5
1,Were you the driver or a passenger?,NO,NO,Pedestrian / Cyclist,pedestrian_cyclist,0
2,Did you receive medical treatment?,NO,NO,Yes — treated at hospital,treated_hospital,20
2,Did you receive medical treatment?,NO,NO,Yes — treated by doctor,treated_doctor,15
2,Did you receive medical treatment?,NO,NO,No treatment yet,no_treatment,-15
3,Has an insurance company contacted you?,YES,NO,Yes,insurance_contacted,10
3,Has an insurance company contacted you?,YES,NO,No,insurance_not_contacted,0
3,Has an insurance company contacted you?,YES,NO,Not sure,not_sure,0
```
