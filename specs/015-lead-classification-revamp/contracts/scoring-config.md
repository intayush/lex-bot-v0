# Contract: Scoring Configuration JSON Shape

**Path**: `sub_types.scoring_config_json` (TEXT column, JSON-encoded)

**Defined by**: `scoringConfigSchema` (NEW) in
`packages/shared/src/schemas/sop.ts`

**Read at**: chat-route finalization (per-lead),
POST `/api/dashboard/sop/case-types` (admin save)

**Written at**: POST `/api/dashboard/sop/case-types` (admin save),
seed-defaults bootstrap, `db:ensure-car-accident-scoring` remediation
script

**Status**: NEW for spec 015

## Shape

```jsonc
{
  "schema_version": 1,
  "thresholds_self": {
    "hot":  [76, 100],
    "warm": [51, 75],
    "cold": [26, 50],
    "spam": [0, 25]
  },
  "thresholds_family_friend": {
    "hot":  [76, 100],
    "warm": [26, 75],
    "spam": [0, 25]
  },
  "hard_overrides_enabled": {
    "missing_contact":        true,
    "out_of_scope":           true,
    "no_injury_no_treatment": true,
    "fake_info":              true
  }
}
```

## Field Semantics

### `schema_version` (integer, required)

Pinned to `1` in MVP. The runtime rejects any other value with a
parse error. Future expansions (Case Value Score / Urgency Score
decomposition per spec §Assumptions) bump this to `2` and add new
sibling fields without touching the existing v1 fields.

### `thresholds_self` (object, required)

Score-to-classification mapping for visitors who answered the
`request_type` question with `SELF`.

Four buckets, each a `[min, max]` integer tuple. Both bounds are
**inclusive**. The four bucket ranges MUST:

- Cover the full range `[0, 100]` (no gaps).
- Not overlap (no point lands in two buckets).
- Order: `spam` < `cold` < `warm` < `hot` (per FR-038).

Example default (from `lex-chat.xlsx`, Self table):

| Bucket | Range    |
|--------|----------|
| `spam` | `[0, 25]`  |
| `cold` | `[26, 50]` |
| `warm` | `[51, 75]` |
| `hot`  | `[76, 100]` |

### `thresholds_family_friend` (object, required)

Score-to-classification mapping for visitors who answered the
`request_type` question with `FRIEND_FAMILY`.

Three buckets only — no `cold` (per FR-039 and the xlsx Family/Friend
table). Same coverage and overlap rules as Self.

Example default:

| Bucket | Range    |
|--------|----------|
| `spam` | `[0, 25]`  |
| `warm` | `[26, 75]` |
| `hot`  | `[76, 100]` |

### `hard_overrides_enabled` (object, required)

Per-rule on/off toggles. The four rule names are pinned in MVP and
correspond to the fixed predicate set in
`packages/api/src/lib/scoring/hard-overrides.ts`:

| Key                       | Predicate                                                                                  |
|---------------------------|--------------------------------------------------------------------------------------------|
| `missing_contact`         | Both `contact_email` and `contact_phone` are null/empty after the contact form is submitted |
| `out_of_scope`            | Captured case_type's `is_in_scope` flag is false                                           |
| `no_injury_no_treatment`  | Captured `injury` chip is `no` AND captured `medical_treatment` chip is `no_treatment`     |
| `fake_info`               | Phone < 7 digits, or email matches `/^test@\|@(test\|example)\./i`, or name matches `/^(test\|asdf\|fake\|x{2,})/i` |

`true` = rule fires; `false` = rule disabled (FR-010). Disabled rules
do not contribute to either the classification or the reasons array.

Authoring NEW rules is out of scope for MVP per spec §Assumptions; the
key set is fixed.

## Validation Rules (Zod)

The `scoringConfigSchema` enforces:

1. `schema_version` is exactly `1`.
2. Every threshold tuple `[lo, hi]`:
   - Both members are integers in `[0, 100]`.
   - `lo <= hi`.
3. The four Self bucket ranges form a contiguous partition of
   `[0, 100]` with no gaps and no overlaps.
4. The three Family/Friend bucket ranges form a contiguous partition
   of `[0, 100]` with no gaps and no overlaps.
5. `hard_overrides_enabled` has all four boolean keys exactly once.

A save that fails any rule is rejected with a structured Zod issue
including a stable `params.code` (e.g.,
`'THRESHOLDS_GAP'`, `'THRESHOLDS_OVERLAP'`,
`'THRESHOLDS_INVALID_BOUND'`, `'SCHEMA_VERSION_UNSUPPORTED'`) so the
dashboard can render an actionable inline error per FR-021.

## NULL semantics

`sub_types.scoring_config_json IS NULL` means "this sub_type has no
scoring configuration; the leads finalization path falls through to
the LLM classifier" (FR-022). NULL is the default for every sub_type
in MVP except `(personal_injury, car_accident)`.

Setting the column back to NULL via the dashboard (FR-022) returns
the sub_type to the legacy classifier path without deleting the
sub_type itself.

## Forward Compatibility

Adding the deferred Case Value Score / Urgency Score decomposition
(spec §Assumptions) bumps `schema_version` to `2` and adds new sibling
fields like `case_value_components` (Injury Severity 0–40, Liability
0–25, etc.) and `urgency_components`. The runtime branches on
`schema_version` so v1 rows continue to score correctly while v2 rows
score using the decomposed model. No migration is forced; admins can
opt into v2 per sub_type.
