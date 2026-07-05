<!--
SYNC IMPACT REPORT (most recent)
================================
Version change: 1.0.0 → 2.0.0 (MAJOR)
Date: 2026-07-05
Bump rationale: The Platform Admin Console feature (super-admin tooling to
register, onboard, and oversee all law-firm tenants) requires three changes
that the versioning policy classifies as MAJOR / principle-redefining:

  1. LLM provider is no longer Gemini-only. Per §Versioning Policy, "swapping
     the LLM provider away from Gemini" is an explicit MAJOR trigger. The
     Required Stack now permits Google Gemini, Anthropic, and OpenAI selected
     per-tenant behind a provider-resolver abstraction. Gemini 2.5 Flash
     remains the platform default and fallback.
  2. Principle I's "MUST NOT be implemented before MVP completion" contract is
     redefined: super-admin multi-tenant operation, admin-facing analytics,
     and user-configurable LLM providers are carved out of the deferral list
     for the Platform Admin Console specifically. Other deferrals (payment,
     CRM, per-firm team roles, self-serve signup, etc.) remain in force.
  3. A new Principle VIII (Platform Administration & Tenant Isolation) is added
     to bound the newly-permitted cross-tenant super-admin surface.

Modified sections:
  ~ §I MVP-First Discipline — exclusion list amended with an explicit
    Platform Admin Console carve-out.
  ~ §VI Bounded, Observable, Cost-Aware Agent — added per-tenant model/provider
    resolution rules (bounded, key-secured, cost-attributed).
  ~ §Required Stack — "LLM provider" row now lists Gemini + Anthropic + OpenAI
    via the AI SDK; Gemini 2.5 Flash is the default/fallback.
  + §VIII Platform Administration & Tenant Isolation (NON-NEGOTIABLE) — new
    principle governing the super-admin role, cross-tenant access, and
    per-tenant secret handling.

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check enumerates gates
     dynamically against this file; new Principle VIII is picked up without a
     template edit. No change required.
  ✅ .specify/templates/spec-template.md — principle-agnostic. No change required.
  ✅ .specify/templates/tasks-template.md — phase model still aligns. No change
     required.

Follow-up TODOs: none. All principles resolved.
-->

<!--
SYNC IMPACT REPORT (prior)
================================
Version change: 1.0.1 → 1.0.0 (REVERT)
Date: 2026-05-24
Bump rationale: Reverts the 1.0.0 → 1.0.1 PATCH that added
gemini-2.5-flash-lite to §IV. The preflight feature (011-preflight-phrase)
that motivated the addition was rolled to a client-side keyword
classifier after production showed 5-10x the design latency for the
LLM-driven approach. With no LLM call in the preflight path, the
constitution returns to single-model-only.

Modified sections:
  ~ §IV Required Stack — "LLM provider" row reverted to gemini-2.5-flash only.

Templates requiring updates: none.
-->

<!--
SYNC IMPACT REPORT
==================
Version change: TEMPLATE (uninitialized) → 1.0.0
Bump rationale: Initial ratification. The prior file was an unfilled template
with placeholder tokens only; this is the first concrete constitution derived
from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Per semantic versioning
policy defined herein, the first ratified version is 1.0.0.

Modified principles (none → newly authored):
  + I.   MVP-First Discipline (NON-NEGOTIABLE)
  + II.  Type Safety & Schema-Validated Boundaries
  + III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE)
  + IV.  Serverless-Compatible & Stateless Server Architecture
  + V.   Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE)
  + VI.  Bounded, Observable, Cost-Aware Agent
  + VII. Phased Incremental Delivery

Added sections:
  + Core Principles (7 principles)
  + Technology Stack & Architectural Limits
  + Development Workflow & Quality Gates
  + Governance

Removed sections:
  - All `[PLACEHOLDER]` tokens from the template

Templates requiring updates:
  ✅ .specify/templates/plan-template.md — Constitution Check section is
     compatible; principle gates can be enumerated by `/speckit.plan` against
     this constitution without template edits. No file change required.
  ✅ .specify/templates/spec-template.md — Spec format remains principle-
     agnostic (user stories, FRs, success criteria). No file change required.
  ✅ .specify/templates/tasks-template.md — Existing phase model (Setup →
     Foundational → User Stories → Polish) aligns with Principle VII's phased
     delivery. Tests are flagged "OPTIONAL — only if requested"; this remains
     compatible because Principle III requires tests to be requested in feature
     specs and enforced via Constitution Check, not via template default.
  ✅ AGENTS.md — Generic SPECKIT pointer; no principle references to update.
  ✅ README.md — User-facing project description; no principle references that
     conflict with this constitution.

Follow-up TODOs: none. All placeholders resolved.
-->

# Lex Bot Constitution

Lex Bot is the Legal Chatbot for Law Firm Client Intake & Lead Qualification, as
defined in `product-spec-legal-chatbot.md`. This constitution codifies the
non-negotiable engineering rules, coding conventions, technology selections,
architectural limits, and testing strategy that govern every contribution to
this repository. It is binding on all packages in the monorepo
(`widget`, `api`, `dashboard`, `crawler`, `shared`).

## Core Principles

### I. MVP-First Discipline (NON-NEGOTIABLE)

The MVP scope, defined in product spec §1.6 and §10, is the contract. The
single core loop the prototype MUST prove is:

> user asks question → chatbot retrieves context → chatbot qualifies lead → lead is stored.

Rules:

- Features outside §10's "Out of Scope (MVP)" table MUST NOT be implemented
  before MVP completion. This explicitly excludes payment processing, CRM
  integrations, team roles (multiple users per firm), self-serve firm signup,
  notification channels beyond the dashboard bell, multi-language support,
  custom widget builders, and live agent handoff.
- **Platform Admin Console carve-out (amendment 2.0.0):** three items formerly
  on the deferral list — super-admin multi-tenant operation, admin-facing
  analytics, and user-configurable LLM providers — are now permitted, but
  ONLY within the internal Platform Admin Console governed by Principle VIII.
  They MUST NOT leak into the firm-facing dashboard or the widget. This
  carve-out does not reopen the other deferrals above.
- Any contribution that adds a "nice to have" beyond the spec MUST cite the
  spec section it implements. PRs that cannot map their changes to a spec
  section MUST be rejected or rescoped.
- Success is measured against §1.7: a lawyer can install the widget,
  configure guardrails, run the crawler, and have a working chatbot on their
  website within 30 minutes.

Rationale: The spec is explicit that scope discipline is what makes the
prototype shippable. Every deferred feature has a documented post-MVP path;
deviating from that order has a real cost in time-to-validation.

### II. Type Safety & Schema-Validated Boundaries

TypeScript is mandatory end-to-end. Every package targets Node.js 20+ with
strict TypeScript and shares the workspace `tsconfig.base.json`.

Rules:

- All packages MUST be authored in TypeScript. JavaScript source files are
  prohibited except for build/config artifacts (e.g., generated bundles,
  `.eslintrc.cjs` if required by tooling).
- All cross-boundary data MUST pass through a Zod schema before it is trusted:
  HTTP request bodies, HTTP response bodies, LLM tool parameters, dashboard
  form submissions, crawler config files, and database row reads when types
  cannot be statically guaranteed.
- Database access MUST go through Drizzle ORM. Raw SQL is permitted only when
  Drizzle cannot express the query, and MUST be reviewed for SQL-injection
  safety.
- Shared types (entities, API contracts, tool parameter schemas) MUST live in
  `packages/shared` and be imported by both producers and consumers. Types
  MUST NOT be duplicated across packages.
- `tsc --noEmit` MUST pass across all packages in CI before merge.

Rationale: The system spans five long-lived packages, an LLM tool-calling
boundary, and a public widget API. Type drift between producer and consumer
is the most expensive class of bug in this architecture; Zod at every
external boundary plus shared types in the monorepo prevents it cheaply.

### III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE)

The product spec §9.8 defines the test layers. This constitution makes them
binding gates:

| Layer | Tool | Required for |
|-------|------|--------------|
| Unit | Vitest | Pure utilities, search scoring, content extraction, partial-lead heuristics |
| Integration | Vitest + MSW | API route handlers, LLM tool wiring, database writes (against in-memory SQLite mock) |
| E2E | Playwright | Dashboard flows (login, configure, view leads), widget-on-test-app smoke |
| Widget component | Vitest + Testing Library | Render, streaming UI states, accessibility roles |
| Conversation quality | Manual + eval scripts | LLM response correctness against scripted dialogues |

Rules:

- Every feature task that produces production code MUST have at least one
  failing test written first. Tests MUST be visible in the diff before the
  implementation that satisfies them.
- Each phase in product spec §12.5–§12.11 has explicit "done when" checklists.
  A phase MUST NOT be marked complete until every checkbox in its "done when"
  list has a corresponding passing test or verified manual check recorded in
  the PR description.
- The CI pipeline (§9.10) MUST run, in order, on every PR: install →
  `tsc --noEmit` → `eslint .` → `vitest run` → `turbo build`. E2E
  (`pnpm test:e2e`) runs on merge to `main`.
- LLM-backed integration tests MUST mock the model via MSW or the AI SDK's
  test utilities. Live LLM calls in CI are prohibited because responses are
  non-deterministic and costly.
- In-memory SQLite (`better-sqlite3` + `drizzle-orm/better-sqlite3`) is the
  required test database. Tests MUST NOT require a network database
  connection.
- Conversation-quality eval scripts are NOT gating in CI but MUST be run
  manually before any release that touches the system prompt, agent logic,
  guardrails generation, or lead-classification criteria.

Rationale: §12.12 mandates regression checks between phases and the spec is
explicit that LLM responses are non-deterministic. Mandatory mocked
integration tests, plus manual eval gates on agent-affecting changes,
catch regressions without making CI flaky or expensive.

### IV. Serverless-Compatible & Stateless Server Architecture

Production deployment is two Netlify sites backed by Neon PostgreSQL
(§9.7). The architecture MUST remain compatible with serverless functions
on every commit.

Rules:

- The API MUST NOT depend on a persistent local filesystem at runtime.
  Anything that needs persistence goes to Neon. Anything that needs read-only
  static data goes to the lawyer's context store (fetched over HTTPS).
- Server actions in Next.js are PROHIBITED. All mutations MUST go through
  Next.js Route Handlers under `POST /api/*`. This is required to avoid
  action-ID mismatch across Netlify deploys (§8.4 implementation note,
  §9.7).
- Native binary dependencies are PROHIBITED in the API package.
  Specifically: `bcrypt` (native) MUST NOT be added; `bcryptjs` (pure JS) is
  the only acceptable password/API-key hashing library. Any new dependency
  with `node-gyp`, `prebuild`, or platform-specific binaries MUST be
  reviewed for serverless compatibility before adoption.
- The chat widget MUST hold no sensitive state (§2.10). All session state,
  conversation history, and lead data live server-side. The widget MUST be
  a pure UI layer.
- The API server MUST NEVER write to the lawyer's context store (§5.10).
  The store is read-only at runtime; only the Crawler CLI and the
  Dashboard publish action are permitted writers.
- CORS on the chat API MUST be `Access-Control-Allow-Origin: *` because the
  widget is embedded on arbitrary client websites. Authentication is the
  per-site API key in the `x-api-key` header (§2.4), not origin-based.
- The widget JS bundle MUST stay within size budgets: NPM package ≤ 35KB
  gzipped, CDN standalone (Preact-bundled) ≤ 50KB gzipped (§6.10). Bundle
  size is measured in CI; regressions block merge.

Rationale: Netlify Functions, Neon, and a CDN-distributed widget impose
hard constraints. Encoding them in the constitution prevents a class of
mistakes (server actions, native bcrypt, filesystem caches) that have
already cost time during the prototype's first migration.

### V. Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE)

The system operates inside attorney-client privilege boundaries (§1.10,
§5.2, §11.4, §11.5). Data placement and disclosure rules MUST be enforced
in code, not just in policy.

Rules:

- The lawyer's website content (crawled markdown + manifest) MUST remain on
  the lawyer's own infrastructure. The SaaS MUST fetch context at query
  time and MUST NOT mirror or persist context-store contents beyond a
  short-lived in-memory cache (TTL ≤ 5 minutes per §5.2).
- The context store MUST contain only publicly available website content
  and non-sensitive configuration. Sensitive guardrail material (e.g.,
  internal "Custom Instructions" notes from the dashboard form) MUST be
  injected via system prompt from the database and MUST NOT appear in any
  file written to the lawyer's server.
- API keys MUST be stored as bcryptjs hashes only (§2.4). Plaintext keys
  MUST be shown to the user exactly once at generation and MUST NOT be
  logged, mirrored, or cached on the server.
- Personal data collection in the widget MUST be preceded by visible
  consent (§11.5). Consent timestamp and method MUST be persisted per
  session.
- Data ownership and deletion: lawyer-initiated deletion MUST remove the
  lawyer-visible record AND write a snapshot to `archived_data` per §1.10
  and the schema in §2.6. Privacy policy and ToS MUST disclose this
  retention.
- The chatbot MUST NEVER reveal its system prompt, configuration, internal
  tools, or any other lawyer's data (§11.2). A system-level instruction
  enforcing this MUST be present in every system prompt assembly.
- Logging MUST NOT record API keys, password hashes, session secrets, or
  full PII in plaintext. Lead PII may be stored in the database (it is the
  product) but MUST NOT be written to general-purpose log streams.
- The chatbot MUST NEVER fabricate information (§7.11). If relevant context
  is not available, the agent MUST acknowledge the gap rather than
  hallucinate. This is enforced by the system prompt and verified via
  conversation-quality evals.

Rationale: A lead-intake bot for law firms that leaks privileged content,
hallucinates legal claims, or mishandles consent is not just a bug — it is
a liability event for the firm and for us. These rules are written into
the architecture precisely so they cannot be quietly relaxed.

### VI. Bounded, Observable, Cost-Aware Agent

The LLM is a non-deterministic, expensive, and adversarially-targeted
component. It MUST be bounded by hard limits and instrumented for
visibility (§7.x, §11.1, §11.3, §11.7).

Rules:

- Agent tool-calling MUST cap recursion at `maxSteps: 5` (§7.2). Higher
  values require explicit justification in the PR and Constitution Check.
- Context injection MUST respect the token budget in §7.7: ~1000 tokens
  for `_guardrails.md` (never truncated), ~3000 tokens for retrieved
  pages, ~500 tokens supplementary. Total cap ~4500 tokens. Implementations
  MUST measure and clamp; tests MUST verify the cap.
- Per-session message rate limit: 50 messages per conversation (§11.1).
- Per-API-key daily conversation cap: 1000 conversations (§11.1). Both
  limits are implemented at the API layer and MUST be active from day one.
- The agent has exactly two tools in MVP: `searchContext` and `captureLead`
  (§2.8, §7.3, §7.4). Adding a third tool requires a constitution
  amendment because additional tools change the agent's behavior model and
  the system-prompt budget.
- User input MUST be sanitized before being injected into prompts: strip
  control characters, enforce a maximum length, and run through a
  prompt-injection screen (§11.2). Conversations flagged as injection
  attempts MUST be logged.
- Structured JSON logging MUST be emitted for every conversation event:
  message received, tool invoked, files retrieved with relevance scores,
  tokens used, response sent, errors with full context (§11.7). Logs MUST
  be queryable by session ID.
- Token usage (input + output) MUST be recorded per conversation in the
  database for cost monitoring (§11.3). The dashboard surfaces cumulative
  spend. Per-tenant usage records MUST additionally capture the resolved
  provider and model so cost can be attributed per tenant and per provider.
- Per-tenant model/provider resolution (amendment 2.0.0): the chat runtime
  MUST resolve the LLM provider and model per tenant through a single
  provider-resolver abstraction — never a hardcoded model call scattered
  through the code. Supported providers are Google Gemini, Anthropic, and
  OpenAI via the Vercel AI SDK. When a tenant has no explicit configuration,
  the resolver MUST fall back to the platform default (`gemini-2.5-flash`).
  A tenant's per-provider API key, if supplied, MUST be stored encrypted at
  rest (not a bcryptjs hash — the key must be recoverable to call the
  provider), MUST NOT be logged, and MUST NOT be returned to any client in
  plaintext after entry. All existing agent bounds (maxSteps ≤ 5, token
  budget, rate limits) apply identically regardless of the resolved provider.
- The chatbot MUST display a persistent disclaimer: "I am an AI assistant,
  not a lawyer. Nothing I say constitutes legal advice." (§11.4). This is
  a non-removable widget element.

Rationale: An unbounded agent, an unmeasured cost surface, or an
unobservable failure mode each map to a real prior incident in
LLM-product engineering. The spec calls each one out; the constitution
makes them gates.

### VII. Phased Incremental Delivery

Development MUST follow the canonical phase order in §12.5: Crawler CLI →
Context Search Agent → Chat API → Widget → Lead Classification + DB →
Dashboard.

Rules:

- A phase MUST NOT be started until the previous phase's "done when"
  checklist (§12.6–§12.11) is fully satisfied and committed.
- Each phase produces a working, independently demonstrable deliverable.
  The system MUST be runnable (in limited form) at the end of every phase.
- The "demo-first" alternative order in the spec's Appendix is permitted
  ONLY for stakeholder demos using pre-shipped mock content. Production
  builds MUST follow §12.5.
- After each phase, the full test suite for all previous phases MUST pass
  (`pnpm test`, plus `pnpm test:e2e` once Phase 6 introduces it).

Rationale: §12.5 is explicit that no phase depends on a later one, and
§12.12 mandates cumulative regression. Treating phase order as
constitutional protects the spec's incremental-delivery property and
keeps the prototype demoable at every checkpoint.

### VIII. Platform Administration & Tenant Isolation (NON-NEGOTIABLE)

The Platform Admin Console is an internal, super-admin-only surface for the
SaaS operator to register, onboard, configure, and oversee all law-firm
tenants. It is the ONLY place where cross-tenant access is permitted. This
principle bounds that power so it cannot erode the per-tenant isolation that
Principle V guarantees.

Rules:

- Super-admin identity MUST be a distinct role, stored separately from the
  `accounts` (firm) table and authenticated on its own credentials. A firm
  login MUST NEVER gain super-admin capability, and a super-admin session MUST
  be explicitly flagged; absence of the flag denies every `/api/admin/*`
  handler and every `/admin/*` route.
- Cross-tenant read/write is permitted ONLY through `/api/admin/*` handlers
  guarded by the super-admin check. The firm-facing dashboard and its
  `/api/dashboard/*` handlers MUST remain scoped to the caller's own
  `account_id` exactly as before — this amendment MUST NOT relax that scoping.
- Every admin action that mutates a tenant (create, onboard, suspend,
  reactivate, delete, rotate key, change LLM config) MUST be attributable:
  the acting super-admin and a timestamp MUST be recorded.
- Tenant deletion MUST follow Principle V's archival rule: soft-delete with an
  `archived_data` snapshot, never a hard wipe of lead/PII data.
- Per-tenant secrets managed from the console (LLM provider API keys) MUST be
  encrypted at rest and MUST follow the plaintext-shown-once, never-logged,
  never-returned rules of Principle V. API keys for the widget remain
  bcryptjs-hashed; LLM provider keys are encrypted (recoverable) because they
  must be replayed to the provider.
- Admin analytics MUST be derived from data the platform already stores
  (sessions, leads, token-usage records, routing/action events). Adding a new
  tracking surface MUST be justified in the feature spec and MUST NOT record
  PII into general-purpose log streams (Principle V).
- The onboarding wizard produces DRAFT tenant configuration and SOP that reuse
  the existing seed/default machinery and the existing versioning +
  publish/draft model. It MUST NOT introduce a parallel configuration store.

Rationale: Multi-tenant super-admin tooling concentrates privilege in one
surface. Left unbounded it is the single most dangerous way to violate
attorney-client data boundaries at scale. Making the role separation,
attribution, archival-on-delete, and secret-handling rules constitutional
ensures the convenience of central administration never silently overrides
Principle V's isolation guarantees.

## Technology Stack & Architectural Limits

The technology selections in product spec §9 are binding. Substitutions
require a constitution amendment.

### Required Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Language | TypeScript (strict) | Node.js 20+ runtime |
| Frontend framework | React (NPM widget, Dashboard); Preact (CDN widget bundle) | Per §6.2 |
| Framework | Next.js (Dashboard + API) | Route Handlers only — no Server Actions |
| LLM provider | Google Gemini (`@ai-sdk/google`), Anthropic (`@ai-sdk/anthropic`), OpenAI (`@ai-sdk/openai`) — selected per-tenant via a provider-resolver | `gemini-2.5-flash` is the platform default and fallback (amendment 2.0.0, §VIII) |
| AI SDK | Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) | `streamText` + `tool()` + `useChat` |
| Styling | Tailwind CSS (Dashboard); CSS custom properties (Widget) | §6.7, §8.11 |
| Database (prod) | Neon serverless PostgreSQL via `@neondatabase/serverless` | §2.6, §9.3 |
| Database (test) | `better-sqlite3` (in-memory) | Dev dependency only |
| ORM | Drizzle (`drizzle-orm/neon-http` prod, `drizzle-orm/better-sqlite3` test) | §9.5 |
| Validation | Zod | All cross-boundary schemas |
| Auth (Dashboard) | `bcryptjs` + `iron-session` | Pure JS only — no `bcrypt` native |
| Crawler rendering | Playwright (CSR), `cheerio` (SSR/static) | §3.5, §9.4 |
| Markdown pipeline | `unified` / `remark` / `rehype` | §9.9 |
| ID generation | `nanoid` | Sessions, API keys |
| Concurrency | `p-limit` | Crawler page-fetch throttling |
| Package manager | `pnpm` (workspaces) | Required |
| Build orchestration | Turborepo | Per §9.6 |
| Linting | ESLint flat config | Required |
| Formatting | Prettier | Required |
| CI | GitHub Actions | Per §9.10 |
| Versioning | Changesets | Package versioning + changelogs |

### Monorepo Structure

The repository is a pnpm + Turborepo workspace with these packages
(§9.6):

- `packages/widget` — React/Preact chat widget
- `packages/api` — Next.js API + Drizzle schema/migrations
- `packages/dashboard` — Next.js dashboard
- `packages/crawler` — CLI crawl tool
- `packages/shared` — Shared types, utilities, constants

New top-level packages MUST be justified against this structure in the PR
description.

### Architectural Limits

- Widget bundle size: NPM ≤ 35KB gz, CDN ≤ 50KB gz (§6.10).
- Per-conversation messages: ≤ 50 (§11.1).
- Per-API-key daily conversations: ≤ 1000 (§11.1).
- LLM tool-call recursion: `maxSteps ≤ 5` (§7.2).
- Total context-injection budget: ~4500 tokens (§7.7).
- Individual context markdown files: ~2000 words; oversized pages MUST
  be split by heading (§5.7).
- Crawler default `--max-pages`: 100 (§3.3).
- Context-store cache TTL on the API server: ≤ 5 minutes (§5.2).
- Widget conversation persistence: `sessionStorage` only; closing the
  tab ends the session (§6.8).

### Required Environment Variables

- API site: `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY`,
  `SESSION_SECRET` (≥ 32 chars).
- Widget site: `VITE_API_URL`.
- Dev seed: `CONTEXT_STORE_URL` (override for local).

Missing required env vars MUST cause fast startup failure with a clear
error message — NEVER silent fallback to a default.

## Development Workflow & Quality Gates

### Branch & PR Workflow

- Feature branches follow `###-feature-name` (Speckit convention).
- Every PR description MUST include:
  1. The product-spec section(s) implemented (e.g., "implements §7.4").
  2. A Constitution Check note: list every principle that applies and
     confirm compliance, or open a Complexity Tracking entry justifying
     deviation.
  3. The phase (§12.5–§12.11) the change belongs to and which "done when"
     boxes it ticks.
- Direct commits to `main` are prohibited except for repository
  bootstrapping.

### CI Gates (PR-blocking)

Per §9.10, the pipeline is:

1. `pnpm install --frozen-lockfile`
2. `tsc --noEmit` across all packages
3. `eslint .`
4. `vitest run` (unit + integration)
5. `turbo build` (all packages)
6. Bundle-size check on `packages/widget` outputs

E2E (`pnpm test:e2e` via Playwright) runs on merge to `main`.

### Manual Gates (Release-blocking)

- Conversation-quality eval scripts MUST pass before any release that
  touches: the system prompt, agent logic, guardrails generation, or
  lead-classification criteria.
- Phase-completion sign-off: when transitioning between phases in §12.5,
  the PR that closes a phase MUST link to a recorded run of the phase's
  "done when" checklist, with each box either green-tested or
  manually-verified with evidence.
- User testing per §11.8: before investing heavily in the agent layer
  (Phase 5+), the guardrails form (Phase 6 / §4) MUST be validated with
  at least 2–3 practicing lawyers. Findings MUST be recorded in the repo.

### Code Review

- Every PR requires at least one human review.
- Reviewers MUST verify Constitution compliance, not just code-level
  correctness.
- A reviewer who finds a constitution violation MUST request changes,
  even if the implementation is otherwise sound.

### Local Development

- `pnpm dev` MUST bring up the full local testbed (§12.3): React test
  app, API server, and context store served as static files. This
  command's behavior is part of the contract — changes that break
  single-command bootstrapping require an amendment.
- `pnpm db:migrate` and `pnpm db:seed` MUST be idempotent and MUST work
  against a fresh Neon branch.

## Governance

### Authority

This constitution supersedes ad-hoc team conventions, individual
preferences, and prior informal practices. Where any document, comment,
or chat instruction conflicts with this constitution, this document wins
unless the user explicitly overrides it for a specific session
(per the platform's user-instruction priority).

### Amendment Procedure

1. Open a PR that modifies `.specify/memory/constitution.md`.
2. The PR description MUST include:
   - The motivation (what problem the amendment solves).
   - The diff summary (added / modified / removed principles).
   - The proposed version bump (MAJOR / MINOR / PATCH) with reasoning.
   - A migration plan if existing code violates the new rule.
3. The PR MUST update the Sync Impact Report comment at the top of this
   file, the dated footer, and any dependent templates flagged in the
   report.
4. Amendments require explicit approval from the project owner.
5. After merge, all open feature branches MUST rebase and re-run their
   Constitution Check.

### Versioning Policy

Semantic versioning applies to the constitution itself:

- **MAJOR**: Backward-incompatible governance changes, principle removals,
  or principle redefinitions that invalidate prior compliant code.
  Example: dropping a NON-NEGOTIABLE marker, removing the no-server-actions
  rule, swapping the LLM provider away from Gemini.
- **MINOR**: A new principle or section is added, or a materially
  expanded rule that adds new obligations without invalidating prior
  compliance. Example: adding an eighth principle, extending Principle VI
  with new observability requirements.
- **PATCH**: Clarifications, wording fixes, typo corrections, or
  non-semantic refinements that do not change what compliance requires.

When the bump type is ambiguous, the PR MUST include reasoning before
finalizing; default to the higher bump.

### Compliance Review

- Every PR Constitution Check is the routine compliance instrument.
- Quarterly: a compliance sweep audits the last 90 days of merged PRs
  against the current constitution version. Findings are filed as issues.
- Drift between this document and `product-spec-legal-chatbot.md` MUST be
  resolved by updating one or the other within the same release cycle —
  never silently tolerated.

### Runtime Guidance

Day-to-day engineering guidance (commands, file layouts, conventions
that are not policy) lives in `README.md`, `AGENTS.md`, and the active
plan under `specs/[###-feature]/plan.md`. Those documents implement this
constitution; they MUST NOT contradict it.

**Version**: 2.0.0 | **Ratified**: 2026-05-23 | **Last Amended**: 2026-07-05
