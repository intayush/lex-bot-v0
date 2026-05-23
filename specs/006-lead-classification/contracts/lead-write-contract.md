# Contract: `leads` Table Write

**Owner**: Lead Classification (`006-lead-classification`)
**Source of Truth**: §2.6 schema, §7.4 (LLM path), §7.10
(heuristic path), §12.10.

## Table

`leads` — schema defined by `001-foundation` per §2.6.

This contract specifies the **write semantics** for this table.
Two write paths exist:

1. LLM-driven (`captureLead` function).
2. Heuristic-driven (`savePartialLead` function).

## LLM-Driven Path (UPSERT)

### Trigger

The agent calls the `captureLead` tool. The route handler in
`004-chat-api-agent` invokes
`captureLead({ accountId, sessionId, ...params })`.

### Behavior

UPSERT keyed by `session_id` (R3):

```ts
await tx.insert(leads).values({
  id: nanoid(),
  account_id: accountId,
  session_id: sessionId,
  name, contact_email, contact_phone,
  case_type, incident_date, brief_description,
  classification, classification_rationale,
  urgency_factors_json: JSON.stringify(urgencyFactors),
  status: 'new',
  created_at: new Date().toISOString(),
}).onConflictDoUpdate({
  target: leads.session_id,
  set: {
    name, contact_email, contact_phone,
    case_type, incident_date, brief_description,
    classification, classification_rationale,
    urgency_factors_json: JSON.stringify(urgencyFactors),
    // NOTE: id, account_id, status, created_at are NOT updated.
  },
});
```

### Invariants

- `classification` is exactly one of `'urgent'`, `'normal'`,
  `'unqualified'` (FR-009).
- `classification_rationale` is non-empty trimmed string (R4).
- `urgency_factors_json` is a valid JSON-serialized string array.
- `account_id` matches the API key's account (Phase 3
  enforcement).
- `session_id` references an existing `sessions.id` row that
  belongs to `account_id` (Phase 3 enforces account ownership).
- `status` is NEVER mutated by this feature beyond its default
  `'new'`. Phase 6 dashboard is the only writer of `status`.
- `created_at` is set on first insert; preserved on update.

## Heuristic-Driven Path (INSERT only)

### Trigger

After every chat turn, the route handler in
`004-chat-api-agent` calls
`savePartialLead(accountId, sessionId, partial, messages)`.

### Behavior

```ts
// 1. existence check
const existingLead = await tx.select(...).from(leads).where(eq(leads.session_id, sessionId));
if (existingLead) return; // skipped: LLM-driven path already wrote

// 2. usefulness check
const hasData = partial.contactEmail || partial.contactPhone || partial.briefDescription;
if (!hasData) return; // skipped: no useful data

// 3. classify by heuristic
const { classification, rationale } = classifyPartialLead(messages);

// 4. INSERT (no upsert; existence check already prevents duplicates)
await tx.insert(leads).values({
  id: nanoid(),
  account_id: accountId,
  session_id: sessionId,
  name: partial.name,
  contact_email: partial.contactEmail,
  contact_phone: partial.contactPhone,
  case_type: null,
  incident_date: null,
  brief_description: partial.briefDescription,
  classification,
  classification_rationale: rationale,
  urgency_factors_json: '[]',
  status: 'new',
  created_at: new Date().toISOString(),
});
```

### Invariants

- Same as LLM-driven path EXCEPT:
  - `case_type`, `incident_date` are always `null`.
  - `urgency_factors_json` is always `'[]'`.
- The function NEVER overwrites a row written by the LLM-driven
  path (existence check).
- The function NEVER inserts when no useful data was extracted
  (FR-024 + Assumption).

## Schema Migration (R8)

Add a unique index on `leads.session_id`:

```sql
CREATE UNIQUE INDEX "leads_session_id_unique" ON "leads" ("session_id");
```

This enables the upsert pattern AND provides a DB-level guarantee
that there is at most one lead per session.

## Atomicity (R2)

Both writes happen inside a Drizzle transaction. If any step
fails, the transaction rolls back leaving the database
unchanged.

## Logging (R5)

| Event | When |
|---|---|
| `lead_captured` | After successful LLM-driven upsert |
| `partial_lead_saved` | After successful heuristic-driven insert |
| `partial_lead_skipped` | When heuristic path returns without writing |
| `lead_capture_failed` | On caught exception |

All events go through the Foundation logger; payload fields are
redacted per the Foundation log-event contract.

## Tests

Beyond the existing 294 + 429 LOC of tests, add gap-fill tests for:

- Upsert behavior (R3): two `captureLead` calls for same session
  yield single row; second updates fields.
- Atomicity (R2): induced notification failure rolls back lead.
- Rationale validation (R4): empty / whitespace-only rationale
  throws before any DB write.
- Heuristic skip-when-empty (R7): no useful data → no row
  written.

