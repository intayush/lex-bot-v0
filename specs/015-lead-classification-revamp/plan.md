# Implementation Plan: Lead Classification Revamp

**Branch**: `015-lead-classification-revamp` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/015-lead-classification-revamp/spec.md`

## Summary

Replace the existing 3-value LLM-emitted lead classification (`urgent` /
`normal` / `unqualified`) with a deterministic, rule-based 4-value
classification (`HOT` / `WARM` / `COLD` / `SPAM`) computed at SOP
finalization. The same `leads.classification` column is reused; only its
value space and the system that produces it change.

The new scoring engine activates only when the captured (case_type,
sub_type) pair is `(personal_injury, car_accident)` in MVP, but the
runtime, schema, and dashboard must be extensible to any (case_type,
sub_type) pair without further code changes. Scoring weights live as
typed JSON on chips inside the existing `sop_steps.inline_chips_json`;
classification thresholds and hard-override toggles live as a typed JSON
column on `sub_types`; both are validated by Zod at every boundary.

Eight scoring questions (timing, injury, treatment, role, insurance
activity, work impact, attorney status, contact) plus two metadata
questions (request type, geographic qualification) are added as new SOP
steps that fire only when the captured sub_type has scoring config.
Scoring questions slot between Step 4 ("what happened?") and Step 5
("when did this happen?") via existing `position`-based ordering — no
advancer code change required for placement.

Hard-override rules (missing-contact, out-of-scope, no-injury-no-treatment,
fake-info) are pinned in code, run after lead persistence, can only
downgrade classification to SPAM, and emit structured logs without PII
per Constitution V.

For sub_types without scoring config (every sub_type except car_accident
in MVP), the LLM `captureLead` tool emits the new 4-value enum directly;
the legacy 3-value enum is migrated 1:1 (urgent→HOT, normal→WARM,
unqualified→SPAM) on existing `leads` rows.

A pure `scoreLead(sopState, scoringConfig) → ScoredLead` function is the
testable core. Failure of the scorer at finalization captures the lead
as SPAM with `lead_score = null`, `reasons = ["scoring_error"]`, and an
ERROR-level log line — the visitor flow never blocks on a scoring error.

Estimated implementation time: ~3-4 working days (the bulk being the
admin UI for scoring config and the data migration tests).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (ESM). All packages
in the existing pnpm + Turborepo workspace.

**Primary Dependencies** (no new deps; all in repo):

- `drizzle-orm` + `@neondatabase/serverless` (prod) / `better-sqlite3`
  (test) — for the new `sub_types.scoring_config_json` column, the
  per-finalization classification update path, and the legacy-row
  migration.
- `zod` — boundary validation for the new scoring chip schema (extends
  `inline_chips_json` shape), the new `scoringConfigSchema` (per-sub_type
  thresholds + hard-override toggles), and the updated
  `leadClassificationSchema` enum (4 values).
- `nanoid` — IDs for the new SOP steps and for any net-new chip rows
  authored by seed-defaults.
- `@legal-chatbot/shared` — extend `leadClassificationSchema` (3→4
  values), extend `chipSchema` with optional `score_weight`, add
  `scoringConfigSchema`, extend `leadSchema` with `lead_score` + new
  metadata columns.
- `next/server` + React — existing chat route + dashboard pages, no new
  components beyond the Scoring sub-section in the existing Case Types
  tab and the new score column in the leads table.
- `iron-session` — existing dashboard auth (no change).
- `@ai-sdk/google` — system-prompt rubric prose update (3→4 enum
  values); no new tools and no model change.

**Storage**: Neon serverless PostgreSQL (production) + in-memory SQLite
via `better-sqlite3` (tests). One new column on `leads`
(`lead_score INTEGER NULL`), one new column on `sub_types`
(`scoring_config_json TEXT NULL`), one new column on `leads` for
metadata (`request_type TEXT NULL`,
`geographic_qualification TEXT NULL`,
`geographic_qualification_details_json TEXT NULL`,
`score_reasons_json TEXT NULL`). The existing
`leads.classification` column stays; only its value space and producer
change. One new Drizzle migration (`0003_*.sql`) covers all column
additions plus the legacy-value migration UPDATE.

**Testing**: Vitest unit tests, colocated next to source. The pure
`scoreLead` function and each hard-override predicate are unit-testable
in isolation. The xlsx HOT/WARM walk examples become test fixtures.
Integration tests (Vitest + MSW) cover the full finalization path
(captureLead with scoring config → scoreLead invoked → leads row
written with new columns). Playwright walk spec covers the visitor
flow end-to-end against the dev seed (Personal Injury → Car Accident →
8 scoring questions → contact form → finalize → assert classification +
score + reasons match expected). Constitution III gating applies.

**Target Platform**: Same as upstream — Netlify Functions for API +
dashboard pages; modern evergreen browsers for the React widget and
dashboard. All Constitution IV invariants inherited (no Server
Actions, no native binaries, CORS unchanged, widget bundle size
budgets unchanged).

**Project Type**: Cross-cutting fix inside the existing monorepo. No
new workspace packages.

**Performance Goals**:

- `scoreLead` MUST complete in <50ms p99 for any reasonably-shaped
  `SOPState` + `ScoringConfig` on Netlify Functions cold start. Pure
  function over typed JSON; no I/O. Easily achievable.
- Lead-finalization end-to-end latency MUST NOT regress vs. baseline
  by more than 100ms (the only added work is one DB read of
  `sub_types.scoring_config_json` plus the in-memory scorer).
- No change to widget bundle size; no change to system-prompt token
  budget (the rubric prose change is 3 lines for 3 lines).

**Constraints** (all from Constitution):

- No filesystem writes (Constitution IV).
- No native deps (Constitution IV).
- No Server Actions (Constitution IV).
- LLM `maxSteps: 5` unchanged (Constitution VI).
- Token budget ~4500 unchanged (Constitution VI).
- No PII in logs (Constitution V; reinforced by FR-010d / FR-034).
- Widget bundle size unchanged; no new client-side dependencies.

**Scale/Scope**: Per-account; iterates one lead at a time at
finalization. The legacy migration (FR-031) is a one-shot UPDATE over
the entire `leads` table (currently 10s of rows in dev/staging,
designed for 1000s in prod). Single SQL statement.

## Constitution Check

| Principle | Applies? | Compliance |
|-----------|----------|------------|
| **I. MVP-First Discipline** | Yes — extends the Phase 5 (Lead Classification + DB) deliverable defined in §10/§12.9. | ✅ Implements §10's "Lead is qualified and classified" requirement and §1.7's measurable outcome (lead quality visible to the lawyer). MVP scope is bounded to one (case_type, sub_type) — Personal Injury / Car Accident. The architecture is extensible per spec but no extra sub_type configurations ship in MVP. Out-of-scope items (per-account override authoring, Case Value / Urgency decomposition, scoring config import/export, A/B testing, score recomputation) are explicitly deferred in spec §Assumptions. No nice-to-haves added. |
| **II. Type Safety & Schema-Validated Boundaries** | Yes — new persisted JSON shapes (`scoring_config_json`, extended `inline_chips_json`), enum value-space change, new lead columns. | ✅ All new shapes are added to `packages/shared/src/schemas/{leads,sop}.ts` and consumed by both API and widget where relevant. New `scoringConfigSchema` validates persisted JSON at write time (POST `/api/dashboard/sop/case-types`) and read time (chat-route finalization). `leadClassificationSchema` enum updated 3→4 values. No raw SQL beyond the one one-shot value migration. No type duplication. |
| **III. Test-First, Layered Testing** | Yes — production code changes across 6+ files. | ✅ Tests authored first, per surface: pure `scoreLead` unit tests with xlsx-derived fixtures (HOT/WARM walks); each hard-override (4) as a pure-function unit test; `applyHardOverrides` integration test; `case-types-diff` validation extension tests (rejects malformed scoring config); `leadClassificationSchema` enum migration tests; `partial-lead.classifyPartialLead` 4-value migration tests; `system-prompt.ts` rubric tests assert new labels; integration tests for `captureLead` + `updateLeadSOPState` writing the new columns; Playwright walk spec for the full visitor flow. CI gates from Constitution III remain enforced. |
| **IV. Serverless-Compatible & Stateless Server** | Yes — touches API package + DB schema + dashboard. | ✅ No Server Actions added (writes go through `POST /api/dashboard/sop/case-types`, mirror of existing pattern). No native deps. No filesystem writes. CORS unchanged. Widget bundle unaffected (zero-byte impact — scoring runs server-side). One Drizzle migration (`0003_*.sql`); idempotent against fresh Neon branch per Constitution Local-Development requirement. |
| **V. Privilege, Privacy, Data-Boundary** | Yes — fake-info heuristic touches PII (name, phone, email) at finalization; new structured log surface. | ✅ Per FR-010d / FR-034 the structured log line names the override rule but never records matched PII values. Per Q4 clarification the fake-info regex set is pinned in code (no admin-tunable PII patterns). Lead PII continues to be stored in `leads.*` columns (per the constitution carve-out: "lead PII may be stored in the database — it is the product"). The new `score_reasons_json` column contains chip *labels* and *rule names* only — never names/phones/emails. Captured-label snapshot from spec 014 is the source of human-readable phrases; no new PII surface. |
| **VI. Bounded, Observable, Cost-Aware Agent** | Yes — system prompt prose changes; new structured log per finalization. | ✅ Token-budget impact: +0 (3 lines for 3 lines in the rubric prose). `maxSteps: 5` unchanged. No new tools. New structured log line per finalization (`lead_classified` event with classification, score, reasons, sub_type_slug, hard_override_fired) is a Constitution VI obligation, not an exception — §11.7 mandates structured JSON logging for conversation events. |
| **VII. Phased Incremental Delivery** | Yes — operates inside Phase 5 (Lead Classification + DB) deliverables. | ✅ Bug fix / scope expansion that completes Phase 5's "lead is classified before being persisted" requirement with a deterministic implementation. Independently demoable: visitor walks SOP for car-accident → captured lead has score + classification + reasons. Pre-existing test suites remain green; legacy enum migration is the only one-shot operation. |

**Verdict**: All gates pass. No Complexity Tracking entries required.

The one judgment call worth recording: the new `lead_classified`
structured-log event introduces a per-finalization log surface that
does not currently exist in the codebase (per item 11 of the survey).
This is a *Constitution VI obligation* (the principle mandates
structured JSON logging for conversation events) being newly satisfied
for the lead-classification surface, not a deviation. Item is recorded
in research.md so plan reviewers know it's net-new infrastructure
rather than an extension.

## Project Structure

### Documentation (this feature)

```text
specs/015-lead-classification-revamp/
├── INPUT.md                # Original /speckit.specify prompt (reference)
├── spec.md                 # Feature spec (clarified)
├── plan.md                 # This file
├── research.md             # Phase 0 output
├── data-model.md           # Phase 1 output (state-shape extensions)
├── quickstart.md           # Phase 1 output (manual verification steps)
├── contracts/
│   ├── scoring-config.md           # Phase 1 — sub_types.scoring_config_json shape
│   ├── chip-with-score.md          # Phase 1 — extended inline_chips_json shape
│   ├── lead-classification-enum.md # Phase 1 — enum migration contract
│   └── lead-finalization-log.md    # Phase 1 — structured log line shape
├── checklists/
│   └── requirements.md     # Already passing (from /speckit.specify)
└── tasks.md                # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/
├── shared/
│   └── src/
│       └── schemas/
│           ├── leads.ts                     # EDIT: leadClassificationSchema 3→4 values; extend leadSchema with new columns
│           └── sop.ts                       # EDIT: extend chipSchema with optional score_weight; add scoringConfigSchema
├── api/
│   ├── drizzle/
│   │   └── 0003_*.sql                       # NEW: leads.lead_score + metadata cols, sub_types.scoring_config_json, legacy enum UPDATE
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── chat/
│   │   │   │   │   └── route.ts             # EDIT: captureLead tool param schema (3→4 enum); rubric prose unchanged here
│   │   │   │   └── dashboard/
│   │   │   │       └── sop/
│   │   │   │           └── case-types/
│   │   │   │               └── route.ts     # EDIT: extend inbound Zod with sub_type.scoring_config_json shape
│   │   │   └── dashboard/
│   │   │       ├── leads/
│   │   │       │   └── lead-table.tsx       # EDIT: 4-value color map, filter chips, score column, reasons cell, scoring-failed indicator
│   │   │       └── sop/
│   │   │           └── case-types-tab.tsx   # EDIT: add Scoring sub-section to expanded sub-type panel
│   │   ├── db/
│   │   │   ├── schema.ts                    # EDIT: leads + sub_types column additions
│   │   │   ├── seed-defaults/
│   │   │   │   └── sop.ts                   # EDIT: add 8 scoring SOP steps (positions 5-12); add metadata steps; ship car_accident scoring_config
│   │   │   └── ensure-car-accident-scoring.ts  # NEW: idempotent remediation script for legacy accounts
│   │   └── lib/
│   │       ├── leads.ts                     # EDIT: captureLead invokes scoreLead; updateLeadSOPState invokes scoreLead; structured log
│   │       ├── partial-lead.ts              # EDIT: classifyPartialLead emits 4-value enum
│   │       ├── system-prompt.ts             # EDIT: rubric prose 3 labels → 4 labels with new criteria
│   │       └── scoring/
│   │           ├── score-lead.ts            # NEW: pure scoreLead(sopState, scoringConfig) → ScoredLead
│   │           ├── score-lead.test.ts       # NEW: xlsx HOT/WARM walks + boundary cases + capping/flooring
│   │           ├── hard-overrides.ts        # NEW: 4 pure predicates + applyHardOverrides combinator
│   │           ├── hard-overrides.test.ts   # NEW: each rule + downgrade-only + disabled-toggle
│   │           ├── reason-builder.ts        # NEW: builds reasons[] per FR-010a (|weight| ≥ 5 rule)
│   │           ├── reason-builder.test.ts   # NEW: inclusion threshold + ordering
│   │           ├── classification-mapper.ts # NEW: score → classification via threshold table; legacy enum migration helper
│   │           └── classification-mapper.test.ts # NEW: Self vs Family/Friend tables; boundaries; legacy mapping
│   ├── tests/
│   │   └── e2e/
│   │       └── widget-lead-classification.walk.spec.ts  # NEW: full visitor flow for car-accident
│   └── package.json                                     # EDIT: add db:ensure-car-accident-scoring script
└── widget/                                              # NO CHANGE (scoring runs server-side; rendering chips already supported by 010/014)
```

**Structure Decision**: Cross-cutting fix inside the existing monorepo.
The bulk of new code lives under `packages/api/src/lib/scoring/` as a
new directory of pure functions (the `scoreLead` engine). The existing
SOP runtime (`packages/api/src/lib/sop/*`) is reused without
modification — scoring questions are configured as additional
`sop_steps` rows whose positions slot between Step 4 and Step 5; the
existing `nextPendingStep` selector handles ordering automatically.
The shared `leadClassificationSchema` enum is the single source of
truth for the value space; the dashboard, API, and DB column type all
derive from it.

## Complexity Tracking

> No Constitution violations require justification. All gates pass on
> first evaluation.

The two judgment calls worth surfacing for review (not violations,
just decisions reviewers should validate):

1. **Reusing `leads.classification` instead of adding `leads.tier`.**
   Per Q3 clarification, the same column holds the new 4-value enum.
   Pro: zero rename surface, one-line `CHECK CONSTRAINT` change, no
   downstream API/SDK churn. Con: column name no longer matches the
   conceptual term ("classification" vs the older "tier" mental model).
   The user explicitly chose this path; spec §Clarifications records
   the rationale.

2. **`scoreLead` runs synchronously inside the chat-route's
   finalization path, not as a deferred background job.** Pro: the
   `x-sop-state` response header can carry the new classification +
   score back to the widget on the very turn that finalizes the lead
   (no second round-trip; no eventual-consistency window for the
   dashboard). Con: a bug in `scoreLead` is on the critical path of
   the visitor's last turn. Mitigated by FR-010b's "scoring_error
   never blocks finalization" contract, the pure-function nature of
   the scorer (easily testable, no I/O), and the structured ERROR-log
   surface for post-incident debugging.


## Constitution Re-Check (Post Phase-1 Design)

After authoring `research.md`, `data-model.md`, the four contracts in
`contracts/`, and `quickstart.md`, I re-evaluate the Constitution
gates against the now-fully-specified design:

| Principle | Verdict | Notes |
|-----------|---------|-------|
| **I. MVP-First Discipline** | ✅ Still passes | All decisions stayed within the bounds set by the MVP scope clause. The deferred items (Case Value Score / Urgency Score, per-account override authoring, A/B testing) are noted in research.md §R11 and the `schema_version: 1` literal in `scoringConfigSchema` enforces forward-compat without preempting their design. |
| **II. Type Safety & Schema-Validated Boundaries** | ✅ Still passes | Every new persisted shape (`scoringConfigSchema`, extended `chipSchema`, updated `leadSchema`) lives in `packages/shared` and is enforced at every boundary. Migration UPDATE is the only raw SQL and is justified by Constitution carve-out (§9.5: raw SQL permitted when Drizzle cannot express the query — UPDATE-with-WHERE-equality on a text column is expressible in Drizzle but the migration file is the natural home for one-shot value rewrites). |
| **III. Test-First, Layered Testing** | ✅ Still passes | Phase 1 produced contracts that map 1:1 to test fixtures: scoring-config invalid-shape tests, chip-with-score round-trip tests, classification-enum migration tests, finalization-log shape assertions. The xlsx HOT/WARM walk examples in spec §User Stories become integration test fixtures. |
| **IV. Serverless-Compatible & Stateless Server** | ✅ Still passes | No filesystem writes; one Drizzle migration; no native deps; no Server Actions; CORS unchanged. The structured log surface is `console.info` / `console.error` — already serverless-compatible (Netlify Functions capture stdout/stderr automatically). |
| **V. Privilege, Privacy, Data-Boundary** | ✅ Still passes — strengthened | The Phase 1 design EXCEEDS Constitution V's baseline by adding FR-010d (no PII in override logs) and FR-010c (fake-info heuristic runs after persistence). The lead-finalization-log contract enumerates the PII fields that MUST NOT appear; tests assert this. |
| **VI. Bounded, Observable, Cost-Aware Agent** | ✅ Still passes | The new `lead_classified` structured log surface satisfies §11.7's "structured JSON logging for every conversation event" obligation for the lead-classification surface specifically. Token budget unchanged; tools unchanged; maxSteps unchanged. |
| **VII. Phased Incremental Delivery** | ✅ Still passes | This feature operates inside Phase 5's "Lead Classification + DB" deliverable. It enhances the existing Phase 5 surface with a deterministic implementation; pre-existing test suites for Phases 1–4 remain green. |

**Verdict**: All gates still pass. No new Complexity Tracking entries.

The Phase 1 design did not surface any new Constitution conflicts; the
two judgment calls recorded in plan §Complexity Tracking remain the
only items reviewers should weigh.

## Phase 1 Exit Status

✅ `data-model.md` — every persisted shape change documented.

✅ `contracts/` — 4 boundary contracts authored
(`scoring-config.md`, `chip-with-score.md`,
`lead-classification-enum.md`, `lead-finalization-log.md`).

✅ `quickstart.md` — manual verification path for every user story
plus migration verification and scoring-error fallback.

✅ AGENTS.md SPECKIT block points at this plan.

✅ Constitution Check re-evaluated post-design; no new violations.

Ready for Phase 2 (`/speckit.tasks` → `tasks.md`).
