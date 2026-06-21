# Contract: Attorneys API

**Feature**: 024-attorney-routing

All endpoints require an authenticated dashboard session. `account_id` is always derived from the session — never from the request body or URL.

---

## GET /api/dashboard/attorneys

Returns all attorneys for the authenticated account, each with their case type assignments.

**Response 200**:
```json
{
  "attorneys": [
    {
      "id": "atty_abc",
      "name": "Sarah Kim Esq.",
      "email": "sarah@firm.com",
      "mobile": "+14125550001",
      "case_type_slugs": ["dui", "criminal_defense"],
      "created_at": "2026-06-21T10:00:00.000Z",
      "updated_at": "2026-06-21T10:00:00.000Z"
    }
  ]
}
```

**Response 401**: No session.

---

## POST /api/dashboard/attorneys

Creates a new attorney.

**Request**:
```json
{
  "name": "Sarah Kim Esq.",
  "email": "sarah@firm.com",
  "mobile": "+14125550001",
  "case_type_slugs": ["dui", "criminal_defense"]
}
```

`name` and `email` are required. `mobile` and `case_type_slugs` are optional (default empty array).

**Response 201**:
```json
{ "success": true, "id": "atty_abc" }
```

**Response 400**: Validation failure (missing name, invalid email, unknown case type slug for this account).
**Response 409**: Email already exists for this account.
**Response 401**: No session.

**Side effects**: Inserts one row in `attorneys` and one row per assigned case type in `attorney_case_type_assignments`.

---

## PATCH /api/dashboard/attorneys/[id]

Updates an existing attorney's fields and/or case type assignments.

**Request** (all fields optional — only provided fields are updated):
```json
{
  "name": "Sarah Kim",
  "email": "sarah.kim@firm.com",
  "mobile": null,
  "case_type_slugs": ["dui"]
}
```

When `case_type_slugs` is provided, it **replaces** the full assignment list (not a patch). To remove all assignments, pass `"case_type_slugs": []`.

**Response 200**:
```json
{ "success": true }
```

**Response 400**: Validation failure.
**Response 404**: Attorney not found or belongs to a different account.
**Response 409**: New email conflicts with another attorney in this account.
**Response 401**: No session.

---

## DELETE /api/dashboard/attorneys/[id]

Deletes an attorney and all their case type assignments.

**Response 200**:
```json
{ "success": true }
```

**Response 404**: Attorney not found or belongs to a different account.
**Response 401**: No session.

**Side effects**: Deletes the `attorneys` row; `attorney_case_type_assignments` rows are cascade-deleted. Pending `notifications` rows referencing this attorney are NOT deleted — they remain as historical records.
