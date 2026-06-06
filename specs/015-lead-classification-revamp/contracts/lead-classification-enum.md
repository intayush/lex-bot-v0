# Contract: Lead Classification Enum

**Path**: `leads.classification` (TEXT column, NOT NULL)

**Defined by**: `leadClassificationSchema` (UPDATED) in
`packages/shared/src/schemas/leads.ts`

**Read at**: leads dashboard table render, leads detail view, every
lead-list filter, structured log emission.

**Written at**: `captureLead` in `packages/api/src/lib/leads.ts`,
`updateLeadSOPState` in same file, `classifyPartialLead` in
`packages/api/src/lib/partial-lead.ts`, the migration UPDATE in
`drizzle/0003_*.sql`.

**Status**: VALUE-SPACE CHANGE (existing column, existing Zod schema,
new value set)

## Shape

```text
leadClassificationSchema = z.enum(['HOT', 'WARM', 'COLD', 'SPAM'])

type LeadClassification = z.infer<typeof leadClassificationSchema>
```

The DB column type stays `text NOT NULL`. The four-value contract is
enforced by Zod at every boundary read or write.

## Old → New Mapping

| Old value         | New value | Notes                                                                |
|-------------------|-----------|----------------------------------------------------------------------|
| `'urgent'`        | `'HOT'`   | One-shot UPDATE in `0003_*.sql` rewrites every existing row          |
| `'normal'`        | `'WARM'`  | Same                                                                 |
| `'unqualified'`   | `'SPAM'`  | Same                                                                 |
| (no old value)    | `'COLD'`  | Net-new bucket; legacy data has no rows that map to it (FR-031)      |

## Producers

Four code paths produce a lead classification value:

1. **Rule-based scorer** (`scoreLead`) — for leads where the captured
   sub_type has `scoring_config_json IS NOT NULL`. Authoritative
   when applicable.
2. **LLM `captureLead` tool** — for leads where the captured sub_type
   has no scoring config. The tool's parameter Zod schema enforces
   the new enum.
3. **Partial-lead heuristic** (`classifyPartialLead`) — for abandoned
   sessions. The regex-driven branch logic now emits the new enum.
4. **Legacy migration UPDATE** — one-time, runs on `0003_*.sql`
   apply.

The chat-route finalization handler picks the producer:

```text
if (subType.scoring_config_json !== null) {
  classification = scoreLead(...).classification;       // Producer 1
} else if (sopState.is_finalized) {
  classification = llm.captureLead.params.classification; // Producer 2
} else {
  classification = classifyPartialLead(transcript);     // Producer 3
}
```

(Producer 4 only runs at migration time and never at request time.)

## Consumers

Every consumer must accept all four values; any consumer that
hard-codes the old three values is a 015 break.

| Consumer                                                       | Update                                                                       |
|----------------------------------------------------------------|------------------------------------------------------------------------------|
| `packages/api/src/app/dashboard/leads/lead-table.tsx:19-23`    | `classificationStyles` map adds COLD; updates HOT/WARM/SPAM mappings         |
| `packages/api/src/app/dashboard/leads/lead-table.tsx:59-64`    | `filterOptions` adds COLD; renames urgent/normal/unqualified labels          |
| `packages/api/src/app/dashboard/leads/lead-table.tsx:12`       | `Lead.classification` type loses `string \| null` and gains the strict enum  |
| `packages/api/src/lib/leads.ts:104, 143`                       | "urgent transition" notification logic changes to "HOT transition" semantics |
| `packages/api/src/lib/leads.test.ts`                           | All test fixtures use new enum values                                        |
| `packages/api/src/lib/partial-lead.test.ts:391-432`            | Heuristic test cases updated to assert HOT/WARM/COLD/SPAM                    |
| `packages/api/src/lib/system-prompt.ts:138-141`                | Rubric prose rewritten with the four-value vocabulary (see research §R6)    |

## Notification path

The existing `notifications.type = 'urgent_lead'` notification fires
on transitions into the most-urgent classification. Per spec the
notification semantics is preserved:

- Pre-015: notification fires when classification transitions into
  `'urgent'` (from any other value or on first INSERT).
- Post-015: notification fires when classification transitions into
  `'HOT'` (from any non-HOT value or on first INSERT).

The notification `type` string stays `'urgent_lead'` in MVP — renaming
it to `'hot_lead'` would be a wider dashboard / consumer surface
change with no functional benefit; the type is internal. The
**rendered** notification text in the dashboard updates to refer to
"HOT lead" rather than "urgent lead" so lawyers see consistent
vocabulary.

## Migration semantics

The migration UPDATE in `0003_*.sql` runs three statements
unconditionally:

```sql
UPDATE leads SET classification = 'HOT'  WHERE classification = 'urgent';
UPDATE leads SET classification = 'WARM' WHERE classification = 'normal';
UPDATE leads SET classification = 'SPAM' WHERE classification = 'unqualified';
```

Idempotent (zero rows match on second run). No downtime concern (the
UPDATE is fast; the table is small). The legacy rationale and urgency
factors fields are preserved unchanged (FR-032).

## Validation tests required

Per Constitution III the enum change requires:

1. Zod schema unit test asserting old values now fail to parse.
2. Migration test: seed three legacy rows in the test DB, run
   migration, assert all three rows have new values and zero rows
   have any legacy value.
3. `captureLead` integration test asserting the new enum values
   round-trip into `leads.classification` correctly via both
   producer paths.
4. `classifyPartialLead` unit test asserting the heuristic produces
   the new enum values for all branch coverage cases.
5. Dashboard component test (Vitest + Testing Library) asserting all
   four classification badges render with distinct colours.
