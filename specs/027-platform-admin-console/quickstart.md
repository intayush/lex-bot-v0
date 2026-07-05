# Quickstart & Validation: Platform Admin Console

Runnable validation that proves the feature end-to-end. Assumes the monorepo dev
setup (`pnpm dev`) and a Neon dev branch or local Postgres.

## Prerequisites

- New env vars set (fail-fast validated by `src/lib/env.ts`):
  - `ADMIN_SESSION_SECRET` (≥32 chars)
  - `ENCRYPTION_KEY` (32-byte key, base64 or hex)
  - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (platform fallback keys; may be dummy
    for non-provider tests)
  - existing: `DATABASE_URL`, `SESSION_SECRET`, `GOOGLE_GENERATIVE_AI_API_KEY`
- Deps installed: `pnpm install` (adds `@ai-sdk/anthropic`, `@ai-sdk/openai`).
- Migration applied: `pnpm --filter @legal-chatbot/api db:generate` then
  `db:migrate` (creates `0010`, adds 4 tables + extends `accounts`).
- Dev super-admin seeded: run the new `seed-super-admin` script (creates a dev
  super-admin, e.g. `admin@lexbot.dev`).

## Validation scenarios

### 1. Admin auth & isolation (US1 / SC-002)
1. Visit `/admin` unauthenticated → redirected to `/admin/login`.
2. Log in with dev super-admin → land on fleet overview.
3. With a **firm** login cookie, request `/api/admin/tenants` → **401**.
Expected: only the super-admin session reaches the console.

### 2. Register + onboard + publish (US2 / SC-001)
1. From fleet overview, **Register** a firm (email + name) → receive a widget
   API key shown **once**; tenant appears with `onboarding_status=draft`.
2. Complete the wizard (identity → case types → persona → contact → escalation),
   **Finish** → draft config + SOP + default branches generated.
3. **Publish** → `onboarding_status=live`.
4. Point the widget at the new key and send a message → chatbot serves the
   published config/SOP.
Expected: a brand-new firm is live and serving in one sitting.

### 3. LLM provider resolution (US3 / SC-004, SC-005)
1. Leave a tenant unconfigured → its chat uses `gemini-2.5-flash` (platform key).
2. Set provider=Anthropic + a model + a per-tenant key → chat uses Anthropic
   with the tenant key; a `usage_events` row records provider=`anthropic`.
3. `GET .../llm-config` → response has `hasKey:true` but **no** key material.
4. Grep logs for the key → absent.
Expected: correct provider used; keys never exposed.

### 4. Metrics (US4 / SC-006)
1. For a tenant with seeded sessions/leads/usage → `GET .../metrics` shows
   funnel (HOT/WARM/COLD/SPAM + conversion), usage/cost (tokens + estimated
   spend by provider/model), routing outcomes.
2. For a zero-traffic tenant → all zeros, no error.

### 5. SOP visualization (US5)
1. `GET .../sop-view` for a published tenant → steps + case types + sub-types +
   branch questions; no edit controls in the UI.
2. Tenant with no branches → `branch:null`, default flow still shown.

### 6. Lifecycle (US6 / SC-007)
1. Suspend a tenant → its widget key rejected (chat 401); reactivate → serves.
2. Rotate key → new key works, old key rejected.
3. Soft-delete → `archived_data` snapshot exists, tenant leaves the fleet, no
   hard delete.
4. `admin_audit_log` has a row (actor + timestamp) for each action above.

## Test commands

- Unit + integration: `pnpm --filter @legal-chatbot/api test`
  - key suites: provider-resolver fallback, `crypto` encrypt/decrypt round-trip,
    metrics aggregation, wizard→config/SOP generation, admin-guard 403,
    tenant/LLM-config CRUD, key rotation.
- E2E: `pnpm --filter @legal-chatbot/api e2e`
  - flow: admin login → register → wizard → publish → tenant live; firm login
    denied.
- Full gate: `pnpm test` (turbo) → `tsc --noEmit`, `eslint`, `vitest run`,
  `turbo build`.

## Reference

- Contracts: [`contracts/`](./contracts/) — auth, tenants, onboarding,
  llm-config, metrics, sop-view.
- Data model: [`data-model.md`](./data-model.md).
- Research/decisions: [`research.md`](./research.md).
- Design doc: `docs/superpowers/specs/2026-07-05-admin-console-design.md`.
