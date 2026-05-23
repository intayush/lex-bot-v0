# Contract: captureLead Integration

**Owner**: SOP Workflow (`010-sop-workflow`)
**Extends**: `006-lead-classification` `lead-classification-tool-contract.md`.
**Source of Truth**: spec.md FR-057, FR-059.

## Purpose

When the SOP runtime determines a lead is ready to finalize (Step 6 finalize OR out-of-scope termination OR threshold reached), the agent invokes the existing `captureLead` tool from Phase 5. This contract defines:

1. How SOP-captured values flow into the existing `captureLead` parameters.
2. The new `sop_state` parameter added to `captureLead`'s schema.
3. How `leads.sop_state_snapshot` is persisted.

## Updated `captureLead` Tool Schema

The Phase 5 tool's parameter schema is extended with one new optional field:

```ts
const captureLeadParamsSchema = z.object({
  // Existing fields from 006-lead-classification (unchanged):
  contact_name: z.string().nullable(),
  contact_email: z.string().email().nullable(),
  contact_phone: z.string().nullable(),
  case_summary: z.string(),
  classification: z.enum(['hot', 'warm', 'cold', 'out_of_scope']),
  classification_rationale: z.string(),
  qualifying_answers: z.record(z.string(), z.string()).nullable(),  // Legacy; preserved for backward compat

  // NEW field:
  sop_state: sopStateSchema.nullable(),
});
```

The `sop_state` field is optional (nullable) for backward compatibility with accounts that have not yet migrated to SOP. When present, `lib/leads.ts → captureLead`'s execute body persists it to `leads.sop_state_snapshot`.

## Trigger Points

`captureLead` is invoked by the agent at any of these SOP transitions:

| Trigger | SOP State at invocation | Classification hint |
|---|---|---|
| Step 6 `analyzeAndFollowUp` returns `mode='finalize'` | `is_finalized=true`, all required steps `complete` | `hot` or `warm` per LLM judgment |
| Visitor selects out-of-scope chip on Step 1 | `is_finalized=true`, `out_of_scope_termination=true`, only `case_type` step has captured value | `out_of_scope` |
| `current_progress >= qualified_lead_threshold` AND visitor signals goodbye | `is_finalized=true`, threshold met | `hot` or `warm` per LLM judgment |
| Visitor explicitly disengages mid-flow | `is_finalized=false`, partial captures | `cold` |

The agent decides which classification per Phase 5's existing rubric; the SOP state provides factual capture data, not the classification verdict.

## Field Mapping

The agent populates `captureLead` parameters from SOP state using these conventions:

| `captureLead` field | Sourced from | Notes |
|---|---|---|
| `contact_name`, `contact_email`, `contact_phone` | Free-text answers in any SOP step matching email/phone/name patterns | Phase 5 partial-lead capture (per `006-lead-classification`) handles ongoing extraction; final state collected here |
| `case_summary` | Concatenation of `case_type`, `sub_type`, `where`, `what`, `when` captured values + Step 6 follow-up answers | Plain-language synthesis by the LLM |
| `qualifying_answers` | Map of step slug → captured value, restricted to `is_required=true` steps | Preserved for legacy dashboard views |
| `sop_state` | Full `SOPState` object from `sessions.sop_state_json` | Snapshot at time of capture |

The agent's system prompt (per `system-prompt-extension-contract.md`) instructs the LLM to populate these fields naturally based on the conversation transcript.

## Persistence

`packages/api/src/lib/leads.ts → captureLead` execute body is extended:

```ts
// Existing insert into leads table is extended with sop_state_snapshot:
await db.insert(leads).values({
  id,
  account_id: ctx.accountId,
  session_id: ctx.sessionId,
  contact_name,
  contact_email,
  contact_phone,
  case_summary,
  classification,
  classification_rationale,
  qualifying_answers_json: qualifying_answers ? JSON.stringify(qualifying_answers) : null,

  // NEW:
  sop_state_snapshot: sop_state ? JSON.stringify(sop_state) : null,

  created_at: new Date().toISOString(),
});
```

The column was added via this feature's schema migration (per `data-model.md` → "Column Additions" → `leads.sop_state_snapshot`).

## Out-of-Scope Termination Path

Special case: when the visitor selects an out-of-scope chip on Step 1, the SOP runtime:

1. Sets `state.is_finalized=true` and `state.out_of_scope_termination=true`.
2. Instructs the agent (via system-prompt block) to use the configured out-of-scope deflection message.
3. Auto-invokes `captureLead` with `classification='out_of_scope'`, `case_summary='Out-of-scope: <case_type label>'`, and the partial `sop_state` (only Step 1 captured).
4. Agent continues answering further questions if visitor stays engaged (per FR-022).

This is the same flow as Phase 5's `out_of_scope` classification; SOP termination merely supplies the trigger.

## Logging

Existing Phase 5 `lead_captured` event payload is extended with `sop_finalization_reason: 'step_6_finalize' | 'threshold_met' | 'out_of_scope_termination' | 'mid_flow_disengage' | null`.

## Tests

`packages/api/src/lib/leads.test.ts` (extends Phase 5 tests) MUST cover:

- `captureLead` with `sop_state=null` (legacy backward compat) → row inserted with `sop_state_snapshot=null`.
- `captureLead` with `sop_state` populated → row inserted with JSON-serialized snapshot.
- Schema-migration roundtrip: insert lead with snapshot, read back, parse JSON, verify Zod validates against `sopStateSchema`.
- `out_of_scope_termination=true` flag in snapshot is preserved.

Phase 5's existing test suite continues to pass without modification (backward-compat verified).

## Constitution Compliance

- Constitution II: new `sop_state` parameter Zod-validated; persisted JSON re-parsed and Zod-validated on dashboard read.
- Constitution V: `sop_state_snapshot` persisted on the existing account-scoped `leads` row; logger redaction list extended (Foundation `logger.ts`) to redact captured-value content matching email/phone/name patterns from `lead_captured` event payloads.
- Constitution VII: schema addition coordinated via Foundation `drizzle-kit` migration tooling; one-shot migration is idempotent.

