# Quickstart & Validation Guide: Branch CSV Import (020)

**Branch**: `020-branch-csv-import`
**Date**: 2026-06-20

---

## Prerequisites

- `pnpm dev` running (API at `http://localhost:3000`)
- DB seeded: `pnpm db:seed`
- Logged into the dashboard

---

## Scenario 1 — Template Download

**Validates**: FR-001, FR-002, FR-003, FR-004

1. Open `http://localhost:3000/dashboard/sop` → Branches tab
2. Click any (case_type, sub_type) pair (e.g., Personal Injury / Car Accident)
3. Click **"Download CSV Template"**

**Expected**:
- Browser downloads a file named `branch-template-personal_injury-car_accident.csv`
- Opening it shows columns: `question_position`, `question_text`, `free_text_allowed`, `multi_select`, `chip_label`, `chip_slug`, `score_weight`
- At least 3 example rows with real data are present

```bash
# Verify via API directly:
curl -s -b <session-cookie> \
  http://localhost:3000/api/dashboard/branches/personal_injury/car_accident/template \
  -o template.csv && head -5 template.csv
```

---

## Scenario 2 — Valid CSV Import → Preview → Save as Draft → Publish

**Validates**: FR-005 through FR-020 (happy path)

1. Download the template (Scenario 1)
2. Edit it to add 2 questions × 3 chips each (or use the example below)
3. Click **"Import from CSV"**, select the file
4. Verify the preview shows 2 question blocks with correct chips and weights
5. Click **"Save as Draft"** — verify success message
6. Click **"Publish"** — verify the branch is now live

**Minimal valid CSV for testing**:
```
question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight
1,Were you injured?,NO,NO,Yes serious,yes_serious,25
1,Were you injured?,NO,NO,Yes minor,yes_minor,10
1,Were you injured?,NO,NO,No injuries,no_injuries,-20
2,Was there a police report?,YES,NO,Yes,police_report_yes,15
2,Was there a police report?,YES,NO,No,police_report_no,0
```

**Expected after upload**:
- Preview shows 2 questions: "Were you injured?" (3 chips) and "Was there a police report?" (2 chips + free text)
- After Save as Draft: `GET /api/dashboard/branches/personal_injury/car_accident` returns a new draft version

---

## Scenario 3 — CSV With Validation Errors

**Validates**: FR-009, FR-010, FR-011, FR-013, FR-014

Upload a CSV with these intentional errors:
```
question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight
1,Test question,NO,NO,Valid chip,valid_slug,10
2,Another question,NO,NO,Bad slug,bad slug here,5
3,Empty chips question,NO,NO,,missing_label,999
```

**Expected**:
- No data written to DB
- Error report shows:
  - Row 3: `chip_slug` — "Slug must contain only lowercase letters, digits, and underscores" (space in slug)
  - Row 4: `chip_label` — "Chip label cannot be empty"
  - Row 4: `score_weight` — "Must be an integer between -50 and 50"

---

## Scenario 4 — Wrong File Format

**Validates**: FR-006, FR-007

1. Try uploading an `.xlsx` file → expect "Please upload a CSV file (.csv)"
2. Try uploading a CSV with the `score_weight` column missing → expect "Missing required column: score_weight"

---

## Scenario 5 — Classification Thresholds Preserved on Re-import

**Validates**: FR-022

1. Edit the Car Accident branch thresholds manually via the editor (change HOT to [80, 100])
2. Publish that change
3. Import a new CSV for the same branch
4. Save as Draft, then Publish the imported version
5. Verify the Car Accident branch thresholds are still HOT=[80, 100] (not reset to defaults)

---

## API Verification Commands

```bash
# Parse and validate a CSV (replace session cookie):
curl -s -X POST \
  -b <session-cookie> \
  -F "file=@test.csv" \
  http://localhost:3000/api/dashboard/branches/personal_injury/car_accident/import \
  | python3 -m json.tool

# Verify the branch now has a new draft version:
curl -s -b <session-cookie> \
  http://localhost:3000/api/dashboard/branches/personal_injury/car_accident \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('versions:', len(d.get('history', [])))"
```
