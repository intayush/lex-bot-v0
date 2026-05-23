# Feature Specification: Deployment & Release

**Feature Branch**: `009-deployment-release`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Deployment & Release from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary sources: §1.8 (Deployment Model), §9.7 (Deployment), §9.8 (Testing Strategy — including conversation-quality testing), §9.10 (Environment & Tooling, CI pipeline). Supporting sources: §1.9 (LLM Provider), §12.3 (Dev Environment Setup — for prod parity), §12.4 (Shrager seed content). Each functional requirement cites its source section. No requirements have been invented.

## Overview

The Deployment & Release feature is the operational layer that takes the eight prior feature builds and ships them to production. Per §1.8 the deployment model places three things in three places: context files self-hosted on the lawyer's own server (already an output of `002-crawler-cli`), the chatbot API and Dashboard hosted centrally as SaaS (deployed here to Netlify per §9.7), and the chat widget embedded in the lawyer's website via NPM and CDN distribution (also deployed here per §9.7).

Per §9.7 the system deploys as **two Netlify sites from the same monorepo**: one site for Dashboard + API, one site for Widget + Demo + the Shrager seed `chatbot-context/`. The Crawler ships to the npm registry as an `npx`-executable package. The database is managed by Neon. The CI pipeline (§9.10) runs on every PR with E2E gated to merge-to-`main`. Conversation-quality eval scripts (§9.8) run as a manual release gate because LLM responses are non-deterministic.

This is Phase 8 of the build roadmap. It depends on every prior feature being complete and is the gate before any "production" claim. Some CI plumbing (install → type-check → lint → unit/integration → build) is already binding in `001-foundation` (FR-036 to FR-042); this feature owns the **production deployment plumbing** itself plus the merge-to-`main` E2E and the manual conversation-quality gate.

## User Scenarios & Testing *(mandatory)*

The "users" of Deployment & Release are:

1. **A Lex Bot release engineer** — runs the deploy pipeline, publishes the crawler to npm, publishes the widget to the CDN, and runs the manual conversation-quality eval before declaring a release.
2. **A lawyer (or their developer)** — installs `legal-chatbot-crawl` from npm via `npx`, embeds the widget from the CDN, and points their dashboard browsers at the deployed API site.
3. **A potential client visiting the lawyer's website** — interacts with the deployed widget hitting the deployed API in production.

### User Story 1 — Engineer Deploys Dashboard + API to Netlify (Priority: P1)

The release engineer pushes to `main`. CI runs the full pipeline (install, type-check, lint, unit + integration, build, E2E). On success, Netlify builds and publishes the Dashboard + API site (the Next.js app) using `@netlify/plugin-nextjs`. The site exposes the dashboard at the chosen URL and the chat API at `/api/chat`.

**Why this priority**: §9.7 names this as the primary deployment surface. Without it, neither the dashboard nor the chat API is reachable in production, and the entire system is unbuilt for end users.

**Independent Test**: Push to `main`, observe CI green, observe Netlify build green, then visit the deployed dashboard URL and POST to the deployed `/api/chat` endpoint with a valid API key.

**Acceptance Scenarios**:

1. **Given** a green CI run on `main`, **When** Netlify triggers a build for the API site, **Then** the build uses `@netlify/plugin-nextjs` with base directory `packages/api` per the §9.7 deployment table.
2. **Given** the API site is deployed, **When** the deployed Next.js app initializes, **Then** required environment variables (`DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `SESSION_SECRET` ≥ 32 chars) are read from Netlify configuration; missing values cause the deploy to fail to serve traffic rather than silently fall back (§9.7 Environment variables — API site, plus the Foundation's fast-fail rule).
3. **Given** the dashboard URL is reached, **When** an authenticated lawyer browses pages, **Then** the rendered dashboard mirrors the local-dev dashboard built in `007-dashboard`.
4. **Given** the chat endpoint is reached, **When** the deployed API receives `POST /api/chat` from the widget, **Then** it serves the streaming protocol exactly as exercised in `004-chat-api-agent` (no special production-only code paths).

---

### User Story 2 — Engineer Deploys Widget + Demo + Context to Netlify (Priority: P1)

The release engineer publishes the second Netlify site, which hosts: the widget bundle (built from `packages/widget` via Vite, suitable for CDN consumption), a small demo site, and the seeded `chatbot-context/` static files (Shrager content plus generated `_manifest.json` and `_guardrails.md`). The widget site reads `VITE_API_URL` to know which API to call.

**Why this priority**: §9.7 names "Widget + Demo site" as one of the two deploy targets. The CDN distribution channel (§6.2) lives on this site. Without it, the CDN install path of the widget does not work and the seeded demo content is not reachable.

**Independent Test**: Visit the deployed widget-site URL and verify (a) the demo page renders the embedded widget, (b) `https://<widget-site>/widget/v1/legal-chatbot.js` (or equivalent path documented in §6.2) is served, (c) `https://<widget-site>/chatbot-context/_manifest.json` is reachable as a static file.

**Acceptance Scenarios**:

1. **Given** a green CI run on `main`, **When** Netlify triggers a build for the Widget site, **Then** the build is the Vite output from `packages/widget` and the `chatbot-context/` directory is published as static assets alongside the widget (§9.7 deployment table row 2).
2. **Given** the widget site is deployed, **When** the build initializes, **Then** the `VITE_API_URL` environment variable is read and used as the URL of the API site's chat endpoint (§9.7 Environment variables — Widget site).
3. **Given** the widget site is deployed, **When** `chatbot-context/_manifest.json` is fetched over HTTPS, **Then** it returns the seeded manifest as static content (§9.7 row 2 "served as static assets alongside the widget").

---

### User Story 3 — Engineer Publishes Crawler to the npm Registry (Priority: P1)

The release engineer publishes the `legal-chatbot-crawl` package to the npm registry so lawyers (and their developers) can run it as `npx legal-chatbot-crawl --url https://example-lawfirm.com --output ./chatbot-context/` from any machine without prior installation.

**Why this priority**: §9.7 names "Crawler — npm registry — Distributed as `npx`-executable package" as a binding deployment target. §3.3 documents the `npx` invocation as the standard interface. Without npm publication, the §3.3 install path does not exist and lawyers cannot generate their context.

**Independent Test**: After publication, run `npx legal-chatbot-crawl --url <test-site> --output ./out/` on a clean machine with only Node.js installed, and verify the crawler runs as documented in `002-crawler-cli`.

**Acceptance Scenarios**:

1. **Given** the crawler package is published to the npm registry, **When** a developer runs `npx legal-chatbot-crawl …`, **Then** the package is resolved, downloaded, and executed without prior `npm install` (§9.7).
2. **Given** the published version, **When** semver tagging is applied, **Then** version management and changelog generation use Changesets (§9.10).

---

### User Story 4 — Lawyer Installs the Widget Through CDN or NPM (Priority: P1)

A lawyer (or their developer) embeds the widget on their site via either the CDN script tag or the NPM package, both of which are produced by the deployment pipeline. The CDN path uses the URL of the deployed widget site; the NPM path resolves to a published package on the npm registry.

**Why this priority**: §6.2 documents both distribution channels and §9.7 routes the CDN through Netlify. Without the production CDN URL and the npm publish, neither install channel works for end users.

**Independent Test**: From a clean test page, paste the §6.2 CDN script tag (with the production CDN URL) and verify the widget renders and connects to the deployed API. Separately, `npm install @legal-chatbot/widget` and render `<LegalChatbot apiKey="…" />` against the same API.

**Acceptance Scenarios**:

1. **Given** the widget Netlify site is deployed, **When** a `<script>` tag points at the production CDN URL with a valid `data-api-key`, **Then** the widget loads and connects to the production chat API (§6.2 CDN, §9.7 widget site).
2. **Given** the NPM package is published, **When** a host project installs and renders `<LegalChatbot apiKey="…" />`, **Then** the widget loads against React per §6.2.

---

### User Story 5 — Engineer Provisions Production Neon Database (Priority: P1)

The release engineer creates a production Neon serverless PostgreSQL database, runs the migrations, and configures the production `DATABASE_URL` in Netlify. The schema in production matches the §2.6 schema exactly, and CI's seed step does NOT run against production (production data is real).

**Why this priority**: §9.7 names "Database — Neon (serverless PostgreSQL) — Managed, no infrastructure to maintain" as the binding choice. Without a production database, no lead can be persisted.

**Independent Test**: Provision a Neon database, run the production migration command, then verify all seven tables from §2.6 exist and that a manual write works against the production `DATABASE_URL`.

**Acceptance Scenarios**:

1. **Given** an empty production Neon database, **When** the production migrate command runs, **Then** all seven tables (`accounts`, `api_keys`, `configurations`, `sessions`, `leads`, `archived_data`, `notifications`) exist with the §2.6 columns and constraints (already specified in `001-foundation`).
2. **Given** a production Neon database, **When** the API site's deploy reads `DATABASE_URL`, **Then** it is the production connection string (not dev/staging).
3. **Given** a production Neon database, **When** the production deploy is configured, **Then** the dev seed script (`pnpm db:seed`) is not invoked against it (production data must not be overwritten).

---

### User Story 6 — Engineer Runs E2E Tests on Merge to Main (Priority: P1)

When code is merged to `main`, the CI pipeline executes Playwright E2E tests covering the dashboard flows (login, configure, view leads). Failure of any E2E test blocks the deploy.

**Why this priority**: §9.10 step 6 explicitly says "E2E tests (on merge to main only)." This is the gate that catches integration regressions invisible to unit tests.

**Independent Test**: Push a PR to `main` that breaks a dashboard flow; verify the merge-to-`main` E2E job fails and the deploy does not proceed.

**Acceptance Scenarios**:

1. **Given** a merge to `main`, **When** CI runs, **Then** the Playwright E2E suite (§9.8 row 3) executes after the build stage (§9.10 step 6).
2. **Given** a Playwright failure, **When** CI completes, **Then** the deploy is blocked.

---

### User Story 7 — Engineer Runs the Conversation-Quality Eval Before Release (Priority: P1)

Before declaring a release, the engineer runs the conversation-quality eval suite against the live (deployed) agent. The suite consists of a curated set of test conversations (user scripts) with expected outcomes (§9.8). Findings are recorded; regressions block the release until addressed.

**Why this priority**: §9.8 explicitly mandates this layer of testing as a manual QA gate, distinct from the automated CI tests, because LLM responses are non-deterministic. Without this gate, regressions in agent behavior — guardrail compliance, classification accuracy, fallback wording — slip into production silently.

**Independent Test**: Maintain a documented set of test conversations under (e.g.) `evals/` in the repo. Before declaring a release, execute the suite against the deployed agent and compare actual outputs to documented expectations.

**Acceptance Scenarios**:

1. **Given** a curated set of test conversations with expected outcomes, **When** the suite is run against the live agent before release, **Then** outputs are compared against expectations and discrepancies are reviewed (§9.8 conversation-quality testing).
2. **Given** a regression is detected, **When** the suite finishes, **Then** the release is held until the regression is addressed (§9.8 "Run periodically against the live agent to detect regressions").

---

### User Story 8 — Lawyer Embeds the Widget With a Wildcard CORS Surface (Priority: P2)

A lawyer embeds the widget on their `https://example-lawfirm.com` site. The widget's calls to the deployed API succeed because the API responds with `Access-Control-Allow-Origin: *` — the widget is designed to be embedded on arbitrary client websites and the per-site API key (§2.4) is the authentication surface, not the request origin.

**Why this priority**: §9.7 explicitly mandates this CORS posture: "CORS is set to `Access-Control-Allow-Origin: *` since the widget is designed to be embedded on any client's website." Without it, every new firm would need an origin allowlist update on the SaaS — defeating the embeddable model.

**Independent Test**: Embed the widget on a previously-unknown origin and verify CORS-preflighted and same-host fetch calls succeed against the API.

**Acceptance Scenarios**:

1. **Given** the deployed API, **When** a request originates from any HTTP origin, **Then** the API responds with `Access-Control-Allow-Origin: *` (§9.7).

---

### Edge Cases

- **Server actions accidentally re-introduced in a deploy**: §9.7 explicitly says server actions are not used because cached HTML can reference stale action hashes across Netlify deploys. A deploy that introduces server actions would break previously-cached pages on the lawyer's already-open browser tabs. The §8.4 implementation note is the binding constraint; this feature surfaces it as a deploy-time check.
- **Native binary deps re-introduced**: §9.7 explicitly records that `bcrypt` was replaced with `bcryptjs` because Netlify's build environment cannot compile native C++ addons. A deploy that introduces a native-binary dependency would fail Netlify build. This is a deploy-time guarantee, not a runtime check.
- **CI green but Netlify deploy red**: CI runs the full pipeline (§9.10) but Netlify performs an additional production build. Failures here (e.g., serverless-function size, unsupported node-API usage) MUST surface to the engineer.
- **Conversation-quality regression after a model update**: §9.8 says the eval is "Not automated in CI (LLM responses are non-deterministic) but tracked as a manual QA step." When the model behind `gemini-2.5-flash` changes (provider-side), the eval is the only mechanism that catches a behavioral regression.
- **Widget version published to CDN ≠ version on npm**: §6.2 names both channels and §9.7 routes the CDN through Netlify. Skew between channels would cause integration confusion. The release process must publish both channels in lockstep (or document the skew).
- **Deploying without the conversation-quality eval being run**: §9.8 says the eval is "tracked as a manual QA step" — i.e., a release-gate that must be executed by a human. The release process must record the eval execution as part of release notes.
- **Production seed run accidentally**: The dev `pnpm db:seed` (§12.3) creates a test account `dev@legalchatbot.com` and a dev API key `dev_test_key`. Running it against production would create a known credential pair on the live system. This MUST be prevented by configuration (e.g., refuse to seed when `DATABASE_URL` looks like the production connection string) or by process.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`. Items already binding in earlier feature specs are deliberately not re-stated.

### Functional Requirements

#### FR Group A — Deployment Topology (§1.8, §9.7)

- **FR-001**: The system MUST be deployed as two Netlify sites from the same monorepo: one for Dashboard + API, one for Widget + Demo + the Shrager seed `chatbot-context/`. Source: §9.7 deployment table.
- **FR-002**: The Dashboard + API site MUST use `@netlify/plugin-nextjs` and have base directory `packages/api`. Source: §9.7 row 1.
- **FR-003**: The Dashboard + API site MUST serve API routes via Next.js serverless functions. Source: §9.7 row 1 ("Next.js serverless functions for API routes").
- **FR-004**: The Widget + Demo site MUST be a Vite static build hosting the widget bundle, demo content, and the seeded `chatbot-context/` as static assets alongside the widget. Source: §9.7 row 2.
- **FR-005**: The Crawler MUST be distributed via the npm registry as an `npx`-executable package. Source: §9.7 row 3, §3.3 invocation pattern.
- **FR-006**: The database MUST be a managed Neon serverless PostgreSQL instance — no self-hosted infrastructure. Source: §9.7 row 4.
- **FR-007**: At the system level, context files remain self-hosted on the lawyer's own server; the Chatbot API and Dashboard are SaaS-hosted; the Chat Widget is a client-side JS library embedded in the lawyer's website. Source: §1.8.
- **FR-008**: The pre-integrated Gemini model MUST be provided centrally; lawyers MUST NOT need to supply their own API keys or configure LLM settings. Source: §1.9.

#### FR Group B — Production Environment Variables (§9.7)

- **FR-009**: The API site MUST be configured in Netlify with the environment variables: `DATABASE_URL` (Neon connection string), `GOOGLE_GENERATIVE_AI_API_KEY` (Gemini API key), `SESSION_SECRET` (iron-session encryption key, minimum 32 characters). Source: §9.7 Environment variables — API site.
- **FR-010**: The Widget site MUST be configured with the environment variable `VITE_API_URL` pointing to the API site's chat endpoint (example: `https://api-site.netlify.app/api/chat`). Source: §9.7 Environment variables — Widget site.

#### FR Group C — Key Deployment Decisions (§9.7)

- **FR-011**: The deployed API MUST use Next.js Route Handlers for all mutations; Server Actions MUST NOT be used. Source: §9.7 ("Server actions are not used"), §8.4 implementation note.
- **FR-012**: Native-binary dependencies MUST NOT be introduced into deployed packages; password and API-key hashing MUST use `bcryptjs` (pure JS), not native `bcrypt`. Source: §9.7 ("`bcrypt` (native C++ addon) was replaced with `bcryptjs` (pure JS) to eliminate native binary compilation on Netlify's build environment").
- **FR-013**: The deployed chat API MUST respond with `Access-Control-Allow-Origin: *` because the widget is designed to be embedded on any client's website. Source: §9.7 ("CORS is set to `Access-Control-Allow-Origin: *`").

#### FR Group D — CI Pipeline (§9.10)

- **FR-014**: A CI pipeline MUST exist on GitHub Actions and run on every pull request and on merges to `main`. Source: §9.10 ("GitHub Actions — CI pipeline (lint, type-check, test on PR)").
- **FR-015**: The CI pipeline MUST execute the following stages, in this order, on every PR: (1) install dependencies (`pnpm install`); (2) type check (`tsc --noEmit` across all packages); (3) lint (`eslint .`); (4) unit + integration tests (`vitest run`); (5) build all packages (`turbo build`). Source: §9.10 CI pipeline stages 1–5. (These are already binding in `001-foundation` FR-037; restated here as the deployment integration contract.)
- **FR-016**: On merge to `main`, the CI pipeline MUST additionally run E2E tests using Playwright after the build stage. Source: §9.10 step 6, §9.8 row 3.
- **FR-017**: Failure of any CI stage MUST block its merge (PR-stages 1–5) or its deployment to production (merge-to-main stage 6). Source: §9.10 (implicit gate behavior of a CI pipeline).
- **FR-018**: Version management and changelog generation MUST use Changesets. Source: §9.10 ("Changesets — Version management and changelog generation").
- **FR-019**: The repository's monorepo build orchestration MUST use Turborepo. Source: §9.10 ("Turborepo — Monorepo build orchestration").

#### FR Group E — Testing Strategy (§9.8)

- **FR-020**: The deployed system MUST be covered by the five test layers from §9.8: Unit (Vitest), Integration (Vitest + MSW), E2E (Playwright), Widget component (Vitest + Testing Library), and Conversation quality (Manual + eval scripts). Source: §9.8 testing-strategy table.
- **FR-021**: Conversation-quality testing MUST maintain a curated set of test conversations (user scripts) with expected outcomes. Source: §9.8 conversation-quality bullet 1.
- **FR-022**: The conversation-quality suite MUST be run periodically against the live agent to detect regressions. Source: §9.8 conversation-quality bullet 2.
- **FR-023**: The conversation-quality suite MUST NOT be automated in CI (because LLM responses are non-deterministic) and MUST be tracked as a manual QA step that runs before release. Source: §9.8 conversation-quality bullet 3 ("Not automated in CI (LLM responses are non-deterministic) but tracked as a manual QA step").

#### FR Group F — Release Distribution (§9.7, §6.2, §3.3)

- **FR-024**: The widget production CDN URL produced by the Widget Netlify site MUST match the URL pattern documented in §6.2 (e.g., `https://cdn.legalchatbot.com/widget/v1/legal-chatbot.js` or the project's chosen equivalent), and MUST be referenced by lawyers' embed snippets. Source: §6.2 CDN Script Tag.
- **FR-025**: The widget NPM package MUST be published as `@legal-chatbot/widget` to the npm registry. Source: §6.2 NPM Package.
- **FR-026**: The crawler NPM package MUST be published with a name that allows the documented `npx legal-chatbot-crawl` invocation to resolve it. Source: §3.3, §9.7 row 3.
- **FR-027**: Both NPM-published packages (widget, crawler) MUST use Changesets for version management and changelog generation, and MUST publish a CHANGELOG accessible to consumers. Source: §9.10.

#### FR Group G — Production-Parity Guarantees (§12.3)

- **FR-028**: The deployed API server MUST fetch context from the configured `context_store_url` identically to how the local-dev API server does — no special production-only code paths. Source: §12.3 ("The API server fetches from this URL identically to how it would in production — no special local-mode code paths") — read in the inverse direction (the dev parity guarantee implies the production guarantee).
- **FR-029**: The deployed system MUST NOT require Docker or self-hosted databases. Source: §12.2 ("No Docker or self-hosted databases"), §9.7 row 4.

#### FR Group H — Seeded Demo Content & Demo Site (§12.4, §9.7)

- **FR-030**: The Widget Netlify site MUST publish the pre-crawled Shrager Defense Attorneys context files (`_manifest.json`, `_guardrails.md`, `pages/`, `config/`) as static assets so that the demo and any test installation has realistic firm content available out of the box. Source: §12.4, §9.7 row 2.
- **FR-031**: The seeded demo content's purpose is to provide realistic scenarios for testing: practice-area questions, attorney lookup, intake qualification, escalation handling, and out-of-scope deflection. The published content MUST preserve these scenarios. Source: §12.4 ("This real-world content provides realistic scenarios for testing…").

#### FR Group I — Production Database Migration (§9.7, §2.6)

- **FR-032**: The production Neon database MUST be initialized with the §2.6 schema via the project's migration tooling (`pnpm db:migrate` or its CI-runnable equivalent). Source: §9.7 row 4, §2.6 schema, §12.3 (migration command).
- **FR-033**: The dev seed script (`pnpm db:seed`) MUST NOT be executed against the production database. Source: §12.3 (the dev seed creates the test account `dev@legalchatbot.com` and the dev API key `dev_test_key`, which MUST NOT exist on production).

### Key Entities

This feature introduces no new persistent application entities. Its "entities" are the deployment artifacts and the release-process records that surround them:

- **API Netlify site**: The deployed Dashboard + API. Hosts the Next.js app at the chosen URL; consumes `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`, `SESSION_SECRET`. Source: §9.7 row 1, Environment variables.
- **Widget Netlify site**: The deployed Vite static build hosting the widget bundle, demo, and seeded `chatbot-context/`. Consumes `VITE_API_URL`. Source: §9.7 row 2, Environment variables.
- **Crawler npm package**: Published `npx`-executable. Source: §9.7 row 3, §3.3.
- **Widget npm package**: Published `@legal-chatbot/widget`. Source: §6.2.
- **Production Neon database**: Managed PostgreSQL instance with the §2.6 schema. Source: §9.7 row 4, §2.6.
- **Conversation-quality eval suite**: A curated set of test conversations with expected outcomes, stored in the repository, run manually against the live agent before each release. Source: §9.8.
- **Release notes / changelog**: Per-package CHANGELOG generated by Changesets. Source: §9.10.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a green CI run on `main`, the API Netlify site reaches `Deployed` state within Netlify's standard build window. Source: §9.7 row 1.
- **SC-002**: After a green CI run on `main`, the Widget Netlify site reaches `Deployed` state within Netlify's standard build window. Source: §9.7 row 2.
- **SC-003**: A request to the deployed `POST /api/chat` with a valid API key returns the streaming response shape described by `004-chat-api-agent` (Vercel AI SDK stream protocol, `x-session-id` header set, chunked transfer encoding). Source: §12.8 success response shape (already binding in `004-chat-api-agent`).
- **SC-004**: A request to any deployed API endpoint returns the response header `Access-Control-Allow-Origin: *`. Source: §9.7 ("CORS is set to `Access-Control-Allow-Origin: *`").
- **SC-005**: The deployed dashboard, under any browser supported by `007-dashboard`, allows a lawyer to log in and reach the Leads page. Source: §12.11 deliverable + §9.7 deployment.
- **SC-006**: The CDN URL for the widget bundle returns the widget JavaScript with the production-published version. Source: §6.2.
- **SC-007**: `npx legal-chatbot-crawl --url <site> --output ./out/` works on a clean machine with only Node.js installed. Source: §3.3, §9.7 row 3.
- **SC-008**: 100% of merge-to-`main` events execute the full CI pipeline including the Playwright E2E suite. Source: §9.10 step 6.
- **SC-009**: 0 deploys to production occur with a Server Actions usage in the codebase. Source: §9.7, §8.4.
- **SC-010**: 0 deploys to production occur with a native-binary npm dependency. Source: §9.7.
- **SC-011**: The Widget Netlify site exposes `chatbot-context/_manifest.json` as a static HTTPS-reachable asset. Source: §9.7 row 2, §12.4.
- **SC-012**: For every release, the conversation-quality eval suite is executed against the live agent and the run is recorded (e.g., in release notes or in a tracked log). Source: §9.8.
- **SC-013**: 100% of releases publish a CHANGELOG entry generated via Changesets. Source: §9.10.
- **SC-014**: The production Neon database contains all seven tables defined by §2.6 immediately after the production migration runs. Source: §9.7 row 4, §2.6, §12.3.
- **SC-015**: The dev seed script does not execute against the production database in any release run. Source: §12.3.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Production CDN URL**: §6.2 shows `https://cdn.legalchatbot.com/widget/v1/legal-chatbot.js` as an illustrative URL. The actual production URL is whatever the Widget Netlify site exposes (or a custom domain in front of it). The exact host is configuration; the path layout `widget/v1/…` is the documented default.
- **NPM package names**: §6.2 shows `@legal-chatbot/widget`. §3.3 shows `npx legal-chatbot-crawl`. Implementations MAY scope the crawler under the same npm scope (`@legal-chatbot/crawl`) so long as the documented `npx` invocation still resolves; or use the unscoped name `legal-chatbot-crawl`. Either is consistent with the spec.
- **Branching/version strategy on Netlify**: §9.7 names two Netlify sites but does not enumerate preview-deploy behavior, branch deploys, or rollback procedure. Standard Netlify defaults (deploy `main` to production, deploy PRs to preview URLs) are acceptable.
- **Frequency of the conversation-quality eval**: §9.8 says "Run periodically." The release-gate framing is adopted: at minimum, run before every release that touches the system prompt, agent logic, guardrails generation, or lead-classification criteria.
- **Eval-suite location in the repo**: §9.8 does not enumerate a directory. A top-level `evals/` (or under `tests/evals/`) is the natural default and consistent with §9.10's directory conventions.
- **Production migration tool invocation**: §9.7 / §12.3 show `pnpm db:migrate` as the command. Whether migrations are run via a Netlify build hook, a manually-triggered GitHub Actions job, or an operator's local environment with the production `DATABASE_URL` is implementation detail.
- **Production-seed prevention mechanism**: §12.3 describes the dev seed but does not enumerate how production protects itself. A startup check in the seed script that refuses to run when the connection string looks like a production connection (or when `NODE_ENV=production`) is a reasonable default.
- **Custom domain**: §9.7 shows `api-site.netlify.app` as illustrative. Whether to attach a custom domain is post-MVP per §10's "white-labeling / custom domains for the dashboard" deferral; default `*.netlify.app` URLs are acceptable for MVP.
- **Crawler version cadence**: §9.7 names npm publication. Whether to publish on every merge to `main` or to gate publication via a Changesets release branch is implementation detail; both are consistent with §9.10.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Deployment & Release feature, even though they appear in the same spec sections.

- The Foundation CI pipeline plumbing (install / type-check / lint / unit-integration / build) — already binding in `001-foundation` (FR-036 to FR-042). This feature consumes that pipeline as a precondition.
- The implementation of any feature being deployed (foundation, crawler, search, chat API, widget, lead classification, dashboard, hardening) — owned by their respective feature specs (`001`–`008`).
- Cost monitoring, daily-budget cap, FAQ semantic cache, per-session debug mode, ToS acceptance, privacy/retention disclosure language — owned by `008-hardening`.
- All MVP-deferred items in §10 / §8.12 (analytics, billing, CRM, multi-language, A/B testing, live handoff, BYO LLM, white-labeling / custom domains, webhooks).
- Multi-region deployments, blue/green deployments, or canary deployments. The spec describes a single-target deploy per Netlify site.
- Production observability tooling beyond the structured logger from `001-foundation` (no Sentry / Datadog / etc. is mandated).
- Custom domain configuration (§10 "white-labeling / custom domains for the dashboard" is deferred to post-MVP).
- Disaster recovery / backup procedures beyond what Neon provides as a managed service.

## Dependencies

- **External (release-gate)**: A Netlify account/team with capacity for two sites, an npm registry account with publish rights, a Neon account with capacity for a production database, a Gemini API key for `GOOGLE_GENERATIVE_AI_API_KEY`, and capacity to run the manual conversation-quality evals.
- **Internal — Upstream**: All eight prior feature specs (`001-foundation` through `008-hardening`). Deployment & Release does not implement product behavior; it ships product behavior built elsewhere.
- **Internal — Downstream**: None. This is the terminal feature in the build roadmap.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific Netlify deploy hook or build settings file format is mandated; §9.7 names the plugin (`@netlify/plugin-nextjs`) and the base directory (`packages/api`), not the YAML/TOML shape.
- No specific GitHub Actions workflow file structure or job-name convention is mandated; §9.10 names the stages and ordering.
- No specific custom domain, DNS configuration, or SSL setup is mandated; defaults provided by Netlify and Neon are acceptable.
- No specific monitoring/alerting product is mandated; §11.7's structured-JSON logging is the binding observability surface (already in `001-foundation`).
- No specific staging/preview-deploy strategy is mandated; the spec names two production sites only.
- No specific rollback procedure is mandated; using Netlify's "redeploy a previous version" UI is acceptable.
- No specific load-testing or capacity-planning procedure is mandated.
- No specific CDN provider beyond what Netlify provides for the Widget site is mandated; §6.2 names `cdn.legalchatbot.com` only as an illustrative URL.
- No specific changelog format beyond what Changesets generates is mandated.
- The post-MVP roadmap items in §10 / §8.12 (multi-tenant, billing, CRM, analytics, etc.) are explicitly out of scope per those sections — not adopted here.

If any of these are wanted, they belong in a separate feature, not in Deployment & Release.
