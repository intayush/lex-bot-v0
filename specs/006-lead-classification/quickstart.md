# Quickstart: Lead Classification

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the engineer + lawyer experience after the
Lead Classification feature is fully implemented. It validates
the §12.10 done-when checklist.

## Prerequisites

- Foundation, Crawler, Context Search, Chat API + Agent, Chat
  Widget all complete.
- Local dev testbed running (`pnpm dev`).
- The `leads.session_id` unique-index migration (R8) has been
  applied via `pnpm db:migrate`.

## Drive a Qualifying Conversation (per §12.10 deliverable)

Open `http://localhost:5173`, click the chat bubble, and type a
qualifying conversation. Example transcript:

```
You: I was just arrested for DUI last night. My court date is next week.
Bot: I'm sorry to hear that. Can I get your name and phone number?
You: My name is Jane Doe, phone (555) 987-6543.
Bot: Thank you Jane. Have you contacted any attorney yet?
You: No, you're the first.
Bot: I'll have someone reach out to you immediately given the urgency.
```

## Verify the Lead in the Database

```bash
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api exec tsx -e "
  import { db, schema } from './src/db';
  const rows = await db.select().from(schema.leads);
  console.log(JSON.stringify(rows, null, 2));
"
```

Expected (matching §12.10 done-when):

- Exactly one `leads` row for the session.
- `name = 'Jane Doe'`, `contact_phone = '(555) 987-6543'`,
  `case_type = 'DUI'` (or similar), `brief_description` contains
  "arrested" / "DUI".
- `classification = 'urgent'` (FR-009).
- `classification_rationale` non-empty (FR-010, SC-003).
- `urgency_factors_json` is a JSON array containing strings like
  "recent_arrest" / "court_deadline".
- `status = 'new'`.

## Verify the Notification

```bash
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api exec tsx -e "
  import { db, schema } from './src/db';
  const rows = await db.select().from(schema.notifications);
  console.log(JSON.stringify(rows, null, 2));
"
```

Expected:

- One `notifications` row with `type = 'urgent_lead'`.
- `title` matches §8.7 wording: `"New urgent lead: DUI from Jane Doe"`.
- `body` contains the brief description (or fallback wording if
  empty).
- `lead_id` references the lead from the previous query.
- `read = false`, `delivery_channel = 'dashboard'`.

## Verify Upsert Behavior (R3)

Drive a follow-up turn in the SAME session that adds info:

```
You: Actually, I should mention I have a prior DUI conviction.
```

Re-query `leads`. Expect:

- STILL exactly one row (same `id` as before).
- `brief_description` updated with the new context.
- `classification_rationale` updated.

Re-query `notifications`. Expect:

- STILL exactly one notification row (no duplicate created on
  the second urgent capture).

## Verify Empty-Rationale Validation (R4)

This requires a manually crafted tool call (the LLM rarely
produces empty rationales). Test via Vitest:

```bash
pnpm --filter @legal-chatbot/api test leads -- -t "empty rationale"
```

Expected: `LeadValidationError` thrown; no DB write.

## Verify Notification Atomicity (R2)

Vitest test simulates a notification insert failure (e.g.,
poisoned title) and verifies the lead row is rolled back:

```bash
pnpm --filter @legal-chatbot/api test leads -- -t "atomicity"
```

## Verify Partial-Lead Heuristic Path

### Abandoned conversation with extractable data (FR-024)

Drive this conversation but DO NOT let the LLM call `captureLead`
(close the tab quickly):

```
You: Hi I think I have a wage claim. My email is jane@example.com.
```

Wait briefly for the partial-lead path to trigger (it runs in
`onFinish`). Re-query `leads`:

```bash
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api exec tsx -e "
  import { db, schema } from './src/db';
  const rows = await db.select().from(schema.leads);
  console.log(rows);
"
```

Expected:

- One row with `contact_email = 'jane@example.com'`,
  `brief_description` containing "wage claim",
  `classification = 'normal'` (no urgency signals matched),
  `classification_rationale = 'Partial lead describing a legal matter'`,
  `urgency_factors_json = '[]'`,
  `case_type = null`, `incident_date = null`.

### Abandoned conversation with no useful data (R7 / Assumption)

Drive a session of "hi" / "test" / "asdf" and abandon. Re-query
`leads`. Expect: NO row written (the heuristic short-circuits
when no useful data is present).

### Abandoned conversation with urgency signals (R7)

```
You: I was arrested for cocaine possession this morning. Help.
```

Abandon before `captureLead` fires. Re-query `leads`. Expect:

- Row with `classification = 'urgent'` (urgency: "this morning",
  "arrested"; legal: "arrested", "cocaine", "possession").
- `classification_rationale` lists matched urgency phrases.

## Run the Full Test Suite

```bash
pnpm --filter @legal-chatbot/api test leads partial-lead
```

Expected: all tests in `leads.test.ts` (294 LOC + R1–R5
gap-fills) and `partial-lead.test.ts` (429 LOC + R5/R7
gap-fills) pass.

## Verify Schema Migration (R8)

After running `pnpm db:migrate`, inspect the schema:

```bash
DATABASE_URL=$DATABASE_URL pnpm --filter @legal-chatbot/api exec tsx -e "
  import { neon } from '@neondatabase/serverless';
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql\`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'leads' AND indexname LIKE '%session_id%'
  \`;
  console.log(rows);
"
```

Expected: one row with `indexname = 'leads_session_id_unique'`
and an `indexdef` containing `UNIQUE INDEX`.

## Verify Logger Events (R5)

After driving a conversation, inspect the structured-log stream
(stdout in dev; Netlify log stream in production):

```bash
# Filter for lead events
pnpm dev 2>&1 | grep -E '"event":"(lead_captured|notification_created|partial_lead_)'
```

Expected events with redacted payloads:

- `lead_captured`: `{ leadId, classification, isUpsert }` plus
  context `{ session_id, account_id }`.
- `notification_created`: `{ notificationId, leadId, accountId }`.
- `partial_lead_saved`: `{ leadId, classification, signalsMatched: ['urgency:arrested', ...] }`.
- `partial_lead_skipped`: `{ sessionId, reason: 'no_data' | 'lead_exists' }`.

No log payload contains user message text or matched substrings.

## Done-When (§12.10) Verification Map

| §12.10 done-when | Verification step |
|---|---|
| After 5+ messages in a qualifying conversation, a lead record is created | "Drive a Qualifying Conversation" + "Verify the Lead in the Database" |
| Lead has: name, contact, case type, classification (urgent/normal/unqualified) | DB query above shows all four populated |
| Classification rationale is stored and readable | `classification_rationale` field is non-empty (R4 enforces) |
| Partial conversations still save partial data (abandoned sessions) | Heuristic-path "Abandoned conversation with extractable data" |
| Unqualified leads (out-of-scope questions) are correctly classified | Drive a tax-law question through the seeded criminal-defense firm; expect `classification = 'unqualified'` (LLM-driven) or heuristic `unqualified` |
| Unit tests pass for: intake tracking, classification logic, DB writes | `pnpm --filter @legal-chatbot/api test leads partial-lead` |

## Out of Scope for This Quickstart

- Lead UI in the dashboard (Leads page, Lead Detail) — Phase 6
  (`007-dashboard`).
- Notifications drawer UI — Phase 6 (`007-dashboard` §8.7).
- Cost monitoring / lead-volume analytics — Phase 7
  (`008-hardening`).
- Production deploy — Phase 8 (`009-deployment-release`).

