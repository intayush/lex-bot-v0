# Phase 0 Research: Hardening

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the
Hardening feature against `product-spec-legal-chatbot.md`
(§1.10, §11.2–11.8) and the Lex Bot Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers; items below are
the implementation plan for R1–R9.

## R1. Schema Additions

**Decision**: Add four NEW tables and two column additions via
Foundation's `drizzle-kit` migration tooling:

```sql
-- Spend alert configurations
CREATE TABLE spend_alerts (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  threshold_usd numeric NOT NULL,
  period text NOT NULL,        -- 'daily' | 'weekly' | 'monthly'
  enabled boolean NOT NULL DEFAULT true,
  last_triggered_at text,      -- nullable; ISO 8601
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- Daily budget caps
CREATE TABLE daily_budget_caps (
  id text PRIMARY KEY,
  account_id text NOT NULL UNIQUE REFERENCES accounts(id),
  daily_limit_usd numeric NOT NULL,
  current_day text NOT NULL,   -- ISO date 'YYYY-MM-DD'
  current_day_spend_usd numeric NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- ToS acceptance audit
CREATE TABLE tos_acceptances (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  tos_version text NOT NULL,
  accepted_at text NOT NULL,
  ip_address text,             -- optional; if available
  user_agent text              -- optional; if available
);
CREATE INDEX tos_acceptances_account_id_idx ON tos_acceptances(account_id);

-- FAQ semantic cache (MAY-level; optional)
CREATE TABLE faq_cache (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  query_embedding text NOT NULL,   -- JSON-serialized vector
  query_text text NOT NULL,
  response_text text NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at text,
  expires_at text NOT NULL,        -- ISO 8601 UTC
  invalidated_at text,             -- nullable; set when context store changes
  created_at text NOT NULL
);
CREATE INDEX faq_cache_account_id_idx ON faq_cache(account_id);
```

Two column additions:

```sql
-- Consent metadata on session
ALTER TABLE sessions ADD COLUMN consent_accepted_at text;       -- ISO 8601 UTC
ALTER TABLE sessions ADD COLUMN consent_method text;            -- 'banner' | 'implied' | etc.
```

**Rationale**:
- Each table directly maps to a binding §11 requirement:
  - `spend_alerts` → §11.3 "configurable spend alerts" (FR-002, FR-003).
  - `daily_budget_caps` → §11.3 "daily budget cap that disables the chatbot" (FR-004, FR-005).
  - `tos_acceptances` → §11.4 (FR-011, FR-012).
  - `faq_cache` → §11.6 (MAY-level).
- Column additions to `sessions` for consent metadata
  (§11.5 FR-006) keep the audit trail co-located with the
  conversation — matches the spec's "Store a consent
  timestamp and method per session in the database."
- All migrations are forward-compatible (additive, no
  destructive operations).
- Foundation's `drizzle-kit` tooling handles idempotency.

**Alternatives considered**:
- Embed alert/budget config in `accounts` row as JSON: rejected.
  Tables give better query-ability and indexing; a single JSON
  column on `accounts` would require parsing on every read.
- Use `archived_data` for ToS acceptance: rejected.
  `archived_data` is for deletion snapshots (Phase 6 R7), not
  for active records.
- Skip the FAQ cache table; use a process-local Map: rejected.
  §11.6 explicitly says "Store cached responses in the database
  with a TTL." Process-local cache wouldn't survive function
  cold starts and wouldn't share across instances.

**Implementation notes**:
- Migrations generated via `pnpm --filter @legal-chatbot/api db:generate`.
- The `daily_budget_caps.current_day` rolls over on first
  invocation each day (lazy reset; no scheduled job).
- The `faq_cache.query_embedding` stores JSON-serialized
  Float32Array. PostgreSQL's `pgvector` extension is NOT used
  for MVP — keep it portable to SQLite for tests.
- Indexes added on `account_id` for both `tos_acceptances` and
  `faq_cache` for lookup performance.

## R2. Cost Monitoring Surface (FR-001 to FR-005)

**Decision**: Implement four pieces:

1. **Aggregation library** (`packages/api/src/lib/cost-monitoring.ts`):
   ```ts
   export async function getDailySpend(accountId: string, days: number): Promise<DailySpend[]>;
   export async function getCumulativeSpend(accountId: string, since: Date): Promise<number>;
   ```
   Reads `token_usage` rows; multiplies `(prompt_tokens, completion_tokens)` by per-token Gemini prices (`apiEnv.GEMINI_PRICE_PROMPT_PER_1K`, `apiEnv.GEMINI_PRICE_COMPLETION_PER_1K` — operator-configurable env vars).

2. **Cost-monitoring page** (`packages/api/src/app/dashboard/cost/page.tsx`):
   Server-rendered. Shows: today's spend, this week's, this
   month's, a sparkline chart (per-day for last 30 days), the
   list of configured alerts, and the daily budget cap (with
   current usage % indicator).

3. **Spend alerts** (`spend-alerts.ts` + `/api/dashboard/spend-alerts`):
   CRUD UI for thresholds. After every chat turn (in
   `004-chat-api-agent`'s `onFinish` handler — extension
   needed), check whether any alert has been crossed and
   create a `notifications` row of `type: 'system'` if so.

4. **Daily budget cap** (`budget-cap.ts` + middleware in
   `route.ts` of `004-chat-api-agent`):
   At chat turn entry, check `daily_budget_caps`. If
   `current_day_spend_usd >= daily_limit_usd`, return a 200
   response with a fixed assistant message (the "friendly
   disabled-message" from §11.3 bullet 4) instead of calling
   the LLM. After every successful turn, increment
   `current_day_spend_usd` by the turn's cost.

**Rationale**:
- §11.3 binds all four pieces (FR-001 to FR-005).
- Per-token pricing comes from operator env config so updates
  don't require code changes; defaults track Gemini's
  published pricing.
- The chat-API integration for budget cap (item 4) is a
  cross-feature touch — Phase 7 owns the helper, Phase 3 owns
  the integration point. Documented in spec.md cross-feature
  ownership.

**Alternatives considered**:
- Hardcode pricing in source: rejected. Gemini pricing changes;
  env config decouples.
- Real-time WebSocket spend display: post-MVP. Polling every
  30 s on the cost page is acceptable for MVP.
- Pre-computed daily spend rollup table: post-MVP. The
  `token_usage` table is small enough for direct aggregation
  queries at MVP scale.

**Implementation notes**:
- The "friendly disabled-message" wording comes from §11.3
  bullet 4 paraphrased: "Service has been temporarily paused
  for today. Please call the firm directly at [phone]." The
  configured firm phone is substituted from
  `widgetConfig.contact.phone`.
- The cost page uses a tiny chart library (e.g., `recharts`
  if not too heavy, or hand-rolled SVG) for the sparkline.
  Captured as Assumption.
- Spend-alert deduplication: the `last_triggered_at` field
  prevents alert spam — once an alert fires for a period,
  it doesn't re-fire until the next period boundary.

## R3. Consent Persistence (FR-006)

**Decision**: Implement `POST /api/consent` Route Handler that
the widget's `<ConsentBanner>` (Phase 4 R5) submits to on
"Continue" click. The handler:

1. Authenticates the request via the `x-api-key` header (same
   mechanism as `/api/chat`).
2. Validates body via Zod:
   ```ts
   { sessionId: z.string(), method: z.enum(['banner']) }
   ```
3. UPDATEs the session row's `consent_accepted_at = now()`
   and `consent_method = method`.
4. Returns `{ success: true }`.

**Rationale**:
- §11.5 binds: "Store a consent timestamp and method per
  session in the database." FR-006.
- The session is the natural home for consent metadata (per
  spec data-model.md).
- API-key auth matches the chat endpoint's auth model — the
  consent submission shares the request's account context.

**Alternatives considered**:
- POST consent at chat-init time alongside `/api/chat`:
  rejected. Consent is a separate decision the visitor makes
  at a separate moment (banner accept ≠ first chat message).
- Store consent in `cookies` only: rejected. §11.5 explicitly
  says "in the database."

**Implementation notes**:
- The widget's `ConsentBanner` (Phase 4) is responsible for
  the UI; Phase 7 owns the persistence endpoint.
- CORS on this endpoint is the same wildcard pattern as
  `/api/chat` (per §9.7): `Access-Control-Allow-Origin: *`.
- Consent acceptance is single-shot per session;
  re-acceptance updates the timestamp (no harm).

## R4. Privacy Policy & ToS Templates (FR-007 to FR-010)

**Decision**: Add two markdown templates in
`packages/shared/src/templates/`:

- `privacy-policy.md`: includes the §1.10 retention disclosure,
  the §11.5 "data retention disclosure" paragraph, and the
  GDPR Article 17 exceptions language (FR-009).
- `terms-of-service.md`: includes the §11.4 limitations
  acknowledgment ("not a lawyer", "does not constitute legal
  advice"), data retention disclosure, and a placeholder
  for liability terms reviewed by counsel (FR-013).

The dashboard's "Privacy & Compliance" form section (Phase 6
R9) imports these as starter templates. The lawyer customizes
and the resulting text is stored in their configuration JSON
(or hosted at a generated URL — Assumption captured in spec
and Phase 6 plan).

**Rationale**:
- §11.5 binds the privacy policy template surface.
- §1.10 binds the retention language.
- §11.5's "Data retention disclosure" paragraph is the binding
  text.
- §11.4 binds the ToS limitations acknowledgment.
- FR-007 to FR-010 + FR-013.

**Alternatives considered**:
- Inline templates in dashboard code: rejected; Constitution
  Principle II prefers shared content in `packages/shared`.
- Single combined template: rejected; privacy policy and ToS
  serve different legal purposes and surface in different
  places.

**Implementation notes**:
- The templates use `{{firm_name}}` / `{{phone}}` /
  `{{email}}` placeholders the lawyer customizes.
- Foundation's data-model says `archived_data` retains
  data indefinitely per §1.10; the privacy template includes
  this disclosure verbatim.
- The GDPR Article 17 language must be reviewed by legal
  counsel (FR-009 + FR-013); the template ships with a clear
  "REPLACE WITH COUNSEL-REVIEWED LANGUAGE" placeholder until
  reviewed.

## R5. ToS Acceptance Flow (FR-011 to FR-013)

**Decision**: Implement two pieces:

1. **Modal at first login** (`packages/api/src/app/dashboard/`):
   - Middleware checks `tos_acceptances` for the current
     account + current ToS version. If no row exists, redirect
     to a ToS-acceptance modal page that the lawyer must accept
     before proceeding.
   - The current ToS version is a constant in
     `packages/shared/src/templates/terms-of-service.md`
     metadata (e.g., `version: 1`).

2. **POST /api/auth/accept-tos**:
   - Validates session.
   - INSERTs into `tos_acceptances` with `tos_version`,
     `accepted_at`, optional `ip_address` and `user_agent`
     (extracted from request headers).
   - Returns `{ success: true, redirect: '/dashboard/leads' }`.

**Rationale**:
- §11.4 says: "Consider requiring lawyers to accept terms of
  service that acknowledge the chatbot's limitations."
  FR-011, FR-012.
- The "Consider" wording in §11.4 makes ToS acceptance
  MAY-level; spec.md FR-011 elevates it to MUST because of
  the regulated domain.
- The middleware enforcement guarantees no lawyer reaches
  Dashboard pages without acceptance.

**Alternatives considered**:
- One-time signup-time acceptance only: rejected. ToS may
  be updated; the version-check middleware handles upgrades.
- Soft prompt instead of modal: rejected. Acceptance is a
  legal record; the flow must be unambiguous.

**Implementation notes**:
- The ToS version bump (e.g., from `1` to `2`) re-prompts
  every account on next login. Old `tos_acceptances` rows
  are kept (audit trail).
- The liability-counsel-review obligation (FR-013) is a
  release-gate item, not a code task. Documented in
  spec.md as an external dependency.

## R6. Optional Prompt-Injection Classifier (FR-014, MAY-level)

**Decision**: Implement `injection-classifier.ts` as an
operator-opt-in module. When `INJECTION_CLASSIFIER_ENABLED=true`,
the chat-API route handler (Phase 3) calls
`classifyForInjection(text)` BEFORE the LLM call. The
classifier:

1. Runs the existing regex-based detector (Phase 3 R9) FIRST
   (cheap; ~µs).
2. If the regex matches → flag and return `{ matched: true, source: 'regex' }`.
3. Otherwise, run a lightweight ML classifier:
   - **Option A**: a small bundled ONNX classifier (e.g., a
     fine-tuned DistilBERT for prompt-injection detection).
   - **Option B**: a Gemini classification call with a tiny
     few-shot prompt and `responseMimeType: 'application/json'`.
4. If either path matches → emit
   `injection_attempt` log event with `source: 'regex' | 'ml'`.

The Phase 3 chat route does NOT block the request based on
classifier output (per §11.2 + Phase 3 R9 — the system-prompt
non-disclosure rule is the runtime defense; the classifier is
the audit trail).

**Rationale**:
- §11.2 bullet 4: "Consider a lightweight classifier that
  detects manipulation attempts before they reach the LLM."
  MAY-level.
- The regex-first / ML-fallback ordering minimizes cost
  (regex catches ~80% of attempts at near-zero cost).
- An optional implementation lets operators decide whether
  the additional latency + cost is worth the additional
  detection.

**Alternatives considered**:
- Always-on ML classifier: rejected. Spec wording is
  "Consider"; doubles latency on every chat turn.
- Block on classifier match: rejected per Phase 3 R9.

**Implementation notes**:
- For MVP: implement only Option B (Gemini call) since the
  Gemini provider is already wired. Option A (ONNX) is
  post-MVP if cost becomes a concern.
- The classifier call is a separate Gemini round-trip; its
  cost is included in `token_usage` recording (Phase 3 R3).

## R7. FAQ Semantic Cache (FR-015 to FR-018, MAY-level)

**Decision**: Implement `faq-cache.ts` as an operator-opt-in
module. When `FAQ_CACHE_ENABLED=true`:

1. **On chat turn entry**, BEFORE the LLM call:
   - Compute embedding for the user's message via
     `@ai-sdk/google`'s embedding endpoint.
   - SELECT recent (`expires_at > now()` and
     `invalidated_at IS NULL`) `faq_cache` rows for this
     account; compute cosine similarity between the query
     embedding and each row's `query_embedding`.
   - If max similarity > threshold (e.g., 0.92), return the
     cached `response_text` directly; increment `hit_count`
     and update `last_hit_at`. Skip the LLM call entirely.
2. **On chat turn completion** (in `onFinish`):
   - If the response was novel (not from cache), insert a
     new `faq_cache` row with the query embedding, the
     response text, and an expiry (e.g., 7 days).
3. **On context store change**:
   - The Crawler CLI (or Sync CLI) doesn't directly invalidate
     the cache. Instead, on every API request, the cache check
     compares the cached response's `created_at` against the
     account's most recent `_manifest.json` `generated_at`. If
     the manifest is newer, set `invalidated_at = now()` for
     all that account's cache rows (lazy invalidation, no
     scheduled job).

**Rationale**:
- §11.6 binds the four pieces.
- 30–50% LLM-call reduction for FAQ-heavy firms (FR-018).
- Lazy invalidation tied to manifest timestamps avoids the
  need for a CLI hook.

**Alternatives considered**:
- pgvector with `<->` operator for cosine similarity:
  faster but requires a Postgres extension; not portable to
  SQLite tests. JSON-serialized vectors with in-memory cosine
  computation is acceptable for MVP scale.
- TTL alone, no manifest-based invalidation: rejected.
  §11.6 explicitly says "invalidate when context store
  changes."
- Always-on cache: rejected; spec preserves "Consider…".

**Implementation notes**:
- Threshold tuning: start at 0.92 (high precision); tune via
  conversation-quality eval scripts (Phase 8).
- Embedding cost: each cache check = one embedding call. Net
  cost reduction depends on hit rate. For MVP, log
  hits/misses and surface the rate in the cost-monitoring
  dashboard (post-MVP).
- FAQ-heavy firms see best results; for non-FAQ firms the
  cache may be net-negative — that's why it's MAY-level.

## R8. Per-Session Debug Mode (FR-019, FR-020, MAY-level)

**Decision**: Implement `debug-mode.ts` exposing a small
admin-only API that toggles `enableSessionDebug(sessionId)`
on the Foundation logger (declared in
`001-foundation/contracts/log-event-contract.md`). The
toggle is stored process-locally (an in-memory Set per
function instance — same as the rate-limit counters, with
the same caveat that horizontal scaling on Netlify means
the toggle may need to be set on multiple instances; for
MVP this is acceptable).

The admin surface is a route at
`POST /api/dashboard/debug-mode` body
`{ sessionId: string, enable: boolean }`. Authenticated as
the lawyer (a Lex Bot engineer impersonates via the
session cookie, OR a future "admin" role gates it).

**Rationale**:
- §11.7 last bullet: "Consider a debug mode that can be
  toggled per session for troubleshooting specific
  conversations." FR-019, FR-020.
- The Foundation logger already supports
  `enableSessionDebug(sessionId)`; this feature exposes the
  toggle.
- An admin-only HTTP surface lets an engineer mark a
  problematic session reported by a lawyer without code
  deploys.

**Alternatives considered**:
- Stored debug flag on `sessions` row: post-MVP. In-memory
  is simpler and fits MVP.
- No HTTP toggle (only via direct code edit): rejected. Spec
  says "toggleable"; HTTP is the smallest viable surface.

**Implementation notes**:
- The toggle is non-persistent across function restarts
  (acceptable per §11.1 patterns).
- Authentication for the debug-mode toggle uses iron-session
  (lawyer's dashboard cookie); a later admin-role check is
  out of scope.
- The toggle's effect ends when the function instance
  recycles; engineers re-toggle if needed.

## R9. User-Testing Release-Gate Process (FR-021 to FR-023)

**Decision**: Document the user-testing protocol as a
release-gate process artifact. No code task. Add
`docs/user-testing.md` capturing:

- Required participants per §11.8: 2–3 practicing lawyers
  for the guardrails form; non-technical users (≥ 3) for
  the chat widget.
- Tasks each participant performs (configure firm; chat as
  a prospective client).
- Observation methodology: think-aloud + recorded session
  + post-task interview.
- Findings template: confusion points, gaps, recommended
  changes.
- Validation criteria: qualifying questions and escalation
  triggers match real intake workflows.
- Release-gate enforcement: PRs that "touch the agent layer"
  (the system prompt, agent logic, guardrails generation,
  lead-classification criteria) cannot merge unless this
  doc shows a recorded run within the last release cycle.

**Rationale**:
- §11.8 explicitly mandates the protocol with timing
  ("after the form is built but before investing heavily in
  the agent layer").
- FR-021 to FR-023.
- Constitution III (TDD) treats user-testing for UX as
  parallel to automated tests for code.

**Alternatives considered**:
- Skip and rely on conversation-quality eval scripts only:
  rejected. §11.8's user-testing is a different gate (UX,
  not LLM correctness).

**Implementation notes**:
- The doc lives in the repo so reviewers can verify
  release-gate compliance during PR review.
- The user-testing protocol is captured as a release-gate
  item in `009-deployment-release` plan (Phase 8).

## Constitution Cross-Reference Summary

| Constitution element | Hardening decision | Aligned |
|---|---|---|
| I (MVP-First) | All decisions cite §-anchors; MAY-level FRs preserved as MAY (not over-promoted to MUST) | ✅ |
| II (Type Safety) | All new tables Zod-typed via Drizzle; consent + ToS bodies Zod-validated; cost-aggregation queries Zod-typed | ✅ |
| III (TDD layered) | Each new helper test-first; deterministic fixtures for FAQ cache (when enabled); mock Gemini for classifier tests | ✅ |
| IV (Serverless / Stateless) | Route Handlers only; no Server Actions; no fs writes; no native binaries; MAY-level optionals are env-flag gated | ✅ |
| V (Privilege & Privacy) | Consent persistence (R3); GDPR Art 17 disclosure (R4); ToS audit trail (R5); Foundation logger redaction throughout | ✅ |
| VI (Observable Agent) | Cost-monitoring surface (R2); per-session debug mode (R8); injection classifier audit trail (R6); daily budget cap as cost-bound | ✅ |
| VII (Phased Delivery) | Schema additions coordinated via Foundation tooling (R1); cross-feature touches with Phase 3 (budget cap), Phase 4 (consent banner), Phase 6 (privacy template surface) explicitly documented | ✅ |
| Required Stack | No new dependencies for binding (MUST-level) FRs; optional MAY-level deps documented for FR-014 / FR-015–018 | ✅ |
| Architectural Limits | None new; all upstream limits inherited | ✅ |

## Open Questions — None

All decisions resolve cleanly. No `NEEDS CLARIFICATION` markers
remain. Ready to proceed to Phase 1.
