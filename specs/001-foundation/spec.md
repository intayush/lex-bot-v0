# Feature Specification: Foundation

**Feature Branch**: `001-foundation`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Foundation from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Each functional requirement cites the spec section it derives from. No requirements have been invented.

## Overview

The Foundation feature delivers the cross-cutting infrastructure that every other component of Lex Bot depends on. It is the prerequisite for every subsequent phase (Crawler, Context Search, Chat API, Widget, Lead Classification, Dashboard) defined in product spec §12.5.

This specification covers seven atomic foundational modules:

1. Monorepo bootstrap (§9.6)
2. Shared types and validation schemas (§2.6, §4.4, §7.3, §7.4)
3. Database schema and migration tooling (§2.6, §9.3, §9.5)
4. Environment configuration and secrets loading (§9.7, §12.3)
5. Structured logging foundation (§11.7)
6. CI pipeline and quality gates (§9.10)
7. Local development orchestration (§12.3)

The Foundation does not deliver end-user value on its own. Its value is enabling subsequent features to be built reliably, consistently, and with shared infrastructure.

## User Scenarios & Testing *(mandatory)*

The "users" of the Foundation are the engineers building Lex Bot and the engineers operating it. Their journeys are described below.

### User Story 1 — New Engineer Bootstraps the Project Locally (Priority: P1)

A developer joining the project clones the repository, installs dependencies, configures secrets, applies database migrations, seeds development data, and starts the full local testbed with a single command. Within a short setup window they have the React test app, the API server, and the context store running locally and the chat widget responding end-to-end against a real Gemini model and a real Neon database.

**Why this priority**: Product spec §1.7 defines the success metric as "a lawyer can install the widget, configure guardrails, run the crawler, and have a working chatbot handling intake questions on their website within 30 minutes." That outcome is impossible if engineers cannot themselves stand the system up locally. §12.3 explicitly mandates a single-command bring-up.

**Independent Test**: A new engineer with Node.js, a Gemini API key, and a Neon connection string can complete the §12.3 setup sequence (`git clone`, `pnpm install`, populate `.env`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`) and observe a streaming response in the browser when they type a message into the test app's widget.

**Acceptance Scenarios**:

1. **Given** a fresh checkout with `.env` populated, **When** the engineer runs `pnpm install`, **Then** all workspace packages install successfully without native-binary build failures.
2. **Given** an empty Neon database and a valid `DATABASE_URL`, **When** the engineer runs `pnpm db:migrate`, **Then** every table defined in the schema (§2.6) exists in the database.
3. **Given** the migrated database, **When** the engineer runs `pnpm db:seed`, **Then** a test account, a development API key, a published guardrails configuration, and a `context_store_url` of `http://localhost:5173/chatbot-context/` are created (§12.3).
4. **Given** a seeded database, **When** the engineer runs `pnpm dev`, **Then** the React test app, the API server, and the context store (served as static files) all start concurrently (§12.3).
5. **Given** all three are running, **When** the engineer opens the test app and sends a message in the widget, **Then** a streaming response is rendered.

---

### User Story 2 — Engineer Adds a Feature Across Packages with Type Safety (Priority: P1)

An engineer implementing a feature that crosses package boundaries (e.g., a new shape used by both the API and the dashboard) defines the shape once in the shared package and the validation schema once. Any drift between producer and consumer is caught at type-check time rather than at runtime.

**Why this priority**: Product spec §9.1 mandates "End-to-end type safety across all packages" as the rationale for choosing TypeScript. §9.5 mandates Drizzle ORM for "Full TypeScript inference from schema definition to query results." §9.9 lists Zod as the universal validation library across "API inputs, form data, tool parameters."

**Independent Test**: Modify a shared type or schema; verify that consumers in other packages (api, widget, dashboard, crawler) fail type-checking until they are updated.

**Acceptance Scenarios**:

1. **Given** a shape used across packages, **When** it is changed in the shared package, **Then** consuming packages that have not been updated fail `tsc --noEmit`.
2. **Given** an API request with a body that does not match its Zod schema, **When** the request is received, **Then** the request is rejected before it reaches handler logic.

---

### User Story 3 — CI Blocks a Regression Before Merge (Priority: P1)

An engineer opens a pull request that introduces a type error (or lint violation, or failing test, or build failure). CI runs and reports the failure, blocking merge until the regression is fixed.

**Why this priority**: Product spec §9.10 defines the CI pipeline stages in a fixed order, and §12.12 mandates regression checks "After completing each phase" via the full test suite. Without enforced gates, the phased build order in §12.5 cannot be guaranteed.

**Independent Test**: Open a PR containing a deliberate type error, lint violation, or failing unit test; observe that the corresponding CI stage fails and merge is prevented.

**Acceptance Scenarios**:

1. **Given** a PR with a TypeScript error, **When** CI runs, **Then** the type-check stage fails (§9.10 step 2).
2. **Given** a PR with a lint violation, **When** CI runs, **Then** the lint stage fails (§9.10 step 3).
3. **Given** a PR with a failing Vitest case, **When** CI runs, **Then** the test stage fails (§9.10 step 4).
4. **Given** a PR with a build error in any package, **When** CI runs, **Then** the build stage fails (§9.10 step 5).

---

### User Story 4 — Engineer Diagnoses a Past Conversation from Logs (Priority: P2)

An engineer investigating an issue with a specific past conversation queries the structured logs by session ID and recovers the full event timeline: messages received, tool invocations with the files they retrieved, response sent, and any errors with their context.

**Why this priority**: Product spec §11.7 mandates "structured JSON logs so they can be queried later (even if only writing to files for MVP)" and lists the events that MUST be logged: "every conversation event: message received, tool called, context retrieved, response sent" plus "tool call details: which files were searched, relevance scores, tokens used" and "errors with full context (session ID, conversation state, failing tool)."

**Independent Test**: After running a chat session in the local testbed, query the log output by session ID and verify the four event categories listed in §11.7 are all present and JSON-parseable.

**Acceptance Scenarios**:

1. **Given** a chat session has occurred, **When** the engineer filters logs by `session_id`, **Then** they see entries for message-received, tool-called, context-retrieved, and response-sent events.
2. **Given** an error occurred during a session, **When** the engineer reads the error log entry, **Then** it contains the session ID, the conversation state, and the failing tool (§11.7).

---

### Edge Cases

- **Missing required environment variables**: If `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, or `SESSION_SECRET` is missing on API startup, the API MUST fail to start with a clear error indicating which variable is missing (derived from §9.7's enumeration of required env vars and the constitution's "no silent fallback" rule, which itself was extracted from §9.7's explicit listing).
- **`SESSION_SECRET` shorter than 32 characters**: Per §9.7, `SESSION_SECRET` requires "min 32 chars"; startup MUST fail if the value is shorter.
- **Re-running migrations on an already-migrated database**: §12.3 implies migrations are part of routine setup. Re-running `pnpm db:migrate` MUST be safe (idempotent) so engineers can re-bootstrap without data loss in shared dev environments.
- **Re-running the seed on an already-seeded database**: §12.3 lists `pnpm db:seed` in the standard setup. The seed MUST be safe to re-run for dev workflows; it MUST NOT duplicate the test account or the dev API key on each invocation.
- **Native binary failure on a Netlify-like build environment**: §9.7 records that `bcrypt` (native) was replaced with `bcryptjs` (pure JS) "to eliminate native binary compilation on Netlify's build environment." The Foundation MUST exclude native-binary dependencies from production packages and MUST allow `better-sqlite3` only as a dev dependency (§9.3).
- **`CONTEXT_STORE_URL` override**: §12.3 states the seeded `context_store_url` defaults to `http://localhost:5173/chatbot-context/` and may be overridden via `CONTEXT_STORE_URL`. The Foundation MUST honor this override.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — Monorepo Bootstrap (§9.6)

- **FR-001**: The repository MUST be organized as a Turborepo workspace per the layout in §9.6, with packages: `widget`, `api`, `dashboard`, `crawler`, and `shared`. Source: §9.6 directory tree.
- **FR-002**: The repository MUST use `pnpm` as the package manager with workspace support. Source: §9.1 ("Package manager: pnpm — Fast, disk-efficient, workspace support") and §9.10 ("pnpm — Package manager with workspace support").
- **FR-003**: The repository MUST use Turborepo for build orchestration enabling parallel builds across packages, dependency-aware task execution, and shared `tsconfig` and lint rules. Source: §9.6 ("Turborepo benefits").
- **FR-004**: A single `pnpm install` invocation MUST install dependencies for every package. Source: §9.6 ("Single `pnpm install` for all packages").
- **FR-005**: The repository MUST target Node.js 20+ as the runtime. Source: §9.1, §9.10 ("Node.js 20+ — Runtime (LTS, native fetch, stable ESM)").
- **FR-006**: The repository MUST use ESLint with flat config for code linting. Source: §9.10 ("ESLint — Code linting (flat config)").
- **FR-007**: The repository MUST use Prettier for code formatting. Source: §9.10 ("Prettier — Code formatting").
- **FR-008**: The repository MUST use Changesets for version management and changelog generation. Source: §9.10 ("Changesets — Version management and changelog generation").
- **FR-009**: All packages MUST be authored in TypeScript. Source: §9.1 ("Language: TypeScript — End-to-end type safety across all packages").

#### FR Group B — Shared Types & Validation Schemas (§2.6, §4.4, §7.3, §7.4, §9.9)

- **FR-010**: The `shared` package MUST expose shared types, utilities, and constants used by other packages. Source: §9.6 (`shared` package description).
- **FR-011**: The `shared` package MUST provide Zod schemas for validation across API boundaries. Source: §9.9 ("zod — Schema validation for API inputs, form data, tool parameters") and §9.1 ("Validation: Zod — Schema validation across API boundaries").
- **FR-012**: Tool parameter shapes used by the agent MUST be expressed as Zod schemas. Source: §7.3 (`contextSearchTool` parameters defined via `z.object({...})`) and §7.4 (`captureLead` parameters defined via `z.object({...})`).
- **FR-013**: The configuration form output JSON shape MUST be defined as a typed schema. Source: §4.4 (the JSON shape with `version`, `saved_at`, `persona`, `practice_areas`, `qualifying_questions`, `boundaries`, `escalation`, `contact`, `custom_instructions`).

#### FR Group C — Database Schema & Migration Tooling (§2.6, §9.3, §9.5)

- **FR-014**: The production database MUST be Neon serverless PostgreSQL accessed via the `@neondatabase/serverless` HTTP driver. Source: §2.6, §9.1, §9.3, §9.9.
- **FR-015**: Database access MUST go through Drizzle ORM using `drizzle-orm/neon-http` for production. Source: §2.6, §9.1, §9.5.
- **FR-016**: Database access for tests MUST go through Drizzle using `drizzle-orm/better-sqlite3` against in-memory SQLite. Source: §2.6 ("SQLite (`better-sqlite3`) is retained as a dev dependency for fast in-memory test mocks"), §9.3, §9.5, §9.9.
- **FR-017**: `better-sqlite3` MUST be declared as a dev dependency only. Source: §2.6 and §9.3 ("retained as a dev dependency for in-memory test mocks").
- **FR-018**: The database schema MUST define the following tables exactly as specified in §2.6: `accounts`, `api_keys`, `configurations`, `sessions`, `leads`, `archived_data`, `notifications`. Source: §2.6 schema listing.
- **FR-019**: The schema MUST use the column types and constraints shown in §2.6, including the `accounts_email_unique` index on `accounts.email`, primary keys, foreign-key references (`api_keys.account_id → accounts.id`, `configurations.account_id → accounts.id`, `sessions.account_id → accounts.id`, `leads.account_id → accounts.id`, `leads.session_id → sessions.id`, `notifications.account_id → accounts.id`, `notifications.lead_id → leads.id`), and default values (`is_published = false`, `messages_json = '[]'`, `is_preview = false`, `status = 'new'`, `read = false`, `delivery_channel = 'dashboard'`). Source: §2.6 schema listing.
- **FR-020**: SQL migrations MUST be generated from the schema using `drizzle-kit`. Source: §9.5 ("Migration tooling: `drizzle-kit` generates SQL migrations from schema changes").
- **FR-021**: A `pnpm db:migrate` command MUST exist that creates the PostgreSQL tables on Neon. Source: §12.3 ("`pnpm db:migrate` # Create PostgreSQL tables on Neon").
- **FR-022**: A `pnpm db:seed` command MUST exist that creates a development account, a development API key, a published guardrails configuration, and the dev `context_store_url`. Source: §12.3 ("Dev seed script (`pnpm db:seed`)" enumerates all four).
- **FR-023**: The dev seed MUST create the test account `dev@legalchatbot.com` with password `password123`. Source: §12.3.
- **FR-024**: The dev seed MUST create the development API key `dev_test_key`, stored as a bcryptjs hash. Source: §12.3 ("A dev API key: `dev_test_key` (bcrypt-hashed)") and §9.7 (replacement of `bcrypt` with `bcryptjs`).
- **FR-025**: The dev seed MUST create a published guardrails configuration "using Shrager Defense Attorneys defaults." Source: §12.3.
- **FR-026**: The dev seed MUST set the dev account's `context_store_url` to `http://localhost:5173/chatbot-context/`, with the value overridable via the `CONTEXT_STORE_URL` environment variable. Source: §12.3.

#### FR Group D — Environment Configuration & Secrets (§9.7, §12.3)

- **FR-027**: The API site MUST require the following environment variables to start: `DATABASE_URL` (Neon connection string), `GOOGLE_GENERATIVE_AI_API_KEY` (Gemini API key), `SESSION_SECRET` (iron-session encryption key, minimum 32 characters). Source: §9.7 ("Environment variables (API site)").
- **FR-028**: The widget site MUST require the environment variable `VITE_API_URL` pointing to the API site's chat endpoint. Source: §9.7 ("Environment variables (Widget site)").
- **FR-029**: The repository MUST ship a `.env.example` template that lists `DATABASE_URL` and `GOOGLE_GENERATIVE_AI_API_KEY`. Source: §12.3 ("`cp .env.example .env # Add DATABASE_URL and GOOGLE_GENERATIVE_AI_API_KEY`").
- **FR-030**: The dev environment MUST support `CONTEXT_STORE_URL` as an override of the seeded context-store URL. Source: §12.3.

#### FR Group E — Structured Logging Foundation (§11.7)

- **FR-031**: The Foundation MUST provide a structured-JSON logger usable by all packages. Source: §11.7 ("Use structured JSON logs so they can be queried later (even if only writing to files for MVP)").
- **FR-032**: The logger MUST be capable of recording every conversation event: message received, tool called, context retrieved, response sent. Source: §11.7.
- **FR-033**: The logger MUST be capable of recording tool-call detail including which files were searched, relevance scores, and tokens used. Source: §11.7.
- **FR-034**: The logger MUST be capable of recording errors with full context: session ID, conversation state, and the failing tool. Source: §11.7.
- **FR-035**: The logger MUST support a per-session debug mode that can be toggled on for troubleshooting specific conversations. Source: §11.7 ("Consider a debug mode that can be toggled per session for troubleshooting specific conversations").

#### FR Group F — CI Pipeline & Quality Gates (§9.10)

- **FR-036**: A CI pipeline MUST exist on GitHub Actions and run on pull requests. Source: §9.10 ("GitHub Actions — CI pipeline (lint, type-check, test on PR)").
- **FR-037**: The CI pipeline MUST execute the following stages, in order: (1) install dependencies (`pnpm install`); (2) type check (`tsc --noEmit` across all packages); (3) lint (`eslint .`); (4) unit + integration tests (`vitest run`); (5) build all packages (`turbo build`); (6) E2E tests on merge to `main` only. Source: §9.10 ("CI pipeline stages") enumerated 1–6.
- **FR-038**: Failure of any stage in FR-037 MUST block PR merge for stages 1–5; stage 6 runs on merge to `main`. Source: §9.10.
- **FR-039**: The Foundation MUST configure Vitest as the unit/integration test runner. Source: §9.8 (testing strategy table: "Unit tests — Vitest", "Integration tests — Vitest + MSW").
- **FR-040**: The Foundation MUST configure MSW (Mock Service Worker) for integration test mocking. Source: §9.8 ("Integration tests — Vitest + MSW").
- **FR-041**: The Foundation MUST configure Playwright as the E2E test runner. Source: §9.8 ("E2E tests — Playwright").
- **FR-042**: The Foundation MUST configure Vitest + Testing Library for widget component tests. Source: §9.8 ("Widget tests — Vitest + Testing Library").

#### FR Group G — Local Development Orchestration (§12.3)

- **FR-043**: A `pnpm dev` command MUST exist that concurrently starts the React test app, the API server, and the context-store static-file serving. Source: §12.3 ("This concurrently starts: 1. React test app (Vite); 2. API server (Next.js dev mode); 3. Context store — served as static files from `./chatbot-context/` on the test app's dev server").
- **FR-044**: The local dev React test app MUST run on `localhost:5173` (Vite). Source: §12.2 component-location table.
- **FR-045**: The local dev API server MUST run on `localhost:3000` (Next.js). Source: §12.2 component-location table.
- **FR-046**: The local dev context store MUST be served from the local filesystem path `./chatbot-context/` and exposed at `http://localhost:5173/chatbot-context/`. Source: §12.2 and §12.3 ("the React test app's Vite dev server serves the `./chatbot-context/` directory as static files at `http://localhost:5173/chatbot-context/`").
- **FR-047**: The local dev environment MUST require only Node.js, a Gemini API key, and a Neon connection string — no Docker and no self-hosted databases. Source: §12.2 ("No Docker or self-hosted databases. A developer with Node.js, a Gemini API key, and a Neon connection string can run the full system").
- **FR-048**: Pre-crawled context for the seeded development account MUST ship with the repo at `chatbot-context/` (Shrager Defense Attorneys content). Source: §12.4 ("The repo ships with a pre-crawled set of context files from Shrager Defense Attorneys").
- **FR-049**: The API server's behavior in local dev MUST identically mirror its behavior in production: it MUST fetch context from the configured URL with no special local-mode code paths. Source: §12.3 ("The API server fetches from this URL identically to how it would in production — no special local-mode code paths").

#### FR Group H — Cross-Cutting Constraints (Spec-derived)

- **FR-050**: Native-binary npm dependencies MUST be excluded from production packages; specifically, `bcrypt` MUST NOT be used and `bcryptjs` MUST be used in its place for password and API-key hashing. Source: §9.7 ("`bcrypt` (native C++ addon) was replaced with `bcryptjs` (pure JS) to eliminate native binary compilation on Netlify's build environment") and §9.9.
- **FR-051**: The Foundation MUST NOT introduce any deployment that requires a persistent local filesystem at runtime; persistence is delegated to Neon and read-only static data is delegated to the lawyer's context store. Source: §9.3 ("Serverless-compatible: No persistent filesystem required — works with Netlify Functions, Vercel, and other serverless platforms") and §2.11 ("Context Store — Passive file storage. Read-only at query time").
- **FR-052**: The Foundation MUST NOT introduce Next.js Server Actions; mutations are reserved for Route Handlers. Source: §8.4 ("Configuration save and publish use standard API route handlers (`POST /api/dashboard/config`) rather than Next.js server actions. This avoids server action ID mismatch issues that occur on serverless platforms like Netlify") and §9.7 ("Server actions are not used").

### Key Entities

The Foundation does not introduce new business entities; it provides the schema for entities defined in §2.6 that downstream features will populate. The entities defined by the schema are:

- **Account**: A law firm's account (`accounts` table). Attributes: id, email (unique), password_hash, firm_name, created_at. Source: §2.6.
- **API Key**: A widget authentication token bound to an account (`api_keys` table). Attributes: id, account_id, key_hash (bcryptjs hash), label, context_store_url, created_at, revoked_at. Source: §2.6, §2.4.
- **Configuration**: A versioned guardrails record (`configurations` table). Attributes: id, account_id, version, config_json, is_published, created_at. Source: §2.6, §4.5.
- **Session**: A chat session (`sessions` table). Attributes: id, account_id, messages_json (default `[]`), is_preview (default false), created_at, updated_at. Source: §2.6.
- **Lead**: A captured intake lead (`leads` table). Attributes: id, account_id, session_id, name, contact_email, contact_phone, case_type, incident_date, brief_description, classification (`urgent` | `normal` | `unqualified`), classification_rationale, urgency_factors_json, status (default `new`: `new` | `contacted` | `dismissed`), created_at. Source: §2.6, §7.4.
- **Archived Data**: A retained snapshot of a record after lawyer-initiated deletion (`archived_data` table). Attributes: id, account_id, original_table (`leads` | `sessions`), original_id, data_json, deleted_by_user_at, archived_at. Source: §2.6, §1.10.
- **Notification**: A dashboard alert (`notifications` table). Attributes: id, account_id, type (`urgent_lead` | `escalation` | `system`), title, body, lead_id, read (default false), delivery_channel (default `dashboard`), delivered_at, created_at. Source: §2.6, §8.7.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new engineer can complete the Initial Setup flow described in §12.3 (`git clone` → `pnpm install` → populate `.env` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`) without manual intervention beyond providing the two required secret values.
- **SC-002**: After running `pnpm dev`, the React test app, the API server, and the context-store static-file route are all reachable on the URLs specified by §12.2 (`localhost:5173`, `localhost:3000`, `http://localhost:5173/chatbot-context/`).
- **SC-003**: After running `pnpm db:seed`, querying the database returns exactly one account with email `dev@legalchatbot.com`, one API key associated with that account, one published configuration, and a context-store URL of `http://localhost:5173/chatbot-context/` (or the value of `CONTEXT_STORE_URL` if set).
- **SC-004**: Running `pnpm db:migrate` against an empty database results in all seven tables from §2.6 (`accounts`, `api_keys`, `configurations`, `sessions`, `leads`, `archived_data`, `notifications`) being present with the columns and constraints specified.
- **SC-005**: Re-running `pnpm db:migrate` and `pnpm db:seed` on an already-bootstrapped database does not corrupt or duplicate seeded records.
- **SC-006**: Every CI stage from §9.10 (install → type-check → lint → tests → build) executes on every pull request, and a failure in any stage blocks merge.
- **SC-007**: A pull request that introduces a TypeScript error, a lint violation, or a failing Vitest test is detected by CI before merge in 100% of cases.
- **SC-008**: Logs emitted during a chat session include all four event categories required by §11.7 (message received, tool called, context retrieved, response sent), and every log entry is valid JSON.
- **SC-009**: Logs emitted for an error during a chat session include the session ID, the conversation state, and the failing tool name, as required by §11.7.
- **SC-010**: The repository contains zero production runtime dependencies that require native compilation; the production dependency tree resolves successfully on a clean Linux build environment without `node-gyp` or platform-specific binaries.
- **SC-011**: The widget production bundle is built without depending on `bcrypt` or any other native binary library; password and key hashing use `bcryptjs` exclusively.
- **SC-012**: Engineers can add a new shape to `packages/shared` and observe a type error in any consuming package that has not been updated to match.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Idempotent migrations and seeds**: §12.3 lists `pnpm db:migrate` and `pnpm db:seed` as ordinary setup steps. The spec does not say "exactly once," so we assume both must be safe to re-run during routine dev workflows. (Constitution-level requirement; §12.3 implicitly relies on this.)
- **Fail-fast on missing env vars**: §9.7 enumerates required environment variables. The spec does not explicitly say "fail to start if missing," but the constitution and standard operational practice for serverless apps require fast, loud failure rather than silent fallback. Adopted as a non-functional safety default.
- **Logger transport is pluggable, file-based for MVP**: §11.7 says "even if only writing to files for MVP." We assume file-based (or stdout, which Netlify aggregates) is acceptable for the Foundation; remote log aggregation is not required by the spec.
- **`SESSION_SECRET` minimum length 32 is enforced at startup**: §9.7 explicitly says "min 32 chars." Adopted as a startup precondition, not a runtime check.
- **Workspace root layout matches §9.6 exactly**: The directory tree in §9.6 is shown with `apps/` marked "(optional) combined deployments" — we treat `apps/` as optional for the Foundation and not required for MVP.
- **No additional packages beyond the five named in §9.6**: The spec lists exactly `widget`, `api`, `dashboard`, `crawler`, `shared`. Splitting a sync CLI out of `crawler` (FR for §4.7's `legal-chatbot-sync`) is permitted only later by an explicit roadmap module; the Foundation creates only the five packages named in the spec.
- **Single account in dev**: §12.3 describes one test account; multi-tenant dev fixtures are not required by the spec.

## Out of Scope (for this feature)

The following are explicitly **not** part of the Foundation feature, even though they are mentioned in the same spec sections:

- The crawler CLI itself (§3, §12.6) — Phase 1.
- The context-search agent (§7, §12.7) — Phase 2.
- The chat API route handler and agent runtime (§7, §12.8) — Phase 3.
- The chat widget UI (§6, §12.9) — Phase 4.
- The `captureLead` tool, classification logic, and partial-lead heuristic (§7.4, §12.10) — Phase 5.
- The dashboard UI, authentication flows, leads pages, configuration form, preview chat (§8, §12.11) — Phase 6.
- Production deployment to Netlify (§9.7) — Phase 8 of the roadmap.
- Cost monitoring dashboards, daily budget caps, FAQ semantic cache (§11.3, §11.6) — Phase 7 hardening.
- Conversation-quality eval scripts (§9.8) — Phase 8 release prerequisite.

The Foundation provides the *infrastructure* that enables all of the above; it does not implement any of them.

## Dependencies

- **External**: A Neon PostgreSQL database (free tier sufficient per §9.3) and a Google Generative AI (Gemini) API key (§9.7, §12.2). The Foundation cannot be exercised end-to-end without both.
- **Internal**: None. The Foundation is the first phase and depends on no other Lex Bot feature.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific log destination (cloud logging service, Sentry, etc.) is required — the spec says "writing to files for MVP" is acceptable (§11.7).
- No specific GitHub Actions workflow file structure is required beyond the staged pipeline of §9.10.
- No code-coverage threshold is specified — the spec does not mention one.
- No git pre-commit hook is mandated — the spec does not require it.
- No specific commit-message convention is mandated — the spec does not require it.
- No IDE configuration (`.vscode/`, `.editorconfig`) is mandated — the spec does not require it.

If any of these are wanted, they belong in a separate feature, not in Foundation.
