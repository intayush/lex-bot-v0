# Phase 1 Data Model: Lead Classification Revamp

**Date**: 2026-06-06

**Status**: Complete

**Scope**: Data shape changes — Zod schemas, persisted JSON, DB columns,
state-shape extensions. References `research.md` for decision
rationales; references `contracts/` for boundary contracts.

This is **not** a migration plan — see `research.md §R5` and the
to-be-authored Drizzle migration `0003_*.sql` for migration mechanics.

## Entity Inventory

The 015 feature touches 4 persisted entities and 1 in-memory
state-shape entity:

| Entity                    | Layer                  | Change                                                   |
|---------------------------|------------------------|----------------------------------------------------------|
| `leads` (table)           | DB                     | Add 5 columns; existing `classification` value space changes |
| `sub_types` (table)       | DB                     | Add 1 column (`scoring_config_json`)                     |
| `sop_steps` (table)       | DB                     | Add 1 column (`applies_when_sub_type_slug`); existing `inline_chips_json` content shape extended (no DDL) |
| `Chip` (Zod / JSON)       | Shared schema          | Extend with optional `score_weight: number`              |
| `ScoringConfig` (Zod / JSON) | Shared schema       | NEW — matches `sub_types.scoring_config_json`           |
| `SOPState` (in-memory)    | Shared schema          | No structural change (existing `captured_value` /        |
|                           |                        | `captured_label` carry the new chip captures unchanged)  |

## 1. `leads` table

**Existing columns** (preserved):

`id`, `account_id`, `session_id`, `name`, `contact_email`,
`contact_phone`, `case_type`, `incident_date`, `brief_description`,
`classification` (NOT NULL text), `classification_rationale`,
`urgency_factors_json`, `sop_state_snapshot`, `status`,
`follow_up_action`, `follow_up_action_changed_at`, `created_at`.

**Existing column with value-space change**:

| Column           | Old domain                                        | New domain                                  |
|------------------|---------------------------------------------------|---------------------------------------------|
| `classification` | `'urgent'` \| `'normal'` \| `'unqualified'`       | `'HOT'` \| `'WARM'` \| `'COLD'` \| `'SPAM'` |

Type at the DB layer remains `text NOT NULL`. The value-space contract
is enforced by the Zod schema at every boundary (FR-030 / Constitution
II). The migration UPDATE in `0003_*.sql` rewrites every existing row
1:1 (urgent→HOT, normal→WARM, unqualified→SPAM) per FR-031.

**New columns** (all part of `0003_*.sql`):

| Column                                     | Type            | Nullable | Default | Notes                                                           |
|--------------------------------------------|-----------------|----------|---------|-----------------------------------------------------------------|
| `lead_score`                               | `integer`       | YES      | NULL    | 0–100 inclusive when set; NULL for unscored / failed / legacy   |
| `score_reasons_json`                       | `text`          | YES      | NULL    | JSON array of phrase strings; NULL for unscored / legacy        |
| `request_type`                             | `text`          | YES      | NULL    | `'SELF'` \| `'FRIEND_FAMILY'` enum (Zod-enforced)                |
| `geographic_qualification`                 | `text`          | YES      | NULL    | `'IN_SERVICE_AREA'` \| `'OUTSIDE_SERVICE_AREA'` enum             |
| `geographic_qualification_details_json`    | `text`          | YES      | NULL    | JSON `{ city: string, state: string }`; only when "Outside"     |

**Validation rules**:

- `lead_score` MUST be in `[0, 100]` inclusive when non-null.
  Enforced by the Zod schema `leadSchema` in
  `packages/shared/src/schemas/leads.ts` and by the scorer's
  cap/floor logic (FR-005).
- `score_reasons_json` MUST be `null` when `lead_score` is `null`,
  EXCEPT when the special `["scoring_error"]` sentinel applies (then
  `lead_score = null` and `score_reasons_json = '["scoring_error"]'`
  per FR-010b).
- `request_type` and `geographic_qualification` MUST be set on every
  rule-based-scored lead (the visitor must answer the metadata
  questions for the scorer to choose the right threshold table). MAY
  be null on legacy or LLM-fallback leads.
- `geographic_qualification_details_json` is only set when
  `geographic_qualification = 'OUTSIDE_SERVICE_AREA'`.

**State transitions** (none new). Lead row is INSERTed at finalization
and UPDATEd when SOP-state-driven contact-form-derived fields are
backfilled (existing behaviour); the new columns are written exactly
once on INSERT.

### Updated `leadSchema` (packages/shared/src/schemas/leads.ts)

The shared Zod schema currently declares 14 fields (out of date — see
015 survey item 3). The 015 update synchronises it with the DB schema
and adds the new columns:

```text
leadClassificationSchema = z.enum(['HOT', 'WARM', 'COLD', 'SPAM'])

leadRequestTypeSchema = z.enum(['SELF', 'FRIEND_FAMILY'])

leadGeographicQualificationSchema = z.enum(['IN_SERVICE_AREA', 'OUTSIDE_SERVICE_AREA'])

leadSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  session_id: z.string(),
  name: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  case_type: z.string().nullable(),
  incident_date: z.string().nullable(),
  brief_description: z.string().nullable(),
  classification: leadClassificationSchema,                      // value-space change
  classification_rationale: z.string().nullable(),
  urgency_factors_json: z.string().nullable(),
  lead_score: z.number().int().min(0).max(100).nullable(),       // NEW
  score_reasons_json: z.string().nullable(),                     // NEW
  request_type: leadRequestTypeSchema.nullable(),                // NEW
  geographic_qualification: leadGeographicQualificationSchema.nullable(),  // NEW
  geographic_qualification_details_json: z.string().nullable(),  // NEW
  sop_state_snapshot: z.string().nullable(),                     // existed in DB, missing from schema
  status: leadStatusSchema,
  follow_up_action: z.string().nullable(),                       // existed in DB, missing from schema
  follow_up_action_changed_at: z.string().nullable(),            // existed in DB, missing from schema
  created_at: z.string(),
})
```

The 4 schema-vs-DB drift fields (`sop_state_snapshot`,
`follow_up_action`, `follow_up_action_changed_at`, plus the new ones)
are written in this update. Pre-existing tests against `leadSchema`
will need to assert the new fields default to null on legacy rows.

## 2. `sub_types` table

**Existing columns** (preserved): `id`, `case_type_id`, `slug`,
`label`, `position`, `created_at`.

**New column**:

| Column                | Type   | Nullable | Default | Notes                                              |
|-----------------------|--------|----------|---------|----------------------------------------------------|
| `scoring_config_json` | `text` | YES      | NULL    | JSON validated by `scoringConfigSchema` (Zod)      |

NULL = "no scoring configuration; fall through to LLM classifier"
(FR-022). Non-NULL must parse against `scoringConfigSchema` (see §3
below) at every boundary read.

**Validation rules**:

- The JSON, when non-null, MUST parse against `scoringConfigSchema`.
  If it doesn't (e.g., malformed JSON, missing required fields,
  thresholds with gaps), the scorer treats it as a scoring error
  (FR-010b path) and the offending sub_type's leads are captured as
  SPAM with `["scoring_error"]` reasons.
- The Zod-level threshold-coverage validation runs on POST
  `/api/dashboard/sop/case-types` (FR-020) so admins cannot save
  invalid configs.
- The same JSON shape is parsed at chat-route finalization; any
  parse failure there is logged and treated as scoring_error.

## 3. `ScoringConfig` Zod schema (NEW shared)

Lives in `packages/shared/src/schemas/sop.ts`. Used by:

- POST `/api/dashboard/sop/case-types` to validate admin saves
  (FR-020 / FR-021).
- The Drizzle insert/update path that writes
  `sub_types.scoring_config_json`.
- The chat-route finalization path that reads
  `sub_types.scoring_config_json`.

```text
classificationBoundsSchema = z.tuple([
  z.number().int().min(0).max(100),
  z.number().int().min(0).max(100),
]).refine(([lo, hi]) => lo <= hi, "lower bound must be ≤ upper")

thresholdsSelfSchema = z.object({
  hot:  classificationBoundsSchema,
  warm: classificationBoundsSchema,
  cold: classificationBoundsSchema,
  spam: classificationBoundsSchema,
})
.refine(coversFullRange, "Self thresholds must be contiguous and cover [0,100]")
.refine(noOverlap, "Self thresholds must not overlap")

thresholdsFamilyFriendSchema = z.object({
  hot:  classificationBoundsSchema,
  warm: classificationBoundsSchema,
  spam: classificationBoundsSchema,
})
.refine(coversFullRange, "Family/Friend thresholds must be contiguous and cover [0,100]")
.refine(noOverlap, "Family/Friend thresholds must not overlap")

hardOverridesEnabledSchema = z.object({
  missing_contact:        z.boolean(),
  out_of_scope:           z.boolean(),
  no_injury_no_treatment: z.boolean(),
  fake_info:              z.boolean(),
})

scoringConfigSchema = z.object({
  schema_version:           z.literal(1),
  thresholds_self:          thresholdsSelfSchema,
  thresholds_family_friend: thresholdsFamilyFriendSchema,
  hard_overrides_enabled:   hardOverridesEnabledSchema,
})
```

**Default values shipped for car_accident** (per `lex-chat.xlsx`):

```text
{
  schema_version: 1,
  thresholds_self: {
    hot:  [76, 100],
    warm: [51, 75],
    cold: [26, 50],
    spam: [0, 25],
  },
  thresholds_family_friend: {
    hot:  [76, 100],
    warm: [26, 75],
    spam: [0, 25],
  },
  hard_overrides_enabled: {
    missing_contact:        true,
    out_of_scope:           true,
    no_injury_no_treatment: true,
    fake_info:              true,
  },
}
```

**Forward compatibility**: `schema_version: z.literal(1)` means the
runtime rejects unknown future versions explicitly. When the
post-MVP Case-Value-Score / Urgency-Score work lands (spec §Assumptions),
it bumps to `schema_version: 2` and the runtime adds a `v2` branch
without breaking existing v1 rows.

## 4. `sop_steps` table

**Existing columns** preserved.

**New column**:

| Column                          | Type   | Nullable | Default | Notes                                                                              |
|---------------------------------|--------|----------|---------|------------------------------------------------------------------------------------|
| `applies_when_sub_type_slug`    | `text` | YES      | NULL    | When set, step only fires when captured sub_type's slug matches; NULL = always fires |

See `research.md §R2` for the runtime semantics. The existing 6
default SOP steps leave this column NULL (they always fire). The 9
new car-accident-scoring steps (8 scoring + request_type +
geographic_qualification — well, 10 total once we count
request_type/geographic_qualification distinctly; see R1 table) all
set `applies_when_sub_type_slug = 'car_accident'`.

Wait — the request_type and geographic_qualification questions were
called "metadata, not scored". They still need to be asked only for
configured sub_types (otherwise non-car-accident leads would also see
those questions, which contradicts spec FR-011: "scoring questions
fire only when the captured sub_type matches the configured sub_type").
So those 2 metadata steps also have `applies_when_sub_type_slug =
'car_accident'` in MVP. Future sub_types with their own scoring config
will have their own copies of these steps with their own
`applies_when_sub_type_slug`.

**Existing column with content-shape extension** (no DDL):

| Column              | Old content shape                       | New content shape                                              |
|---------------------|------------------------------------------|----------------------------------------------------------------|
| `inline_chips_json` | JSON array of `{label, slug}`            | JSON array of `{label, slug, score_weight?}` (optional field)  |

The added field is optional, so existing rows parse unchanged
(backward-compatible). Only the new scoring-question rows carry
`score_weight` values.

## 5. `Chip` Zod schema extension

Lives in `packages/shared/src/schemas/sop.ts`.

**Before**:
```text
chipSchema = z.object({
  label: z.string(),
  slug:  z.string(),
})
```

**After**:
```text
chipSchema = z.object({
  label:         z.string(),
  slug:          z.string(),
  score_weight?: z.number().int().min(-50).max(50).optional(),
})
```

Bounded range `[-50, +50]` prevents pathological weights; the highest
absolute weight in `lex-chat.xlsx` is +25 (Q3 Surgery), so the bounds
have generous headroom for future tuning.

`undefined` (the field absent) is the contract for "this chip does
not contribute to scoring." `0` (the field present with value 0) is
the contract for "explicitly worth nothing" — used by the "I Don't
Know" chip per FR-016.

Distinguishing absent from `0` matters because the reasons-builder
(FR-010a) treats undefined-weight chips as not-eligible-for-reasons,
while `0`-weight chips are eligible-but-excluded-by-threshold (an
"I Don't Know" answer never appears in the reasons array because
|0| < 5).

## 6. In-memory state shape (no change)

`SOPState` and `SOPStateStep` (defined in
`packages/shared/src/schemas/sop.ts`) require **zero structural
changes**. The new scoring-question SOP steps capture chip slugs into
the existing `captured_value: string | null` field and chip labels
into the existing `captured_label: string | null` field (added by
spec 014).

The `scoreLead` function (Phase 2) receives:
- `sopState: SOPState` — the full captured-state at finalization, read
  from `leads.sop_state_snapshot`.
- `scoringConfig: ScoringConfig` — parsed from
  `sub_types.scoring_config_json`.
- `chipsBySlug: Map<string, Chip>` — flattened chip catalog from
  the relevant `sop_steps.inline_chips_json` rows, used to look up
  `score_weight` per captured slug.

Returns:
- `ScoredLead = { classification, lead_score, score_reasons,
  hard_override_fired, scoring_path }`.

`ScoredLead` is an **internal** in-memory shape — not persisted
directly. The fields are mapped onto `leads` columns by the caller
(`captureLead` / `updateLeadSOPState` in `packages/api/src/lib/leads.ts`).

## Relationships

```text
case_types (1) ──< (n) sub_types (1) ──< (0..1) scoring_config_json
                                     │
                                     └──< (n) sop_steps {applies_when_sub_type_slug = sub_type.slug}
                                                       │
                                                       └──< (n) chips ∈ inline_chips_json {score_weight?}

sop_configurations (1) ──< (n) sop_steps

leads (1) ──── (1) sop_state_snapshot (JSON of SOPState)
                          │
                          └──< (n) SOPStateStep {captured_value, captured_label}
                                                       │
                                                       └─→ resolved against
                                                            chips.slug @
                                                            scoreLead time
```

A captured `SOPStateStep.captured_value` (a chip slug) is resolved
back to its `score_weight` by joining the step's
`sop_steps.inline_chips_json` array. The relationship is purely
in-memory; no FK from state to step row.

## Migration order

`0003_*.sql` order of operations:

1. `ALTER TABLE leads ADD COLUMN lead_score INTEGER NULL;`
2. `ALTER TABLE leads ADD COLUMN score_reasons_json TEXT NULL;`
3. `ALTER TABLE leads ADD COLUMN request_type TEXT NULL;`
4. `ALTER TABLE leads ADD COLUMN geographic_qualification TEXT NULL;`
5. `ALTER TABLE leads ADD COLUMN geographic_qualification_details_json TEXT NULL;`
6. `ALTER TABLE sub_types ADD COLUMN scoring_config_json TEXT NULL;`
7. `ALTER TABLE sop_steps ADD COLUMN applies_when_sub_type_slug TEXT NULL;`
8. `UPDATE leads SET classification = 'HOT'  WHERE classification = 'urgent';`
9. `UPDATE leads SET classification = 'WARM' WHERE classification = 'normal';`
10. `UPDATE leads SET classification = 'SPAM' WHERE classification = 'unqualified';`

All 7 ADD COLUMNs are nullable / no-default, so they're safe on a
table with existing data. The 3 UPDATEs are idempotent (re-running
matches zero rows after first run).

The migration is verified end-to-end in `quickstart.md §Migration
verification`.

## Phase 1 Data Model Exit Status

✅ Every persisted shape change documented with type, nullability,
default, and validation rule.

✅ Every Zod schema change is sourced to its `.ts` file.

✅ Forward-compatibility (schema_version=1) recorded.

✅ Migration order is deterministic and idempotent.

Ready for `contracts/` authoring.
