# Quickstart: Foundation

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows what a new engineer experiences after the
Foundation feature is fully implemented. It is the validation walk
for SC-001 (one-command bring-up) and the §12.3 binding behavior.

## Prerequisites

- Node.js 20+ (LTS)
- pnpm 9+
- A Neon account with a free-tier database (or a dedicated dev branch)
- A Google Generative AI API key (Gemini)

## Initial Setup

```bash
git clone <repo>
cd legal-chatbot
pnpm install
cp .env.example .env
# Edit .env to set DATABASE_URL, GOOGLE_GENERATIVE_AI_API_KEY, SESSION_SECRET
pnpm db:migrate
pnpm db:seed
```

Expected outcomes:

- `pnpm install` completes without native-binary build failures (per
  Constitution IV; `bcryptjs` is the only auth-hash dependency).
- `cp .env.example .env` creates a populated template with
  `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `SESSION_SECRET`
  placeholders. Engineers fill in the values.
- `pnpm db:migrate` creates all seven §2.6 tables on the configured
  Neon branch. Re-running is a no-op.
- `pnpm db:seed` creates: account `dev@legalchatbot.com` /
  `password123`; API key `dev_test_key`; published Shrager-defaults
  configuration; `context_store_url` =
  `http://localhost:5173/chatbot-context/` (or `CONTEXT_STORE_URL`
  if set). Re-running is a no-op.
- If `SESSION_SECRET` is shorter than 32 characters, `pnpm db:migrate`
  (or any other invocation that loads the API env) fails fast with
  a clear Zod error naming the variable.

## Run the Local Testbed

```bash
pnpm dev
```

Expected outcomes (single command brings all of these up):

- React test app on `http://localhost:5173`.
- API server on `http://localhost:3000`.
- Context store served as static files at
  `http://localhost:5173/chatbot-context/`.
- The widget on the test app can be opened, but it has no streaming
  response yet — that arrives in Phase 3 (`004-chat-api-agent`).
  Foundation guarantees the *plumbing*; downstream features deliver
  the user-facing chat behavior.

## Verify CI Passes Locally

```bash
pnpm typecheck    # tsc --noEmit across all packages
pnpm lint         # eslint .
pnpm test         # vitest run, all packages
pnpm build        # turbo build, all packages
```

These mirror the GitHub Actions stages (§9.10). All must pass with
zero warnings/errors before merging any PR.

## Verify Logs Are Structured

Run any test that exercises the logger and observe that log lines
emitted to stdout are valid line-delimited JSON, with redacted
secret-bearing fields:

```bash
pnpm --filter @legal-chatbot/shared test logger
```

Spot-check that fields named `key_hash`, `password_hash`,
`session_secret`, etc. appear as `"<redacted>"` in the output.

## Verify Migrations Are Idempotent

```bash
pnpm db:migrate      # first run: creates tables
pnpm db:migrate      # second run: no-op, no error
pnpm db:seed         # first run: creates rows
pnpm db:seed         # second run: no duplicates, no error
```

A SQL diff (or row-count check) before and after the second `seed`
shows no change.

## Done-When (Spec FR Satisfaction Map)

| Spec FR group | Verification step above |
|---|---|
| A. Monorepo Bootstrap | `pnpm install` completes; workspace layout matches §9.6 |
| B. Shared Types & Zod | `pnpm typecheck` succeeds across packages importing from `@legal-chatbot/shared` |
| C. DB Schema & Migrations | `pnpm db:migrate` creates all seven tables; idempotent second run |
| D. Env Config | Missing-var fast-fail behavior verified; `.env.example` exists |
| E. Structured Logger | Logger test verifies redaction and shape |
| F. CI Pipeline | `pnpm typecheck`/`lint`/`test`/`build` all pass; GitHub Actions workflow exists |
| G. Local Dev | `pnpm dev` brings all three surfaces up |
| H. Cross-Cutting | No `bcrypt` native dep; no Server Actions; no fs writes at runtime |

## Troubleshooting

- **`Error: Invalid env. SESSION_SECRET: String must contain at least 32 character(s)`**: edit `.env` and supply a 32+ character value.
- **`Connection refused` on port 5173 or 3000**: another process is using the port; stop it or set `WIDGET_DEV_PORT` / `API_DEV_PORT`. (Foundation does not introduce these overrides; mention only as a generic pnpm dev tip.)
- **Drizzle migration error**: confirm `DATABASE_URL` points at a writable Neon branch; the free-tier branch can be used for dev.
- **Logs are unredacted**: confirm callers go through the `@legal-chatbot/shared` logger and not raw `console.log`. The ESLint rule disallowing `console.log` in `packages/api/**` enforces this.

## Out of Scope for This Quickstart

- Running the crawler — Phase 1 (`002-crawler-cli`).
- Running a chat conversation — Phase 3 (`004-chat-api-agent`).
- Logging into the dashboard — Phase 6 (`007-dashboard`).
- Production deploy — Phase 8 (`009-deployment-release`).
