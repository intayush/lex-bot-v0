# Contract: Case Value Config API

**Feature**: 025-case-value-estimator

All endpoints require an authenticated dashboard session.

---

## GET /api/dashboard/branches/[caseType]/[subType]

Existing endpoint — extended to include case value configuration.

**Response 200** (new fields added):
```json
{
  "branch": {
    "id": "branch_abc",
    "is_active": true,
    "is_case_value_enabled": false,
    "current_version": {
      "id": "bv_xyz",
      "version_number": 3,
      "questions": [...],
      "classification_thresholds": {...},
      "hard_override_toggles": {...},
      "case_value_config": {
        "bands": [
          { "score_min": 76, "score_max": 100, "value_min_usd": 75000, "value_max_usd": 250000, "position": 0 },
          { "score_min": 51, "score_max": 75,  "value_min_usd": 15000, "value_max_usd": 75000,  "position": 1 },
          { "score_min": 26, "score_max": 50,  "value_min_usd": 3000,  "value_max_usd": 15000,  "position": 2 }
        ]
      }
    }
  }
}
```

`case_value_config` is `null` if not yet configured. `is_case_value_enabled` defaults to `false`.

---

## POST /api/dashboard/branches/[caseType]/[subType] — action: 'save'

Extended request body:

```json
{
  "action": "save",
  "questions": [...],
  "classification_thresholds": {...},
  "hard_override_toggles": {...},
  "is_case_value_enabled": true,
  "case_value_config": {
    "bands": [
      { "score_min": 76, "score_max": 100, "value_min_usd": 75000, "value_max_usd": 250000, "position": 0 }
    ]
  }
}
```

`is_case_value_enabled` and `case_value_config` are optional — if omitted, existing values are preserved.

**Validation**:
- Each band: `score_min ≤ score_max`, both in [0, 100]
- Each band: `value_min_usd ≤ value_max_usd`, both ≥ 0
- `bands` array may be empty (config exists but no bands defined)

**Response 200**:
```json
{ "success": true, "new_version": 4, "config_id": "bv_new" }
```

---

## POST /api/dashboard/branches/[caseType]/[subType] — action: 'toggle_case_value'

New action to toggle the case-type-level switch without creating a new version.

**Request**:
```json
{ "action": "toggle_case_value", "enabled": true }
```

**Response 200**:
```json
{ "success": true }
```

**Side effects**: Updates `branches.is_case_value_enabled` for this (account, case_type_slug, sub_type_slug). Does NOT create a new branch version.
