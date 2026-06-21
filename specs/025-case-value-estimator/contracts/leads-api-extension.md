# Contract: Leads API Extension & Badge Resolution

**Feature**: 025-case-value-estimator

---

## Badge Resolution Logic

The leads page resolves the value badge for each lead server-side before rendering.

### Resolution Query (pseudocode)

```
For each lead on the current page:
  1. If lead.lead_score is null → badge = null
  2. If lead.classification is 'SPAM' → badge = null
  3. Lookup: branch WHERE account_id = lead.account_id
              AND case_type_slug = lead.case_type
              AND is_case_value_enabled = true
     If not found → badge = null
  4. Lookup: branch_version WHERE id = branch.current_version_id
  5. Parse case_value_config_json → CaseValueConfig
  6. Find first band WHERE band.score_min ≤ lead.lead_score ≤ band.score_max (ordered by position)
  7. If no band matches → badge = null
  8. badge = formatBadge(band.value_min_usd, band.value_max_usd)
```

### Badge Format

```typescript
function formatBadge(min: number, max: number): string {
  const fmt = (n: number) =>
    n >= 1_000_000 ? `$${n / 1_000_000}M`
    : n >= 1_000   ? `$${n / 1_000}K`
    : `$${n}`;
  return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
}
```

Examples:
- `(75000, 250000)` → `"$75K – $250K"`
- `(200000, 1000000)` → `"$200K – $1M"`
- `(1500, 8000)` → `"$1.5K – $8K"`
- `(50000, 50000)` → `"$50K"`

---

## Leads Table Column

New column inserted after the Classification column:

| Column | Shown when | Value |
|--------|------------|-------|
| Estimated Value | `badge !== null` | Green pill badge e.g. "$75K – $250K" |
| (none) | `badge === null` | Empty cell, no dash |

**Badge styling**: `background: #ECFDF5`, `color: #059669`, `border-radius: 12px`, `padding: 2px 8px`, `font-size: 11px`, `font-weight: 500`.

---

## CSV Import Extension

The branch CSV template download is extended with an optional `[CASE_VALUE]` section:

```csv
question_position,question_text,free_text_allowed,multi_select,chip_label,chip_slug,score_weight
1,Were you injured?,NO,NO,Yes,injured,15
1,Were you injured?,NO,NO,No,not_injured,-15
...

[CASE_VALUE]
case_value_enabled,YES
score_min,score_max,value_min_usd,value_max_usd
76,100,75000,250000
51,75,15000,75000
26,50,3000,15000
```

**Parsing rules**:
- The `[CASE_VALUE]` section is optional. Its absence does not affect question parsing.
- `case_value_enabled` row: `YES` sets enabled, `NO` or absence leaves it unchanged.
- Band rows: each provides one `CaseValueBand`. Position is inferred from order (0, 1, 2...).
- Validation errors in the case value section are reported as `{ row, column, message }` with row numbers relative to the start of the `[CASE_VALUE]` section.

**Template generation**: The `GET /api/dashboard/branches/[caseType]/[subType]/template` endpoint appends the case value section to the downloaded CSV when the branch has existing case value config.
