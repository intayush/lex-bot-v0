# Contract: Config History API

**Feature**: 022-version-history-ui

All endpoints require an authenticated dashboard session cookie. `account_id` is always read from the session — never from the request body or URL.

---

## GET /api/dashboard/config

Returns the version history list for the authenticated account.

**Request**: No body. No query params.

**Response 200**:
```json
{
  "versions": [
    {
      "id": "abc123",
      "version": 5,
      "label": "Summer 2026 Campaign",
      "is_published": true,
      "created_at": "2026-06-15T10:30:00.000Z"
    },
    {
      "id": "def456",
      "version": 4,
      "label": null,
      "is_published": false,
      "created_at": "2026-06-10T08:00:00.000Z"
    }
  ]
}
```

Ordered by `version DESC`. `config_json` is not included (fetched server-side on restore).

**Response 401**: No session.

---

## POST /api/dashboard/config — action: 'restore'

Creates a new draft by copying the content of an existing version.

**Request**:
```json
{
  "action": "restore",
  "source_version_id": "def456"
}
```

`source_version_id` — the `id` (not version number) of the version to restore from. Must belong to the authenticated account.

**Response 200**:
```json
{
  "success": true,
  "new_version": 6
}
```

**Response 400**: `source_version_id` missing or empty.
**Response 404**: Source version not found or belongs to a different account.
**Response 401**: No session.

**Side effects**:
- Inserts a new `configurations` row with `version = maxVersion + 1`, `is_published = false`, `label = null`, `config_json` copied from source.
- Invalidates `invalidateConfigCache(accountId)` and `invalidateSystemPromptCache(accountId)`.
- Does NOT modify the source row.

---

## PATCH /api/dashboard/config/label

Updates the label on a specific configuration version. Does not create a new version.

**Request**:
```json
{
  "version_id": "def456",
  "label": "Summer 2026 Campaign"
}
```

`label` — string, max 80 characters, or `null` to clear the label. `version_id` must belong to the authenticated account.

**Response 200**:
```json
{ "success": true }
```

**Response 400**: `label` exceeds 80 characters or `version_id` missing.
**Response 404**: Version not found or belongs to different account.
**Response 401**: No session.

**Side effects**: Single `UPDATE configurations SET label = ? WHERE id = ? AND account_id = ?`.
