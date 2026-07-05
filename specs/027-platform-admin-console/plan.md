# Implementation Plan: Platform Admin Console

**Branch**: `027-platform-admin-console` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/027-platform-admin-console/spec.md`

## Summary

Build an internal, super-admin-only console inside `packages/api` for the SaaS
operator team to register, onboard, configure, oversee, and manage the lifecycle
of every law-firm tenant. LexBot is already multi-tenant at the data layer
(every domain table is `account_id`-scoped), but there is no operator tooling:
accounts are created only by seed scripts, initial config is hardcoded defaults,
the LLM is a globally-hardcoded `google('gemini-2.5-flash')` call, and there is
no cross-tenant view or analytics.

**Architecture decision**: The console is a new `/admin/*` UI surface plus
`/api/admin/*` route handlers in the existing Next.js app, guarded by a **new,
separate super-admin session** (a parallel iron-session with its own cookie and
secret — mirroring `dashboard-session.ts`, never reusing the firm session). It
introduces four new tables (`super_admins`, `account_llm_config`,
`admin_audit_log`, `usage_events`) and extends `accounts` with lifecycle/
onboarding columns. The hardcoded chat model call is replaced by a single
**provider-resolver** (`resolveModelForAccount(accountId)`) that reads
`account_llm_config` and falls back to `gemini-2.5-flash`. Onboarding reuses the
existing `seedSopForAccount` / `ensure*` machinery, transforming today's
script-only provisioning into a wizard-driven flow. Metrics are derived from
existing `sessions`/`leads`/routing data plus a **new `usage_events` table**
(token usage is currently captured nowhere — the AI SDK `usage` object is
discarded in `onFinish`).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 20+.

**Primary Dependencies**: Next.js 15 (App Router, Route Handlers only — no
Server Actions), Drizzle ORM (`drizzle-orm/neon-http` prod,
`drizzle-orm/better-sqlite3` test), Zod (all boundaries), `iron-session`
(auth), `bcryptjs` (super-admin password + widget API-key hashing), `nanoid`
(IDs), Vercel AI SDK (`ai`) with **`@ai-sdk/google` (existing) +
`@ai-sdk/anthropic` + `@ai-sdk/openai` (new)**. Node built-in `crypto`
(`aes-256-gcm`) for per-tenant provider-key encryption — no new crypto
dependency.

**Storage**: Neon serverless PostgreSQL. New tables: `super_admins`,
`account_llm_config`, `admin_audit_log`, `usage_events`. Extended: `accounts`
(+`status`, `onboarding_status`, `deleted_at`). IDs are `text` + `nanoid()`;
timestamps are ISO-string `text` columns (repo convention). Versioned config
reuses existing `configurations` / `sop_configurations` tables.

**Testing**: Vitest (unit + integration) with in-memory `better-sqlite3` (mock
of `./index.js` + `./schema.js` → `test-schema.js`); Playwright (E2E,
`tests/e2e`). New tables MUST be mirrored in `src/db/test-schema.ts` and the
per-test `CREATE TABLE` SQL, or mocks won't have them.

**Target Platform**: Netlify Functions running Next.js 15; Neon Postgres.
Serverless — no persistent filesystem, no native binaries (`bcryptjs`, not
`bcrypt`).

**Project Type**: Web application (Next.js app in `packages/api`; shared Zod
types in `packages/shared`). Widget untouched.

**Performance Goals**: Provider resolution adds ≤1 cached DB lookup per
conversation (reuse the 60s-TTL cache pattern from `auth.ts`). Fleet overview
and per-tenant metrics render in <2s for a realistic fleet (≤100 tenants) —
metrics aggregated with grouped queries, not per-tenant N+1.

**Constraints**: No Server Actions (Route Handlers only). Missing required env
vars MUST fail fast. Per-tenant provider API keys encrypted at rest
(recoverable, NOT hashed), never logged, never returned in plaintext after
entry. All existing agent bounds (maxSteps ≤ 5, ~4500-token context budget,
50 msgs/conversation, 1000 conversations/key/day) apply to every provider.
Firm-scoped `/api/dashboard/*` isolation MUST NOT be relaxed.

**Scale/Scope**: `packages/api` (new `/admin` pages, `/api/admin/*` handlers,
provider-resolver in chat route, `usage_events` capture, 4 new tables + 1
extended, new migration `0010`, `test-schema.ts` additions) + `packages/shared`
(new Zod schemas: admin session, LLM config, wizard submission, metrics DTOs).
`packages/widget` untouched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against constitution **v2.0.0** (amended 2026-07-05 to enable this
feature).

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline | ✅ PASS | Enabled by the v2.0.0 *Platform Admin Console carve-out*: super-admin multi-tenant operation, admin analytics, and user-configurable LLM providers are now permitted **inside the console only**. Deferrals still honored: no self-serve signup, no billing, no per-firm team roles, no SOP editing here. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | All new HTTP bodies/responses, wizard submissions, and LLM-config forms validated by new Zod schemas in `packages/shared`. Drizzle for all DB access. |
| III. Test-First, Layered Testing | ✅ PASS | Unit (provider-resolver fallback, encryption round-trip, metrics aggregation, wizard→config/SOP generation), integration (admin-guard 403, tenant CRUD, LLM-config CRUD, key rotation via in-memory SQLite), E2E (login→register→wizard→publish→live). Tests written before implementation. |
| IV. Serverless-Compatible & Stateless | ✅ PASS | Route Handlers only; no filesystem; `bcryptjs` + Node `crypto` (no native binaries). Provider resolution is request-scoped. |
| V. Privilege, Privacy, Data-Boundary Integrity | ✅ PASS | Per-tenant keys encrypted at rest, never logged/returned; widget keys stay bcrypt-hashed, shown once. Soft-delete writes `archived_data` snapshot. No PII in general logs. Firm isolation preserved. |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | Single provider-resolver (no scattered model calls); all bounds unchanged across providers; **new `usage_events` capture** records tokens + resolved provider/model per conversation (satisfies the §VI recording rule that is currently unmet). |
| VII. Phased Incremental Delivery | ✅ PASS | Delivered per user-story priority (P1→P3); each phase independently demonstrable. |
| VIII. Platform Administration & Tenant Isolation | ✅ PASS | Separate super-admin role/table/session; cross-tenant access only via guarded `/api/admin/*`; every mutation writes an `admin_audit_log` row (actor + timestamp); archival-on-delete; encrypted secrets; analytics from existing data + one justified new table. |

**Result**: PASS on all eight principles. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/027-platform-admin-console/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (admin API contracts)
│   ├── admin-auth.md
│   ├── tenants.md
│   ├── onboarding.md
│   ├── llm-config.md
│   ├── metrics.md
│   └── sop-view.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/api/
├── drizzle/
│   └── 0010_*.sql                         # new migration (extends accounts + 4 new tables)
├── src/
│   ├── db/
│   │   ├── schema.ts                       # + super_admins, account_llm_config,
│   │   │                                   #   admin_audit_log, usage_events; extend accounts
│   │   ├── test-schema.ts                  # SQLite mirror of the above (REQUIRED for tests)
│   │   ├── seed.ts                         # extract provisionTenant() from seed()'s account/apiKey/config block
│   │   └── seed-super-admin.ts             # new: dev super-admin seed
│   ├── lib/
│   │   ├── env.ts                          # NEW central fail-fast env (ENCRYPTION_KEY, provider keys, admin secret)
│   │   ├── admin-session.ts                # NEW parallel iron-session (cookie: legal_chatbot_admin)
│   │   ├── admin-guard.ts                  # NEW requireSuperAdmin() helper for /api/admin/*
│   │   ├── crypto.ts                        # NEW aes-256-gcm encrypt/decrypt for provider keys
│   │   ├── llm/provider-resolver.ts         # NEW resolveModelForAccount(accountId) + cache
│   │   ├── admin/tenant-provisioning.ts     # NEW register + wizard→draft config/SOP
│   │   ├── admin/metrics.ts                 # NEW funnel / usage-cost / routing aggregations
│   │   ├── admin/audit.ts                   # NEW recordAdminAction(...)
│   │   └── usage.ts                          # NEW recordUsageEvent(...) called from chat onFinish
│   └── app/
│       ├── admin/                           # NEW UI (mirrors app/dashboard structure)
│       │   ├── login/page.tsx
│       │   ├── layout.tsx                    # guards on admin session
│       │   ├── sidebar.tsx
│       │   ├── page.tsx                      # fleet overview
│       │   └── tenants/[id]/…                # detail, wizard, llm, metrics, sop-view
│       └── api/
│           ├── admin/
│           │   ├── login/route.ts
│           │   ├── logout/route.ts
│           │   ├── tenants/route.ts          # GET list (fleet), POST create
│           │   ├── tenants/[id]/route.ts     # GET detail, DELETE (soft)
│           │   ├── tenants/[id]/onboarding/route.ts
│           │   ├── tenants/[id]/publish/route.ts
│           │   ├── tenants/[id]/llm-config/route.ts
│           │   ├── tenants/[id]/status/route.ts   # suspend/reactivate
│           │   ├── tenants/[id]/rotate-key/route.ts
│           │   ├── tenants/[id]/metrics/route.ts
│           │   └── tenants/[id]/sop-view/route.ts
│           └── chat/route.ts                 # MODIFIED: model = await resolveModelForAccount(auth.accountId);
│                                             #           onFinish captures usage
└── vitest.setup.ts                           # add defensive defaults for new required env vars

packages/shared/src/schemas/
├── admin.ts                                  # NEW admin session, wizard submission, DTOs
└── llm-config.ts                             # NEW provider/model/key config schema
```

**Structure Decision**: Web application. All work lands in `packages/api`
(console UI + admin API + chat-route resolver + new tables/migration) and
`packages/shared` (Zod schemas). Chosen over populating the empty
`packages/dashboard` workspace because it reuses the existing auth/session/DB/
test wiring in one deploy target (per the approved design doc
`docs/superpowers/specs/2026-07-05-admin-console-design.md`). The widget is
untouched.

## Complexity Tracking

> No constitution violations. Section intentionally empty.
