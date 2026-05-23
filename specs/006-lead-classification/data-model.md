# Data Model: Lead Classification

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

Lead Classification writes two persistent entities (`leads`,
`notifications`) defined by `001-foundation`'s `001-foundation/data-model.md`.
This feature owns the **write semantics** for those tables (when
to insert, when to upsert, when to wrap in a transaction). It
also defines two ephemeral structured types: the `captureLead`
tool input/output and the partial-lead heuristic output.

## Persistent Entities (write)

### Lead (`leads` table)

The §2.6 schema is reproduced in `001-foundation/data-model.md`.
This feature's write semantics:

| Operation | Trigger | Behavior |
|---|---|---|
| INSERT | First `captureLead` for a session | New row with `id = nanoid()`, all fields populated from tool params |
| UPDATE (upsert) | Subsequent `captureLead` calls within same session (R3) | UPDATE existing row; `id` stays stable; `created_at` unchanged |
| INSERT | `savePartialLead` for a session that has no existing lead | New row; only `name`, `contact_email`, `contact_phone`, `brief_description`, `classification`, `classification_rationale` populated; `case_type`, `incident_date` are null; `urgency_factors_json: '[]'` |
| (skipped) | `savePartialLead` for a session that already has a lead | No-op (heuristic defers to LLM-driven capture) |
| (skipped) | `savePartialLead` with no useful data extracted | No-op (Assumption: don't persist empty rows) |

**Schema invariants enforced at write time**:

| Field | Invariant | Source |
|---|---|---|
| `classification` | one of `'urgent'` / `'normal'` / `'unqualified'` | FR-009; Zod enum on tool param + DB constraint via Drizzle enum |
| `classification_rationale` | non-empty trimmed string for LLM-driven path | FR-010, R4 |
| `urgency_factors_json` | valid JSON-serialized string array | R3 / R5 |
| `status` | defaults to `'new'`; never set otherwise by this feature | §2.6 |
| `account_id` | references existing `accounts.id` | §2.6 FK |
| `session_id` | references existing `sessions.id`; UNIQUE INDEX added by R8 | §2.6 FK + R8 |
| `created_at` | ISO 8601 UTC; set on INSERT only | §2.6 |

### Notification (`notifications` table)

This feature writes ONE notification type: `'urgent_lead'`. Phase
6's notifications drawer reads them.

| Operation | Trigger | Behavior |
|---|---|---|
| INSERT | `captureLead` with `classification: 'urgent'` AND no existing urgent_lead notification for this `session_id` (R3) | New row in same transaction as the lead INSERT/UPDATE (R2) |
| (skipped) | `captureLead` with `classification: 'urgent'` AND an urgent_lead notification already exists for this `session_id` | No-op (avoid drawer spam on repeat captureLead calls) |
| (skipped) | All other classifications | No-op |

**Schema invariants enforced at write time**:

| Field | Invariant | Source |
|---|---|---|
| `type` | `'urgent_lead'` exactly | §2.6 + §8.7 |
| `title` | `"New urgent lead: {case_type} from {name}"` (R1) | §8.7 + R1 |
| `body` | `brief_description` text, with fallback wording (R1) | §8.7 + R1 |
| `lead_id` | non-null FK to the just-written lead | §2.6 |
| `read` | defaults to `false` | §2.6 |
| `delivery_channel` | `'dashboard'` (constant for MVP) | §2.6 + §8.7 |
| `delivered_at` | set to insert time (Assumption captured in spec.md) | §2.6 |
| `created_at` | ISO 8601 UTC | §2.6 |

## Transaction Semantics (R2)

Both writes happen inside a single Drizzle transaction:

```ts
await db.transaction(async (tx) => {
  // 1. UPSERT the lead
  await tx.insert(leads).values({ ... }).onConflictDoUpdate({ ... });

  // 2. If urgent AND no existing urgent_lead notification for this session,
  //    INSERT the notification
  if (classification === 'urgent') {
    const existing = await tx.select(...)...;
    if (!existing) {
      await tx.insert(notifications).values({ ... });
    }
  }
});
```

If either operation throws, both are rolled back. The Foundation
logger emits `lead_capture_failed` on rollback (R5).

## Ephemeral Types

### `CaptureLeadInput` (function param)

```ts
interface CaptureLeadInput {
  accountId: string;
  sessionId: string;
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  caseType: string | null;
  incidentDate: string | null;       // ISO date when present
  briefDescription: string | null;
  classification: 'urgent' | 'normal' | 'unqualified';
  classificationRationale: string;   // non-empty (R4)
  urgencyFactors: string[];
}
```

### `CaptureLeadResult` (function return)

```ts
interface CaptureLeadResult {
  leadId: string;
  classification: 'urgent' | 'normal' | 'unqualified';
  isUpsert: boolean;        // false on first call; true on subsequent
}
```

### `PartialLeadData` (heuristic extractor output)

```ts
interface PartialLeadData {
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  briefDescription: string | null;
}
```

### `PartialLeadClassification` (heuristic classifier output)

```ts
interface PartialLeadClassification {
  classification: 'urgent' | 'normal' | 'unqualified';
  rationale: string;
}
```

## Validation Pipeline

```text
captureLead(input)
  │
  ├─→ validate input.classificationRationale is non-empty  (R4)
  │       │ throws LeadValidationError on failure
  │
  ├─→ validate input.urgencyFactors is array of strings (Drizzle types)
  │
  ├─→ db.transaction()  (R2)
  │       │
  │       ├─→ INSERT or UPSERT into leads (R3 — onConflictDoUpdate by session_id)
  │       │
  │       └─→ if urgent: INSERT into notifications (deduplicated)
  │
  ├─→ logger.event('lead_captured', ...)  (R5)
  │
  └─→ return { leadId, classification, isUpsert }


savePartialLead(accountId, sessionId, partial, messages)
  │
  ├─→ existence check: SELECT lead WHERE session_id = ?
  │       │ if exists, log 'partial_lead_skipped' { reason: 'lead_exists' } and return
  │
  ├─→ usefulness check: any of (email, phone, description) non-null?
  │       │ if no, log 'partial_lead_skipped' { reason: 'no_data' } and return
  │
  ├─→ classifyPartialLead(messages) → { classification, rationale }
  │
  ├─→ INSERT into leads
  │
  └─→ logger.event('partial_lead_saved', ...)  (R5)
```

## State Transitions

### Lead Lifecycle (write side)

```text
[no lead]  ──── captureLead(urgent) ────▶  [lead, urgent, notification]
[no lead]  ──── captureLead(normal) ────▶  [lead, normal]
[no lead]  ──── captureLead(unqualified) ▶  [lead, unqualified]
[no lead]  ──── savePartialLead ────────▶  [partial lead, classification by heuristic]

[lead, *]  ──── captureLead (R3 upsert) ▶  [lead, updated]
                                              │
                                              └─ if classification became urgent AND no
                                                  urgent_lead notification yet → also create one

[lead, *]  ──── savePartialLead ────────▶  no-op (heuristic defers to LLM-captured leads)

[lead, *]  ──── status mutated by Phase 6 dashboard ─▶ [lead, contacted | dismissed]
[lead, *]  ──── deleted by lawyer (Phase 6) ─▶ [archived to archived_data; row cleared]
```

(Status/delete transitions are owned by Phase 6 dashboard but
shown here for context.)

### Notification Lifecycle

```text
[no notification]  ──── urgent lead captured ───▶  [unread urgent_lead]
[unread]           ──── lawyer reads it (Phase 6) ▶  [read]
[unread]           ──── deleted by lawyer (Phase 6) ▶  [removed]
```

(Read/delete are owned by Phase 6.)

## Coordination With Other Features

### Upstream

- `001-foundation`: `leads` and `notifications` schema (§2.6),
  Drizzle DB factory, structured logger, shared types.
- `004-chat-api-agent`: registers `captureLead` as an agent
  tool; calls `extractPartialLeadData` + `classifyPartialLead` +
  `savePartialLead` from the route's `onFinish` handler.

### Downstream

- `007-dashboard` Phase 6: reads `leads` for the Leads page +
  Lead Detail; reads `notifications` for the bell drawer.
  Mutates `leads.status` (Mark as contacted / Dismiss) and
  `notifications.read` (Mark as read).
- `008-hardening` Phase 7: reads aggregated lead metrics for
  cost-monitoring dashboard (token-usage rows are joined on
  `session_id` to identify lead-producing conversations).
- `009-deployment-release`: production migration runs the unique-
  index addition (R8) idempotently via `pnpm db:migrate`.

## Schema Migration (R8)

Add a unique index on `leads.session_id`:

```sql
CREATE UNIQUE INDEX "leads_session_id_unique" ON "leads" ("session_id");
```

Migration file generated by `drizzle-kit` after the schema edit.
Foundation's `pnpm db:migrate` applies it idempotently.

