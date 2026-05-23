# Implementation Plan: Dashboard

**Branch**: `007-dashboard` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-dashboard/spec.md`

## Summary

The Dashboard is the lawyer-facing web application — "the single
control plane for everything that isn't the crawler CLI" (§8.1).
It provides authentication, the seven configuration form sections,
the Leads list + detail view, the Notifications drawer, the
Widget Installation flow, the Crawler Status page, and the
Preview & Test chat. Per §8.11 it is built on Next.js + Tailwind
+ Drizzle + bcryptjs + iron-session and deployed to Netlify with
`@netlify/plugin-nextjs`. Per §8.4 / §9.7, mutations go through
Route Handlers — never Server Actions.

This is **Phase 6** per §12.5. It depends on every prior phase:
Foundation database schema, Crawler manifest output,
`searchContext` for the "Test context retrieval" action,
`captureLead` writes for the Leads page reads, and the Chat
Widget for the Preview & Test page.

A working partial implementation already exists at
`packages/api/src/app/dashboard/` (1,665 LOC across config form,
preview chat, leads list/detail, sidebar, layout, page) plus
auth route handlers in `packages/api/src/app/api/auth/` and the
config save/publish route at
`packages/api/src/app/api/dashboard/config/route.ts`. The 67 FRs
in the spec map onto an implementation that is **roughly 35%
complete** — the existing parts (login, config form, leads list,
leads detail, config save/publish) are well-built; many entire
pages and surfaces are missing.

This plan targets the gaps:

- **R1** — **Architectural decision**: keep the dashboard
  co-located with the API (`packages/api/src/app/dashboard/`)
  rather than reviving the empty `packages/dashboard/`
  package. Document why this aligns with §9.7's "Dashboard + API
  | Netlify (`@netlify/plugin-nextjs`) | base directory
  `packages/api`" deployment model.
- **R2** — Account signup + password reset (FR-001, FR-004).
- **R3** — Notifications drawer + bell + unread count
  (FR-040–FR-045).
- **R4** — Widget Installation page: API-key management,
  install snippet generator, verify-installation probe
  (FR-046–FR-048).
- **R5** — Crawler Status page: status fields + Re-crawl,
  View manifest, Test context retrieval actions (FR-049–FR-052).
- **R6** — Preview & Test page (separate from in-config
  preview): embeds the same `<ChatWidget>` from `005-chat-widget`
  with the `x-preview` header; debug panel showing tool calls,
  files retrieved, token usage per turn (FR-053–FR-057).
- **R7** — Lead actions: Mark as contacted, Add internal note,
  Dismiss, Export PDF/JSON (FR-039); bulk actions (FR-033);
  pagination 25/page (FR-034); deletion with archival (FR-059).
- **R8** — Configuration version history + diff view +
  one-click rollback (FR-023, FR-024).
- **R9** — Privacy policy template surface (FR-060) +
  Data retention disclosure (cross-feature with `008-hardening`).
- **R10** — Transcript export (FR-061).
- **R11** — Overview page (FR-006: §8.3 lists "Overview (home)").
- **R12** — Schema additions: `internal_notes` column on leads
  (Assumption from spec); ensure `notifications` reads (already
  written by Phase 5).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ per §8.11
+ Foundation. Module is ESM, runs as Next.js 15 App Router under
Netlify Functions.

**Primary Dependencies** (already in `packages/api/package.json`,
per §8.11 + Constitution Required Stack):

- `next` 15 (App Router; Route Handlers only — no Server Actions).
- `react` 19 + `react-dom` 19.
- `tailwindcss` (already in use across existing pages).
- `drizzle-orm` + `@neondatabase/serverless`.
- `bcryptjs` — password hashing.
- `iron-session` — encrypted cookie session.
- `nanoid` — IDs.
- `@legal-chatbot/shared` — schemas, env, logger.
- `@legal-chatbot/widget` — embedded for §8.10 Preview chat.
- `@vercel/og` or similar — POST-MVP for PDF export (Assumption
  flagged; alternative: client-side `jsPDF`).

**Storage**: Neon PostgreSQL via Drizzle. Tables:

- `accounts`: read/write (signup, login).
- `api_keys`: read/write (manage page).
- `configurations`: read/write (form, version history, publish).
- `sessions`: read (transcript view).
- `leads`: read/write (list, detail, status mutations,
  internal_notes, deletion).
- `archived_data`: write (on deletion).
- `notifications`: read/write (drawer, mark-read).

**Testing**: Vitest for unit tests of helpers (Drizzle queries,
exports). Playwright for E2E (per §9.8 row 3 + §12.11 done-when
"Manual browser verification of all pages" — the spec is explicit
that automated tests are necessary but manual verification is
binding for several UX acceptance criteria).

**Target Platform**: Netlify Functions (serverless) per §9.7.
Server-rendered pages and API routes share the same Netlify
deploy. The widget is embedded for §8.10 Preview either via NPM
import (production build inlines it) or via the same workspace
package reference (dev mode HMR works).

**Project Type**: Next.js 15 App Router web app inside
`packages/api`. The `packages/dashboard/` package is currently
unused and remains so per R1 (no removal — Constitution
Required Stack would require an amendment to remove it; leaving
it as a placeholder is harmless).

**Performance Goals**:
- Page render: server-side render plus client hydration; SSR-only
  for non-interactive pages (Overview, Crawler Status read).
- Leads list pagination: 25 per page (FR-034).
- Configuration save: a single DB insert via `POST /api/dashboard/config`.
- Verify-installation probe: timeout 5 s.

**Constraints**:
- Server Actions FORBIDDEN (§8.4 implementation note + §9.7 +
  Constitution Principle IV). All mutations go through `POST /api/dashboard/*` Route Handlers.
- TS strict (Constitution II).
- Zod-validate every mutation body (Constitution II).
- No native binary deps (`bcryptjs`, never `bcrypt`).
- iron-session cookie: HTTP-only, Secure in production
  (FR-003 + §8.2).
- Lawyer can ONLY see their own data (account_id scoping on
  every query).
- No fs writes at runtime (Constitution IV).
- Logger MUST redact secrets (Constitution V).
- Constitution VII: schema additions (R12) coordinated via
  Foundation `drizzle-kit` migration tooling.

**Scale/Scope**: Single user per account (FR-002 + §8.2). The
scale ceiling is per §11.1: 1000 conversations/key/day, so a
busy firm sees ~1000 leads/day max. The Leads page paginates
at 25/page, sufficient for most firms' weekly volume on a
single page-of-pages.

## Constitution Check

| # | Principle | Dashboard applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors (§4.x, §8.x, §11.5, §12.11). All §10 / §8.12 deferred items are explicitly out of scope. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Configuration form output uses `configurationSchema` from `packages/shared`; all mutation bodies Zod-validated; Drizzle typed queries throughout. | ✅ PASS — pending mutation route validation gap-fills |
| III | Test-First, Layered Testing | Existing helpers have tests; pages use Playwright E2E (§9.8 row 3); §12.11 done-when "Manual browser verification of all pages" is the binding gate but automated tests precede implementation per Constitution III. | ✅ PASS — pending E2E + helper tests |
| IV | Serverless / Stateless Architecture | Next.js Route Handlers only — NO Server Actions (§8.4 + §9.7); `iron-session` cookie auth (no DB session); no fs writes; no native binaries (`bcryptjs`). | ✅ PASS |
| V | Privilege & Privacy | Account-scoped queries on every read; deletion writes to `archived_data` (FR-059); transcript export (FR-061); privacy policy template surface (FR-060); cookie HTTP-only Secure. | ✅ PASS — pending R7 (deletion + archival), R10 (transcript export) |
| VI | Bounded, Observable Agent | Dashboard is read-mostly for the agent; the only agent-touching surface is Preview chat (R6) which uses `x-preview: true` and is not counted as production conversations; rate limits owned upstream. | ✅ PASS |
| VII | Phased Incremental Delivery | Phase 6 of §12.5; depends on every prior phase; the Preview chat reuses Phase 4 widget; the Test context retrieval action reuses Phase 2 search; the read of `leads` + `notifications` consumes Phase 5 writes. | ✅ PASS |

**Required Stack** (from Constitution): all decisions stay
inside the binding stack table. The empty
`packages/dashboard/` package remains in the workspace per
Constitution Required Stack but is not built (R1).

**Architectural Limits**: Pagination at 25 leads/page; all other
limits (50/conv, 1000/key/day) are upstream.

**Result**: All gates PASS. R1–R12 are gap-fills, not
Constitution violations. The empty `packages/dashboard/` package
is a known workspace artifact; R1 documents the rationale for
keeping the dashboard implementation co-located with the API
package.

## Project Structure

### Documentation (this feature)

```text
specs/007-dashboard/
├── plan.md
├── research.md
├── data-model.md           # Read/write entity matrix; new internal_notes column; export shapes
├── quickstart.md
├── contracts/
│   ├── auth-routes-contract.md            # POST /api/auth/{login,logout,signup,reset}
│   ├── dashboard-config-route-contract.md  # POST /api/dashboard/config (save/publish/rollback)
│   ├── dashboard-leads-routes-contract.md  # GET/PATCH /api/dashboard/leads/* + actions
│   ├── notifications-route-contract.md     # GET/PATCH /api/dashboard/notifications
│   ├── api-keys-route-contract.md          # POST/DELETE /api/dashboard/api-keys
│   ├── crawler-status-route-contract.md    # GET /api/dashboard/crawler-status
│   └── widget-installation-contract.md     # Verify-installation probe
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (`packages/api/src/`)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/api/src/
├── app/
│   ├── login/                          # ✅ exists
│   ├── signup/                         # ❌ NEW (R2)
│   ├── reset-password/                 # ❌ NEW (R2)
│   ├── dashboard/
│   │   ├── layout.tsx                  # ⚠ EXTEND — add notifications bell + drawer
│   │   ├── page.tsx                    # ⚠ EXTEND — Overview page (currently 5 LOC stub)
│   │   ├── sidebar.tsx                 # ⚠ EXTEND — add nav items: Notifications, Widget Installation, Crawler Status, Preview & Test
│   │   ├── logout-button.tsx           # ✅ keep
│   │   ├── leads/                      # ⚠ EXTEND
│   │   │   ├── page.tsx                # ⚠ EXTEND — pagination, bulk actions, search
│   │   │   ├── lead-table.tsx          # ⚠ EXTEND — sort/filter/search/bulk
│   │   │   └── [id]/
│   │   │       └── page.tsx            # ⚠ EXTEND — Mark contacted, Add note, Dismiss, Export, Delete actions
│   │   ├── config/                     # ✅ exists
│   │   │   ├── page.tsx                # ⚠ EXTEND — version history sidebar
│   │   │   ├── config-form.tsx         # ✅ keep
│   │   │   ├── preview-chat.tsx        # ✅ keep (in-config preview)
│   │   │   └── version-history.tsx     # ❌ NEW (R8)
│   │   ├── notifications/              # ❌ NEW (R3)
│   │   │   └── page.tsx                # Full notifications listing (drawer is the bell-attached UI)
│   │   ├── widget-install/             # ❌ NEW (R4)
│   │   │   ├── page.tsx
│   │   │   ├── api-keys-section.tsx
│   │   │   └── snippet-generator.tsx
│   │   ├── crawler-status/             # ❌ NEW (R5)
│   │   │   └── page.tsx
│   │   ├── preview/                    # ❌ NEW (R6) — standalone Preview & Test page
│   │   │   ├── page.tsx
│   │   │   └── debug-panel.tsx
│   │   └── components/                 # ❌ NEW
│   │       ├── notifications-bell.tsx  # (R3) bell + unread count
│   │       └── notifications-drawer.tsx # (R3) drawer
│   └── api/
│       ├── auth/
│       │   ├── login/route.ts          # ✅ exists
│       │   ├── logout/route.ts         # ✅ exists
│       │   ├── signup/route.ts         # ❌ NEW (R2)
│       │   └── reset-password/route.ts # ❌ NEW (R2)
│       └── dashboard/
│           ├── config/route.ts         # ⚠ EXTEND — add `rollback` action (R8)
│           ├── leads/                  # ❌ NEW
│           │   ├── [id]/route.ts       # PATCH lead status / add note / DELETE
│           │   ├── export/route.ts     # GET PDF or JSON export
│           │   └── bulk/route.ts       # POST bulk actions
│           ├── notifications/route.ts  # ❌ NEW — GET list, PATCH mark-read, mark-all-read (R3)
│           ├── api-keys/route.ts       # ❌ NEW — POST generate / DELETE revoke / POST rotate (R4)
│           ├── crawler-status/route.ts # ❌ NEW — GET aggregated status (R5)
│           ├── verify-install/route.ts # ❌ NEW — server-side probe (R4)
│           └── test-context/route.ts   # ❌ NEW — invokes searchContext (R5)
└── lib/
    ├── auth.ts                          # ⚠ EXTEND — signup helper, password reset token (R2)
    ├── config.ts                        # ⚠ EXTEND — rollback helper (R8)
    ├── notifications.ts                 # ❌ NEW (R3)
    ├── api-keys.ts                      # ❌ NEW (R4)
    ├── crawler-status.ts                # ❌ NEW (R5)
    ├── leads-actions.ts                 # ❌ NEW (R7)
    ├── leads-export.ts                  # ❌ NEW (R7, R10) — PDF / JSON / transcript
    ├── leads-deletion.ts                # ❌ NEW (R7) — write to archived_data
    └── ... (other lib/ files unchanged)
```

The empty `packages/dashboard/` package remains as-is per R1.

**Structure Decision**: Keep the dashboard implementation in
`packages/api/src/app/dashboard/` (the existing pattern). Per
R1, this aligns with §9.7 deployment row 1 ("Dashboard + API |
Netlify | base directory `packages/api`"). The empty
`packages/dashboard/` package is a workspace placeholder
referenced by Constitution Required Stack; it remains for
forward-compatibility (e.g., post-MVP white-labeling per §10
might warrant moving the dashboard back out).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

The dual-location of the dashboard package (empty workspace
package vs. populated `packages/api/src/app/dashboard/`) is
documented in R1 as an intentional architectural choice
aligned with §9.7. It is NOT a Constitution violation — the
empty workspace package satisfies Constitution Required Stack;
the population lives where deployment dictates.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/007-dashboard/plan.md` | ✅ written |
| Research | `specs/007-dashboard/research.md` | ✅ written (12 research items: R1–R12) |
| Data model | `specs/007-dashboard/data-model.md` | ✅ written (read/write entity matrix; new `password_resets` table; new `internal_notes` and `rotation_grace_until` columns; state diagrams; cross-feature coordination) |
| Contracts | `specs/007-dashboard/contracts/` | ✅ written (7 contracts: auth-routes, dashboard-config-route, dashboard-leads-routes, notifications-route, api-keys-route, crawler-status-route, widget-installation) |
| Quickstart | `specs/007-dashboard/quickstart.md` | ✅ written (full §12.11 walkthrough + per-page verification + auth flows + privacy template + transcript export) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; §10 / §8.12 deferred items explicitly out of scope | ✅ |
| II | Type Safety & Zod | Every mutation route Zod-validates body via discriminated unions or single-shape schemas; `configurationSchema` reused | ✅ |
| III | TDD layered | Helpers test-first (`api-keys.ts`, `notifications.ts`, `crawler-status.ts`, `leads-actions.ts`); Playwright E2E owns page coverage per §9.8 row 3 | ✅ |
| IV | Serverless / Stateless | Route Handlers ONLY; iron-session cookie; no fs writes; no Server Actions; bcryptjs only | ✅ |
| V | Privilege & Privacy | Account-scoped queries on every read; `archived_data` written on lead deletion (R7); plaintext API key shown once and never logged; cookie HTTP-only Secure; logger redaction | ✅ |
| VI | Observable Agent | Dashboard surfaces tools called + files retrieved + token usage in Preview debug panel (R6); rate limits owned upstream | ✅ |
| VII | Phased Delivery | R1 documents the dashboard co-location decision; schema additions (R12) coordinated via Foundation tooling; Preview chat reuses Phase 4 widget; Test context retrieval reuses Phase 2 cache invalidation; reads of `leads`/`notifications` consume Phase 5 writes | ✅ |

**Architectural Limits**: pagination at 25/page; all other limits
upstream.

**Result**: All gates PASS post-design. R1–R12 are gap-fills,
not Constitution violations. The empty `packages/dashboard/`
package is documented as an intentional workspace placeholder
(R1).

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 7 user stories in `spec.md` (P1×4, P2×3).
- 67 FRs in 13 groups.
- 12 research items.
- 7 contracts.

Task graph (rough):

- **Phase A** (sequential, foundational): R12 schema migrations
  → R2 signup + reset routes → R8 rollback action.
- **Phase B** (parallel after Phase A): R3 Notifications;
  R4 API keys + Widget Installation; R5 Crawler Status;
  R6 Preview & Test page; R7 Lead actions; R9 Privacy template
  surface; R10 Transcript export; R11 Overview page.
- **Phase C** (testing): Vitest helpers + Playwright E2E for
  the §12.11 binding manual verification items.

R1 (architectural decision) and R6 sub-decisions
(deletion semantics, PDF generation library) are settled in this
plan; no further task. R12's `key_prefix` sub-task documented in
`api-keys-route-contract.md`.

