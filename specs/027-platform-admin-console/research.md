# Phase 0 Research: Platform Admin Console

All decisions are grounded in existing repo patterns (see the plan's Technical
Context) and constitution v2.0.0. No unresolved `NEEDS CLARIFICATION` remain.

---

## R1. Super-admin authentication & session

**Decision**: A separate `super_admins` table + a parallel iron-session in a new
`src/lib/admin-session.ts`, cookie name `legal_chatbot_admin`, its own secret
`ADMIN_SESSION_SECRET`. A `requireSuperAdmin()` guard in `src/lib/admin-guard.ts`
protects every `/api/admin/*` handler; `app/admin/layout.tsx` redirects to
`/admin/login` when the admin session is absent. Passwords hashed with
`bcryptjs` (rounds = 10), matching the login route pattern.

**Rationale**: Constitution §VIII requires super-admin identity stored
separately from `accounts` and authenticated on its own credentials, with a firm
login unable to gain super-admin capability. A distinct cookie + secret makes
the two session domains cryptographically independent — a firm session cookie
can never validate as an admin session. Mirrors the proven
`dashboard-session.ts` shape exactly.

**Alternatives considered**: (a) An `is_super_admin` flag on `accounts` —
rejected: violates §VIII's "stored separately" rule and risks privilege
escalation via the firm login path. (b) Reusing the `legal_chatbot_session`
cookie with an added claim — rejected: same cookie/secret means a firm session
is one tampered claim away from admin.

---

## R2. Per-tenant multi-provider LLM resolution

**Decision**: New `account_llm_config` table (`account_id` unique, `provider`,
`model`, `api_key_encrypted` nullable, `is_active`). A single
`resolveModelForAccount(accountId)` in `src/lib/llm/provider-resolver.ts`
returns an AI SDK `LanguageModel`. It reads the tenant's active config; if none,
returns the platform default `google('gemini-2.5-flash')`. For a configured
provider it instantiates the matching AI SDK provider
(`@ai-sdk/google` | `@ai-sdk/anthropic` | `@ai-sdk/openai`), passing the
decrypted per-tenant key when present, else the platform env key. Resolution is
cached with the same 60s-TTL Map pattern as `verifyApiKey`
(`src/lib/auth.ts:32-63`), keyed by `accountId`, invalidated on config write.
The literal `google('gemini-2.5-flash')` at `chat/route.ts:467` and
`date-inferer.ts:45` become resolver calls.

**Rationale**: §VI (amended) requires a single provider-resolver abstraction, no
scattered hardcoded model calls, and `gemini-2.5-flash` as the fallback.
`auth.accountId` is already in scope at the `streamText` call site, so the swap
is local. Caching keeps the added cost to ≤1 DB lookup per cold conversation.

**Alternatives considered**: (a) Env-only provider switch — rejected: not
per-tenant. (b) Instantiating providers eagerly at module load — rejected:
serverless cold-start cost and unnecessary when most tenants use the default.

**Model allow-list**: provider→model pairs validated by a Zod enum in
`packages/shared/src/schemas/llm-config.ts` so an invalid/unknown model is
rejected at the boundary. Defaults: `google/gemini-2.5-flash`,
`anthropic/claude-sonnet-5` (or the current default Sonnet id at build time),
`openai/gpt-4o`-class. Exact model ids are confirmed during implementation
against the installed SDK versions; the enum is the single source of truth.

---

## R3. Provider API-key encryption at rest

**Decision**: AES-256-GCM via Node's built-in `crypto` in `src/lib/crypto.ts`.
A 32-byte key from `ENCRYPTION_KEY` (base64/hex env var). Store
`iv:authTag:ciphertext` (base64, colon-joined) in
`account_llm_config.api_key_encrypted`. `encrypt()`/`decrypt()` are pure and
unit-tested for round-trip. Keys are decrypted only inside the provider-resolver
at chat time, never returned by any `/api/admin/*` response, never logged.

**Rationale**: §V/§VIII require per-tenant provider keys to be *recoverable*
(replayed to the provider), so a one-way bcrypt hash is wrong here — encryption,
not hashing. AES-256-GCM gives confidentiality + integrity (auth tag detects
tampering). Node `crypto` avoids a new native/serverless-incompatible dependency
(§IV).

**Alternatives considered**: (a) `bcryptjs` — rejected: not reversible.
(b) An external KMS — rejected: over-engineered for MVP and adds a network
dependency; `ENCRYPTION_KEY` env is sufficient and swappable later.

**Env handling**: `ENCRYPTION_KEY` (and `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`ADMIN_SESSION_SECRET`) are added to a new central `src/lib/env.ts` that reads +
validates at import time and throws on absence (matching `db/index.ts`'s
fail-fast throw). `vitest.setup.ts` gets defensive defaults for each so imports
don't throw in tests.

---

## R4. Tenant registration & onboarding wizard → draft config/SOP

**Decision**: Extract a `provisionTenant({ email, firmName, ... })` function from
the existing top-level `seed()` block (`seed.ts:246-263` creates the `accounts`
row, hashes+inserts the `apiKeys` row with a generated plaintext key). Registration
returns the plaintext widget key **once**. The wizard collects firm identity,
case types, persona/tone, contact/hours, escalation across steps; the submission
is validated by a Zod schema and stored progressively (draft). On finish, a
`buildDraftFromWizard()` maps answers into the existing `configurationSchema`
shape and writes a **draft** `configurations` row (v1, `is_published=false`),
then calls the canonical `bootstrap-prod.ts` sequence — `seedSopForAccount` →
`ensureContactStepForAccount` → `ensureCarAccidentBranchForAccount` →
`ensureDefaultBranchesForAccount` — for the SOP/branch defaults. Publish flips
`is_published` on the config + SOP (reusing the existing publish path).

**Rationale**: §VIII forbids a parallel configuration store and mandates reuse
of the existing versioning/publish model. The `ensure*` functions are already
idempotent and are exactly what production bootstrap runs per account, so the
wizard becomes an input-driven front-end over proven provisioning.

**Alternatives considered**: (a) A fresh config-generation path — rejected:
duplicates logic and drifts from the firm-facing editors. (b) Auto-publishing on
wizard finish — rejected: spec/US2 requires an explicit publish step and a
draft-until-published state.

**Wizard persistence**: progress stored on the draft `configurations` row (and a
lightweight `onboarding_status` on `accounts`: `draft`→`published`→`live`). No
separate wizard-state table — avoids a parallel store.

---

## R5. Token-usage capture for metrics

**Decision**: New `usage_events` table (`id`, `account_id`, `session_id`,
`provider`, `model`, `prompt_tokens`, `completion_tokens`, `total_tokens`,
`created_at`). Capture in the chat route's `onFinish` by destructuring the AI
SDK `usage` object (currently discarded: `onFinish: async ({ text }) =>`).
Write is deferred via the existing post-stream `waitUntil`-style primitive
(spec 021) so it doesn't add turn latency. Estimated spend is computed at
read-time in `metrics.ts` from a provider/model price map (a constant in
`packages/shared`), not stored.

**Rationale**: §VI requires per-conversation token recording and the dashboard
to surface cumulative spend — this is currently unmet (usage is discarded).
Storing raw tokens (not dollars) keeps records price-list-agnostic; spend is
derived, so price changes don't require backfill. Read-time computation mirrors
the case-value badge pattern (spec 025).

**Alternatives considered**: (a) Storing estimated dollars per event — rejected:
couples records to a price snapshot. (b) Reusing the structured stdout logger —
rejected: not queryable for per-tenant aggregation (§VIII requires metrics from
stored, queryable data).

---

## R6. Metrics aggregation strategy

**Decision**: `src/lib/admin/metrics.ts` exposes per-tenant aggregators:
- **Funnel**: count `sessions` and `leads` for the account, group leads by
  `classification` (HOT/WARM/COLD/SPAM); conversion = leads/sessions.
- **Usage & cost**: aggregate `usage_events` by day and by provider/model;
  messages/conversation from `sessions.messages_json` length or a count.
- **Routing outcomes**: count HOT leads with dispatched notifications (spec 024)
  and group `leads` by the follow-up action field (spec 013).
All queries filter by `account_id` and a date window (default last 30 days).
The fleet overview uses grouped queries across all accounts (not per-tenant
N+1): one `GROUP BY account_id` query per metric.

**Rationale**: Everything derives from existing tables plus `usage_events`;
grouped queries keep the fleet page within the <2s goal for ≤100 tenants.

**Alternatives considered**: Precomputed rollup tables / cron — rejected:
§IV forbids background jobs and the data volume doesn't warrant it for MVP.

---

## R7. Read-only SOP flow visualization

**Decision**: `GET /api/admin/tenants/[id]/sop-view` returns the tenant's active
(published) SOP as a normalized tree DTO — ordered steps → case types →
sub-types → configured branches (with questions) — assembled from
`sopSteps`, `caseTypes`, `subTypes`, `branches`, `branchVersions`. The `/admin`
page renders it read-only (no edit controls). Builds on the existing
`src/lib/sop/FLOW.md` + `diagrams/` effort for the visual layout.

**Rationale**: US5 is a pure read view; keeping it a DTO + presentational render
guarantees the "no second editor" constraint. Reuses published-SOP resolution
already used by the chat runtime.

**Alternatives considered**: Embedding the firm SOP editor read-only — rejected:
risks accidental writes and couples the console to the editor's internals.

---

## R8. Tenant lifecycle (suspend / rotate / soft-delete)

**Decision**: Extend `accounts` with `status` (`active`|`suspended`) and
`deleted_at` (nullable). **Suspend** sets `status='suspended'` and revokes the
tenant's API keys (`revoked_at` set) so `verifyApiKey` rejects them (it already
skips `revoked_at` rows) — the chatbot stops serving; reactivate reverses it and
issues/enables a key. **Rotate** inserts a new `apiKeys` row (new plaintext shown
once) and sets `revoked_at` on the old. **Soft-delete** writes an `archived_data`
snapshot of the tenant's leads/PII (existing table/pattern) and sets
`deleted_at`, excluding the tenant from the active fleet — no hard delete. Every
action calls `recordAdminAction()` → `admin_audit_log`.

**Rationale**: Reuses the existing `revoked_at` semantics in `verifyApiKey`
(`auth.ts:79`) and the §V archival-on-delete rule. §VIII requires attribution on
every mutation.

**Alternatives considered**: Hard delete — rejected by §V. A separate
`suspended` keys table — rejected: `revoked_at` already models it.

---

## R9. Admin audit log

**Decision**: `admin_audit_log` table (`id`, `super_admin_id`, `action`,
`target_account_id` nullable, `metadata_json` nullable, `created_at`). A
`recordAdminAction(adminId, action, targetAccountId?, metadata?)` helper is
called by every mutating `/api/admin/*` handler. No PII in `metadata_json`.

**Rationale**: §VIII mandates every mutating admin action be attributable to a
super-admin with a timestamp. A single append-only table + one helper gives
100% coverage (SC-007).

---

## Summary of new/changed dependencies

- **Add**: `@ai-sdk/anthropic`, `@ai-sdk/openai` (AI SDK providers; pure JS,
  serverless-safe). No other runtime deps — encryption uses Node `crypto`.
- **New env vars**: `ADMIN_SESSION_SECRET` (≥32 chars), `ENCRYPTION_KEY`
  (32 bytes), `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (platform fallback keys).
  All validated fail-fast in the new `src/lib/env.ts`.
