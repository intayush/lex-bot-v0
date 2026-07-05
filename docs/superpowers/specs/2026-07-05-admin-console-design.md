# LexBot Platform Admin Console — Design

**Date:** 2026-07-05
**Status:** Implemented (2026-07-05, branch `027-platform-admin-console`). All 6
user stories (US1–US6) built test-first with unit + integration coverage; UI
pages authored. Deferred to a live environment: applying migration `0010`
(`db:migrate` needs Neon), the Playwright E2E run (`db:seed-super-admin` +
running server), and the quickstart walkthrough. See
`specs/027-platform-admin-console/` for spec/plan/tasks.
**Constitution:** v2.0.0 (amended 2026-07-05 to enable this feature)

## 1. Problem & Goal

LexBot is architecturally multi-tenant (every domain table is scoped by
`account_id`), but there is **no operator tooling** to manage tenants:

- Law-firm accounts are created only by seed/bootstrap scripts — no registration.
- Initial chatbot config + SOP come from hardcoded defaults — no input-driven onboarding.
- The LLM (Gemini) is globally hardcoded — no per-tenant provider/model/key.
- There is no cross-tenant view and no real analytics (only in-memory lead-count tiles).

**Goal:** an internal **Platform Admin Console** — a super-admin-only surface
for the SaaS operator to register, onboard, configure, oversee, and manage the
lifecycle of every law-firm tenant.

## 2. Scope (locked)

| Area | Decision |
|---|---|
| Audience | Platform super-admin (SaaS operator team). Cross-tenant. New role above firm-admin. |
| Placement | New `/admin` pages + `/api/admin/*` handlers inside `packages/api`. Reuses iron-session, Drizzle, versioning. |
| Onboarding | Guided multi-step wizard, super-admin fills it → generates draft Configuration + SOP + branches → publish. |
| LLM management | Multi-provider (Gemini + Anthropic + OpenAI), selected per tenant. Enabled by constitution v2.0.0. |
| Metrics | Lead funnel & quality + Usage & cost + Attorney routing outcomes. (SOP drop-off deferred.) |
| SOP visualization | Read-only per-tenant flow diagram. |

## 3. Constitution Impact

This feature is only permissible because constitution **v2.0.0** (this same
change set) amended three items:

1. **§Required Stack** now permits Google Gemini + Anthropic + OpenAI via the
   AI SDK, selected per tenant. `gemini-2.5-flash` remains the default/fallback.
2. **§I MVP-First** gained a *Platform Admin Console carve-out* permitting
   super-admin multi-tenant operation, admin analytics, and user-configurable
   LLM providers — inside the console only.
3. **§VIII (NEW)** Platform Administration & Tenant Isolation governs the
   super-admin role, cross-tenant access, attribution, archival-on-delete, and
   per-tenant secret handling.

All existing agent bounds (maxSteps ≤ 5, token budget, rate limits) and
Principle V data-boundary rules remain in force and apply to every provider.

## 4. Architecture

### 4.1 Super-admin identity (§VIII)
- New `super_admins` table: `id`, `email` (unique), `password_hash` (bcryptjs),
  `created_at`. Separate from `accounts` — a firm login can never gain
  super-admin capability.
- Own login (`/admin/login`) issuing an iron-session with an explicit
  `isSuperAdmin` flag. `/admin/*` routes and `/api/admin/*` handlers reject any
  session lacking the flag.
- Firm-facing `/dashboard/*` and `/api/dashboard/*` remain scoped to the
  caller's own `account_id` — unchanged.

### 4.2 Tenant registration + onboarding wizard
- `POST /api/admin/tenants` creates an `accounts` row + provisions an `apiKeys`
  row (plaintext key shown once).
- Multi-step wizard (super-admin fills): firm identity → practice areas / case
  types → persona & tone → contact & office hours → escalation rules.
- On finish, wizard answers generate a **draft** `configurations` +
  `sop_configurations` (+ default branches) by reusing existing
  `seedSopForAccount` / `ensureDefaultBranchesForAccount` machinery as the
  starting point, then publish. Converts today's hardcoded seed into an
  input-driven flow. No parallel config store (§VIII).
- Onboarding status tracked per tenant: `draft` / `published` / `live`.

### 4.3 Per-tenant LLM configuration
- New `account_llm_config` table: `account_id`, `provider`
  (`google`|`anthropic`|`openai`), `model`, `api_key_encrypted` (nullable →
  platform-key fallback), `is_active`, timestamps.
- The chat route's hardcoded `google('gemini-2.5-flash')` is replaced by a
  single **provider-resolver** abstraction that reads the tenant's config and
  returns the AI SDK model. Fallback to `gemini-2.5-flash` when unset (§VI).
- Adds `@ai-sdk/anthropic` + `@ai-sdk/openai` dependencies.
- Keys encrypted at rest (recoverable, NOT bcrypt), never logged, never
  returned in plaintext after entry (§V, §VIII).

### 4.4 SOP flow visualization
- Read-only per-tenant view rendering the active SOP as a flow:
  steps → case types → sub-types → configured branches (with branch questions).
- Built from existing SOP/branch tables. Builds on the in-progress
  `packages/api/src/lib/sop/FLOW.md` + `diagrams/` effort.
- View-only — edits stay in the existing firm SOP editor (no second editor).

### 4.5 Metrics
`/api/admin/metrics` surface + per-tenant dashboard cards, all derived from
existing data (§VIII):
- **Lead funnel & quality:** sessions started → leads captured →
  HOT/WARM/COLD/SPAM → conversion %. From `sessions` + `leads`.
- **Usage & cost:** conversation volume over time, messages/conversation, token
  usage & estimated spend, attributed per resolved provider/model (§VI). Leans
  on per-conversation token logging; add a lightweight `usage_events` table if
  the existing logging is not queryably persisted.
- **Attorney routing outcomes:** HOT leads routed / emails dispatched
  (spec 024) + follow-up actions taken (spec 013). From existing data.

### 4.6 Tenant lifecycle & fleet controls (included suggestions)
- **Fleet overview (landing page):** table of all tenants with health-at-a-glance
  — status, lead count (last 30d), estimated spend, last activity, onboarding status.
- **Suspend / reactivate:** disable/enable a tenant's API key (widget stops/starts serving).
- **Soft-delete:** archival snapshot to `archived_data` per §V — never a hard PII wipe.
- **API-key rotation** per tenant (reuses existing hashing; plaintext shown once).
- Every mutating action records the acting super-admin + timestamp (§VIII attribution).

## 5. Explicitly out of scope (defer — name in spec to prevent creep)
- Self-serve firm signup (this console is operator-driven).
- Billing / invoicing integration.
- Team roles / multiple users per firm.
- SOP inline editing from the admin console (view-only here).
- SOP step drop-off analytics.

## 6. Data model summary (new)
- `super_admins` (identity)
- `account_llm_config` (per-tenant provider/model/encrypted key)
- `usage_events` (only if existing token logging is not queryable)
- Tenant lifecycle fields on `accounts` (e.g. `status`, `onboarding_status`,
  soft-delete marker) — final columns decided during planning.
- Reuses: `accounts`, `apiKeys`, `configurations`, `sop_configurations`,
  `sopSteps`, `caseTypes`, `subTypes`, `branches`, `branchVersions`, `leads`,
  `sessions`, `archived_data`, `attorneys`.

## 7. Testing strategy (Constitution III)
- Unit (Vitest): provider-resolver fallback logic, onboarding-wizard →
  config/SOP generation, metrics aggregation, encryption round-trip.
- Integration (Vitest + in-memory SQLite): `/api/admin/*` handlers incl.
  super-admin guard (403 for firm sessions), tenant create/suspend/delete,
  LLM-config CRUD, key rotation.
- E2E (Playwright): super-admin login → register tenant → complete wizard →
  publish → tenant appears live; fleet overview renders.
- All boundaries validated by Zod schemas in `packages/shared` (Constitution II).

## 8. Phasing suggestion (for the plan, not this spec)
1. Super-admin auth + fleet overview (foundational).
2. Tenant registration + onboarding wizard.
3. Per-tenant LLM config + provider-resolver.
4. Metrics.
5. SOP flow visualization.
6. Lifecycle controls (suspend/delete/rotate) — can fold into phase 1–2.
