# Contract: SOP History API

**Feature**: 022-version-history-ui

All endpoints require an authenticated dashboard session cookie. `account_id` is always read from the session.

---

## GET /api/dashboard/sop — updated response

The existing GET already returns a `history` array. After this feature it includes `label` and `step_count`.

**Response 200** (updated shape):
```json
{
  "current_published": {
    "id": "sop_abc",
    "version": 3,
    "qualified_lead_threshold": 6,
    "is_published": true,
    "steps": [ ... ]
  },
  "history": [
    {
      "id": "sop_abc",
      "version": 3,
      "label": "Standard 6-step SOP",
      "is_published": true,
      "created_at": "2026-06-15T10:30:00.000Z",
      "step_count": 6
    },
    {
      "id": "sop_def",
      "version": 2,
      "label": null,
      "is_published": false,
      "created_at": "2026-05-01T08:00:00.000Z",
      "step_count": 5
    }
  ]
}
```

`step_count` is a derived count of `sopSteps` rows with `sop_configuration_id = id`. Ordered by `version DESC`.

**No breaking changes** — new fields are additive.

---

## POST /api/dashboard/sop — action: 'rollback' (already exists, label wire-up needed)

The existing `action: 'rollback'` handler already creates a new SOP draft by copying steps from a historical version. After this feature the new draft inherits `label = null` (not copied from source — restore starts unlabelled, matching config restore behaviour).

**Request** (unchanged):
```json
{
  "action": "rollback",
  "version_id": "sop_def"
}
```

**Response 200** (unchanged):
```json
{
  "success": true,
  "new_version": 4,
  "config_id": "sop_xyz"
}
```

No changes to the handler logic; just verify the new `label` column is set to `null` on insert (Drizzle default handles this automatically).

---

## PATCH /api/dashboard/sop/label

Updates the label on a specific SOP version. Does not create a new version.

**Request**:
```json
{
  "version_id": "sop_def",
  "label": "Pre-rebrand SOP"
}
```

`label` — string, max 80 characters, or `null` to clear. `version_id` must belong to the authenticated account.

**Response 200**:
```json
{ "success": true }
```

**Response 400**: `label` exceeds 80 characters or `version_id` missing.
**Response 404**: Version not found or belongs to different account.
**Response 401**: No session.

**Side effects**: Single `UPDATE sop_configurations SET label = ? WHERE id = ? AND account_id = ?`.
