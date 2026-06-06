# Contract: Branches Admin API

**Feature**: 016-multi-branch-sop · **Spec FRs**: FR-019 through FR-028
**Endpoints**: `GET /api/admin/branches`, `PUT /api/admin/branches/:caseTypeSlug/:subTypeSlug`,
`POST /api/admin/branches/:caseTypeSlug/:subTypeSlug/publish`,
`DELETE /api/admin/branches/:caseTypeSlug/:subTypeSlug`

All endpoints are dashboard-authenticated (existing `iron-session`
session). All endpoints are dashboard-authenticated (existing `iron-session`
session). Constitution IV: Next.js Route Handlers only — no server
actions.

## GET /api/admin/branches

List every (case_type, sub_type) pair from the firm's case-type config
with branch status (FR-020).

**Auth**: Dashboard session (admin role required).

**Query params**: none.

**Response 200** (validated by `branchesListResponseSchema`):

```json
{
  "pairs": [
    {
      "case_type_slug": "personal_injury",
      "case_type_label": "Personal Injury",
      "sub_type_slug": "car_accident",
      "sub_type_label": "Car Accident",
      "branch": {
        "id": "br_abc123",
        "is_active": true,
        "current_version_id": "bv_xyz789",
        "version_number": 3,
        "questions_count": 8,
        "is_published": true,
        "updated_at": 1717689600000
      }
    },
    {
      "case_type_slug": "criminal_defense",
      "case_type_label": "Criminal Defense",
      "sub_type_slug": "assault_charges",
      "sub_type_label": "Assault Charges",
      "branch": null
    }
  ]
}
```

**Response 401** if session missing/invalid. **Response 403** if user
lacks admin role.

## GET /api/admin/branches/:caseTypeSlug/:subTypeSlug

Fetch the full draft branch payload for editing (FR-022, FR-024).

**Path params**: `caseTypeSlug`, `subTypeSlug` (URL-encoded).

**Response 200** (validated by `branchDetailResponseSchema`):

```json
{
  "branch": {
    "id": "br_abc123",
    "case_type_slug": "personal_injury",
    "sub_type_slug": "car_accident",
    "is_active": true
  },
  "current_version": {
    "id": "bv_xyz789",
    "version_number": 3,
    "is_published": true,
    "questions": [
      {
        "id": "q_role",
        "position": 0,
        "text": "Were you a driver or passenger?",
        "preface": null,
        "chips": [
          { "slug": "driver", "label": "Driver", "weight": 10 },
          { "slug": "passenger", "label": "Passenger", "weight": 8 }
        ],
        "free_text_allowed": false,
        "multi_select": false
      }
    ],
    "classification_thresholds": {
      "self": { "hot_min": 76, "warm_min": 51, "cold_min": 26 },
      "family_friend": { "hot_min": 71, "warm_min": 46, "cold_min": 21 }
    },
    "hard_override_toggles": {
      "missing_contact": true,
      "out_of_scope": true,
      "no_injury_no_treatment": true,
      "fake_info": true
    }
  },
  "draft_version": null
}
```

`draft_version` is non-null when the admin has saved an unpublished
draft on top of the current published version. The dashboard editor
shows the draft if present, otherwise the current published version.

## PUT /api/admin/branches/:caseTypeSlug/:subTypeSlug

Save a branch draft (creates the branch if it doesn't exist;
otherwise creates a new draft version on top of the current published
version) (FR-021, FR-022, FR-023, FR-024).

**Auth**: Dashboard session (admin role).

**Request body** (validated by `branchSaveRequestSchema`):

```json
{
  "is_active": true,
  "questions": [ /* BranchQuestion[] */ ],
  "classification_thresholds": { /* same shape as GET response */ },
  "hard_override_toggles": { /* same shape as GET response */ }
}
```

**Validation** (Zod refinements):

- `questions[].chips[].weight` is integer.
- `questions[].chips[].slug` matches `/^[a-z0-9_-]+$/`.
- Chip slugs unique within a question.
- Question `position` values form a contiguous 0-indexed sequence.
- At least one threshold table is provided (Self).
- Hard-override toggles include all four known rule names.

**Response 200**:

```json
{
  "branch_id": "br_abc123",
  "draft_version_id": "bv_new456",
  "version_number": 4,
  "warnings": [
    { "code": "negative_total_max", "message": "Maximum theoretical score is below 0; consider raising chip weights." }
  ]
}
```

`warnings` is the array surfaced from FR-023 validation (does not
block save).

**Response 400** with structured error array on validation failure.

## POST /api/admin/branches/:caseTypeSlug/:subTypeSlug/publish

Publish the current draft version, making it live for new
conversations (FR-017).

**Request body**: empty.

**Response 200**:

```json
{
  "branch_id": "br_abc123",
  "published_version_id": "bv_new456",
  "version_number": 4,
  "published_at": 1717689600000
}
```

**Response 409** if no draft version exists to publish.

**Side effects**: in-flight conversations are unaffected (they pin to
their starting version per R7).

## DELETE /api/admin/branches/:caseTypeSlug/:subTypeSlug

Delete a branch entirely. Historical lead snapshots are preserved
(FR-018, FR-026).

**Request body**: empty (the dashboard's confirmation dialog is
client-side; no server-side confirmation token).

**Response 204** on success. Cascade deletes `branch_versions` rows
(via FK ON DELETE CASCADE). `leads.branch_snapshot_json` rows are
unaffected (snapshot stores all needed data inline).

**Response 404** if no branch exists.

## Auth & Audit

All four mutations (`PUT`, `POST publish`, `DELETE`) record an audit
log entry per FR-028, reusing the existing dashboard audit-log
mechanism. Log fields: `actor_user_id`, `action_type` (one of
`branch_save | branch_publish | branch_delete`), `target_branch_id`,
`firm_id`, `ts`. No PII.

