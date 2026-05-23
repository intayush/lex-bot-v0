# Contract: captureLead Integration

**Owner**: SOP Workflow (`010-sop-workflow`)
**Extends**: `006-lead-classification` `lead-classification-tool-contract.md`.
**Source of Truth**: spec.md FR-057, FR-059; Phase 5 implementation in
`packages/api/src/lib/leads.ts` and the tool registration in
`packages/api/src/app/api/chat/route.ts`.

> **Contract correction (2026-05-23)**: An earlier version of this document
> invented field names (`contact_name`, `case_summary`,
> `qualifying_answers_json`) and a different classification enum
> (`hot|warm|cold|out_of_scope`) that did NOT match the Phase 5
> implementation. This document now matches the real shape.

## Real Phase 5 Surface

### Tool parameter schema (`packages/api/src/app/api/chat/route.ts` lines 115-127)

```ts
const captureLeadParamsSchema = z.object({
  name: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  caseType: z.string().nullable(),
  incidentDate: z.string().nullable(),         // ISO date string when known
  briefDescription: z.string(),                // One-sentence summary, REQUIRED
  classification: z.enum(['urgent', 'normal', 'unqualified']),
  classificationRationale: z.string(),
  urgencyFactors: z.array(z.string()),
});
```

### Backing function input (`packages/api/src/lib/leads.ts → captureLead`)

```ts
interface CaptureLeadInput {
  accountId: string;
  sessionId: string;
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  caseType: string | null;
  incidentDate: string | null;
  briefDescription: string | null;
  classification: 'urgent' | 'normal' | 'unqualified';
  classificationRationale: string;
  urgencyFactors: string[];
}
```

### Persisted shape (`leads` table)

```ts
{
  id, account_id, session_id,
  name, contact_email, contact_phone,            // snake_case columns
  case_type, incident_date, brief_description,
  classification, classification_rationale,
  urgency_factors_json,                          // JSON-stringified array
  status,                                        // default 'new'
  created_at,
  // ADDED by 010-sop-workflow Phase 2B:
  sop_state_snapshot,                            // nullable JSON-stringified SOPState
}
```

The function ALSO inserts a `notifications` row when classification === `'urgent'`.

## SOP Extension

The 010-sop-workflow extension adds a single new optional parameter to the
tool schema — `sopState` — and pipes it through to a new
`leads.sop_state_snapshot` column. **No existing parameters change**; no
existing classification values change. SOP feeds the existing fields
naturally.

### Updated tool parameter schema (additive)

```ts
const captureLeadParamsSchema = z.object({
  // Existing Phase 5 fields (unchanged):
  name: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  caseType: z.string().nullable(),
  incidentDate: z.string().nullable(),
  briefDescription: z.string(),
  classification: z.enum(['urgent', 'normal', 'unqualified']),
  classificationRationale: z.string(),
  urgencyFactors: z.array(z.string()),

  // NEW for 010-sop-workflow (optional):
  sopState: sopStateSchema.nullable().optional(),
});
```

### Updated `captureLead` function signature (additive)

```ts
interface CaptureLeadInput {
  // ...all existing fields unchanged...
  sopState?: SOPState | null;
}
```

The function persists `sopState` as JSON to the `leads.sop_state_snapshot`
column when present, null otherwise.

## Field Mapping: SOP captures → Phase 5 captureLead params

The agent fills the existing tool parameters from SOP-captured values. The
mapping is mechanical:

| Existing param | SOP source |
|---|---|
| `caseType` | The chip label OR free-text answer captured at the `case_type` SOP step (e.g. "DUI", "Personal Injury"). The agent may include the sub_type via formatting (e.g. "DUI — First Offense") if it improves dashboard readability. |
| `incidentDate` | The ISO date computed from the `when` SOP step by the date inferer (R3). When the inferer returned low confidence, this is null. |
| `briefDescription` | A one-sentence synthesis of the `where` + `what` SOP captures (free-text combined with the case-type/sub-type for context). The agent writes this naturally — it is the existing one-sentence summary param. |
| `name`, `contactEmail`, `contactPhone` | Captured per Phase 5's `partial-lead.ts` extractor on the running conversation transcript, OR populated from any custom SOP step that asks for them. SOP does NOT replace partial-lead extraction; the two run in parallel. |
| `classification` | Determined by Phase 5's existing rubric (`urgent | normal | unqualified`). SOP supplies factual capture data; classification is still the agent's judgment per the Phase 5 system-prompt rules. |
| `classificationRationale` | Phase 5 rubric, unchanged. |
| `urgencyFactors` | Phase 5 rubric, unchanged. |
| **NEW** `sopState` | The full `SOPState` snapshot from `sessions.sop_state_json` at the moment of capture. |

The agent's system-prompt SOP block (per
`system-prompt-extension-contract.md`) instructs the LLM to populate
existing params from SOP captures — there is no new agent-facing
behavior beyond passing `sopState` through.

## Trigger Points

`captureLead` is invoked by the agent at any of these SOP transitions
(unchanged from Phase 5 — SOP merely supplies context, not new triggers):

| Trigger | SOP State at invocation | Phase 5 classification rubric likely produces |
|---|---|---|
| Step 6 `analyzeAndFollowUp` returns `mode='finalize'` | `is_finalized=true`, all required steps `complete` | `normal` (or `urgent` if urgency factors present) |
| Visitor selects out-of-scope chip on Step 1 | `is_finalized=true`, `out_of_scope_termination=true`, only `case_type` step has captured value | `unqualified` |
| `current_progress >= qualified_lead_threshold` AND visitor signals goodbye | `is_finalized=true`, threshold met | `normal` (or `urgent`) |
| Phase 5 escalation trigger fires mid-SOP | `is_finalized=false`, partial captures, escalation BEFORE finalize | `urgent` (per Phase 5 escalation contract) |
| Visitor explicitly disengages mid-flow | `is_finalized=false`, partial captures | `unqualified` (or `normal` if enough info) |

Note: classification enum reuses Phase 5 values (`urgent | normal |
unqualified`). The earlier draft of this contract proposed
`hot|warm|cold|out_of_scope`; that was wrong and is rejected.

## Persistence

`packages/api/src/lib/leads.ts → captureLead` execute body is extended with
a single optional path:

```ts
await db.insert(leads).values({
  id: leadId,
  account_id: input.accountId,
  session_id: input.sessionId,
  name: input.name,
  contact_email: input.contactEmail,
  contact_phone: input.contactPhone,
  case_type: input.caseType,
  incident_date: input.incidentDate,
  brief_description: input.briefDescription,
  classification: input.classification,
  classification_rationale: input.classificationRationale,
  urgency_factors_json: JSON.stringify(input.urgencyFactors),

  // NEW:
  sop_state_snapshot: input.sopState ? JSON.stringify(input.sopState) : null,

  status: 'new',
  created_at: now,
});
```

The column was added by 010-sop-workflow Phase 2B (commit `2079ecf`).

## Out-of-Scope Termination Path

Special case: when the visitor selects an out-of-scope chip on Step 1, the
SOP runtime:

1. Sets `state.is_finalized=true` and `state.out_of_scope_termination=true`.
2. Instructs the agent (via system-prompt block) to use the configured
   out-of-scope deflection message from the existing
   `practice_areas.out_of_scope_response` field.
3. Auto-invokes `captureLead` with `classification='unqualified'`,
   `caseType=<the out-of-scope case type's label>`,
   `briefDescription='Out-of-scope: <case type label>'`, and the partial
   `sopState` (only Step 1 captured).
4. Agent continues answering further questions if the visitor stays
   engaged (per FR-022).

## Logging

Existing Phase 5 `lead_captured` event payload is extended with two new
fields:

```ts
{
  // existing fields...
  classification: 'urgent' | 'normal' | 'unqualified',
  case_type: string | null,
  // NEW:
  sop_finalization_reason:
    | 'step_6_finalize'
    | 'threshold_met'
    | 'out_of_scope_termination'
    | 'mid_flow_disengage'
    | 'phase5_escalation'
    | null,
  sop_state_present: boolean,        // true if sopState was non-null
}
```

Foundation logger redaction list is extended for `sop_state_snapshot`
content (per Constitution V): emails, phone numbers, name patterns
matching `\b[A-Z][a-z]+\s+[A-Z][a-z]+\b` are stripped from logged
captured-value summaries. The persisted JSON column is NOT redacted —
it is the system of record for lawyer review.

## Tests

`packages/api/src/lib/leads.test.ts` (extends Phase 5 tests) MUST cover:

- `captureLead` with `sopState=null` (legacy backward compat) → row
  inserted with `sop_state_snapshot=null`.
- `captureLead` with `sopState=undefined` (parameter omitted entirely) →
  row inserted with `sop_state_snapshot=null`.
- `captureLead` with `sopState` populated → row inserted with
  JSON-serialized snapshot; roundtrip read back parses Zod-valid against
  `sopStateSchema`.
- `out_of_scope_termination=true` flag in the snapshot is preserved
  through the roundtrip.

Phase 5's existing 9 captureLead tests continue to pass without
modification (backward-compat verified). The new parameter is fully
optional.

## Constitution Compliance

- **II (Type Safety)**: new `sopState` parameter Zod-validated against
  `sopStateSchema`; persisted JSON re-parsed and validated on dashboard
  read.
- **V (Privacy)**: `sop_state_snapshot` persisted on the existing
  account-scoped `leads` row; logger redaction list extended.
- **VII (Phased Delivery)**: schema column added by Phase 2B
  drizzle-kit migration. Backward-compatible: `sopState` is optional, so
  any existing call site that doesn't pass it continues to work.
