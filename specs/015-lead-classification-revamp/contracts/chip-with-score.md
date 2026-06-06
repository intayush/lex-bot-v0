# Contract: Inline Chip With Score Weight

**Path**: `sop_steps.inline_chips_json` (TEXT column, JSON-encoded
array of chip objects)

**Defined by**: `chipSchema` (EXTENDED) in
`packages/shared/src/schemas/sop.ts`

**Read at**: chat-route per-turn chip rendering, scorer at
finalization, dashboard sub_type editor (read-only preview)

**Written at**: POST `/api/dashboard/sop/case-types`,
seed-defaults bootstrap

**Status**: EXTENDED (existing column, new optional field per chip)

## Shape

A chip is `{label, slug, score_weight?}`:

```jsonc
[
  { "label": "Today",                  "slug": "today",                  "score_weight": 20 },
  { "label": "Within Last 7 Days",     "slug": "within_last_7_days",     "score_weight": 15 },
  { "label": "Within Last 30 Days",    "slug": "within_last_30_days",    "score_weight": 10 },
  { "label": "Within Last 6 Months",   "slug": "within_last_6_months",   "score_weight": 5  },
  { "label": "More Than 6 Months Ago", "slug": "more_than_6_months_ago", "score_weight": 0  },
  { "label": "I Don't Know",           "slug": "i_dont_know",            "score_weight": 0  }
]
```

## Field Semantics

### `label` (string, required)

Visitor-facing chip text. Existing field — no change.

### `slug` (string, required)

Stable identifier for the chip; the value persisted in
`SOPStateStep.captured_value`. Existing field — no change.

### `score_weight` (integer, optional)

The integer contribution this chip makes to the lead score when
selected. Range: `[-50, +50]`. Bounded but generous (highest absolute
weight in the xlsx defaults is +25).

**Three states**:

| Value           | Meaning                                                                  |
|-----------------|--------------------------------------------------------------------------|
| Field absent    | Chip does not contribute to scoring (e.g., chips on the existing 6 default steps) |
| `0`             | Chip contributes nothing AND is not eligible for the reasons array (FR-010a's `\|weight\| ≥ 5` rule excludes 0) |
| Non-zero        | Chip contributes its weight to the score and is reasons-eligible iff `\|weight\| ≥ 5` |

Distinguishing absent from `0` matters because:

- The existing 6 default steps' chips (`today`, `yesterday`, … on
  the `when` step) leave `score_weight` undefined — they are NOT
  scoring chips.
- The new `accident_timing` step's chips ALSO have a `Today` label,
  but with `score_weight: 20` — they ARE scoring chips.
- The "I Don't Know" chip on every scoring question is explicitly
  `score_weight: 0` — it is a scoring chip that contributes nothing,
  per FR-016.

## Backward Compatibility

The added field is optional. Pre-015 `inline_chips_json` rows parse
unchanged (Zod's `optional()` accepts the absence). The 014 default
SOP-step chips (e.g., the 7 `when`-step chips: today, yesterday, …)
continue to render and operate exactly as before; `score_weight` is
ignored on those rows by the scorer.

## Validation Rules (Zod)

The extended `chipSchema` enforces:

1. `label` is a non-empty string (existing).
2. `slug` matches the existing snake_case constraint
   `/^[a-z][a-z0-9_]*$/` (existing).
3. `score_weight`, when present, is an integer in `[-50, +50]`.

The boundary for `inline_chips_json` extends to `z.array(chipSchema)`;
empty arrays are allowed (existing behaviour for steps that have no
inline chips).

## Worked example: full chip set for `accident_timing`

This is the seeded chip set for the new `accident_timing` SOP step
(position 7), per the xlsx Q1 mapping:

```json
[
  { "label": "Today",                  "slug": "today",                  "score_weight": 20 },
  { "label": "Within Last 7 Days",     "slug": "within_last_7_days",     "score_weight": 15 },
  { "label": "Within Last 30 Days",    "slug": "within_last_30_days",    "score_weight": 10 },
  { "label": "Within Last 6 Months",   "slug": "within_last_6_months",   "score_weight": 5  },
  { "label": "More Than 6 Months Ago", "slug": "more_than_6_months_ago", "score_weight": 0  },
  { "label": "I Don't Know",           "slug": "i_dont_know",            "score_weight": 0  }
]
```

For complete chip sets covering all 8 scoring questions plus the 2
metadata questions, see `packages/api/src/db/seed-defaults/sop.ts`
(authored in Phase 2 implementation).
