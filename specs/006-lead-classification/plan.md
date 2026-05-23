# Implementation Plan: Lead Classification

**Branch**: `006-lead-classification` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-lead-classification/spec.md`

## Summary

Lead Classification is the system that captures structured intake
data from chat conversations and persists it as classified leads
in the database. Per §7.4 it operates through the LLM-driven
`captureLead` tool (primary path) and per §7.10 a regex-based
heuristic extractor (fallback for abandoned sessions). For
`urgent` leads it auto-creates a dashboard notification (§7.4
mechanism step 4).

This is **Phase 5** per §12.5. It depends on `001-foundation`
(database schema, env loader, structured logger) and
`004-chat-api-agent` (the agent runtime that registers
`captureLead` and triggers the heuristic fallback after each
turn).

A working implementation already exists at
`packages/api/src/lib/leads.ts` (56 LOC) and
`packages/api/src/lib/partial-lead.ts` (158 LOC) with a
combined 723 LOC of tests (`leads.test.ts` 294 lines +
`partial-lead.test.ts` 429 lines). The test mocks correctly use
in-memory SQLite via `drizzle-orm/better-sqlite3`. The 30 FRs in
the spec map onto an implementation that is **largely correct in
shape** but has several **gaps**:

- **R1** — Notification title/body wording (§8.7 / Edge case).
  Currently `New Urgent Lead: …`; spec §8.7 specifies
  `"New urgent lead: [case type] from [name]"`.
- **R2** — Notification + lead atomicity (Edge case): no
  transaction wraps the two inserts. A failure between them
  could leave a lead without its notification (or vice versa).
- **R3** — Upsert-by-session policy (Assumption): current
  implementation always inserts on `captureLead`; spec
  Assumption permits upsert-by-session-id to handle repeated
  tool calls within a single conversation.
- **R4** — Empty-rationale validation (FR-010, SC-003): no
  runtime check that `classification_rationale` is non-empty.
  Phase 3's tool wiring trusts the LLM.
- **R5** — Foundation logger integration: code is silent; spec
  expects `lead_captured` events emitted via the
  Foundation logger (per `001-foundation` log-event-contract.md
  reservation).
- **R6** — Cross-feature ownership boundary clarification: the
  current code base **already wires `captureLead` into the agent
  in Phase 3** (`packages/api/src/app/api/chat/route.ts`). This
  is acceptable but the test coverage and contract live with
  this feature. R6 documents which tests cover what.
- **R7** — Heuristic edge cases (FR-024 + Assumption): partial
  leads with NO extractable data + NO identifiable matter are
  currently NOT persisted (correct per spec Assumption, but
  worth verifying in tests).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+
(Foundation). Module is ESM; runs as part of the Next.js API
Route Handler in `packages/api`.

**Primary Dependencies** (already in `packages/api/package.json`):

- `drizzle-orm` + `@neondatabase/serverless` — DB writes (§9.5).
- `better-sqlite3` — dev/test DB driver (Constitution Required Stack).
- `nanoid` — lead and notification ID generation.
- `@legal-chatbot/shared` — Foundation logger, env, schemas.

No new dependencies required.

**Storage**: Neon PostgreSQL (production) and in-memory SQLite
(tests). Tables written by this feature: `leads` (insert, possibly
update on R3 upsert), `notifications` (insert when classification =
urgent). Tables read: `leads` (the partial-lead path checks
existence by `session_id`).

**Testing**: Vitest with in-memory SQLite mocks (existing 723
LOC of tests). The mock pattern in `leads.test.ts` and
`partial-lead.test.ts` is the binding test approach — both new
gap-fill tests follow the same pattern.

**Target Platform**: Netlify Functions (serverless) per §9.7.
DB calls go through `@neondatabase/serverless` HTTP driver in
production; SQLite in tests. Constitution IV's no-fs-at-runtime
rule applies.

**Project Type**: TypeScript library inside `packages/api`. No
separate workspace package per Constitution Required Stack.

**Performance Goals**:
- Lead insert + optional notification insert: a single DB
  round-trip (with R2 transaction wrap), ≤ 100 ms p95.
- Heuristic extraction: pure-function regex; ~µs per
  conversation turn.
- Atomicity: a lead is either fully written + notification (if
  urgent) created, or neither.

**Constraints**:
- TS strict (Constitution II).
- Schema conformance: every lead row matches the §2.6 `leads`
  schema; every notification row matches `notifications`
  (Constitution II + FR-026, FR-027).
- `classification` is exactly one of `urgent` / `normal` /
  `unqualified` (FR-009); enforced at write time.
- `classification_rationale` is non-empty for LLM-driven captures
  (FR-010, SC-003); enforced at write time.
- Heuristic path skips persistence when no useful data was
  extracted (Assumption); enforced at the partial-lead module.
- Logger MUST be the Foundation logger; no `console.log` in
  production paths (Constitution V).
- This feature does NOT own the system-prompt classification
  guidance text — that belongs to `004-chat-api-agent`
  (out-of-scope per spec).

**Scale/Scope**: Per §11.1 each session is capped at 50
messages and each API key at 1000 conversations/day, so the
upper bound on lead writes per day is 1000/account. Each lead
write is one row in `leads` plus optionally one row in
`notifications`. Postgres free-tier handles this easily.

## Constitution Check

| # | Principle | Lead Classification applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors (§2.6, §7.4, §7.10, §8.7, §12.10). No scope creep beyond. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Tool params Zod-validated (in Phase 3 wiring); lead inserts use Drizzle typed values; classification enum enforced. **Gap R4 (rationale non-empty)** is a runtime invariant that should also be Zod-checked in `captureLead`. | ✅ PASS — pending R4 |
| III | Test-First, Layered Testing | 723 LOC of tests already exist. Gap-fill tests for R1–R5, R7 are written before fixes. | ✅ PASS |
| IV | Serverless / Stateless | DB writes via `@neondatabase/serverless` HTTP driver; no fs writes; in-memory SQLite for tests. | ✅ PASS |
| V | Privilege & Privacy | Lead PII stored in DB (the product); logger redaction protects logs. **Gap R5 (logger integration)**. | ✅ PASS — pending R5 |
| VI | Bounded, Observable Agent | The `captureLead` tool's params are Zod-bounded; `urgent` outcome triggers notification (audit trail). Logger emits `lead_captured` event (R5). | ✅ PASS — pending R5 |
| VII | Phased Incremental Delivery | Phase 5; depends on Phase 3 tool wiring; produces input for Phase 6 dashboard reads + Phase 7 hardening. R6 documents the cross-feature boundary with `004-chat-api-agent`. | ✅ PASS |

**Architectural Limits** relevant to Lead Classification: none
direct. The 50-msg/conversation and 1000-conv/key/day limits in
`004-chat-api-agent` cap upstream traffic; this feature inherits.

**Result**: All gates PASS. R1–R7 are gap-fills, not Constitution
violations. No amendments required.

## Project Structure

### Documentation (this feature)

```text
specs/006-lead-classification/
├── plan.md
├── research.md
├── data-model.md           # leads + notifications write semantics, partial-lead heuristic shape
├── quickstart.md
├── contracts/
│   ├── capturelead-tool-contract.md     # Zod schema, execute behavior, return shape
│   ├── lead-write-contract.md           # leads-table row invariants, transaction semantics
│   ├── notification-write-contract.md    # urgent_lead row format, §8.7 wording
│   └── partial-lead-contract.md         # Heuristic extraction + classification rules
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (`packages/api/src/lib/`)

```text
packages/api/src/lib/
├── leads.ts                  # ⚠ EXTEND — R1 (notification wording), R2 (transaction), R3 (upsert), R4 (rationale check), R5 (logger)
├── leads.test.ts             # ⚠ EXTEND — gap-fill tests for R1–R5
├── partial-lead.ts           # ⚠ EXTEND — R5 (logger), R7 (verify edge cases)
├── partial-lead.test.ts      # ⚠ EXTEND — gap-fill tests for R7
└── ... (other lib/ files unchanged)
```

The `captureLead` tool wiring in
`packages/api/src/app/api/chat/route.ts` is owned by Phase 3
(`004-chat-api-agent`). This feature only extends:

1. The `captureLead` function signature (params, return type) —
   exposed via the existing `lib/leads.ts` export.
2. Internal behavior of `captureLead` (R1–R5).
3. `extractPartialLeadData`, `classifyPartialLead`,
   `savePartialLead` in `lib/partial-lead.ts`.

The system-prompt classification guidance text is in
`packages/api/src/lib/system-prompt.ts` (already exists; owned
by `004-chat-api-agent`). This feature does not modify that file.

**Structure Decision**: Continue the existing two-file module
split (`leads.ts` for the LLM-driven path; `partial-lead.ts`
for the heuristic path). The two paths share the schema but have
different inputs and validation rules; co-locating both into a
single 250-LOC file would muddle the responsibilities. The split
also matches the §7.4 vs. §7.10 documentation structure.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven Constitution principles pass. R1–R7 are
gap-fills, not Constitution violations.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/006-lead-classification/plan.md` | ✅ written |
| Research | `specs/006-lead-classification/research.md` | ✅ written (8 research items: R1–R8) |
| Data model | `specs/006-lead-classification/data-model.md` | ✅ written (write semantics for `leads` + `notifications`; transaction model; ephemeral types; state diagrams; cross-feature coordination; R8 migration) |
| Contracts | `specs/006-lead-classification/contracts/` | ✅ written (4 contracts: capturelead-tool, lead-write, notification-write, partial-lead) |
| Quickstart | `specs/006-lead-classification/quickstart.md` | ✅ written (full §12.10 walkthrough + R1–R8 verification + DB queries + log inspection) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; no scope creep | ✅ |
| II | Type Safety & Zod | `captureLeadParamsSchema` in `packages/shared`; rationale-non-empty enforced via Zod `min(1)` AND runtime check (R4); Drizzle typed inserts | ✅ |
| III | TDD layered | 723 LOC of existing tests + R1–R5/R7 gap-fill tests enumerated in `lead-write-contract.md`, `notification-write-contract.md`, `partial-lead-contract.md` | ✅ |
| IV | Serverless / Stateless | All DB writes via Neon HTTP / SQLite (tests); transaction atomicity via Drizzle (R2); no fs writes | ✅ |
| V | Privilege & Privacy | Logger redaction (R5); `signalsMatched` payload uses pattern names not substrings; PII never appears in log payloads | ✅ |
| VI | Observable Agent | Five log events emitted; rationale-non-empty validation (R4) preserves audit-trail integrity; transactional atomicity (R2) prevents orphan data | ✅ |
| VII | Phased Delivery | R6 documents cross-feature boundary with Phase 3; R8 schema migration coordinated via Foundation tooling; downstream Phase 6 dashboard reads + Phase 7 hardening clearly identified | ✅ |

**Architectural Limits**: No new direct limits introduced.
Inherits 50/conv + 1000/key/day caps from Phase 3.

**Result**: All gates PASS post-design. R1–R8 are gap-fills, not
Constitution violations.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 4 user stories in `spec.md` (P1×3, P2×1).
- 30 FRs in 6 groups.
- 8 research items.
- 4 contracts.

Task graph:

- **Phase A** (sequential, foundational): R8 schema migration
  → R3 upsert wiring → R2 transaction wrapping. These are
  ordered because R3 depends on the unique index from R8, and
  R2 wraps the writes from R3.
- **Phase B** (parallel after Phase A): R1 notification wording;
  R4 rationale validation; R5 logger integration; R7 heuristic
  edge-case tests.
- **Phase C** (testing): augment 723 LOC of existing tests with
  ~150 LOC of gap-fill tests covering R1–R5, R7. Run full
  suite to confirm no regression.

R6 (cross-feature ownership boundary documentation) is satisfied
by this plan itself; no code task.

