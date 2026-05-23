# Implementation Plan: Foundation

**Branch**: `001-foundation` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-foundation/spec.md`

## Summary

The Foundation feature delivers cross-cutting infrastructure every other Lex Bot phase depends on: monorepo bootstrap, shared types/Zod schemas, the Drizzle/Neon database schema and migrations, the centralized environment loader, the structured-JSON logger, the GitHub Actions CI pipeline, and the single-command local testbed (§12.3). Significant scaffolding already exists (pnpm workspace, Turborepo, all five packages, base `tsconfig.base.json`, partial Drizzle schema, partial seed/migrate scripts). The implementation work targets the gaps: a centralized env-config loader (current `packages/api/src/lib/dashboard-session.ts:11` uses `process.env.SESSION_SECRET ?? ''` — violates Constitution IV); a structured-JSON logger; a GitHub Actions workflow; ESLint flat config; Prettier; idempotent migrate/seed; and verification that the existing schema fully matches §2.6.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (§9.1, §9.10).

**Primary Dependencies**: `drizzle-orm` + `drizzle-kit` + `@neondatabase/serverless`; `better-sqlite3` (dev-only); `zod`; `nanoid`; `bcryptjs`; `iron-session`; `vitest`; `eslint` (flat config); `prettier`; `turbo`; `tsx`. Per §9.9 / Constitution Required Stack.

**Storage**: Neon serverless PostgreSQL (prod via `drizzle-orm/neon-http`); in-memory SQLite (`better-sqlite3` + `drizzle-orm/better-sqlite3`) for tests. Schema defined once in `packages/api/src/db/schema.ts` (§2.6); parallel test schema in `test-schema.ts`. Production builds MUST NOT depend on `better-sqlite3`.

**Testing**: Vitest for unit + integration. MSW added by `004-chat-api-agent`. Playwright added by `007-dashboard`. Foundation only ensures Vitest is wired.

**Target Platform**: Local dev (any OS with Node 20+); production = Netlify Functions (deployed by `009-deployment-release`). Foundation MUST stay serverless-compatible (Constitution IV).

**Project Type**: Multi-package TypeScript monorepo (web service + library + CLI). Layout per §9.6.

**Performance Goals**: None Foundation-specific. Bootstrap (`pnpm install` + `pnpm dev`) completes in a reasonable window for a new engineer.

**Constraints**:
- TS strict (Constitution II).
- No native production deps (`bcryptjs` only, never `bcrypt`) — Constitution IV.
- No Server Actions — Constitution IV.
- No persistent fs at runtime — Constitution IV.
- Logging redacts secrets/PII — Constitution V.
- Required env vars cause fast startup failure — never silent fallback.

**Scale/Scope**: Free-tier Neon (0.5 GB / 190 hrs). Schema = 7 tables.

## Constitution Check

| # | Principle | Foundation applicability | Status |
|---|---|---|---|
| I | MVP-First | Every FR cites a §-number | ✅ |
| II | Type Safety & Zod | tsconfig strict; shared Zod; Drizzle | ✅ |
| III | TDD layered | Vitest infra; tests before impl | ✅ |
| IV | Serverless / Stateless | env fast-fail; logger→stdout; no native binaries; no fs | ✅ |
| V | Privilege & Privacy | Logger redaction enumerated | ✅ |
| VI | Bounded, Observable Agent | Logger schema supports session correlation, tool-call detail, full error context | ✅ |
| VII | Phased Delivery | Phase 0 is foundational; bundle-size CI gate deferred to Phase 4 | ✅ |

All gates PASS. No Complexity Tracking entries needed.

## Project Structure

```text
specs/001-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── env-contract.md
    ├── log-event-contract.md
    └── seed-contract.md
```

### Source Code

```text
legal-chatbot/
├── package.json                          # ✅ exists
├── pnpm-workspace.yaml                   # ✅ exists
├── turbo.json                            # ✅ exists
├── tsconfig.base.json                    # ✅ exists
├── eslint.config.mjs                     # ❌ NEW (flat config)
├── .prettierrc                           # ❌ NEW
├── .env.example                          # ❌ NEW
├── .github/workflows/ci.yml              # ❌ NEW (per §9.10 stages 1–5)
├── packages/shared/src/
│   ├── env/                              # ❌ NEW — env-loader module
│   │   ├── api-env.ts
│   │   ├── widget-env.ts
│   │   ├── dev-env.ts
│   │   └── api-env.test.ts
│   ├── logger/                           # ❌ NEW — structured-JSON logger
│   │   ├── logger.ts
│   │   ├── redact.ts
│   │   ├── debug-mode.ts
│   │   ├── logger.test.ts
│   │   └── redact.test.ts
│   └── schemas/                          # ✅ exists; verify §2.6 alignment
└── packages/api/src/
    ├── db/                               # ✅ schema/migrate/seed exist
    │   └── seed.test.ts                  # ❌ NEW — idempotency tests
    └── lib/dashboard-session.ts          # ⚠ FIX — use shared env loader
```

**Structure Decision**: Continue existing pnpm + Turborepo layout. Foundation work is additive (new files in `packages/shared/src/env/` and `logger/`, new repo-root configs) plus targeted fixes (env-loader migration in `dashboard-session.ts`, idempotency in seed/migrate).

## Complexity Tracking

None. All seven Constitution principles pass without exceptions.

## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/001-foundation/plan.md` | ✅ |
| Research | `specs/001-foundation/research.md` | ✅ |
| Data model | `specs/001-foundation/data-model.md` | ✅ |
| Contracts | `specs/001-foundation/contracts/` | ✅ |
| Quickstart | `specs/001-foundation/quickstart.md` | ✅ |

## Constitution Re-Check (Post-Design)

After Phase 0 (research) and Phase 1 (data model, contracts, quickstart), the Constitution Check is re-evaluated against the concrete design.

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | research.md, contracts, data-model all cite §-numbers | ✅ |
| II | Type Safety | env Zod schemas explicit; data-model validation rules enumerated | ✅ |
| III | TDD layered | Each contract enumerates required tests; tests precede impl | ✅ |
| IV | Serverless / Stateless | Fast-fail env; logger→stdout; no fs; no native binary in prod | ✅ |
| V | Privilege & Privacy | Redaction list explicit | ✅ |
| VI | Observable Agent | Logger schema supports session correlation + tool-call detail | ✅ |
| VII | Phased Delivery | Bundle-size CI gate deferred to Phase 4; E2E to Phase 6 | ✅ |

**Result**: All gates PASS post-design. No Complexity Tracking entries required.

## Hand-Off to `/speckit.tasks`

Tasks will be derived from the spec's User Stories (4 stories, P1/P1/P1/P2), the 52 FRs in 8 groups, and the Phase 1 artifacts. Foundation is a single-package-mostly feature; the task graph is relatively flat with most parallelizable work in `packages/shared/src/env/` and `packages/shared/src/logger/`.
