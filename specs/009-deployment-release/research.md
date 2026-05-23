# Phase 0 Research: Deployment & Release

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the
Deployment & Release feature against
`product-spec-legal-chatbot.md` (§1.8, §1.9, §9.7, §9.8, §9.10,
§12.2, §12.3, §12.4) and the Lex Bot Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers; items below are
the implementation plan for R1–R11.

## R1. CI Pipeline (GitHub Actions)

**Decision**: Add `.github/workflows/ci.yml` with two jobs:

1. **`pr-checks`** — runs on `pull_request` and `push` to any
   branch. Stages per §9.10:
   - `pnpm/action-setup` + Node 20 setup.
   - Cache pnpm store keyed on `pnpm-lock.yaml` hash.
   - `pnpm install --frozen-lockfile` (stage 1).
   - `pnpm typecheck` (stage 2; runs `tsc --noEmit` across
     all packages via Turbo).
   - `pnpm lint` (stage 3).
   - `pnpm test` (stage 4; Vitest unit + integration).
   - `pnpm build` (stage 5; Turbo build for all packages).
   - `pnpm size` (stage 6 / R3 bundle-size gate).

2. **`merge-checks`** — runs on `push` to `main`. Reuses
   `pr-checks` artifacts (or re-runs the install + build) and
   adds:
   - `pnpm test:e2e` (Playwright; per §9.10 step 6).

If any stage fails, the workflow fails; merge is blocked
(via GitHub branch-protection rules — operator configures).

**Rationale**:
- §9.10 binds the six-stage pipeline + E2E on merge to `main`.
- Constitution CI Gates restates the same six stages.
- `pnpm action-setup` + frozen-lockfile is the standard pnpm
  pattern; pinning Node 20 matches §9.10 row 1.

**Alternatives considered**:
- Single combined job: viable but the merge-only E2E job
  separation makes branch-protection rules cleaner.
- Custom self-hosted runners: post-MVP; standard GitHub-hosted
  Ubuntu runners are sufficient and free for public repos.

**Implementation notes**:
- Workflow uses `actions/checkout@v4`, `actions/setup-node@v4`,
  `pnpm/action-setup@v4` (current major versions at time of
  writing — pin to specific SHAs is paranoid but acceptable).
- The cache key includes `pnpm-lock.yaml` hash to invalidate
  on dep changes.
- E2E job needs: production-shaped env vars (DATABASE_URL,
  GOOGLE_GENERATIVE_AI_API_KEY, SESSION_SECRET — provided as
  GitHub Secrets). The E2E suite uses a dedicated test Neon
  branch (out of scope: branch creation; operator manages).

## R2. Playwright E2E Test Suite

**Decision**: Add `packages/api/tests/e2e/` with three spec
files matching §9.8 row 3 ("Dashboard flows: login,
configure, view leads"):

- `login.spec.ts`: navigate to `/login`, submit valid
  credentials, assert redirect to `/dashboard/leads`.
- `configure.spec.ts`: log in, navigate to `/dashboard/config`,
  edit a field, click Save, assert version increment in DB
  query.
- `leads.spec.ts`: log in, navigate to `/dashboard/leads`,
  assert at least one row visible (relies on a pre-seeded
  test lead).

A shared `playwright.config.ts` configures:
- Base URL: `http://localhost:3000` (or
  `process.env.E2E_BASE_URL` for staging/prod).
- Browser: Chromium (single browser for MVP per Constitution
  Required Stack — Playwright supports more, but MVP keeps it
  minimal).
- Trace + screenshot on failure.
- Timeout: 30s per test.

**Rationale**:
- §9.10 step 6 binds Playwright E2E on merge to main.
- §9.8 row 3 binds the scope to "Dashboard flows: login,
  configure, view leads".
- §12.11 done-when "Manual browser verification of all pages"
  is a manual gate that complements automated E2E (not
  replaced by it).

**Alternatives considered**:
- E2E coverage of widget on demo site: viable; defer to a
  separate spec file post-MVP.
- Cypress instead of Playwright: rejected per Constitution
  Required Stack (Playwright is binding).
- Co-locate E2E with each feature's tests: rejected; E2E is
  cross-feature; centralized location is clearer.

**Implementation notes**:
- A small `e2e-setup.ts` provisions a known test account in a
  dedicated Neon test-branch (post-MVP: ephemeral branches per
  PR via Neon's branching API).
- Tests are deterministic: each test creates its own state
  prefixed with a unique nanoid; no cross-test contamination.

## R3. Bundle-Size CI Gate (size-limit)

**Decision**: Wire `size-limit` into the CI pipeline per
`005-chat-widget` plan R8. Add `.size-limit.json` to
`packages/widget/` with two budgets:

```json
[
  { "name": "NPM bundle", "path": "dist/index.js", "limit": "35 KB" },
  { "name": "CDN bundle", "path": "dist/cdn/legal-chatbot.js", "limit": "50 KB" }
]
```

Add `pnpm size` script to `packages/widget/package.json`. Add
`pnpm size` invocation to the CI workflow's PR job after the
build stage.

**Rationale**:
- §6.10 + Constitution Architectural Limits bind the budgets.
- `005-chat-widget` plan R8 already contracted the CI gate;
  Phase 8 wires it into the actual workflow.

**Alternatives considered**: none — `005-chat-widget` already
locked in `size-limit`.

**Implementation notes**:
- `size-limit` measures gzipped size by default — matches the
  spec's "gzipped" requirement.
- The CI step fails the workflow if either budget is exceeded;
  branch protection blocks merge.

## R4. Changesets Initialization

**Decision**: Run `pnpm changeset init` to create
`.changeset/config.json`. Configuration:

```jsonc
{
  "$schema": "https://unpkg.com/@changesets/config@2.3.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [
    "@legal-chatbot/api",
    "@legal-chatbot/dashboard"
  ]
}
```

Public packages (`@legal-chatbot/widget`, `legal-chatbot-crawl`)
are versioned via Changesets; internal packages (`api`,
`dashboard`, `shared`) are ignored from version management
because they aren't published.

**Rationale**:
- §9.10 binds Changesets for "Version management and changelog
  generation".
- FR-018, FR-027.
- The `ignore` list excludes internal packages (deployed via
  Netlify, not npm).

**Alternatives considered**:
- semver-release / standard-version: rejected per Constitution
  Required Stack (Changesets is binding).
- Manual version bumps: rejected; loses changelog generation.

**Implementation notes**:
- Engineers add a `.changeset/<random>.md` file per
  user-impacting change describing the version bump
  (`patch`/`minor`/`major`) and a human-readable summary.
- A future "release" PR consolidates pending changesets,
  bumps versions, and regenerates changelogs.

## R5. Conversation-Quality Eval Suite

**Decision**: Add `evals/` repo-root directory with:

- `evals/scenarios/`: YAML files describing test conversations.
  Each scenario has:
  ```yaml
  name: "Personal Injury — Urgent"
  setup:
    api_key: ${EVAL_API_KEY}
    base_url: ${EVAL_BASE_URL}
  conversation:
    - user: "I was hit by a car this morning."
    - expectations:
        agent_response_contains: ["personal injury"]
        captureLead_called: true
        captureLead_classification: "urgent"
  - user: "My phone is (555) 123-4567."
    - expectations:
        captureLead_called: true
  ```

- `evals/run-evals.ts`: harness that:
  1. Reads each scenario YAML.
  2. Drives a chat against `EVAL_BASE_URL` (defaults to the
     deployed production API).
  3. After each turn, evaluates expectations.
  4. Outputs a pass/fail report per scenario + overall summary.

The eval is **NOT automated in CI** per §9.8: "Not automated
in CI (LLM responses are non-deterministic) but tracked as a
manual QA step." A release engineer runs it manually before
declaring a release.

**Rationale**:
- §9.8 binds the curated test conversation set + manual gate.
- FR-020 to FR-023, SC-012.
- Scenarios cover the four classification outcomes from §7.4
  (urgent, normal, unqualified) plus injection-attempt
  scenarios from §11.2.

**Alternatives considered**:
- Run in CI with deterministic temperature=0: rejected. Even
  at temperature=0, model updates from the provider can shift
  behavior; non-deterministic per §9.8.
- Free-form prompts (no structured expectations): rejected;
  pass/fail signal is the value.

**Implementation notes**:
- Initial scenarios:
  1. Personal injury (urgent) — drives a `captureLead` call.
  2. Family law (normal) — drives a different `captureLead`
     classification.
  3. Tax law (unqualified) — verifies §7.11 fallback.
  4. Injection attempt — verifies non-disclosure rule
     (system prompt not revealed).
- A `pass_rate` metric (e.g., ≥ 90%) is the release-gate.
- Findings recorded in `evals/runs/<date>.md` for audit.

## R6. Production Seed Guard

**Decision**: Modify `packages/api/src/db/seed.ts` to abort
with an error when ANY of:

1. `process.env.NODE_ENV === 'production'`.
2. `process.env.DATABASE_URL` matches a production-pattern
   regex (e.g., contains `prod.` or absent of `localhost` /
   `dev.` markers — captured as Assumption with conservative
   default).
3. `process.env.ALLOW_PROD_SEED !== 'true'` (escape hatch for
   intentional production seeding, but disabled by default).

The check runs at the top of the seed script's `main()` before
any DB writes.

```ts
function assertNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed production database (NODE_ENV=production)');
  }
  if (process.env.ALLOW_PROD_SEED === 'true') {
    return; // explicit opt-in
  }
  const url = process.env.DATABASE_URL || '';
  if (/(^|\.)prod\./.test(url) || /^postgres(ql)?:\/\/[^/]+\.amazonaws\.com/.test(url)) {
    throw new Error('Refusing to seed: DATABASE_URL looks like production');
  }
}
```

**Rationale**:
- §12.3 describes the dev seed creating known credentials
  (`dev@legalchatbot.com` / `password123`, API key
  `dev_test_key`).
- Running this against production would create a publicly
  known credential pair — a security disaster.
- FR-033 + SC-015 bind the prevention.
- Spec edge case: "Production seed run accidentally" is
  explicitly named.

**Alternatives considered**:
- Rely on operator discipline: rejected. Spec demands it as a
  technical guard.
- Block via separate seed script for prod: rejected; one
  script with a guard is simpler.

**Implementation notes**:
- The guard is unit-tested: with `NODE_ENV=production` the
  script throws; with `NODE_ENV=development` it proceeds.
- The error message clearly names the offending env var.

## R7. Production Environment Variables Documentation

**Decision**: Add `docs/deployment-runbook.md` listing every
required env var for each Netlify site:

### API site (`packages/api`)

| Variable | Required | Source | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | Neon production connection string | Constitution + §9.7 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Gemini API key | §9.7 |
| `SESSION_SECRET` | yes (≥ 32 chars) | iron-session encryption | §9.7 |
| `GEMINI_PRICE_PROMPT_PER_1K` | yes (Hardening) | Gemini per-token pricing | §11.3 |
| `GEMINI_PRICE_COMPLETION_PER_1K` | yes (Hardening) | Gemini per-token pricing | §11.3 |
| `FAQ_CACHE_ENABLED` | no (default false) | MAY-level | §11.6 |
| `INJECTION_CLASSIFIER_ENABLED` | no (default false) | MAY-level | §11.2 |
| `SENDGRID_API_KEY` | no (one of the two) | Email provider | §8.2 |
| `RESEND_API_KEY` | no (one of the two) | Email provider | §8.2 |
| `NODE_ENV=production` | yes | Constitution IV | Required |

### Widget site (`packages/widget`)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | yes | URL to the API site's chat endpoint per §9.7 |

**Rationale**:
- §9.7 binds the env-var inventory.
- FR-009, FR-010.
- Centralizing in a runbook prevents drift.

**Alternatives considered**:
- Inline in each Netlify config: viable but harder to audit;
  the runbook is the single source of truth.

**Implementation notes**:
- The runbook also documents how to set Netlify env vars via
  the dashboard or CLI (`netlify env:set`).
- A dev-only `.env.example` (already in Foundation) covers
  the local subset.

## R8. NPM Publish Workflow

**Decision**: Add `.github/workflows/release.yml` triggered by
PRs from a `changeset-release/main` branch (Changesets'
default). The workflow:

1. Runs the full PR checks (stages 1–5 from R1).
2. Runs `pnpm changeset publish` which:
   - Bumps versions per pending changesets.
   - Generates changelog entries.
   - Tags the git commit.
   - Publishes packages to npm.
3. Pushes the version commit + tag back to `main`.

For MVP, only `@legal-chatbot/widget` and `legal-chatbot-crawl`
(the Crawler npm package — name TBD per Crawler R8) are
public; their `package.json` `private: false`.

**Rationale**:
- §9.10 binds Changesets.
- FR-024 to FR-027 bind npm publication of the two
  user-installable packages.
- SC-013 enforces "100% of releases publish a CHANGELOG entry
  generated via Changesets."

**Alternatives considered**:
- Manual `pnpm publish` from local: rejected; auditability
  + CI verification is essential.
- Auto-publish on every merge to main: rejected; Changesets'
  PR-based release model is the standard.

**Implementation notes**:
- npm token stored as `NPM_TOKEN` GitHub Secret.
- The crawler package's `bin` field exposes the
  `legal-chatbot-crawl` executable per §3.3 / §9.7 row 3.
- The widget package's `main` / `module` / `exports` /
  `peerDependencies` are configured per
  `005-chat-widget/contracts/react-component-contract.md`.

## R9. NPM Package Metadata Adjustments

**Decision**: Update `packages/widget/package.json` and
`packages/crawler/package.json`:

- Set `"private": false` (currently `true`).
- Add `"publishConfig": { "access": "public" }` for scoped
  packages.
- Add `"files"` array listing what gets included in the
  published tarball (typically `dist/` only):
  ```jsonc
  "files": ["dist", "README.md"]
  ```
- Add `"repository"`, `"license"`, `"author"`, `"description"`
  fields.

**Rationale**:
- npm publish requires `private: false`.
- The `files` array prevents accidentally publishing source
  + node_modules.
- Standard package metadata is professional hygiene.

**Alternatives considered**:
- Use `.npmignore` instead of `files`: equivalent but `files`
  is more explicit.

**Implementation notes**:
- README content for each package is required for npm display.
  A short README in each package documenting installation +
  usage (cross-referencing the relevant spec).

## R10. Production Migration Runbook

**Decision**: Document the production migration procedure in
`docs/deployment-runbook.md`. Key steps:

1. **Provision Neon production database**: Create a Neon
   project + database; capture the connection string.
2. **Set Netlify env var**: `DATABASE_URL=<production conn string>`
   on the API site.
3. **Run migrations** (one-time or per release with new
   migrations): from a developer machine OR a GitHub Actions
   workflow:
   ```bash
   DATABASE_URL=<prod url> pnpm --filter @legal-chatbot/api db:migrate
   ```
4. **VERIFY** all 7+ §2.6 tables exist (plus Phase 7's 4 new
   tables when those land).
5. **DO NOT** run `pnpm db:seed` against production (R6 guard
   prevents it).

**Rationale**:
- §9.7 row 4 binds Neon as the production database.
- FR-032, SC-014 bind the migration outcome.
- A runbook avoids ad-hoc tribal knowledge.

**Alternatives considered**:
- Auto-migrate on Netlify build: rejected. Migrations are
  destructive operations that should be human-initiated and
  reviewable.
- Migration GitHub Action: viable; documented as
  post-MVP option.

**Implementation notes**:
- The runbook includes example output for each step.
- Failure modes documented: connection refused, permission
  denied, migration conflict.

## R11. Constitution-Aligned Deploy Invariants

**Decision**: Add a CI step `verify-invariants` that runs on
every PR and checks:

1. **No Server Actions**: grep `packages/api/src` for
   `'use server'` directives → fail if found.
2. **No native binaries in production deps**: parse
   `packages/api/package.json` `dependencies` and
   `packages/widget/package.json` `dependencies` (production
   only); fail if any package is in a known-native list
   (`bcrypt` chief among them).
3. **CORS wildcard verified**: parse
   `packages/api/src/app/api/chat/cors.ts`; fail if
   `Access-Control-Allow-Origin` is not `*`.

These are static checks runnable without a build.

**Rationale**:
- Constitution IV binds these three as deploy-time invariants
  (§9.7 + §8.4).
- FR-011, FR-012, FR-013 + SC-009, SC-010 enforce them as
  zero-tolerance.
- A grep-based check is the lowest-cost insurance against
  regression.

**Alternatives considered**:
- ESLint custom rules: viable; more effort than a one-shot
  grep.
- Trust code review: insufficient given Constitution's
  zero-tolerance posture.

**Implementation notes**:
- The script `scripts/verify-deploy-invariants.sh` (or `.ts`)
  exits non-zero on any violation.
- The CI workflow runs it as a dedicated stage between lint
  and tests.

## Constitution Cross-Reference Summary

| Constitution element | Deployment & Release decision | Aligned |
|---|---|---|
| I (MVP-First) | All decisions cite §-anchors; §10 deferred items out of scope | ✅ |
| II (Type Safety) | E2E tests + eval harness use TS strict; production migration via Drizzle types | ✅ |
| III (TDD layered) | CI integrates Vitest, Playwright; manual eval gate documented per §9.8 | ✅ |
| IV (Serverless / Stateless) | Netlify + Neon + npm + CDN; deploy invariants enforced (R11); production seed guard (R6) | ✅ |
| V (Privilege & Privacy) | Production seed guard prevents dev credentials on prod; Foundation logger redaction inherited | ✅ |
| VI (Observable Agent) | Conversation-quality eval gate (R5); bundle-size gate (R3) | ✅ |
| VII (Phased Delivery) | CI shape enforces phase ordering at PR time; npm publish gated through Changesets PR flow | ✅ |
| Required Stack | Netlify, GitHub Actions, Changesets, Playwright, size-limit, Turborepo — all already in stack table | ✅ |
| Architectural Limits | Bundle-size CI gate enforces widget budgets; runtime limits owned by their respective features | ✅ |

## Open Questions — None

All decisions resolve cleanly. No `NEEDS CLARIFICATION` markers
remain. Ready to proceed to Phase 1.
