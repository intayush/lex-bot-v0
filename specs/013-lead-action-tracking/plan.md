# Implementation Plan: Lead Action Tracking

**Branch**: `013-lead-action-tracking` (planned) | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

## Summary

Adds a lawyer-controlled "follow-up action" field to the existing
`leads` entity. The lawyer selects one of three values (`Contacted`,
`Call didn't answer`, `Client meeting fixed`) from the lead detail
page. The selection persists with a timestamp, surfaces in the leads
list table as a new column, and is editable at any time. Leads with
no recorded action show a clearly distinguishable placeholder so the
lawyer can scan the list at-a-glance for un-actioned leads.

This is a real feature with a schema migration: 2 nullable columns
added to the existing `leads` table (`follow_up_action` enum-like text +
`follow_up_action_changed_at` ISO timestamp). One new POST mutation
route handler. One new client component (the picker). Two existing
files edited (the leads list table + the lead detail page).

Estimated implementation time: ~1-2 hours.

The change builds on the established 007-dashboard pattern for
account-scoped writes (POST /api/dashboard/* discriminated-union body
+ iron-session auth + same-account FK check).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+. Module is ESM.
Server-side runs in Next.js Route Handlers under Netlify Functions;
client-side runs in the existing dashboard React app.

**Primary Dependencies** (all already in scope; no new deps required):

- `drizzle-orm` + `@neondatabase/serverless` — DB writes for the
  schema migration + the action update.
- `zod` — boundary validation for the new POST body.
- `nanoid` — not needed for this feature (using existing lead PK).
- `iron-session` — existing dashboard auth.
- `next/server` + React (Next.js App Router) — page + Route Handler.
- `@legal-chatbot/shared` — new Zod schema for the action enum gets
  exported here.

**Storage**: Neon PostgreSQL (production) + in-memory SQLite (tests).
**Two new columns** added to the existing `leads` table per
data-model.md:
- `follow_up_action: text` (nullable; one of `'contacted' | 'call_no_answer' | 'meeting_fixed'`)
- `follow_up_action_changed_at: text` (nullable; ISO 8601)

**Testing**:

- Vitest unit tests for the Zod schema (action validation) +
  the existing leads route extension (auth + authorization +
  cross-account guard).
- One new walk-tagged Playwright spec covering the full UX:
  navigate to lead → select action → save → see in table.

**Target Platform**: Same as upstream — Netlify Functions for API +
dashboard pages; modern evergreen browsers for the React UI.
Constitution IV invariants (no Server Actions, no native binaries,
CORS not relevant for `/dashboard/*` routes since they're
same-origin) inherited.

**Project Type**: Cross-cutting feature inside the existing pnpm +
Turborepo monorepo. No new workspace packages. Code lands in:

- `packages/shared/src/schemas/lead-action.ts` — NEW shared Zod schema
- `packages/api/src/db/schema.ts` — EXTEND (2 new columns on `leads`)
- `packages/api/src/db/test-schema.ts` — EXTEND (mirror for SQLite tests)
- `packages/api/drizzle/` — NEW migration file (auto-generated)
- `packages/api/src/app/api/dashboard/leads/[id]/action/route.ts` — NEW POST handler
- `packages/api/src/app/dashboard/leads/[id]/page.tsx` — EXTEND (render picker)
- `packages/api/src/app/dashboard/leads/[id]/action-picker.tsx` — NEW client component
- `packages/api/src/app/dashboard/leads/lead-table.tsx` — EXTEND (new column)
- `packages/api/tests/e2e/dashboard-lead-action.walk.spec.ts` — NEW walk spec

**Performance Goals**: No measurable change. The action update is a
single-row UPDATE (one DB roundtrip ~30-100ms via Neon-HTTP). The new
table column adds one text field per row at render time (negligible).
The migration is additive (two nullable columns); zero-downtime apply.

**Constraints**:

- TS strict (Constitution II).
- All new boundary inputs Zod-validated (Constitution II): the POST
  body must Zod-parse against `leadActionUpdateSchema`.
- All new persistent shapes use Drizzle typed inserts/updates
  (Constitution II).
- No Server Actions — Route Handler only (Constitution IV); pattern
  matches the existing `/api/dashboard/config` and `/api/dashboard/sop/*`
  routes from 007 + 010.
- Account-scoping (Constitution V): the route MUST verify the
  authenticated user's `accountId` matches the lead's `account_id`
  before applying the update. Cross-account write attempts return 404
  (NOT 403, to avoid leaking lead existence).
- Logger redaction (Constitution V): no PII in logs from this route
  (the action enum + lead id are not PII; we don't log full lead rows).
- Constitution VII: schema additions go through Foundation's
  `drizzle-kit` migration tooling. Migration is additive (two nullable
  columns); idempotent at apply time.

**Scale/Scope**: Per-lead, two new text fields totaling ~30-50 bytes.
At MVP scale (~hundreds of leads per account), negligible storage
impact. The new dashboard column adds one additional text node per
row at render time.

## Constitution Check

| # | Principle | Applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Feature implements §4 dashboard lead-management (the "lawyers manage leads" prototype loop). All FRs cite spec sections; v2 features (history log, custom vocabulary, bulk updates, table filtering) are explicitly out-of-scope. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | New `leadActionUpdateSchema` in `packages/shared/src/schemas/lead-action.ts`; POST body Zod-validated; Drizzle typed updates; new columns added to both prod and test schema files. | ✅ PASS |
| III | Test-First, Layered Testing | Vitest unit tests for the shared schema + the route handler authored before implementation; one walk-tagged Playwright spec covering the full UX. | ✅ PASS |
| IV | Serverless-Compatible & Stateless | Route Handler only (no Server Actions); single UPDATE per request; no fs writes; no new native deps. The `neon-http` driver constraint applies (no transactions); single-row UPDATE doesn't need one. | ✅ PASS |
| V | Privilege & Privacy | Account-scoping enforced server-side: a user from account A attempting to update a lead in account B receives a 404 (not 403, per privacy hygiene — don't leak lead existence). No new PII surfaces; the action enum is non-PII. Logger redaction policy unchanged. | ✅ PASS |
| VI | Bounded, Observable, Cost-Aware Agent | No agent changes. | ✅ PASS |
| VII | Phased Incremental Delivery | Single feature, single phase. Schema migration is additive (two nullable columns); zero-downtime apply. Independently revertible by rolling back the migration + reverting the file changes. | ✅ PASS |

**Architectural Limits**:

- Per-conversation messages cap, daily-conversations cap, agent
  recursion cap, token budget — all unaffected.
- Widget bundle size — unaffected (no widget changes).
- Migration tooling: existing `drizzle-kit generate` + `db:migrate`
  pipeline (Constitution VII).

**Result**: All gates PASS unconditionally. No Complexity Tracking
entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/013-lead-action-tracking/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── lead-action-route-contract.md
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (touchpoints)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/shared/src/
├── schemas/
│   ├── lead-action.ts                   # ❌ NEW — leadActionEnum + leadActionUpdateSchema + LeadAction type
│   └── index.ts                         # ⚠ EXTEND — re-export lead-action.ts

packages/api/src/
├── db/
│   ├── schema.ts                        # ⚠ EXTEND — add follow_up_action + follow_up_action_changed_at columns to leads
│   └── test-schema.ts                   # ⚠ EXTEND — mirror for SQLite tests
├── drizzle/
│   └── 000X_lead_action.sql             # ❌ NEW — auto-generated migration file
├── app/
│   ├── api/
│   │   └── dashboard/
│   │       └── leads/
│   │           └── [id]/
│   │               └── action/
│   │                   └── route.ts     # ❌ NEW — POST handler for action updates
│   │                   └── route.test.ts # ❌ NEW — route unit tests (auth + authz + Zod)
│   └── dashboard/
│       └── leads/
│           ├── lead-table.tsx           # ⚠ EXTEND — render the action column with badge for each lead
│           └── [id]/
│               ├── page.tsx             # ⚠ EXTEND — render <ActionPicker> + the timestamp display
│               └── action-picker.tsx    # ❌ NEW — client component (form + select + save button)

packages/api/tests/e2e/
└── dashboard-lead-action.walk.spec.ts   # ❌ NEW — Playwright walk-tagged spec
```

**Structure Decision**: All new code lives inside the existing
`packages/api`, `packages/shared` per the established Phase 6 R1 +
007-dashboard co-location decision. NO new workspace packages. The
new `[id]/action/` sub-route follows the same nesting pattern used
by `dashboard/sop/case-types/` and `dashboard/sop/goodbye-phrases/`
in 010.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All gates PASS unconditionally.
