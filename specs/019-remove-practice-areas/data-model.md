# Data Model: Remove Practice Areas — Consolidate on Case Types (019)

**Branch**: `019-remove-practice-areas`
**Date**: 2026-06-20

This document covers only the delta from the existing data model. All entities not mentioned are unchanged.

---

## Changed Entity: Configuration

**Location**: `packages/shared/src/schemas/configuration.ts`

### Delta

#### Add top-level field

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `out_of_scope_response` | `string` | `''` | The deflection message the chatbot sends when a visitor asks about a legal area outside the firm's scope. Promoted from `practice_areas.out_of_scope_response`. |

#### Deprecate `practice_areas` sub-object

| Field | Old status | New status |
|-------|-----------|-----------|
| `practice_areas` | Required (`z.object({active, custom, out_of_scope_response})`) | Optional (`z.object({...}).optional()`) — parses without error on old rows; UI never writes it on new saves |

### Read-time migration rule

When loading a stored configuration row:
- If `out_of_scope_response` at the top level is absent or empty string, AND `practice_areas.out_of_scope_response` is non-empty → populate `out_of_scope_response` from the nested value before returning.
- Applied in the config loading utility, not at the DB layer.

### New Zod shape (conceptual)

```
configurationSchema = z.object({
  version: z.number().int(),
  saved_at: z.string(),
  persona: personaSchema,
  out_of_scope_response: z.string().default(''),   // ← NEW (promoted)
  practice_areas: practiceAreasSchema.optional(),   // ← was required; now optional legacy
  qualifying_questions: z.array(...),
  boundaries: boundariesSchema,
  escalation: escalationSchema,
  contact: contactSchema,
  custom_instructions: z.string().default(''),
  theme: themeSchema.nullable().optional(),
})
```

---

## Changed Contract: `/api/config` Response

**Location**: `packages/api/src/app/api/config/route.ts`

### Delta

| Field | Old | New |
|-------|-----|-----|
| `practice_areas` | `string[]` — from `config.practice_areas.active + custom` | **Removed** |
| `in_scope_case_types` | (did not exist) | `string[]` — from `case_types.filter(is_in_scope).sort(position).map(label)` |

All other response fields (`chatbot_name`, `greeting_message`, `phone`, `theme`, `sop`, `case_types`) are unchanged.

---

## Changed Type: Widget `WidgetConfig`

**Location**: `packages/widget/src/components/ChatPanel.tsx` (interface) and `packages/widget/src/components/ChatWidget.tsx` (state type)

### Delta

| Field | Old | New |
|-------|-----|-----|
| `practice_areas: string[]` | Received from `/api/config`; passed to `<QuickReplies>` | **Renamed** to `in_scope_case_types: string[]` |

---

## No DB Migration Required

The `configurations` table stores `config_json` as a plain text column. The schema change (making `practice_areas` optional, adding `out_of_scope_response`) is handled entirely in the Zod parsing layer:

- Old rows: parse with `practice_areas` present (now optional, so no error) + `out_of_scope_response` absent (defaults to `''`) → read-time migration fills it from the nested value.
- New rows (post-feature): written without `practice_areas`; contain `out_of_scope_response` at top level.

Both coexist without a migration script.

---

## Unchanged Entities

- `case_types` table — no schema changes; `is_in_scope`, `position`, `label` already exist
- `sub_types` table — unchanged
- `sop_configurations` / `sop_steps` — unchanged
- `sessions`, `leads` — unchanged
