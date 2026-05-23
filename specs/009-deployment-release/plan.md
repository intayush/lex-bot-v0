# Implementation Plan: Deployment & Release

**Branch**: `009-deployment-release` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-deployment-release/spec.md`

## Summary

Deployment & Release is the operational layer that ships the
eight prior feature builds to production. Per §1.8 the deployment
model places three things in three places: context files
self-hosted on the lawyer's server (output of `002-crawler-cli`),
the chatbot API and Dashboard hosted centrally as SaaS
(deployed here to Netlify per §9.7), and the chat widget embedded
in the lawyer's website via NPM and CDN distribution
(also deployed here per §9.7).

This is **Phase 8** per §12.5. It depends on every prior feature
(`001-foundation` through `008-hardening`) and is the gate
before any "production" claim.

A working partial deployment exists today:

- `packages/api/netlify.toml` configures the Dashboard + API
  Netlify site with `@netlify/plugin-nextjs` per §9.7.
- `packages/widget/netlify.toml` configures the Widget + Demo
  Netlify site with the `chatbot-context/` static asset publish
  per §9.7 row 2.
- Root `package.json` has `turbo`-orchestrated scripts.

The 33 FRs in the spec map onto an implementation that is
**roughly 30% complete** (Netlify configs in place; everything
else missing). This plan targets the gaps:

- **R1** — GitHub Actions CI workflow (`/.github/workflows/ci.yml`)
  implementing §9.10 stages 1–5 on every PR + stage 6 (E2E) on
  merge to `main` (FR-014 to FR-019).
- **R2** — Playwright E2E test suite at `packages/api/tests/e2e/`
  covering §9.10 step 6 + §9.8 row 3 (Dashboard flows: login,
  configure, view leads).
- **R3** — Bundle-size CI gate via `size-limit` integrated into
  the CI workflow (Foundation deferred this to Phase 4; Phase 4
  defined the contracts in `005-chat-widget` plan R8; Phase 8
  wires it into the actual workflow).
- **R4** — Changesets initialization (`.changeset/`) with
  `changeset publish` workflow for npm publication of the
  Crawler and Widget packages (FR-018, FR-024–FR-027).
- **R5** — Conversation-quality eval suite at `evals/` with the
  manual-release-gate process documentation (FR-020 to FR-023).
- **R6** — Production seed guard: the dev seed must refuse to
  run when `NODE_ENV=production` or when `DATABASE_URL` looks
  like a production connection string (FR-033, SC-015).
- **R7** — Production environment-variable inventory + Netlify
  configuration documentation (FR-009, FR-010).
- **R8** — npm publish workflow (`/.github/workflows/release.yml`)
  triggered by Changeset version PRs (FR-024–FR-027, SC-013).
- **R9** — Per-Netlify-site `package.json` adjustments to declare
  the `@legal-chatbot/widget` NPM package as publishable
  (currently `private: true`).
- **R10** — Production migration runbook documenting the
  `pnpm db:migrate` invocation against Neon (FR-032, SC-014).
- **R11** — Constitution-aligned deploy invariants enforced in
  CI: no Server Actions in code; no native binaries in the API
  package; CORS wildcard verified.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation).
The CI workflows themselves are YAML; everything else stays
TypeScript per §9.1.

**Primary Dependencies** (already installed; nothing new needed
for binding work):

- `turbo` — monorepo build orchestration (§9.6).
- `@netlify/plugin-nextjs` — Next.js Netlify build (§9.7 row 1).
- `vite` — widget Vite build (§9.7 row 2).
- `@changesets/cli` — version management + changelogs (§9.10).
- `@playwright/test` — E2E test runner (§9.8 row 3).
- `size-limit` + `@size-limit/preset-app` (or similar) — bundle-size
  CI gate (§6.10, R3).
- `vitest` — unit/integration test runner (§9.8).

**Storage**: Production Neon serverless PostgreSQL per §9.7 row 4.
The Crawler npm package, Widget npm package, and the two Netlify
sites are the four release artifacts.

**Testing**:

- CI runs the full §9.10 pipeline on every PR (stages 1–5).
- CI runs the §9.10 step 6 Playwright E2E suite on merge to main
  (after build).
- The conversation-quality eval suite (R5) is a **manual** gate
  per §9.8 — it runs against the live deployed agent before
  release (not in CI).

**Target Platform**: Netlify Functions (serverless) for the API
+ Dashboard site; Netlify static for the Widget + Demo site;
npm registry for the Crawler and Widget npm packages; Neon
managed PostgreSQL for the database.

**Project Type**: Repository-wide infrastructure feature. Most
"code" is YAML (`.github/workflows/`), markdown documentation,
and configuration files. Some TypeScript (E2E test files, eval
scripts). Pure additive work — no existing code is replaced.

**Performance Goals**:

- CI pipeline (PR stages 1–5) completes in ≤ 10 minutes on
  cached pnpm + turbo (per industry norms — spec is silent).
- Netlify build completes within Netlify's standard build window
  (≤ 15 minutes).
- npm publish via Changesets completes in ≤ 5 minutes after a
  release PR merges.

**Constraints**:

- TS strict (Constitution II) for any TypeScript artifacts (E2E
  tests, eval scripts).
- All Foundation invariants apply at deploy time:
  - No Server Actions in any deployed Next.js app
    (Constitution IV).
  - No native binaries in production deps (Constitution IV).
  - CORS `Access-Control-Allow-Origin: *` on the API
    (Constitution IV / FR-013).
  - `bcryptjs`, never `bcrypt` (Constitution IV / FR-012).
- Production seed guard MUST prevent dev account / dev API key
  insertion on production database (FR-033, SC-015).
- npm publishes require lawyers and engineers to maintain
  package version discipline (Changesets enforces).
- Conversation-quality eval suite is a release-gate, not a CI
  gate (per §9.8 binding "tracked as a manual QA step").

**Scale/Scope**: Two Netlify sites, two npm packages, one Neon
database. Single-environment deployment for MVP (production
only); preview deploys via Netlify's default branch-deploy
behavior (per Assumption documented in spec.md).

## Constitution Check

| # | Principle | Deployment & Release applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors (§1.8, §1.9, §9.7, §9.8, §9.10, §12.3, §12.4). All §10 / §8.12 deferred items explicitly out of scope. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | E2E tests + eval scripts use TS strict; CI YAML is type-checked indirectly (action versions pinned); production migration uses Drizzle types. | ✅ PASS |
| III | Test-First, Layered Testing | Each layer of §9.8 has a CI integration; conversation-quality manual gate documented. Existing helper tests (Phases 1–8) inherited unchanged. | ✅ PASS |
| IV | Serverless / Stateless Architecture | Netlify Functions + Neon (managed) + npm registry + CDN — all serverless / managed. CI invariants block Server Actions / native binaries / non-wildcard CORS at PR time (R11). | ✅ PASS |
| V | Privilege & Privacy | Production seed guard prevents dev credentials on production DB (R6); Foundation logger redaction inherited; npm-published packages contain no secrets. | ✅ PASS |
| VI | Bounded, Observable Agent | Conversation-quality eval gate (R5) ensures regressions in agent behavior are caught before release; bundle-size gate (R3) ensures widget budget compliance per Constitution Architectural Limits. | ✅ PASS |
| VII | Phased Incremental Delivery | Phase 8; depends on every prior phase being complete. The CI workflow shape is the integration contract that enforces phase ordering: stages 1–5 on every PR catch any phase's regression. | ✅ PASS |

**Architectural Limits**: Widget bundle ≤ 35 KB gz (NPM) and
≤ 50 KB gz (CDN) enforced in CI by R3. All other limits
(50/conv, 1000/key/day, maxSteps:5, ~4500-token cap) are
enforced at runtime by their owning features; the deploy
artifact carries those guarantees.

**Result**: All gates PASS. R1–R11 are net-new infrastructure
work, not Constitution violations. No amendments required.

## Project Structure

### Documentation (this feature)

```text
specs/009-deployment-release/
├── plan.md
├── research.md
├── data-model.md           # Deploy artifacts (no DB entities); release-gate state
├── quickstart.md
├── contracts/
│   ├── ci-pipeline-contract.md          # GitHub Actions stages + branch rules
│   ├── netlify-deploy-contract.md       # Two-site config + env vars
│   ├── npm-publish-contract.md          # Changesets + release workflow
│   ├── eval-suite-contract.md           # Conversation-quality manual gate
│   └── deploy-invariants-contract.md    # CI checks for Server Actions / native binaries / CORS
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (repository-wide)

```text
legal-chatbot/
├── .github/                              # ❌ NEW (R1, R8)
│   └── workflows/
│       ├── ci.yml                        # PR stages 1–5 + merge-to-main E2E
│       └── release.yml                   # Changeset publish to npm on version merge
├── .changeset/                           # ❌ NEW (R4)
│   ├── config.json                       # Changesets config
│   └── README.md
├── netlify.toml                          # ❌ NEW (optional repo-root pointer; OR keep per-package)
├── packages/api/
│   ├── netlify.toml                      # ✅ EXISTS — verify NODE_ENV + env vars
│   ├── tests/e2e/                        # ❌ NEW (R2)
│   │   ├── playwright.config.ts
│   │   ├── login.spec.ts
│   │   ├── configure.spec.ts
│   │   └── leads.spec.ts
│   └── src/db/seed.ts                    # ⚠ EXTEND — add R6 production-seed guard
├── packages/widget/
│   ├── netlify.toml                      # ✅ EXISTS — verify VITE_API_URL pipeline
│   ├── package.json                      # ⚠ EXTEND — set `private: false`, add `publishConfig`, `files` (R9)
│   └── .size-limit.json                  # ❌ NEW (R3)
├── packages/crawler/
│   └── package.json                      # ⚠ EXTEND — set `private: false`, add `publishConfig`, `bin`, `files` (R9, FR-005)
├── evals/                                # ❌ NEW (R5)
│   ├── README.md
│   ├── scenarios/
│   │   ├── personal-injury-urgent.yml
│   │   ├── family-law-normal.yml
│   │   ├── tax-out-of-scope.yml
│   │   └── injection-attempt.yml
│   └── run-evals.ts                      # Harness: drives /api/chat against deployed URL
├── docs/
│   ├── deployment-runbook.md             # ❌ NEW (R7, R10) — production migration + env config
│   ├── user-testing.md                   # ⚠ shared with `008-hardening` R9
│   └── release-process.md                # ❌ NEW (R5, R8) — release-gate procedure
└── package.json                          # ⚠ EXTEND — add `release`, `eval`, `test:e2e` scripts; add `@changesets/cli`, `@playwright/test`, `size-limit` devDeps
```

**Structure Decision**: All work lives at repository root or in
existing packages. NO new workspace packages introduced
(Constitution Required Stack respected). The `evals/` directory
is a top-level repository folder (not a package) per the spec's
Assumption that eval suite location is operator choice.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven Constitution principles pass. The dual-Netlify-site
topology is mandated by §9.7 — not a complexity choice.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/009-deployment-release/plan.md` | ✅ written |
| Research | `specs/009-deployment-release/research.md` | ✅ written (11 research items: R1–R11) |
| Data model | `specs/009-deployment-release/data-model.md` | ✅ written (release artifacts catalog + operational records + state diagrams) |
| Contracts | `specs/009-deployment-release/contracts/` | ✅ written (5 contracts: ci-pipeline, netlify-deploy, npm-publish, eval-suite, deploy-invariants) |
| Quickstart | `specs/009-deployment-release/quickstart.md` | ✅ written (9-step §12.5 Phase 8 walkthrough + done-when SC verification map) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; all §10 deferred items explicit out of scope | ✅ |
| II | Type Safety & Zod | E2E specs use TS strict; eval scenarios validated via Zod at parse time; production migration via Drizzle types | ✅ |
| III | TDD layered | CI integrates Vitest + Playwright; manual eval gate at release-time per §9.8 | ✅ |
| IV | Serverless / Stateless | Production seed guard (R6); deploy-invariants CI gate (R11); CORS verified; no native binary; no Server Actions | ✅ |
| V | Privilege & Privacy | Production seed guard prevents dev credentials on prod; no secrets in logs / npm packages / git tags | ✅ |
| VI | Observable Agent | Conversation-quality eval (R5) is the operator-facing observability gate; bundle-size CI gate (R3) enforces widget budgets | ✅ |
| VII | Phased Delivery | CI shape enforces phase ordering; Changesets gates npm publishes; deploy invariants enforce Constitution IV at PR time | ✅ |

**Architectural Limits**: Bundle-size gate enforces widget
budgets at CI time; runtime limits owned by their respective
features.

**Result**: All gates PASS post-design. R1–R11 are net-new
infrastructure work, not Constitution violations.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 8 user stories in `spec.md` (P1×7, P2×1).
- 33 FRs in 9 groups (A–I).
- 11 research items.
- 5 contracts.

Task graph:

- **Phase A** (sequential, foundational): R6 production seed
  guard → R9 npm package metadata → R4 Changesets init →
  R11 deploy-invariants script.
- **Phase B** (parallel after Phase A): R1 CI workflow;
  R2 Playwright E2E suite; R3 bundle-size gate (depends on
  Phase 4 widget bundle); R7 deployment runbook.
- **Phase C** (sequential after Phase B): R8 release.yml
  workflow (depends on R1's CI workflow); R10 production
  migration runbook (depends on operator action).
- **Phase D** (manual release-gate): R5 eval suite +
  initial scenarios. The eval suite is built in code; running
  it is a manual release-gate per §9.8.

Final integration: a "release dress rehearsal" where the team
walks the §12.5 Phase 8 walkthrough end-to-end against a
staging environment before the first real production release.

