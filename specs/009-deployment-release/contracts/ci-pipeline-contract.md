# Contract: CI Pipeline (GitHub Actions)

**Owner**: Deployment & Release (`009-deployment-release`)
**Source of Truth**: §9.10, §9.8, §6.10.

## Workflow Files

- `.github/workflows/ci.yml`: PR + push-to-main checks.
- `.github/workflows/release.yml`: Changeset-driven npm publish
  (separate contract).

## Triggers

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

## Job 1: `pr-checks`

Runs on every `pull_request` and on `push` to `main`. Blocks
merge if any step fails (via branch protection rules).

### Steps (per §9.10 stages 1–5 + R3 + R11)

| # | Stage | Command | Source |
|---|---|---|---|
| 1 | Checkout | `actions/checkout@v4` | — |
| 2 | Setup pnpm | `pnpm/action-setup@v4` (version locked) | Constitution Required Stack |
| 3 | Setup Node 20 | `actions/setup-node@v4` (`node-version: '20'`) | §9.10 row 1 |
| 4 | Cache pnpm store | `actions/cache@v4` keyed on `pnpm-lock.yaml` hash | performance |
| 5 | Install deps | `pnpm install --frozen-lockfile` | §9.10 stage 1 |
| 6 | Verify deploy invariants | `bash scripts/verify-deploy-invariants.sh` | R11 |
| 7 | Type check | `pnpm typecheck` (`tsc --noEmit` across all packages via Turbo) | §9.10 stage 2 |
| 8 | Lint | `pnpm lint` (ESLint flat config) | §9.10 stage 3 |
| 9 | Unit + integration tests | `pnpm test` (Vitest) | §9.10 stage 4 |
| 10 | Build all packages | `pnpm build` (Turbo) | §9.10 stage 5 |
| 11 | Bundle-size check | `pnpm --filter @legal-chatbot/widget size` (size-limit) | §6.10 / R3 |

## Job 2: `merge-checks`

Runs on `push` to `main` AFTER `pr-checks` passes. Adds the
E2E suite per §9.10 step 6.

### Steps

12. (Re-runs install + build via `needs: pr-checks` or duplicates
    setup if separated.)
13. Install Playwright browsers: `pnpm exec playwright install --with-deps chromium`.
14. Run E2E: `pnpm test:e2e`.

## Required Secrets

GitHub repository secrets the workflow consumes:

| Secret | Used in | Purpose |
|---|---|---|
| `E2E_DATABASE_URL` | `merge-checks` | Test Neon branch |
| `E2E_GOOGLE_GENERATIVE_AI_API_KEY` | `merge-checks` | Gemini for E2E |
| `E2E_SESSION_SECRET` | `merge-checks` | iron-session in tests |

For PR jobs, no secrets are required (tests use in-memory
SQLite per Phase 1 Foundation contract).

## Failure Handling

- Any failed step → workflow fails → branch-protection blocks
  merge.
- Verify-deploy-invariants (R11) is the FIRST gate after install
  to catch regressions early.
- Bundle-size failure: shows the offending package name and the
  excess bytes in the workflow log.

## Caching

- pnpm store: keyed on `pnpm-lock.yaml` hash; restored on
  re-runs to skip re-downloading deps.
- Turbo cache: optionally configured with remote cache for
  builds (post-MVP).

## Tests for the Contract

A trivial PR that touches a comment in any file triggers the
full pipeline. All stages MUST pass before MVP is declared
production-ready.

