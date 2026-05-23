# Phase 0 Research: Foundation
# Phase 0 Research: Foundation

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves all Technical Context decisions for the Foundation
feature against `product-spec-legal-chatbot.md` (§9 Tech Stack &
Recommendations, §11.7 Observability, §12.3 Dev Environment Setup) and
the Lex Bot Constitution v1.0.0 (Required Stack table; Required
Environment Variables; CI Gates).

There were no `NEEDS CLARIFICATION` markers in the Technical Context;
research items below are best-practices investigations rather than
unresolved unknowns.

## R1. Centralized Environment-Variable Loader

**Decision**: Implement a typed env loader in `packages/shared/src/env/`
with three exports: `apiEnv`, `widgetEnv`, `devEnv`. Each is a Zod-parsed
object built from `process.env` (or `import.meta.env` for the widget
build). Parsing happens once at module load; failures throw with a clear
message naming the missing/invalid variable. Consumers import the parsed
object and use it like a typed value.

**Rationale**:

- §9.7 enumerates the binding env vars per site; Constitution "Required
  Environment Variables" mirrors them; FR-027 to FR-030 mandate them
  in the Foundation.
- The current code at `packages/api/src/lib/dashboard-session.ts:11`
  reads `process.env.SESSION_SECRET ?? ''`. The `?? ''` silent fallback
  violates Constitution Principle IV ("Missing required env vars MUST
  cause fast startup failure with a clear error message — NEVER silent
  fallback to a default") and the Foundation spec's Edge Cases section
  ("If `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, or
  `SESSION_SECRET` is missing on API startup, the API MUST fail to
  start with a clear error indicating which variable is missing").
- Zod is already a binding stack choice (§9.9, Constitution Principle
  II). Reusing it for env parsing keeps the dependency surface minimal
  and gives uniform error messages.
- A single load-and-parse on module import (rather than per-call) makes
  startup failure deterministic: if any required var is missing, the
  module fails to import and the function never starts. This is the
  behavior Netlify's deploy-validation flow relies on.

**Alternatives considered**:

- `dotenv` library: rejected. Next.js loads `.env*` files automatically
  in dev; in prod (Netlify) env vars come from the Netlify configuration.
  Adding `dotenv` adds a runtime dep that does nothing in either
  environment.
- `t3-env` / `@t3-oss/env-core`: viable but pulls in extra abstraction.
  The Foundation needs only three env-var groups; a tiny hand-rolled
  module is simpler and stays inside the spec's named library set.
- Lazy access pattern (`getEnv('NAME')` per call): rejected because
  startup failure is the desired behavior; lazy access defers errors to
  the first read, which can hide misconfiguration until traffic arrives.

**Implementation notes**:

- Validate `SESSION_SECRET.length >= 32` per §9.7 / Constitution.
- Validate `DATABASE_URL` looks like a Postgres connection string
  (`postgres://` or `postgresql://`).
- Validate `GOOGLE_GENERATIVE_AI_API_KEY` is non-empty (no specific
  format check; the Gemini SDK handles auth errors).
- Widget env loader uses `import.meta.env.VITE_API_URL` (Vite convention,
  §9.7 Widget site env-var section).
- Dev seed honors `CONTEXT_STORE_URL` override per §12.3.
- Migrate `packages/api/src/lib/dashboard-session.ts` to import the
  parsed `apiEnv.SESSION_SECRET` instead of `process.env.SESSION_SECRET ?? ''`.

## R2. Structured-JSON Logger

**Decision**: Implement a tiny pure-TypeScript logger in
`packages/shared/src/logger/` that emits one JSON object per line to
`stdout` (with `stderr` for `level >= 'error'`). The logger exposes
`logger.event(eventName, payload)`, `logger.toolCall(payload)`,
`logger.error(err, payload)`, plus a per-session debug mode toggle
(`enableSessionDebug(sessionId)`). A `redact` step strips known-secret
field names (api keys, password hashes, `SESSION_SECRET`) from any
payload before emission.

**Rationale**:

- §11.7 requires structured JSON logs covering every conversation
  event (message received, tool called, context retrieved, response
  sent), tool-call detail (which files, scores, tokens), and errors
  with full context (session ID, conversation state, failing tool).
  FR-031 to FR-035 reify this in the Foundation.
- Constitution Principle V mandates that logs MUST NOT record API
  keys, password hashes, session secrets, or full PII in plaintext.
  A redaction pass on every log entry enforces this at the boundary.
- §11.7 mentions "writing to files for MVP" is acceptable. On
  Netlify Functions, `stdout` is automatically aggregated into the
  Netlify log stream — equivalent to file-based logging without
  requiring filesystem writes (Constitution Principle IV).
- A pure-TypeScript implementation (no `pino`, no `winston`, no
  `bunyan`) keeps the dependency surface zero. The output shape is
  the only contract; downstream tooling (ELK, BetterStack, etc.) can
  ingest line-delimited JSON natively. Post-MVP migration to a
  full logging library is a swap of the emit function.

**Alternatives considered**:

- `pino`: highly performant but adds a dependency and a transport
  layer that we don't need on Netlify (stdout is the transport).
- `winston`: heavyweight and not optimized for Node 20 + ESM.
- Raw `console.log`: misses redaction and structured shape; would
  require every caller to JSON-stringify and remember redaction
  rules. The wrapper enforces both.

**Implementation notes**:

- Output shape:
  ```json
  {
    "ts": "2026-05-23T12:34:56.789Z",
    "level": "info" | "warn" | "error" | "debug",
    "event": "<event-name>",
    "session_id": "<optional>",
    "account_id": "<optional>",
    "payload": { ... }
  }
  ```
- Redaction list (case-insensitive substring match on key names):
  `apikey`, `api_key`, `key_hash`, `password`, `password_hash`,
  `session_secret`, `authorization`, `cookie`, `set-cookie`. Matching
  values are replaced with `"<redacted>"`.
- Debug mode: an in-memory `Set<string>` of session IDs. When a log
  call arrives with a `session_id` in the set, additional fields
  (full system prompt, full tool-call payloads) are included. Default
  is empty set; toggling is internal-only (no public HTTP surface in
  Foundation; downstream features may expose a route).
- Error logger MUST capture: `err.name`, `err.message`, `err.stack`,
  plus the call-site-supplied `payload` (which by §11.7 should
  include `session_id`, `conversation state`, `failing tool`).

## R3. Database Schema Verification & Migration Idempotency

**Decision**: Audit the existing
`packages/api/src/db/schema.ts` and `packages/api/src/db/test-schema.ts`
against §2.6 column-by-column. The migration in
`packages/api/drizzle/0000_quick_cerebro.sql` is generated; verify it
applies cleanly to a fresh Neon branch. Make `pnpm db:migrate` and
`pnpm db:seed` idempotent: repeated invocation MUST NOT corrupt or
duplicate data (FR-021, FR-022; spec edge cases).

**Rationale**:

- §2.6 is the binding schema definition. The Foundation spec FR-018
  enumerates each table that must exist. The existing
  `schema.ts` file contains the seven tables but a column-by-column
  cross-check is required before declaring the audit complete.
- §12.3 lists `pnpm db:migrate` and `pnpm db:seed` as routine setup
  steps. Spec edge cases require idempotency for both (re-bootstrap
  must not break a shared dev environment).
- `drizzle-kit` migrations are auto-numbered and tracked in
  `drizzle/meta/`; calling `migrate()` against an already-migrated
  database is a no-op by Drizzle's design — this is already
  idempotent if the migration files are kept versioned. Verification
  task: confirm.
- Seeding is not idempotent by default. The fix is to use
  `INSERT … ON CONFLICT (email) DO NOTHING` (or the Drizzle
  equivalent) for the dev account, and similar conflict-handling for
  the dev API key, dev configuration, and `context_store_url`.

**Alternatives considered**:

- TRUNCATE-and-reload seed: rejected. Dev environments can have
  developer-created leads/configurations that an unconditional
  TRUNCATE would destroy.
- Skip-when-already-seeded by a sentinel row: viable but requires an
  extra schema artifact. Conflict-handling on natural keys (email,
  key label) is simpler.

**Implementation notes**:

- Verification SQL: enumerate `information_schema.columns` for each
  of the seven tables and diff against §2.6 column definitions.
- Idempotency tests live in
  `packages/api/src/db/seed.test.ts` (new): run seed twice, assert
  unchanged row count for the seeded entities.
- The seed MUST honor `CONTEXT_STORE_URL` env override per §12.3.
- The seed MUST hash the API key with `bcryptjs` (§9.7) before
  insert; the plaintext `dev_test_key` is never stored.

## R4. CI Pipeline (GitHub Actions)

**Decision**: Add a single workflow file at
`.github/workflows/ci.yml` running on `pull_request` and `push` to
`main`. Stages match §9.10 exactly: install (`pnpm install
--frozen-lockfile`) → typecheck (`pnpm typecheck`) → lint
(`pnpm lint`) → tests (`pnpm test`) → build (`pnpm build`). The
workflow uses `actions/checkout@v4` and a pnpm setup action; Node 20
is selected via `actions/setup-node@v4` with `node-version: '20'`.

**Rationale**:

- §9.10 mandates GitHub Actions and enumerates the five PR-blocking
  stages plus E2E on merge to `main`. Constitution CI Gates restates
  the same five stages plus a sixth "Bundle-size check on
  `packages/widget` outputs" — that sixth stage is owned by Phase 4
  (`005-chat-widget`), not Foundation.
- `--frozen-lockfile` is required to catch lockfile drift; a missing
  lockfile entry must fail CI rather than silently install a different
  version.
- E2E (`pnpm test:e2e`) is gated by Phase 6's introduction of
  Playwright — Foundation only provisions the test runner, not E2E
  jobs. The CI workflow is structured so adding the E2E job in Phase
  6 is a single additional `job:` block.

**Alternatives considered**:

- Per-package separate workflows: rejected. Turborepo's caching means
  a single workflow that calls `pnpm typecheck`/`test`/`build`
  delegates to Turbo and gets per-package incremental caching for
  free. Multiple workflows duplicate setup steps.
- Self-hosted runners: rejected for MVP; the standard GitHub-hosted
  Ubuntu runners are sufficient and free for public/test repos.

**Implementation notes**:

- Use `actions/cache@v4` with the pnpm store path to speed installs
  on repeated runs.
- Set `env.TURBO_TOKEN` / `TURBO_TEAM` if remote caching is configured
  (post-MVP); for MVP, local Turbo cache only.
- The workflow does NOT need the production env vars
  (`DATABASE_URL`, etc.) — typecheck, lint, tests, and build run
  against in-memory SQLite (test mocks) and do not touch Neon.

## R5. ESLint Flat Config & Prettier

**Decision**: Add `eslint.config.mjs` at the repository root using ESLint
9 flat-config style with `typescript-eslint` for TS support. Add a
minimal `.prettierrc` enforcing standard Prettier defaults. Wire
`pnpm lint` and `pnpm format` scripts at the workspace root via
Turborepo `lint` task (already present in `turbo.json`).

**Rationale**:

- Constitution Required Stack mandates "ESLint flat config" and
  "Prettier" as binding tools. §9.10 row 4 lists ESLint and row 5
  lists Prettier.
- Flat config is the modern default (ESLint 9+) and avoids the
  legacy `.eslintrc.*` cascade. Each package can extend the root
  config without per-package config files.
- Minimal Prettier config (default settings) is acceptable; the
  spec does not prescribe specific style choices.

**Alternatives considered**:

- Biome instead of ESLint+Prettier: faster but not in the binding
  Required Stack. Adopting it would require a constitution
  amendment.
- Per-package ESLint configs: rejected for the same reason as
  per-package CI workflows — duplication without benefit.

**Implementation notes**:

- Root `eslint.config.mjs` exports an array including:
  `@eslint/js` recommended rules, `typescript-eslint` recommended
  TS rules, and project-specific overrides (e.g., disallow
  `console.log` in `packages/api/**` to enforce logger usage —
  Constitution Principle V hardening).
- `.prettierrc`: minimal, defaults; `printWidth: 100` is a
  reasonable choice that matches the Constitution's "<100 chars
  ideally" guidance for prose.

## R6. Local Dev Orchestration (`pnpm dev`)

**Decision**: Confirm and harden the existing `pnpm dev` script. The
root `package.json` already runs `turbo dev`, and Turborepo will
fan out to each package's `dev` script. Verification: a developer
running `pnpm dev` from a fresh clone (after `pnpm install`,
`.env` populated, `pnpm db:migrate`, `pnpm db:seed`) sees the test
React app on `localhost:5173`, the API on `localhost:3000`, and the
context store served at `http://localhost:5173/chatbot-context/`.

**Rationale**:

- §12.3 mandates a single-command bring-up for the local testbed.
  FR-043 to FR-049 enumerate the surfaces.
- The Vite dev server in `packages/widget` serves the `chatbot-context/`
  directory at the project root as static files; this is the same
  topology production uses (the widget Netlify site serves the same
  directory). FR-046, FR-049 ("identical behavior").
- Turborepo's `dev` task is already configured with `cache: false`
  and `persistent: true` (existing `turbo.json`); no change needed.

**Alternatives considered**:

- `concurrently` or `npm-run-all`: rejected. Turborepo already does
  this and its task graph understands inter-package dependencies.
- Separate top-level scripts per service: rejected; complicates
  documentation and contradicts §12.3's "single command" intent.

**Implementation notes**:

- The widget package's `vite.config.ts` (existing) MUST be configured
  to serve `chatbot-context/` from the repo root as a static asset
  base path `/chatbot-context/`. Verify this is set or add it.
- The dashboard package runs on port `3001` (per existing
  `packages/dashboard/package.json` `dev` script). §12.2 doesn't
  enumerate the dashboard port; this is a reasonable default and
  doesn't conflict with §12.2's API:3000 / Vite:5173 listing.

## R7. Shared Types & Zod Schemas

**Decision**: Audit `packages/shared/src/schemas/` against the four
spec sections that drive its content (§2.6 for entity types; §4.4
for the configuration JSON shape; §7.3 for the `searchContext` tool
parameter schema; §7.4 for the `captureLead` tool parameter schema)
and ensure each is exported from the package root. Existing files
listed: `api-key.ts`, `configuration.ts`, `frontmatter.ts`,
`index.ts`, `leads.ts`, `manifest.ts`, `messages.ts`. Verify
coverage is complete; add any missing schema.

**Rationale**:

- FR-010 to FR-013 enumerate the shared types/schema surface.
- Constitution Principle II mandates Zod at every external boundary
  and shared types in the monorepo.
- Existing schema files cover the major spec entities; a quick
  audit confirms parity and surfaces any drift.

**Alternatives considered**:

- Per-package private schemas: rejected. Constitution Principle II
  forbids type duplication across packages.

**Implementation notes**:

- The `shared/src/index.ts` currently re-exports from
  `./schemas/index.js`; the env loader and logger modules also
  need to be re-exported once added.

## R8. CI Bundle-Size Check Deferral

**Decision**: The Constitution CI Gates table lists "Bundle-size check
on `packages/widget` outputs" as PR-blocking. This check is a
**Phase 4** concern and is deferred to the Chat Widget feature
(`005-chat-widget` FR-077). The Foundation CI workflow is
structured so that adding this stage in Phase 4 is a single
`job:` block append.

**Rationale**:

- Constitution Principle VII (Phased Incremental Delivery) prevents
  adding stages whose subjects don't yet exist. The widget bundle
  doesn't exist until Phase 4 builds it.
- Constitution explicitly says "Bundle size is measured in CI;
  regressions block merge" — this remains true; the stage simply
  enters the workflow when the artifact does.

## R9. Test Database Driver Wiring

**Decision**: Provide a thin factory in
`packages/api/src/db/index.ts` that returns either the production
Neon-HTTP driver or the test SQLite driver based on `NODE_ENV`
and the presence of `DATABASE_URL`. The schema definition in
`schema.ts` (PostgreSQL types) and `test-schema.ts` (SQLite
types) parallel each other; the factory selects which to use.

**Rationale**:

- §9.3 / §9.5 mandate this dual-driver setup explicitly: "Drizzle
  ORM ... `drizzle-orm/neon-http` for production and SQLite
  (`drizzle-orm/better-sqlite3`) for test mocks."
- Constitution Principle III requires tests to use in-memory SQLite
  and forbids network-DB connections in tests.
- A factory keeps the rest of the code base unchanged across
  environments; consumers import a `db` symbol and don't choose.

**Alternatives considered**:

- A separate test-only data layer: rejected. The schema would drift.
  The current parallel-schema approach already exists; the factory
  formalizes it.

## Constitution Cross-Reference Summary

Every Foundation research decision has been validated against the
Lex Bot Constitution v1.0.0:

| Constitution element | Foundation decision | Aligned |
|---|---|---|
| Principle I (MVP-First) | All work cites §9, §11.7, §12.3 spec sections | ✅ |
| Principle II (Type Safety) | Zod env loader, shared types in `packages/shared`, strict TS | ✅ |
| Principle III (TDD layered) | Vitest configured; `db:seed` tests + env-loader tests written first | ✅ |
| Principle IV (Serverless / Stateless) | Logger uses stdout (no fs); env loader fast-fails; no native binaries in prod deps | ✅ |
| Principle V (Privacy / Privilege) | Logger redaction list explicitly enumerated; secrets never persisted in plaintext | ✅ |
| Principle VI (Observable Agent) | Logger schema includes session_id, tool-call detail, full error context | ✅ |
| Principle VII (Phased Delivery) | Foundation is Phase 0; bundle-size CI gate deferred to Phase 4 | ✅ |
| Required Stack | All decisions stay inside the binding stack table | ✅ |
| Required Env Vars | All four enumerated env vars handled by the loader | ✅ |
| CI Gates | Stages 1–5 implemented now; stage 6 (bundle size) deferred to Phase 4; E2E deferred to Phase 6 | ✅ |
| Local Development | `pnpm dev` single-command bring-up preserved | ✅ |

## Open Questions — None

All research decisions resolve cleanly against the source spec and
the constitution. No `NEEDS CLARIFICATION` markers remain. Ready to
proceed to Phase 1 (data-model.md, contracts/, quickstart.md).
