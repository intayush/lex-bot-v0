# Contract: SOP State Header on Chat Response

**Feature**: 014-fix-sop-case-subtypes
**Endpoint**: `POST /api/chat`
**Header**: `x-sop-state` (existing)
**Owner**: API package; consumer is the widget package.

## Purpose

The chat response header carries the post-turn SOP state so the widget
can render chips, the progress bar, and the contact form without
re-fetching configuration. This feature extends the header with a single
new optional field so the widget can interpolate the captured case-type
label into Step 2's question text and any visitor-facing affordances.

## Existing Shape (unchanged)

| Field | Type | Description |
|-------|------|-------------|
| `total_steps` | integer | Total step count in the published SOP. |
| `current_progress` | integer | Number of steps with `status = 'complete'` plus skipped steps that count toward threshold. |
| `is_finalized` | boolean | True when the lead has been captured. |
| `qualified_lead_threshold` | integer | Threshold for `captureLead` to trigger. |
| `pending_step_slug` | string \| null | Slug of the earliest pending step, or `null` if none pending. |
| `captured_case_type_slug` | string \| null | Slug of the captured case type, or `null` if Step 1 is not yet complete. |

## New Field

| Field | Type | Description |
|-------|------|-------------|
| `captured_case_type_label` | string \| null | The display label of the captured case type (e.g., `"DUI"`, `"Personal Injury"`). Set when `captured_case_type_slug` is non-null and the slug resolves to a known case type. Set to `null` otherwise (including when the captured slug refers to a since-deleted case type). |

## Population Rules

- The server resolves the label by looking up the captured slug against
  the freshly loaded `caseTypes` for the account in the same chat-route
  invocation that builds the header.
- If the slug is non-null but the case type has been deleted (e.g., the
  admin removed it mid-session), `captured_case_type_label` is `null`.
  Widgets MUST tolerate this: render the slug or fall back to a generic
  "case" word, never throw.
- The label is the *current* label, not a snapshot. (The snapshot lives
  on `SOPStateStep.captured_label` and is only used at lead-capture
  time.) This means an admin renaming "DUI" to "DUI/DWI" mid-session
  causes the next response's header to carry the new label — acceptable
  per the spec's mid-session rename edge case.

## Wire Format

The header continues to be a single line of compact JSON. Example after
the visitor taps the DUI chip:

```json
{
  "total_steps": 6,
  "current_progress": 1,
  "is_finalized": false,
  "qualified_lead_threshold": 6,
  "pending_step_slug": "sub_type",
  "captured_case_type_slug": "dui",
  "captured_case_type_label": "DUI"
}
```

Example after the visitor picks a case type whose `sub_types` is empty
(auto-skip path):

```json
{
  "total_steps": 6,
  "current_progress": 2,
  "is_finalized": false,
  "qualified_lead_threshold": 6,
  "pending_step_slug": "where",
  "captured_case_type_slug": "estate_planning",
  "captured_case_type_label": "Estate Planning"
}
```

`current_progress` is `2` because both Step 1 (case_type, complete) and
Step 2 (sub_type, skipped with `counts_toward_threshold: true`) now
contribute. The pending step has advanced to `where`.

## Backward Compatibility

- The header parser on the widget MUST accept payloads missing the new
  field (older API responses replayed from logs, or rolled-back
  servers). When absent, treat as `null`.
- Older widgets that don't read the field continue to work; the question
  text rendering simply remains LLM-stream-driven.

## Validation

The header payload is validated by the existing
`sopStateHeaderPayloadSchema` Zod schema in
`packages/shared/src/schemas/sop.ts`. The new field is added as
`.optional().nullable()` and the wire output writes `null` (not omitted)
to keep the JSON shape stable across versions.

## Tests

- Unit test on `buildSOPStateHeader` (in `packages/api/src/app/api/chat/route.ts` or extracted helper) covering:
  - case_type complete + slug resolves → label populated.
  - case_type complete + slug refers to deleted ct → label `null`.
  - case_type pending → label `null`.
- Integration test extending the existing chat-route walk to assert the
  new field is present and matches the seeded label after a chip tap.
