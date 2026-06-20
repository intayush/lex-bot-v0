# Feature Specification: Branch Configuration CSV Import

**Feature Branch**: `020-branch-csv-import`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "I want to provide a functionality to import branch configurations for a given case type using a simple excel/csv import where we provide a template csv which the law firm administrator will fill in and upload in the branches section for a given case type."

**Parent Context**: `016-multi-branch-sop`. A Branch is a per-(case_type, sub_type) set of scoring questions with chip options and lead-score weights. Today, lawyers must create each question and chip one at a time through the dashboard editor. This feature lets them bulk-create a branch by downloading a CSV template, filling it in offline, and uploading it.

## Brainstorm: Design Rationale

### Why CSV over a JSON/Excel upload?

CSV was chosen over JSON because:
- Lawyers are familiar with spreadsheets and can fill a CSV in Excel, Numbers, or Google Sheets without technical knowledge.
- JSON requires understanding object nesting which is not business-user-friendly.
- Excel (.xlsx) requires a server-side parsing library and increases bundle weight; CSV is universally parseable.
- The branch structure (questions × chips × weights) maps naturally to a flat table where each row is one chip on one question.

### Template structure (row-per-chip model)

The simplest model that captures the full branch structure is **one row per chip**. Each row describes a single chip option within a question:

| Column | Description |
|--------|-------------|
| `question_position` | Numeric order of the question (1, 2, 3 …) |
| `question_text` | The question the chatbot asks |
| `free_text_allowed` | YES or NO — whether visitor can type a free answer |
| `multi_select` | YES or NO — whether visitor can select multiple chips |
| `chip_label` | Human-readable chip text shown to the visitor |
| `chip_slug` | Machine identifier (lowercase, underscores; must be unique within the question) |
| `score_weight` | Integer from -50 to +50; 0 for neutral |

Questions with the same `question_position` and `question_text` form a single question block. The template ships pre-filled with the Car Accident branch as a worked example so lawyers understand the format immediately.

### Import behavior

- **Full-replace** (not merge): uploading a CSV creates a new draft version of the branch, replacing all prior question/chip data. The lawyer reviews the preview and clicks Publish when satisfied.
- **Validation-first**: the file is parsed and validated in full before any data is written. If any row fails validation, the entire import is rejected with a per-row error report.
- **Preview before publish**: after a successful import parse, the lawyer sees a structured preview of all questions and chips before committing. This mirrors the existing Save → Publish model for branches.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Lawyer Downloads the CSV Template (Priority: P1)

A lawyer navigates to the SOP → Branches section of the dashboard, selects a case type and sub-type pairing (e.g., Personal Injury / Car Accident), and clicks "Download CSV Template." They receive a pre-formatted CSV file with column headers and a worked example showing a complete branch definition for Car Accident. They open it in Excel or Google Sheets, edit the questions and chip weights to match their firm's intake criteria, save it as CSV, and proceed to upload.

**Why this priority**: The template is the entry point for the entire workflow. Without a clear, downloadable template, lawyers cannot know what format to produce.

**Independent Test**: Click "Download CSV Template" on any branch editor page. Verify the downloaded file is a valid CSV with the correct column headers, at least one example question, and at least two example chips per question.

**Acceptance Scenarios**:

1. **Given** a lawyer is on the branch editor for any (case_type, sub_type) pair, **When** they click "Download CSV Template," **Then** a CSV file is downloaded to their computer with columns: `question_position`, `question_text`, `free_text_allowed`, `multi_select`, `chip_label`, `chip_slug`, `score_weight`.
2. **Given** the downloaded template, **When** opened in a spreadsheet application, **Then** it contains at least one pre-filled example question block with at least two chip rows to illustrate the expected structure.
3. **Given** the lawyer saves the filled template back to CSV (not XLSX), **When** they upload it, **Then** the system accepts it successfully.

---

### User Story 2 — Lawyer Uploads a Valid CSV and Reviews the Preview (Priority: P1)

After filling in the template, the lawyer returns to the branch editor, clicks "Import from CSV," selects their file, and submits. Within a few seconds, the dashboard shows a structured preview listing all questions in order, with their chips and score weights. The lawyer verifies the questions look correct and clicks "Save as Draft" to create a new draft version. They then click "Publish" to make it live for the next conversation.

**Why this priority**: This is the core import flow. All other user stories either set it up (US1) or handle failure cases (US3, US4).

**Independent Test**: Use a valid CSV with 3 questions and 4 chips per question. Upload it and verify: (a) a preview table appears with 3 question blocks, (b) each block shows the correct chips and weights, (c) clicking Save creates a new unpublished branch version, (d) clicking Publish makes the branch active for new conversations.

**Acceptance Scenarios**:

1. **Given** the lawyer selects a valid CSV file, **When** they click "Import," **Then** within 5 seconds the page shows a structured preview of all parsed questions and chips.
2. **Given** the preview is displayed, **When** the lawyer clicks "Save as Draft," **Then** a new draft branch version is created with the imported questions and the existing branch remains published (no interruption to live conversations).
3. **Given** a draft version exists from the import, **When** the lawyer clicks "Publish," **Then** the imported version becomes the active branch and future conversations use it.
4. **Given** the lawyer has already published a branch and re-imports a new CSV, **When** the new draft is saved, **Then** the prior published version remains active until the lawyer explicitly publishes the new draft.

---

### User Story 3 — CSV Has Validation Errors (Priority: P1)

The lawyer submits a CSV with mistakes: a chip_slug that contains spaces, a score_weight of 999, and a question with no chips. The system rejects the file and shows an error report listing each problem by row number and column name. The lawyer corrects the issues in their spreadsheet, saves, and re-uploads successfully.

**Why this priority**: Validation feedback is what separates a usable import tool from a black box. Without row-level error messages, lawyers cannot fix their files.

**Independent Test**: Upload a CSV where row 4 has `score_weight = 999` and row 7 has `chip_slug = "my chip"` (space in slug). Verify the error report cites row 4 (score_weight out of range) and row 7 (slug format invalid) before any data is saved.

**Acceptance Scenarios**:

1. **Given** the CSV contains any row with an invalid value, **When** the lawyer uploads it, **Then** no data is saved and the page shows a per-row error list with row number, column name, and a plain-language description of the problem.
2. **Given** the error list is displayed, **When** the lawyer corrects the issues and re-uploads, **Then** the corrected file is accepted and the preview is shown.
3. **Given** a completely empty CSV (headers only, no data rows), **When** the lawyer uploads it, **Then** the system rejects it with the message "The file contains no question rows."
4. **Given** the CSV contains a question block with no chip rows, **When** the file is uploaded and `free_text_allowed = NO` for that question, **Then** the system rejects it with an error indicating that questions without chips must have free text enabled.

---

### User Story 4 — CSV Has the Wrong Format (Priority: P2)

The lawyer accidentally uploads an Excel .xlsx file, or a CSV with missing required columns, or a file larger than the size limit. The system rejects it immediately with a clear message explaining what went wrong, without attempting to parse the content.

**Why this priority**: Format errors are the most common class of user mistake on file upload flows. Catching them early with clear messages reduces support load.

**Independent Test**: Upload an .xlsx file and a CSV missing the `score_weight` column. Verify the first is rejected with "Please upload a CSV file (.csv)" and the second with "Missing required column: score_weight."

**Acceptance Scenarios**:

1. **Given** the lawyer uploads a file that is not a CSV (e.g., .xlsx, .pdf), **When** the system detects the format, **Then** it rejects the file immediately with a message naming the required format.
2. **Given** the lawyer uploads a CSV that is missing one or more required column headers, **When** the system parses the headers, **Then** it rejects the file and lists each missing column by name.
3. **Given** the lawyer uploads a CSV larger than the permitted file size, **When** the upload is initiated, **Then** the system rejects it before processing and states the maximum allowed file size.

---

### Edge Cases

- **Duplicate chip slugs within a question**: two chips on the same question share a slug — rejected with a clear error naming the duplicate.
- **Duplicate question positions**: two rows have the same `question_position` but different `question_text` — rejected; position must be unique per question block.
- **Hundreds of rows**: a CSV with 20 questions × 10 chips = 200 rows — the system processes it and displays the preview within 5 seconds.
- **Special characters in chip labels**: emojis, apostrophes, commas — accepted in `chip_label`; `chip_slug` remains restricted to lowercase letters, digits, and underscores.
- **Import while a branch is mid-conversation**: conversations in flight continue using the version they started with; the import only creates a new draft and does not interrupt active sessions.
- **Lawyer imports then navigates away without saving**: the parsed data is discarded; no draft is created. The system warns the lawyer before they navigate away if a valid parse is pending.
- **Re-import over an existing published branch**: creates a new draft only; does not alter the published version until the lawyer explicitly publishes.
- **CSV with Windows-style line endings (CRLF)**: accepted without error.
- **UTF-8 BOM at start of file (Excel-exported CSVs)**: stripped silently before parsing.

## Requirements *(mandatory)*

### Functional Requirements

#### FR Group A — Template Download

- **FR-001**: The branch editor page MUST display a "Download CSV Template" button visible to authenticated lawyers at all times, regardless of whether a branch version already exists for that (case_type, sub_type) pair.
- **FR-002**: Clicking the download button MUST produce a CSV file with exactly these column headers in this order: `question_position`, `question_text`, `free_text_allowed`, `multi_select`, `chip_label`, `chip_slug`, `score_weight`.
- **FR-003**: The template MUST include at least one complete worked example pre-filled with realistic data (based on the Car Accident branch) to demonstrate the multi-row-per-question structure.
- **FR-004**: The template file MUST be named `branch-template-[case_type_slug]-[sub_type_slug].csv` so lawyers can identify which branch it belongs to when multiple are open.

#### FR Group B — CSV Upload UI

- **FR-005**: The branch editor page MUST display an "Import from CSV" button alongside the template download button.
- **FR-006**: Clicking "Import from CSV" MUST open a file picker restricted to `.csv` files only. If the user selects a non-CSV file, the system MUST reject it before uploading with the message "Please upload a CSV file (.csv)."
- **FR-007**: The maximum accepted file size MUST be 500 KB. Files exceeding this limit MUST be rejected immediately with a message stating the limit.
- **FR-008**: After a valid file is selected and submitted, the system MUST display a loading indicator while parsing and validation are in progress.

#### FR Group C — Validation

- **FR-009**: The system MUST validate every row in the CSV before writing any data. A file with any invalid row MUST be rejected in full (no partial imports).
- **FR-010**: Required column header validation: the system MUST verify all 7 required columns are present in the header row. Missing columns MUST be reported by name before row-level parsing begins.
- **FR-011**: Per-row field validation rules:
  - `question_position`: positive integer; duplicate positions across different question text values are rejected.
  - `question_text`: non-empty string, max 500 characters.
  - `free_text_allowed`: case-insensitive `YES` or `NO` only.
  - `multi_select`: case-insensitive `YES` or `NO` only.
  - `chip_label`: non-empty string, max 100 characters.
  - `chip_slug`: lowercase letters, digits, and underscores only (`[a-z0-9_]+`); must be unique within its question block.
  - `score_weight`: integer in the range −50 to +50 (inclusive).
- **FR-012**: A question block where `free_text_allowed = NO` and has zero chip rows MUST be rejected with an error message identifying the question position.
- **FR-013**: The error report MUST list each validation failure with: row number (1-indexed, counting the header as row 1), column name, and a plain-language description of the problem.
- **FR-014**: The error report MUST be displayed inline on the page without requiring a new navigation; the original upload form MUST remain accessible so the lawyer can re-upload immediately.

#### FR Group D — Preview & Save

- **FR-015**: When a CSV passes all validation, the system MUST render a structured preview showing each question in position order, with its text, free-text flag, multi-select flag, and a list of its chips with their labels, slugs, and score weights.
- **FR-016**: The preview MUST be a read-only view; the lawyer cannot edit individual cells in the preview (they must edit the CSV and re-upload to change values).
- **FR-017**: The preview MUST include a "Save as Draft" button and a "Cancel" button. Clicking "Cancel" discards the parsed data and returns to the branch editor without creating a new version.
- **FR-018**: Clicking "Save as Draft" MUST create a new unpublished branch version containing the imported questions, following the existing branch versioning model from `016-multi-branch-sop`.
- **FR-019**: After saving the draft, the system MUST display the confirmation "Draft saved" and transition to the normal branch editor view showing the new draft version as the current editable state.
- **FR-020**: The import MUST NOT automatically publish. Publishing requires an explicit click of the existing "Publish" button, consistent with all other branch version workflows.

#### FR Group E — Classification Thresholds

- **FR-021**: The CSV import MUST NOT include or modify classification thresholds (`classification_thresholds_json`) or hard override toggles. Those fields are managed via the existing dashboard editor separately.
- **FR-022**: When a new draft is created via import for a branch that already has a published version, the classification thresholds and hard override toggles from the most recent published version MUST be carried forward to the new draft automatically, so importing questions does not accidentally reset scoring configuration.

### Key Entities

- **CSV Template**: A downloadable flat file representing a branch's question/chip structure. One row per chip. Not persisted as a separate entity — generated on demand from a static template (with pre-filled Car Accident example data).
- **Branch Import Parse Result**: Transient in-memory representation of a validated CSV parse. Holds the array of parsed `BranchQuestion[]` ready for the "Save as Draft" action. Not persisted until the lawyer confirms.
- **BranchVersion** (from `016-multi-branch-sop`): The entity created when the lawyer saves the import as a draft. `questions_json` is populated from the parse result. `classification_thresholds_json` and `hard_override_toggles_json` are inherited from the prior published version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A lawyer can download the CSV template, fill it in with a new branch definition (10 questions × 5 chips each), upload it, and have a published branch ready for conversations — all within 10 minutes of starting.
- **SC-002**: 100% of validation errors are reported before any data is written — no partial imports reach the database.
- **SC-003**: A CSV with up to 200 data rows (20 questions × 10 chips) is parsed, validated, and previewed within 5 seconds of file selection.
- **SC-004**: The error report is specific enough that a non-technical lawyer can identify and correct a validation error without contacting support — measured by 90% of test users being able to correct and re-upload within 3 attempts.
- **SC-005**: Zero active chat conversations are interrupted when a branch is imported and saved as a draft (draft save does not alter the published version).
- **SC-006**: The template download produces a file that opens correctly in Excel, Google Sheets, and Apple Numbers without manual format adjustments.

## Assumptions

- **The import creates a draft — publishing is always a separate step.** This is consistent with the existing branch versioning model. Lawyers are expected to review the preview before clicking Publish.
- **Classification thresholds are not in scope for the CSV import.** They are complex multi-field structures (score buckets, hard overrides) best edited through the existing visual editor. Importing them via CSV would require a second, more complex template and is deferred.
- **One CSV = one branch definition.** The file is always scoped to a single (case_type, sub_type) branch. Bulk-importing multiple branches from a single file is out of scope for this feature.
- **File size limit of 500 KB is sufficient.** A branch with 50 questions × 20 chips = 1,000 rows at ~100 bytes each = ~100 KB. 500 KB provides 5× headroom.
- **The template filename encodes the branch identity.** The lawyer is expected to use the template downloaded for the correct (case_type, sub_type) pair; the system does not validate whether the file content matches the target branch.
- **UTF-8 encoding.** Files produced by Excel (UTF-8 BOM), Google Sheets (UTF-8), and LibreOffice (UTF-8) are all accepted. Other encodings are out of scope.

## Dependencies

- **Internal — Upstream**:
  - `016-multi-branch-sop`: Branch, BranchVersion, BranchQuestion, BranchChip data models and the Save/Publish versioning flow. This feature is an alternative input method for creating BranchVersions.
  - `007-dashboard`: Dashboard authenticated session and routing infrastructure.
- **Internal — Downstream**: None. This feature only creates draft BranchVersions; downstream features that read published branches are unaffected.

## Out of Scope

- **Exporting an existing branch to CSV**: reading back a configured branch as a CSV file (the inverse of import). Deferred — the template download is static, not derived from an existing branch.
- **Importing classification thresholds or hard override toggles** via CSV.
- **Bulk import of multiple branches** from a single file.
- **Excel (.xlsx) file support**: only `.csv` is accepted. Lawyers who work in Excel save their file as CSV before uploading.
- **Drag-and-drop file upload**: the file picker is sufficient for MVP; drag-and-drop can be added in a polish pass.
- **Import history / audit log**: not tracked for the draft creation step. The existing branch version history (created_at, created_by_user_id) provides sufficient traceability.
