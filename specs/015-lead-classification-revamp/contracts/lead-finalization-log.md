# Contract: Lead Finalization Structured Log

**Path**: `console.info(JSON.stringify({...}))` emitted at the end of
every successful lead finalization (and at the end of every
finalization that triggers FR-010b's `scoring_error` fallback).

**Defined by**: Implicit (no Zod schema for log lines today, but the
shape is documented here and asserted in tests).

**Emitted at**: `packages/api/src/lib/leads.ts` —
`captureLead` (line 71+) immediately after the leads-row INSERT or
UPDATE, AND `updateLeadSOPState` (line 185+) immediately after its
UPDATE.

**Status**: NEW for spec 015 (no existing structured-log surface for
lead capture today; see 015 survey item 11)

## Shape

```jsonc
{
  "event": "lead_classified",
  "ts": "2026-06-06T15:42:18.301Z",
  "account_id": "acct_xxx",
  "lead_id": "lead_xxx",
  "session_id": "sess_xxx",
  "classification": "HOT",
  "lead_score": 87,
  "reasons": [
    "Recent accident",
    "Emergency room treatment",
    "Insurance requested statement",
    "No attorney retained"
  ],
  "case_type_slug": "personal_injury",
  "sub_type_slug": "car_accident",
  "hard_override_fired": null,
  "scoring_path": "rule_based",
  "request_type": "SELF",
  "geographic_qualification": "IN_SERVICE_AREA",
  "sop_version": 3
}
```

## Field Semantics

| Field                       | Type                                                                          | Notes                                                                                  |
|-----------------------------|-------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| `event`                     | string literal `"lead_classified"`                                             | Constant; allows log queries to filter by event type                                    |
| `ts`                        | ISO-8601 string                                                                | Same instant as the leads row's `created_at` (or update time)                           |
| `account_id`                | string                                                                         | Per-account isolation key                                                              |
| `lead_id`                   | string                                                                         | The newly-written or just-updated `leads.id`                                            |
| `session_id`                | string                                                                         | Required by Constitution VI §11.7 (logs queryable by session ID)                       |
| `classification`            | `"HOT"` \| `"WARM"` \| `"COLD"` \| `"SPAM"`                                   | Final value persisted (after any hard-override downgrade)                              |
| `lead_score`                | integer in `[0, 100]` \| `null`                                                | NULL when scoring path is not `rule_based`                                              |
| `reasons`                   | array of strings                                                               | NEVER PII; only chip labels and rule names; empty array is allowed                     |
| `case_type_slug`            | string \| `null`                                                               | Captured case_type's slug, or null if visitor abandoned before that step                |
| `sub_type_slug`             | string \| `null`                                                               | Same                                                                                    |
| `hard_override_fired`       | `"missing_contact"` \| `"out_of_scope"` \| `"no_injury_no_treatment"` \| `"fake_info"` \| `null` | Names the rule that downgraded to SPAM (if any)                       |
| `scoring_path`              | `"rule_based"` \| `"llm_fallback"` \| `"partial_lead_heuristic"` \| `"scoring_error"` | Which producer path emitted the classification (per `lead-classification-enum.md`)    |
| `request_type`              | `"SELF"` \| `"FRIEND_FAMILY"` \| `null`                                        | NULL on legacy / non-rule-based paths where the metadata wasn't captured                |
| `geographic_qualification`  | `"IN_SERVICE_AREA"` \| `"OUTSIDE_SERVICE_AREA"` \| `null`                      | NULL on paths where the metadata wasn't captured                                        |
| `sop_version`               | integer \| `null`                                                              | The published SOP version that drove this finalization                                  |

## PII Exclusion (Constitution V — non-negotiable)

The log entry MUST NOT contain:

- `name`, `contact_email`, `contact_phone` (or any substring thereof).
- The matched value of any `fake_info` heuristic hit (e.g., the
  literal string `"test@test.com"`).
- The `geographic_qualification_details_json` city/state values
  (visitor-supplied free-text PII).
- Any chip's `captured_value` for steps that capture free-text or
  contact-form-derived data.

The `reasons` array contains chip *labels* (visitor-facing chip
text — public, configured by admins, never PII) and hard-override
*rule names* (constants like `"fake_info"`). Both are PII-free by
construction.

## Error variant

When the scorer fails (FR-010b path), the log entry has these field
overrides:

```jsonc
{
  "event": "lead_classified",
  "classification": "SPAM",
  "lead_score": null,
  "reasons": ["scoring_error"],
  "scoring_path": "scoring_error",
  "hard_override_fired": null,
  "_error": "scoreLead threw: <error.name>: <error.message>",
  ...
}
```

The `_error` field is the only field permitted to leak structured
error detail. It MUST be derived from `Error.name` and
`Error.message` only — never `Error.stack` (which can contain code
paths) and never any captured chip values that would re-leak PII.

This error variant is logged at `console.error` level (not
`console.info`) so existing log routers can prioritise it. The non-
error variant logs at `console.info`.

## Test Assertions

Per Constitution III, integration tests for `captureLead` /
`updateLeadSOPState` MUST assert:

1. The exact JSON shape is emitted (use `vi.spyOn(console, 'info')`
   or `console.error` for the error variant).
2. The PII fields enumerated above are NOT present, even when the
   matched lead has a `name`, `contact_email`, etc.
3. The `event` field is exactly `"lead_classified"`.
4. The `scoring_path` field reflects the actual producer:
   `rule_based` for car_accident in MVP,
   `llm_fallback` for unconfigured sub_types,
   `partial_lead_heuristic` for abandoned sessions,
   `scoring_error` only when the scorer threw.

## Future evolution

A logger abstraction is out of scope for MVP. When the codebase
introduces one (post-MVP), this contract continues to apply — the
shape stays stable; only the emission surface changes from
`console.info` to whatever logger gets adopted.

The `_error` variant is permitted to grow new structured fields
(e.g., `_error_code`) but MUST remain free of PII and stack traces.
