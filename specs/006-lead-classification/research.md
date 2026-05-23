# Phase 0 Research: Lead Classification

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the Lead
Classification feature against `product-spec-legal-chatbot.md`
(§2.6, §2.8, §7.1, §7.4, §7.10, §8.7, §11.5, §12.10) and the
Lex Bot Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers; items below are the
gap-fill plan for R1–R7.

## R1. Notification Title/Body Wording

**Decision**: Update the notification body template in
`packages/api/src/lib/leads.ts` to match §8.7's binding wording:

```
title: "New urgent lead: {case_type} from {name}"
body:  "<the brief description, truncated if very long>"
```

When `case_type` is null, substitute "Unknown matter". When
`name` is null, substitute "Anonymous". When `brief_description`
is null, body falls back to "An urgent lead requires your attention."

**Rationale**:
- §8.7 explicitly: "MVP: only urgent lead notifications ('New
  urgent lead: [case type] from [name]')". This is the binding
  format the dashboard's notifications drawer shows.
- The current implementation uses `New Urgent Lead: {case_type}`
  with title-case "New Urgent Lead" — minor but visible
  divergence from the spec's wording.
- Putting the brief description in the body (rather than
  repeating the title) gives the lawyer actionable preview text
  in the drawer.

**Alternatives considered**:
- Configurable templates via dashboard: post-MVP. Out of scope.
- Localization: post-MVP per §10.

**Implementation notes**:
- Substitution helper `formatNotificationTitle({ case_type, name })`
  is a pure function — easy to unit-test.
- Update the existing test in `leads.test.ts` to assert the new
  wording.

## R2. Lead + Notification Atomicity

**Decision**: Wrap the lead insert and notification insert in a
single Drizzle `db.transaction(async (tx) => { … })` block. If
either insert fails, both are rolled back. The Drizzle Postgres
transaction API (`drizzle-orm/neon-http` and
`drizzle-orm/better-sqlite3`) supports this directly.

**Rationale**:
- §7.4 mechanism steps 3 and 4 are sequential
  ("Write lead record"; "Create notification if urgent"). The
  spec doesn't enumerate transactional behavior, but Spec edge
  case explicitly notes:
  > "Lead written but notification creation fails: §7.4 mechanism
  > steps 3 and 4 are sequential (...). The spec does not
  > enumerate transactional behavior. Captured in Assumptions."
  Spec Assumption (data-model.md): "Notification atomicity with
  lead write: ... A reasonable default is to write both in a
  single database transaction so a partial failure does not
  leave an `urgent` lead without its notification (or vice
  versa)."
- Constitution Principle V (Privilege & Privacy) implicitly
  rewards atomicity — orphaned data is a forensic mess.

**Alternatives considered**:
- Two separate calls with manual rollback on the second failure:
  rejected. Manual cleanup is error-prone; Drizzle gives us
  transactions for free.
- Eventually-consistent: rejected. The notifications drawer is
  the only urgent-lead alert channel; if it's missing the
  lawyer doesn't know an urgent lead arrived.

**Implementation notes**:
- The Neon HTTP driver supports `db.transaction()` — confirm
  before relying.
- Tests cover: notification failure rolls back lead; lead
  failure never inserts notification.
- The transaction is short (two inserts) and within Netlify
  Function timeout.

## R3. Upsert-by-Session Policy on Repeat captureLead Calls

**Decision**: Change `captureLead`'s default behavior to
**upsert-by-session-id**: if a lead row already exists for the
given `session_id`, UPDATE it instead of INSERT. The notification
side has separate logic — the FIRST `captureLead` call that
yields `urgent` creates the notification; subsequent
`urgent`-classification re-calls update the lead row but do NOT
create a new notification (avoids drawer spam).

**Rationale**:
- Spec Assumption: "Update-vs-insert on repeat `captureLead`
  calls within the same session: §7.4 does not enumerate
  uniqueness/idempotency. A reasonable default is upsert-by-
  session-id: the most recent `captureLead` call updates the
  existing lead row for that session rather than creating
  duplicates. This is consistent with 'as soon as the legal
  issue is clear' (§7.4) — the tool may be called multiple
  times as the picture sharpens."
- §11.5 GDPR-style "data minimization" principle: don't store
  duplicate copies of the same lead.
- The dashboard's Leads page (Phase 6) shows one row per
  session by default — duplicates would clutter.

**Alternatives considered**:
- Always insert (current behavior): rejected per Assumption.
- Reject the second call (return existing lead): viable but
  loses the LLM's improved understanding (e.g., contact info
  added on second call).

**Implementation notes**:
- Use Drizzle's `onConflictDoUpdate({ target: leads.session_id, set: { … } })`
  pattern. Requires a unique index on `leads.session_id`.
- Schema implication: add a unique index on
  `leads.session_id` (one lead per session). This matches the
  upsert semantics.
- Migration: produce via `pnpm --filter @legal-chatbot/api db:generate`
  after editing `schema.ts` to add the unique index.
- Notification logic: BEFORE the upsert, check if a `urgent_lead`
  notification already exists for this `(account_id, session_id)`
  pair via `lead_id`. If so, do not create a duplicate.
- Tests cover: first call inserts; second call updates same
  row (asserted via `id` stability); urgent classification on
  second call does NOT create a duplicate notification.

## R4. classification_rationale Non-Empty Validation

**Decision**: Add a runtime check at the entry of `captureLead`:
if `classificationRationale.trim().length === 0`, throw a
typed `LeadValidationError`. The Phase 3 tool wiring will catch
this and produce a structured error log (per Foundation
log-event contract); the LLM's tool-call result is `{ error: 'invalid_lead', message: 'classification_rationale must be non-empty' }`
so the agent can self-correct on the next step (within the
`maxSteps: 5` budget).

**Rationale**:
- §12.10 done-when: "Classification rationale is stored and
  readable." FR-010, SC-003.
- A non-empty rationale is the audit trail for the
  classification — without it, the dashboard's lead-detail view
  shows blank where the rationale should be, breaking §8.6 and
  the lawyer's ability to evaluate the LLM's reasoning.

**Alternatives considered**:
- Trust the LLM: rejected. LLMs occasionally produce empty
  fields when temperatures are high or system-prompt guidance
  is weak.
- Default to "(no rationale provided)": rejected. Silently
  defaulting masks the model failure; surfacing it as a
  validation error gives the agent a chance to retry with
  better params.

**Implementation notes**:
- Validation happens at the very start of `captureLead`'s
  execute body, before any DB calls.
- A Zod `.refine()` could enforce this at the tool-param level
  (Phase 3); doing it in `captureLead` itself keeps the
  contract enforceable regardless of caller.
- Tests: empty string, whitespace-only string, valid string.

## R5. Foundation Logger Integration

**Decision**: Replace any `console.log` / `console.error` in
`leads.ts` and `partial-lead.ts` with the Foundation logger.
Emit standardized events:

| Event | When | Payload |
|---|---|---|
| `lead_captured` | Successful `captureLead` insert/upsert | `{ leadId, classification, isUpsert: boolean }` |
| `notification_created` | Urgent lead creates a notification | `{ notificationId, leadId, accountId }` |
| `partial_lead_saved` | Heuristic path saves a partial | `{ leadId, classification, signalsMatched: string[] }` |
| `partial_lead_skipped` | Heuristic path declined to save (no useful data) | `{ sessionId, reason: 'no_data' \| 'lead_exists' }` |
| `error` | Any caught exception | `{ where, errorType, errorMessage }` |

**Rationale**:
- Constitution Principle V binds redaction-aware logging.
  `console.error` produces unstructured text and bypasses the
  Foundation logger's redaction list.
- Constitution Principle VI binds observability: every lead
  outcome should be queryable from the structured log stream
  for Phase 7's cost monitoring and conversation-quality
  analytics.
- The `lead_captured` event is reserved in Foundation's
  log-event-contract.md (the Foundation pre-allocated this name
  for downstream features).

**Alternatives considered**:
- Continue with no logging: rejected. Constitution V/VI binding.
- Log to a separate "audit" table in the DB: post-MVP. The
  structured-JSON log stream is sufficient for MVP per §11.7.

**Implementation notes**:
- Import `import { logger } from '@legal-chatbot/shared';`.
- Each event includes `session_id` and `account_id` in the
  context (top-level fields per Foundation contract).
- The `signalsMatched` field on `partial_lead_saved` lists the
  matched regex pattern names from `partial-lead.ts` (NOT the
  matched substrings — those could contain PII).

## R6. Cross-Feature Ownership Boundary (Documentation)

**Decision**: Document explicitly what this feature owns vs.
what `004-chat-api-agent` owns:

**Lead Classification owns**:
- `packages/api/src/lib/leads.ts` (the `captureLead` function).
- `packages/api/src/lib/partial-lead.ts` (heuristic extraction
  + classification + persistence).
- The `leads` and `notifications` table writes.
- The §7.4 tool's parameter Zod schema (defined here, imported
  by Phase 3).
- Tests for both files.

**`004-chat-api-agent` (Phase 3) owns**:
- The agent runtime that registers `captureLead` as a tool in
  the Vercel AI SDK `tools` map.
- The system prompt's classification guidance text (§7.4
  outcomes table baked into the prompt).
- The route handler's `onFinish` callback that triggers the
  partial-lead heuristic path.

**No code overlap**: Phase 3's route handler imports the
functions exported by this feature (`captureLead`,
`extractPartialLeadData`, `classifyPartialLead`,
`savePartialLead`). The function signatures are stable — they
are part of this feature's contract.

**Rationale**:
- Constitution Principle VII binds coordinated cross-phase
  changes. Without explicit ownership documentation, the next
  engineer modifying classification behavior won't know whether
  to edit the system prompt (Phase 3) or the persistence
  module (Phase 5).
- The split also corresponds to the spec's structure: §7.4
  describes the LLM-driven path; §7.10 the heuristic path —
  both bound to this feature's persistence.

**Alternatives considered**: none. This is documentation, not
code change.

## R7. Heuristic Edge-Case Verification

**Decision**: Audit `partial-lead.ts`'s edge cases against the
spec and add tests for any gaps:

1. Conversation with NO user messages → `extractPartialLeadData`
   returns all-null, classification → `unqualified`,
   `savePartialLead` skips persistence (verified: line 124-130
   short-circuits).
2. Conversation with user messages but NO extractable patterns
   AND NO legal-matter signals → `unqualified`, persistence
   skipped (verified).
3. Conversation with extractable email but NO legal-matter
   signals → `unqualified`, persistence happens (because contact
   info is "useful data" per current line 125-129 logic).
4. Conversation with legal matter + urgency signals AND existing
   `captureLead` row → `savePartialLead` short-circuits
   (verified: line 119-122).
5. Conversation matches multiple urgency patterns → `urgent`,
   rationale lists all matched signals (verified: existing
   tests cover; rationale joins matched substrings).
6. PII-leakage check: Foundation logger redaction MUST scrub
   any matched email/phone before logging (R5 task).

**Rationale**:
- §12.10 done-when: "Partial conversations still save partial
  data (abandoned sessions)" + "Unqualified leads (out-of-scope
  questions) are correctly classified."
- FR-024 + FR-023 + Assumptions in spec.

**Alternatives considered**: none. This is an audit, not a
design choice.

**Implementation notes**:
- Each scenario gets a Vitest test in `partial-lead.test.ts`.
- The PII-leakage check (item 6) requires confirming the R5
  logger usage in `partial-lead.ts` redacts payload fields by
  name (the Foundation logger's redact list covers `email`,
  `phone`, etc. — confirmed in Foundation contract).

## R8. Schema Migration for `leads.session_id` Unique Index

**Decision**: Add a unique index on `leads.session_id` to enable
the upsert pattern from R3:

```ts
// packages/api/src/db/schema.ts
export const leads = pgTable('leads', {
  // … existing columns
}, (table) => [
  uniqueIndex('leads_session_id_unique').on(table.session_id),
]);
```

Generate the migration via
`pnpm --filter @legal-chatbot/api db:generate`. The migration is
forward-compatible: existing rows have unique session_ids by
construction (each `nanoid()` is unique), so no data fix-up is
needed.

**Rationale**:
- Required by R3's upsert pattern via Drizzle's
  `onConflictDoUpdate`.
- Constitutionally aligned: Constitution Principle II demands
  schema-typed inserts; the unique index makes the upsert path
  type-safe.
- Migration tooling (`drizzle-kit`) is provided by Foundation —
  no new infrastructure.

**Alternatives considered**:
- Conditional INSERT-or-UPDATE in application code: rejected.
  Race condition between SELECT (existence check) and INSERT
  could create duplicates under concurrent writes.
- Application-level lock: rejected. Adds complexity; DB
  unique constraint is the right tool.

**Implementation notes**:
- Update `test-schema.ts` to add the same `uniqueIndex` for
  parity (SQLite supports `UNIQUE INDEX`).
- Run migration test: insert two leads with same `session_id`
  → second insert fails (without upsert path); with `onConflictDoUpdate`
  the second updates the first.

## Constitution Cross-Reference Summary

| Constitution element | Lead Classification decision | Aligned |
|---|---|---|
| I (MVP-First) | Every research item cites a §-anchor | ✅ |
| II (Type Safety) | Tool-param Zod schema; lead inserts via Drizzle typed values; rationale validation (R4); unique-index-backed upsert (R8) | ✅ |
| III (TDD layered) | 723 LOC of existing tests + gap-fill tests for R1–R7 | ✅ |
| IV (Serverless / Stateless) | All DB writes via Neon HTTP driver (production) or in-memory SQLite (tests); no fs writes; transactional atomicity (R2) | ✅ |
| V (Privilege & Privacy) | Logger redaction (R5); PII never appears in log payloads at top level; `partial_lead_saved` event lists pattern names not matched substrings | ✅ |
| VI (Observable Agent) | `lead_captured`, `notification_created`, `partial_lead_*` events emitted; rationale validation (R4) ensures audit trail integrity | ✅ |
| VII (Phased Delivery) | R6 documents cross-feature boundary with Phase 3; R8 schema migration coordinated via Foundation tooling | ✅ |
| Required Stack | No new dependencies; `drizzle-orm`, `nanoid`, `@legal-chatbot/shared` already in scope | ✅ |
| Architectural Limits | Inherits 50-msg/conv + 1000-conv/key/day from Phase 3 | ✅ |

## Open Questions — None

All decisions resolve cleanly against the source spec and the
constitution. No `NEEDS CLARIFICATION` markers remain. Ready to
proceed to Phase 1.
