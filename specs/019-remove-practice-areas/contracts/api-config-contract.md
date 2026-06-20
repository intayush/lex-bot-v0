# Contract: GET /api/config — Post-019 Response Shape

**Endpoint**: `GET /api/config`
**Auth**: `x-api-key` header (per-site API key)
**Feature**: `019-remove-practice-areas`

## Response Body Delta

### Removed field

```
practice_areas: string[]   // REMOVED
```

### Added field

```
in_scope_case_types: string[]
```

Populated from `case_types` rows for the account where `is_in_scope = true`, ordered ascending by `position`, mapped to `label`. Empty array when no case types are in-scope or none are configured.

## Full Response Shape (post-019)

```json
{
  "chatbot_name": "string",
  "greeting_message": "string",
  "in_scope_case_types": ["string", "..."],
  "phone": "string",
  "theme": { "id": "string", "primary_bg": "string", "primary_color": "string" } | null,
  "sop": {
    "id": "string",
    "version": 1,
    "qualified_lead_threshold": 5,
    "steps": [
      {
        "id": "string",
        "position": 1,
        "slug": "case_type",
        "question_text": "string",
        "chip_source": "case_types" | "sub_types" | "inline" | "contact_form" | null,
        "inline_chips_json": "string" | null,
        "accepts_free_text": true,
        "is_required": true
      }
    ]
  } | null,
  "case_types": [
    {
      "id": "string",
      "slug": "string",
      "label": "string",
      "position": 1,
      "is_in_scope": true,
      "sub_types": [
        { "id": "string", "slug": "string", "label": "string", "position": 1 }
      ]
    }
  ]
}
```

## Widget Consumers That Must Be Updated

| File | Current field read | Updated field |
|------|--------------------|---------------|
| `packages/widget/src/components/ChatPanel.tsx` | `widgetConfig.practice_areas` | `widgetConfig.in_scope_case_types` |
| `packages/widget/src/components/ChatWidget.tsx` | `WidgetConfig.practice_areas` type | `WidgetConfig.in_scope_case_types` type |

## Breaking Change Notice

Widget versions published before this feature will receive `undefined` for `in_scope_case_types` (field did not exist) and will no longer receive `practice_areas`. The `QuickReplies` component must guard against `undefined` with a `?? []` default to maintain current behavior (no chips shown).
