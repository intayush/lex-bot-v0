# Implementation Plan: Multi-Branch SOP Workflow

**Branch**: `016-multi-branch-sop` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/016-multi-branch-sop/spec.md`

## Summary

Fix the spec 015 regression where Personal Injury → Car Accident scoring
questions leak into other case types, by converting the SOP runtime into
a deterministic multi-branch workflow.

Three observable changes:

1. **Default SOP reorder**: contact capture moves from being the implicit
   end-of-flow step (driven indirectly by `captureLead`) into an explicit
   Step 6 of the seeded default SOP, immediately after Step 5 ("when").
   Threshold `N` migrates 5 → 6 for firms still on the seeded default.
2. **Branch routing**: the runtime queries a new `branches` table by
   `(case_type_slug, sub_type_slug)` AFTER Step 6 satisfies. Configured +
   active branches present their ordered questions one at a time;
   unconfigured pairs finalize directly via the existing default-only
   path.
3. **Tool surgery**: the generic `analyzeAndFollowUp` tool (introduced in
   spec 010 §F and currently in `packages/api/src/lib/sop/follow-up-tool.ts`)
   is removed from the agent's tool registry entirely. Its behaviour is
   replaced by deterministic branch dispatch driven by the SOP advancer.

The new `Branch` entity subsumes the spec 015 `scoring_config_json` JSON
column on `sub_types`. Migration is a structural rename + container
move: same eight Car Accident questions, same chips, same weights, same
thresholds, same hard-override toggles — relocated to a new `branches`
table keyed by `(case_type_slug, sub_type_slug)` with a published-version
history. The pure `scoreLead` function stays unchanged; only its input
shape changes (it now reads a `Branch` instead of a `SubTypeScoringConfig`).

Step 6 (contact) is implemented as a single free-text conversational
turn (per Clarification Q4) reusing the existing
`packages/api/src/lib/sop/contact-form.ts` extraction. The partial-gate
rule (Q1: at least one of email/phone, name optional) is enforced in
the contact-form satisfaction predicate. Up to 2 polite retries are
attempted before SOP termination without `captureLead` (Q1).

Skip-detection (Q5) is sequence-safe: contact volunteered earlier in the
conversation is captured into the Step 6 fields but does NOT mark Step 6
complete until the runtime advances to Step 6 in sequence; on arrival,
the assistant emits a confirmation prompt before treating Step 6 as
satisfied.

Mid-branch abandonment (Q2) is scored: partial chip selections are
applied to the branch's thresholds, the resulting `lead_score`,
`classification`, and `reasons` are written, plus a new
`branch_incomplete: true` flag on the lead row. The legacy classifier
is NOT used for partial-branch leads.

A new Branches admin tab on the existing `/dashboard/sop` page (extended,
not replaced) lists all `(case_type, sub_type)` pairs from the firm's
configured chip lists, with add / edit / reorder / delete / toggle
active-inactive actions, per-chip weight numeric inputs, and integration
with the existing Preview & Test chat. Save creates a new branch version
(`is_published = false`); Publish makes it live; in-flight conversations
continue with their starting version.

Estimated implementation time: ~4-5 working days (the bulk being the
admin Branches editor UI plus the migration + comprehensive integration
tests; the runtime changes are localized to `packages/api/src/lib/sop/`
and `packages/api/src/lib/scoring/`).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (ESM). All packages
in the existing pnpm + Turborepo workspace.

**Primary Dependencies** (no new deps; all in repo):

- `drizzle-orm` + `@neondatabase/serverless` (prod) / `better-sqlite3`
  (test) — for the new `branches` and `branch_versions` tables, the
  migration of existing `sub_types.scoring_config_json` rows into the
  new schema, and the new `leads.branch_snapshot_json` +
  `leads.branch_incomplete` columns.
- `zod` — boundary validation for `branchSchema`, `branchQuestionSchema`,
  `branchChipSchema`, `branchSnapshotSchema` (all in
  `packages/shared/src/schemas/`); the existing `chipSchema` is reused
  for branch chips (chips already carry `score_weight: number` from
  spec 015).
- `nanoid` — IDs for new branch / branch_version / branch_question rows
  authored by the seed-defaults migration and by admin add-question
  actions.
- `@legal-chatbot/shared` — extend with `branchSchema`,
  `branchQuestionSchema` (already partly modelled as
  `scoringQuestionSchema` in 015 — rename + relocate),
  `branchSnapshotSchema`; remove the now-superseded
  `subTypeScoringConfigSchema` (which lived on `sub_types` in 015).
- `next/server` + React — extended chat route + a new Branches tab on
  the existing `/dashboard/sop` page. No new top-level dashboard routes.
- `iron-session` — existing dashboard auth (no change).
- `@ai-sdk/google` — agent runtime is unchanged structurally; the only
  agent-surface change is the **removal** of the `analyzeAndFollowUp`
  tool from the tool registry. `searchContext` and `captureLead` remain
  the only two agent tools (Constitution VI-compliant).

**Storage**: Neon serverless PostgreSQL (production) + in-memory SQLite
via `better-sqlite3` (tests). New schema:

- New table `branches`: `(id PK, case_type_slug TEXT NOT NULL,
  sub_type_slug TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1,
  current_version_id TEXT NULL, created_at, updated_at)`. UNIQUE
  index on `(case_type_slug, sub_type_slug)`.
- New table `branch_versions`: `(id PK, branch_id FK,
  version_number INTEGER NOT NULL, is_published INTEGER NOT NULL DEFAULT 0,
  questions_json TEXT NOT NULL, classification_thresholds_json TEXT NOT NULL,
  hard_override_toggles_json TEXT NOT NULL, published_at, created_at,
  created_by_user_id FK)`. The full Branch payload (questions + chips +
  thresholds + toggles) is captured on each version row so in-flight
  conversations can pin to a stable version.
- New columns on `leads`: `branch_snapshot_json TEXT NULL` (frozen
  Branch version + captured chip selections + score + classification +
  reasons at finalization), `branch_incomplete INTEGER NOT NULL DEFAULT 0`
  (1 when the branch was abandoned mid-flow per FR-011a).
- Deprecate (do not drop in this migration) `sub_types.scoring_config_json`
  — the column stays for backwards compatibility of historical lead
  rendering; the new code path reads from `branches`. A follow-up
  cleanup migration can remove it once dashboard read paths are confirmed
  green.
- Migration path: one new Drizzle migration (`0004_*.sql`) creates
  `branches` + `branch_versions`, adds `branch_snapshot_json` and
  `branch_incomplete` to `leads`, AND data-copies every existing
  `sub_types.scoring_config_json` row into a new `branches` /
  `branch_versions` pair (idempotent — re-running is a no-op because
  `(case_type_slug, sub_type_slug)` is UNIQUE).
- The existing default-SOP seed (`packages/api/src/db/seed-defaults/`)
  is extended: the seeded default SOP gains a Step 6 (contact) at
  position 6, and the Car Accident `branches` row is seeded with
  `is_published = true` from the same JSON fixture used in spec 015.
  The existing `ensureContactStep.ts` idempotent remediation is
  extended (or a sibling `ensureCarAccidentBranch.ts` is added) so
  pre-existing accounts get the new Step 6 and the migrated branch
  on first dashboard load.

**Testing**: Vitest unit tests, colocated next to source, for:

- `branch-lookup.ts` — `(case_type_slug, sub_type_slug) → Branch | null`
  with per-firm isolation.
- `branch-advancer.ts` — given branch state and visitor input, yields
  next-question-or-finalize. Reuses existing `state-machine.ts` patterns.
- The `scoreLead` pure function (existing — unchanged signature, only
  the caller's config-loading path changes; existing 015 tests stay green).
- Partial-branch scoring tests — verify FR-011a behaviour with various
  abandonment positions (chips on Q1 only, chips on Q1+Q2, chips on
  Q1+Q3+Q5 mixed).
- Step 6 contact-form satisfaction predicate — verify the partial-gate
  rule (Q1 / FR-002): name optional, at least one of email/phone
  required, retry counter at 0/1/2.
- Sequence-safe skip-detection — verify FR-005a: volunteered contact
  before Step 5 completes is captured into Step 6 fields but bar does
  NOT advance to 6/6.
- Tool-registry assertion — a structural test that the agent's tool
  registry contains exactly `searchContext` and `captureLead` (no
  `analyzeAndFollowUp`).

Integration tests (Vitest + MSW) cover:

- Full default-only flow for an unconfigured (case_type, sub_type) pair
  (Criminal Defense → Assault Charges from `negative-sop-flow.json`):
  six default steps, contact extraction, finalize, no branch fires,
  conversation stays open. This is the regression test for the bug.
- Full Car Accident branch flow: six default steps + branch presents
  questions one-by-one + chip taps + finalize with score and reasons.
- Mid-branch abandonment (simulated session timeout): assert
  `branch_incomplete: true`, `lead_score` is numeric, `classification`
  is from thresholds, `reasons` is populated.
- Migration test: in-memory SQLite, run the spec 015 seed
  (`scoring_config_json` populated on `sub_types.car_accident`), then
  apply the spec 016 migration, then assert (a) `branches` row exists
  with the same questions/chips/weights, (b)
  `sub_types.scoring_config_json` is preserved (not dropped), (c)
  re-running the migration is a no-op.

Playwright E2E walk replaces the spec 015 smoke test with two walks:

- `smoke-016-personal-injury.spec.ts` — Personal Injury → Car Accident
  full happy path through branch finalization.
- `smoke-016-criminal-defense.spec.ts` — Criminal Defense → Assault
  Charges; asserts no branch question is ever rendered, conversation
  stays open after finalization, and the lead row has the expected
  default-only shape.

Constitution III gating: every production code change has a failing
test in the same PR before the implementation lands.

**Target Platform**: Same as upstream — Netlify Functions for API +
dashboard pages; modern evergreen browsers for the React widget. No
deployment-target change.

**Project Type**: Web monorepo (existing) — `packages/{api, dashboard,
widget, shared, crawler}`. Constitution IV.

**Performance Goals**:

- Branches dashboard view renders for 50 (case_type, sub_type) pairs in
  ≤ 1s on broadband (SC-010). Implementation: server-side render the
  list from a single SQL JOIN; expand-row queries are lazy.
- Branch lookup at chat-runtime: O(1) keyed read on
  `(case_type_slug, sub_type_slug)` UNIQUE index. Target ≤ 5ms p95
  added to the existing chat turn — well within the existing chat-API
  latency budget. No new external network calls.
- Step 6 contact extraction: reuses the existing `contact-form.ts`
  LLM-driven extraction; same latency profile as today.

**Constraints**:

- Constitution VI tool cap: agent stays at exactly two tools
  (`searchContext`, `captureLead`). The `analyzeAndFollowUp` removal
  brings the count from three back to two — moves us toward, not away
  from, the constitutional limit.
- Constitution VI maxSteps cap: `maxSteps: 5` is unchanged.
- Constitution V data boundary: structured logs for `branch_started`,
  `branch_question_answered`, `branch_completed`, `branch_skipped`
  (FR-033) MUST NOT include captured PII (no name, no email body, no
  phone digits) — only chip slugs, question ids, and category-level
  metadata. Same redaction discipline as spec 015 FR-034.
- Constitution IV serverless: no new long-running processes; no new
  filesystem writes. The migration is run via the existing
  `pnpm db:migrate` Drizzle path.
- Constitution II: every new boundary (HTTP → admin Branches APIs,
  agent tool args, dashboard form submissions) has a Zod schema in
  `@legal-chatbot/shared`. No `any` types.

**Scale/Scope**:

- ~12 new code files (5 in `packages/api/src/lib/`, 4 in
  `packages/dashboard/src/`, 3 in `packages/shared/src/schemas/`).
- ~8 new test files (colocated `.test.ts` plus 2 Playwright specs).
- 1 new Drizzle migration.
- 2 new HTTP endpoints (admin `GET /api/admin/branches`,
  `PUT /api/admin/branches/:case_type_slug/:sub_type_slug`).
- ~25 estimated tasks for `/speckit.tasks`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-evaluated after Phase 1 design.*

| Principle | Status | Note |
|---|---|---|
| **I. MVP-First Discipline** | ✅ Pass | This feature directly fixes a regression introduced by spec 015 (a feature within MVP §10) and operationalizes the multi-branch architecture spec 015 explicitly required ("the architecture must be extensible so admins can configure scoring for any (case_type, sub_type) pair"). No out-of-scope additions: only Personal Injury → Car Accident remains the configured branch at MVP launch (Assumption A in spec). |
| **II. Type Safety & Schema-Validated Boundaries** | ✅ Pass | New entities (`Branch`, `BranchQuestion`, `BranchChip`, `BranchSnapshot`) are all defined as Zod schemas in `@legal-chatbot/shared`. New HTTP endpoints validate request and response bodies via Zod. Drizzle ORM is the only DB access path. No raw SQL. |
| **III. Test-First, Layered Testing** | ✅ Pass | Plan enumerates unit + integration + E2E layers per Constitution III table. Every new code path has a failing test specified in `quickstart.md` and tasks. Two Playwright walks (one happy, one regression). LLM-backed integration tests use MSW; no live LLM calls in CI. |
| **IV. Serverless-Compatible & Stateless Server** | ✅ Pass | All new endpoints are Next.js Route Handlers (no Server Actions). No new native dependencies. No filesystem persistence. Branch state lives entirely in Neon. The agent runtime is unchanged structurally; widget and CDN bundle untouched. |
| **V. Privilege, Privacy, Data-Boundary** | ✅ Pass | Structured logs (`branch_started`, `branch_question_answered`, `branch_completed`, `branch_skipped`) MUST NOT include PII (FR-033). Lead PII (name, email, phone) is stored only in `leads` columns; never in logs. Branch configurations contain no PII. The `BranchSnapshot` on the lead row is the only PII-adjacent JSON column and follows the existing `leads` table redaction rules. |
| **VI. Bounded, Observable, Cost-Aware Agent** | ✅ Pass — *strengthened* | Tool count moves 3 → 2 (`analyzeAndFollowUp` removed; `searchContext` + `captureLead` remain). Token budget unchanged (no new system-prompt content; SOP step prose is reused). `maxSteps: 5` unchanged. Per-session message rate limit and per-API-key daily cap unchanged. Logging extended (4 new event types) per Principle VI's observability rule. |
| **VII. Phased Incremental Delivery** | ✅ Pass | This feature is a defect-fix + extension within Phase 5 (Lead Classification + DB) and Phase 6 (Dashboard) of §12.5. It does not skip phases or introduce out-of-order dependencies. Backwards compatibility for spec 015's `sub_types.scoring_config_json` is preserved through the migration; the column is deprecated but not dropped. |

**Result**: All gates pass. No Complexity Tracking entries required.

The only borderline item is Constitution VI's "Adding a third tool requires
a constitution amendment" — we are doing the inverse (removing a tool),
which is unambiguously aligned with the principle. No amendment is required.

## Project Structure

### Documentation (this feature)

```text
specs/016-multi-branch-sop/
├── plan.md              # This file (/speckit.plan output)
├── spec.md              # Already produced by /speckit.specify + /speckit.clarify
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (this command)
├── quickstart.md        # Phase 1 output (this command)
├── contracts/           # Phase 1 output (this command)
│   ├── branches-admin-api.md      # GET/PUT /api/admin/branches
│   ├── branch-runtime-contract.md # Branch lookup + advancer + finalize
│   └── tool-registry-contract.md  # Agent tool registry assertion
├── checklists/
│   └── requirements.md  # Already produced by /speckit.specify
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT this command)
```

### Source Code (repository root)

The existing pnpm + Turborepo monorepo. New and modified files:

```text
packages/shared/src/schemas/
├── branch.ts                       # NEW — branchSchema, branchQuestionSchema, branchChipSchema, branchSnapshotSchema
├── lead.ts                         # MODIFIED — extend with branch_snapshot_json + branch_incomplete
└── (existing files preserved; subTypeScoringConfigSchema marked @deprecated)

packages/api/src/db/
├── schema.ts                       # MODIFIED — add `branches` and `branch_versions` tables; add `branch_snapshot_json` and `branch_incomplete` columns to `leads`
├── migrate.ts                      # MODIFIED — wires the new 0004 migration
├── seed-defaults/
│   ├── default-sop.ts              # MODIFIED — add Step 6 (contact) at position 6
│   ├── car-accident-branch.ts      # NEW — seed JSON fixture (relocated from 015's scoring config)
│   └── (other seed files unchanged)
├── ensure-contact-step.ts          # MODIFIED — guarantees Step 6 exists for pre-existing accounts
├── ensure-car-accident-branch.ts   # NEW — replaces ensure-car-accident-scoring.ts (idempotent migrate-on-boot)
└── (existing files preserved)

packages/api/src/lib/sop/
├── follow-up-tool.ts               # DELETED
├── follow-up-tool.test.ts          # DELETED
├── branch-lookup.ts                # NEW — (case_type_slug, sub_type_slug) → Branch | null
├── branch-lookup.test.ts           # NEW
├── branch-advancer.ts              # NEW — given branch state + visitor input, yields next question or finalize
├── branch-advancer.test.ts         # NEW
├── branch-snapshot.ts              # NEW — freeze branch version + captured chips into lead's BranchSnapshot
├── branch-snapshot.test.ts         # NEW
├── advancer.ts                     # MODIFIED — after Step 6 satisfies, dispatches to branch-advancer or finalizes
├── contact-form.ts                 # MODIFIED — partial-gate satisfaction predicate (≥1 of email/phone)
├── contact-form.test.ts            # MODIFIED — new tests for partial-gate, retry counter, name-optional
├── skip-detector.ts                # MODIFIED — sequence-safe contact capture (FR-005a)
├── skip-detector.test.ts           # MODIFIED — tests for early-volunteered-contact behaviour
└── state-machine.ts                # MODIFIED — Step 6 (contact) before AI follow-up; AI follow-up step removed

packages/api/src/lib/scoring/
├── score-lead.ts                   # UNCHANGED signature — only its config-loading caller changes
├── score-lead-partial.ts           # NEW — wraps score-lead.ts for partial-branch scoring (FR-011a)
├── score-lead-partial.test.ts      # NEW
└── (other files preserved)

packages/api/src/app/api/
├── chat/route.ts                   # MODIFIED — remove analyzeAndFollowUp from tool registry; add branch advancer hook
├── admin/branches/
│   ├── route.ts                    # NEW — GET (list all (case_type, sub_type) pairs with branch status)
│   └── [caseType]/[subType]/
│       └── route.ts                # NEW — PUT (save), POST (publish), DELETE
└── (existing routes preserved)

packages/dashboard/src/app/dashboard/sop/
├── page.tsx                        # MODIFIED — add Branches tab to the existing tab strip
├── branches-tab.tsx                # NEW — top-level Branches view with the (case_type, sub_type) matrix
├── branch-editor.tsx               # NEW — per-branch question/chip/threshold/toggle editor
├── branch-editor.test.tsx          # NEW
└── (existing SOP-tab files preserved)

packages/dashboard/src/app/dashboard/leads/
├── page.tsx                        # MODIFIED — surface branch_incomplete badge on lead rows
└── lead-detail.tsx                 # MODIFIED — render BranchSnapshot in the detail view

packages/widget/src/
└── (no changes — widget is a pure UI layer; all branch logic is server-side)

tests/e2e/
├── smoke-016-personal-injury.spec.ts   # NEW — replaces smoke-015 happy path
└── smoke-016-criminal-defense.spec.ts  # NEW — regression test for the bug
```

**Structure Decision**: Reuse the existing 5-package monorepo (Constitution
IV.2). All changes are localized to `packages/api`, `packages/dashboard`,
and `packages/shared`; `packages/widget` and `packages/crawler` are
untouched. No new top-level packages.

## Complexity Tracking

> Constitution Check passed all gates with no violations. No entries.

