# Implementation Plan: Hardening

**Branch**: `008-hardening` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-hardening/spec.md`

## Summary

Hardening implements the operational, observability, cost-control,
and compliance layers from §11 "Additional Recommendations" that
were not already absorbed as binding requirements into earlier
phases. It bridges "the system works" → "the system is operable
in production." Per the spec's Out of Scope analysis, this
feature owns:

- §11.2 optional prompt-injection classifier ("Consider…").
- §11.3 cost monitoring SURFACE (cumulative-spend display, alerts,
  daily budget cap with friendly disable). The token-usage
  logging itself is already binding in `004-chat-api-agent` R3.
- §11.4 ToS acceptance + liability-counsel touchpoint.
- §11.5 consent timestamp PERSISTENCE (the banner UI is in
  `005-chat-widget`); privacy/retention disclosure language;
  GDPR Article 17 exceptions.
- §11.6 FAQ semantic cache (entirely deferred until now).
- §11.7 per-session debug mode toggle.
- §11.8 user-testing release-gate process.

This is **Phase 7** per the build roadmap. It can run in
parallel with Phase 6 dashboard work or after, but every item
must be present before any "production" claim. Most items are
**MAY**-level requirements (the spec's "Consider…" language
preserved in spec.md's FRs); a few are **MUST** (consent
persistence, retention disclosure, ToS).

This plan acknowledges that the Hardening feature is largely
**net-new** — unlike Phases 1–6 which had substantial existing
scaffolding to extend, Hardening creates new modules, surfaces,
and database artifacts. The existing repo touch-points are:
- `004-chat-api-agent` already writes `token_usage` per turn
  (Phase 3 R3) — Phase 7 reads this for the cost-monitoring
  surface.
- `005-chat-widget` already shows a small AI-assistant
  disclaimer — Phase 7 ensures the persistent banner-style
  disclaimer + consent banner exist (consent banner UI is
  already a Phase 4 R5 task).
- `007-dashboard`'s configuration form will gain a
  "Privacy & Compliance" section (Phase 6 R9) — Phase 7
  extends its template content with GDPR Article 17 language.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+
(Foundation). Some surfaces are server-side (Next.js Route
Handlers); some are client-side (dashboard UI components +
widget consent submission).

**Primary Dependencies** (already in scope; no new deps required):

- `drizzle-orm` + `@neondatabase/serverless` — DB writes.
- `zod` — Zod schemas at every cross-boundary.
- `@legal-chatbot/shared` — Foundation env, logger.
- React + Next.js — for dashboard cost-monitoring UI.

**Optional Dependencies** (MAY-level FRs — only if the
operator opts in):

- A vector-embedding library (e.g., `@ai-sdk/embeddings` or
  `@google/generative-ai`'s embedding endpoint) for §11.6 FAQ
  semantic cache.
- An ML classifier (e.g., a tiny on-device classifier or
  another Gemini call) for §11.2 optional injection classifier.

The spec's no-new-deps rule is honored: where a MAY-level
optional feature requires an additional library, that library is
listed here as optional and used only when the corresponding FR
is implemented.

**Storage**: Neon PostgreSQL (production). Tables read/written:

- `token_usage` (read; written by `004-chat-api-agent` R3) — for
  cost-monitoring aggregation.
- `accounts` (READ + new column added) — for ToS acceptance
  metadata.
- `sessions` (READ + new columns added) — for consent metadata.
- `notifications` (write) — for spend-alert delivery channel.
- `spend_alerts` (NEW table) — for per-account alert config.
- `daily_budget_caps` (NEW table) — for per-account daily budget.
- `faq_cache` (NEW table) — for §11.6 semantic cache (when
  enabled).
- `tos_acceptances` (NEW table) — for the ToS acceptance audit
  trail.

**Testing**: Vitest unit tests for helpers. Integration tests
for the cost aggregation queries. Optional fixtures for the
semantic cache (deterministic vectors).

**Target Platform**: Netlify Functions (serverless) per §9.7.
All Hardening code follows Constitution IV (no fs at runtime,
no native binaries, no Server Actions).

**Project Type**: Mostly TypeScript libraries inside
`packages/api/src/lib/` plus dashboard UI components inside
`packages/api/src/app/dashboard/` (per Phase 6 R1 co-location
decision) plus a tiny widget endpoint surface
(`POST /api/consent`).

**Performance Goals**:
- Cost-monitoring page render: SSR-only; one query plus per-day
  aggregation; ≤ 200 ms p95.
- FAQ semantic cache hit: ≤ 50 ms (avoids LLM round-trip).
- ToS acceptance write: a single INSERT; trivial.

**Constraints**:
- TS strict (Constitution II).
- All mutations via Route Handlers (Constitution IV).
- All boundary inputs Zod-validated (Constitution II).
- No PII in log payloads (Constitution V; FR-005 of Foundation).
- The optional injection classifier (FR-014) is MAY-level —
  deployed only when operator opts in.
- The FAQ semantic cache (FR-015–FR-018) is MAY-level —
  deployed only when operator opts in.
- Constitution VII binds schema additions (R1) via Foundation's
  `drizzle-kit` migration tooling.

**Scale/Scope**: Cost monitoring aggregates per-conversation
`token_usage` rows. With the §11.1 cap of 1000
conversations/key/day and one row per turn, daily volume is
≤ 50 × 1000 = 50,000 rows/day per account in the worst case.
Realistic firms see 10–50 conversations/day → 500–2500 rows/day.
PostgreSQL handles this trivially.

## Constitution Check

| # | Principle | Hardening applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors (§1.10, §11.2–11.8). The spec carefully carves boundary against earlier phases — see spec.md Out of Scope. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | All new tables Zod-typed via Drizzle inserts; cost-aggregation queries return Zod-validated shapes; consent submission body Zod-validated. | ✅ PASS |
| III | Test-First, Layered Testing | Each new helper test-first; integration tests for aggregation; deterministic fixtures for semantic cache (when enabled). | ✅ PASS |
| IV | Serverless / Stateless Architecture | Route Handlers only (no Server Actions); no fs writes; no native binaries; the optional vector-embedding / classifier libraries used only when operator opts in. | ✅ PASS |
| V | Privilege & Privacy | Consent timestamp persistence (FR-006); GDPR Article 17 disclosure (FR-009); ToS acceptance audit trail (FR-011, FR-012); Foundation logger redacts spend-alert payloads. | ✅ PASS |
| VI | Bounded, Observable Agent | Cost-monitoring surface is the operator-facing observability layer; daily budget cap (FR-004, FR-005) is the cost-bound; per-session debug mode (FR-019, FR-020) is the troubleshooting surface; injection classifier (FR-014) is the additional defense. | ✅ PASS |
| VII | Phased Incremental Delivery | Phase 7; depends on Phase 3 token-usage records, Phase 4 widget consent banner UI, Phase 5 lead writes, Phase 6 dashboard config form. Schema additions (R1) coordinated via Foundation tooling. | ✅ PASS |

**Architectural Limits**: No new direct limits introduced.
Inherits all upstream limits.

**Result**: All gates PASS. The MAY-level FRs (FR-014, FR-015 to
FR-018, FR-019, FR-020) are explicitly marked as
operator-opt-in; the spec preserves the source's "Consider…"
phrasing.

## Project Structure

### Documentation (this feature)

```text
specs/008-hardening/
├── plan.md
├── research.md
├── data-model.md           # 4 NEW tables + 2 column additions; cost-aggregation queries; FAQ cache; consent record
├── quickstart.md
├── contracts/
│   ├── cost-monitoring-contract.md       # Cost-monitoring page route + spend-alert config + daily budget cap
│   ├── consent-persistence-contract.md   # POST /api/consent
│   ├── tos-acceptance-contract.md        # POST /api/auth/accept-tos + middleware enforcement
│   ├── debug-mode-contract.md            # Per-session debug toggle (admin-only surface)
│   └── faq-cache-contract.md             # MAY-level optional semantic cache
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

The user-testing release gate (R8 / FR-021–FR-023) is a **process
contract** documented in research.md; no code surface.

### Source Code

```text
packages/api/src/
├── lib/
│   ├── cost-monitoring.ts                # ❌ NEW — token_usage aggregation, spend calc
│   ├── cost-monitoring.test.ts           # ❌ NEW
│   ├── spend-alerts.ts                   # ❌ NEW — alert config + threshold check
│   ├── spend-alerts.test.ts              # ❌ NEW
│   ├── budget-cap.ts                     # ❌ NEW — daily budget cap check + chatbot disable
│   ├── budget-cap.test.ts                # ❌ NEW
│   ├── consent.ts                        # ❌ NEW — consent record write
│   ├── consent.test.ts                   # ❌ NEW
│   ├── tos.ts                            # ❌ NEW — ToS acceptance write + check middleware
│   ├── tos.test.ts                       # ❌ NEW
│   ├── debug-mode.ts                     # ❌ NEW — toggle per-session debug
│   ├── debug-mode.test.ts                # ❌ NEW
│   ├── faq-cache.ts                      # ❌ NEW (MAY-level) — semantic cache
│   ├── faq-cache.test.ts                 # ❌ NEW
│   ├── injection-classifier.ts           # ❌ NEW (MAY-level) — optional ML classifier
│   ├── injection-classifier.test.ts      # ❌ NEW
│   └── ... (other lib files unchanged)
├── app/
│   ├── api/
│   │   ├── consent/route.ts              # ❌ NEW — POST consent persistence
│   │   ├── auth/accept-tos/route.ts      # ❌ NEW — POST ToS acceptance
│   │   └── dashboard/
│   │       ├── cost/route.ts             # ❌ NEW — GET cost monitoring data
│   │       ├── spend-alerts/route.ts     # ❌ NEW — GET/POST/DELETE alert config
│   │       ├── budget-cap/route.ts       # ❌ NEW — GET/PUT daily budget
│   │       └── debug-mode/route.ts       # ❌ NEW — POST toggle session debug
│   └── dashboard/
│       ├── cost/                         # ❌ NEW — cost monitoring page
│       │   ├── page.tsx
│       │   ├── spend-chart.tsx
│       │   ├── alerts-config.tsx
│       │   └── budget-cap-config.tsx
│       └── (intercept ToS modal)         # ❌ NEW — middleware-driven ToS prompt on first login
└── db/schema.ts                          # ⚠ EXTEND — 4 NEW tables + 2 column additions

packages/widget/src/                       # ⚠ EXTEND
├── components/
│   ├── ConsentBanner.tsx                 # ✅ exists (Phase 4 R5)
│   └── ConsentBanner.tsx                 # ⚠ EXTEND — POST to /api/consent on accept

packages/shared/src/
└── templates/
    ├── privacy-policy.md                 # ❌ NEW — §11.5 + §1.10 + GDPR Art 17 template
    └── terms-of-service.md               # ❌ NEW — §11.4 ToS template
```

**Structure Decision**: All new code lives inside the
`packages/api` workspace package (per Phase 6 R1 co-location).
The two MAY-level optional modules (`faq-cache.ts`,
`injection-classifier.ts`) live in `lib/` like the other
helpers and are wired into the chat-API route conditionally
via env flags (`FAQ_CACHE_ENABLED`, `INJECTION_CLASSIFIER_ENABLED`).
The privacy-policy and ToS templates live in
`packages/shared/src/templates/` so the dashboard's
configuration form (Phase 6 R9) can import them.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven Constitution principles pass.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/008-hardening/plan.md` | ✅ written |
| Research | `specs/008-hardening/research.md` | ✅ written (9 research items: R1–R9) |
| Data model | `specs/008-hardening/data-model.md` | ✅ written (4 NEW tables + 2 column additions + 2 markdown templates + state diagrams + cross-feature coordination) |
| Contracts | `specs/008-hardening/contracts/` | ✅ written (5 contracts: cost-monitoring, consent-persistence, tos-acceptance, debug-mode, faq-cache) |
| Quickstart | `specs/008-hardening/quickstart.md` | ✅ written (8 user-story walkthroughs + DB-query verifications + done-when SC map) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; MAY-level FRs preserved as MAY (FR-014 classifier, FR-015–018 cache, FR-019 debug); no scope creep | ✅ |
| II | Type Safety & Zod | All new tables Zod-typed via Drizzle; consent + ToS + spend-alerts + budget-cap + debug-mode bodies Zod-validated | ✅ |
| III | TDD layered | Each new helper has a test file in the project structure; deterministic fixtures for FAQ cache and classifier; mock Foundation logger for debug-mode tests | ✅ |
| IV | Serverless / Stateless | Route Handlers only; no Server Actions; no fs writes; MAY-level optionals (classifier, FAQ cache) are env-flag gated | ✅ |
| V | Privilege & Privacy | Consent persistence (R3); GDPR Art 17 disclosure (R4); ToS audit trail (R5); Foundation logger redaction throughout | ✅ |
| VI | Observable Agent | Cost-monitoring surface; daily budget cap as cost-bound; per-session debug mode; injection classifier audit trail | ✅ |
| VII | Phased Delivery | Schema migrations coordinated via Foundation tooling (R1); cross-feature integration with Phase 3 (budget cap), Phase 4 (consent banner), Phase 6 (privacy template surface) explicitly documented | ✅ |

**Architectural Limits**: None new; all upstream limits inherited.

**Result**: All gates PASS post-design. R1–R9 are net-new
implementation work; no Constitution amendments required.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 8 user stories in `spec.md` (P1×4, P2×2, P3×1).
- 23 FRs in 8 groups.
- 9 research items.
- 5 contracts (+ R9 process doc).

Task graph:

- **Phase A** (sequential, foundational): R1 schema migrations
  → R4 templates → R3 consent endpoint → R5 ToS middleware.
- **Phase B** (parallel after Phase A): R2 cost monitoring +
  budget cap + spend alerts; R8 debug mode; R9 user-testing
  doc.
- **Phase C** (MAY-level optionals; can be deferred): R6
  injection classifier; R7 FAQ semantic cache.
- **Phase D** (testing): unit tests for each helper; full
  test-suite run.

