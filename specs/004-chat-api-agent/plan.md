# Implementation Plan: Chat API + Agent

**Branch**: `004-chat-api-agent` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-chat-api-agent/spec.md`

## Summary

The Chat API + Agent is the runtime that connects the embedded chat
widget to the LLM. It exposes `POST /api/chat` (§12.8), authenticates
the request via API key (§2.4), creates or resumes a session
(§12.8), composes a system prompt from the lawyer's published
guardrails plus retrieved context (§7.8), runs a Vercel-AI-SDK
tool-calling agent (§7.2) against `gemini-2.5-flash` (§2.7), streams
the response token-by-token to the widget, and persists the
conversation (§2.10).

This is **Phase 3** per §12.5. It depends on `001-foundation`
(database schema, env loader, structured logger), `002-crawler-cli`
(produces the context store the agent retrieves from), and
`003-context-search` (the `searchContext` tool the agent calls).
This plan does NOT include the `captureLead` tool implementation;
that is owned by `006-lead-classification`. The current code base
already wires `captureLead` into the agent — that is acceptable
because Phase 5's deliverable is the captureLead implementation
plus its tests, and the wiring was added preemptively.

A working implementation already exists at
`packages/api/src/app/api/chat/route.ts` (176 lines) plus helpers
in `packages/api/src/lib/` (auth, rate-limit, session,
system-prompt, etc.). The 54 FRs in the spec map onto an
implementation that is **largely correct in shape** but has
several **gaps** that violate the Constitution or fall short of
the spec:

- **R1** — Rate limiting (FR-043 to FR-046): existing code is
  generic 20-req/min/account. Spec mandates **50 messages per
  conversation** (per-session) AND **1000 conversations per day**
  (per-API-key). Both must be implemented; current implementation
  is wrong on both counts.
- **R2** — Prompt-injection sanitation (FR-047): no input
  sanitation. Control characters and oversize messages reach the
  LLM unchecked.
- **R3** — Token-usage recording (FR-050, FR-051): `onFinish` does
  not capture token counts; no DB write.
- **R4** — Structured-JSON logging (FR-054): code uses
  `console.error`. Must use Foundation logger.
- **R5** — Sliding-window memory (FR-033): full history sent to LLM
  on every turn; no summarization for >10 messages.
- **R6** — Cross-account session protection (edge case): existing
  `sessionExists()` does not validate `account_id` match.
- **R7** — Error response wording (FR-011): "Missing API key" must
  become "Invalid API key" per §12.8 example.
- **R8** — Manifest cache deduplication: local cache in
  `route.ts` duplicates the cache the `003-context-search` feature
  will own. Consolidate.
- **R9** — Injection-attempt logging (FR-049): conversations with
  injection patterns must be flagged in logs.
- **R10** — Repeated-inability detection (FR-041): no counter for
  successive empty-context responses; spec mandates a fallback
  message after threshold.
- **R11** — Configurable session expiry (FR-017): hardcoded
  per-session behavior; expiry threshold (default 30 min) needs
  a config knob.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation).
Module is ESM, runs as a Next.js Route Handler on Netlify Functions.

**Primary Dependencies** (already in `packages/api/package.json`):

- `ai` (Vercel AI SDK) — `streamText`, `tool` (§7.2, §9.1).
- `@ai-sdk/google` — Gemini provider (§2.7, §9.1).
- `@ai-sdk/react` — `useChat` hook re-exports (consumed by widget,
  not by the API).
- `next` 15 — Route Handlers (§9.7 forbids Server Actions).
- `drizzle-orm` + `@neondatabase/serverless` — DB access
  (§2.6, §9.5).
- `bcryptjs` — API-key hash comparison (§2.4 step 4, §9.7).
- `nanoid` — session ID generation (§2.4, §9.9).
- `zod` — tool parameter schemas + body validation (Constitution II).
- `iron-session` — dashboard auth cookies (consumed by other
  routes, not `/api/chat`).
- `@legal-chatbot/shared` — Foundation env, logger, schemas.

No new dependencies required by this feature.

**Storage**: Neon PostgreSQL via Drizzle (production) and in-memory
SQLite via `drizzle-orm/better-sqlite3` (tests). Tables read/written
by this feature: `accounts` (read), `api_keys` (read), `configurations`
(read), `sessions` (read/write). Tables NOT touched by this feature:
`leads`, `archived_data`, `notifications` (Phase 5 owns those).

**Testing**: Vitest. Existing test files cover `auth`, `rate-limit`,
`session`, `system-prompt`, `partial-lead`, `leads`. The chat route
itself currently has no test file — gap-fill task.

**Target Platform**: Netlify Functions (serverless) per §9.7. Cold
starts begin with empty per-function caches (manifest cache, rate-
limit counter); each warm request reuses them. Constitution IV's
no-fs-at-runtime rule applies.

**Project Type**: Next.js Route Handler inside `packages/api`
(workspace package `@legal-chatbot/api`).

**Performance Goals**:
- Stream first token within ~1 second of request acceptance
  (subjective; spec is silent on hard latency target).
- `maxSteps: 5` cap on tool-call recursion (§7.2, FR-029).
- Total context injection ≤ ~4500 tokens (§7.7, FR-024) —
  enforced by `003-context-search`'s budget module plus the
  guardrails block budget owned here (~1000 tokens).
- Conversation memory sliding window: last 10 messages full,
  older summarized (§7.9, FR-032, FR-033).

**Constraints**:
- TS strict (Constitution II).
- All boundary inputs Zod-validated (Constitution II, FR-002,
  FR-007).
- No Server Actions (Constitution IV, FR-018, §8.4 implementation
  note).
- No native binaries in production deps (Constitution IV; `bcryptjs`
  only).
- Logger MUST redact secrets (Constitution V; FR-054).
- Agent system prompt MUST contain the non-disclosure rule
  (FR-023, §11.2).
- Persistent disclaimer: "I am an AI assistant, not a lawyer..."
  is part of the system-prompt's mandatory content (FR-024,
  §11.4).
- API responds with `Access-Control-Allow-Origin: *` (FR-013,
  §9.7).
- Streaming response uses Vercel AI SDK protocol (FR-007, §12.8).
- Rate limits: 50 messages/conversation, 1000 conversations/day/key
  (FR-043, FR-044, §11.1).

**Scale/Scope**: Per-firm conversation volume is bounded by the
1000 conversations/day cap. Each conversation up to 50 messages.
Per-session memory window is 10 full messages plus a compact
summary block — keeps token usage predictable (§7.9 binding
rationale).

## Constitution Check

| # | Principle | Chat API + Agent applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors; no scope creep beyond the spec's 12 FR groups | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Body parsed via Zod; tool params Zod (`z.object`); session messages Zod-validated against `messages.ts`; env via Foundation env loader | ✅ PASS — pending body-validation gap-fill |
| III | Test-First, Layered Testing | Existing helper tests; chat route test file is missing — TDD gap-fill before R1–R11 implementation | ✅ PASS — pending route test file |
| IV | Serverless / Stateless | Route Handlers only (no Server Actions); no fs writes; manifest cache process-local; bcryptjs not bcrypt | ✅ PASS |
| V | Privilege & Privacy | Logger MUST redact API keys, password hashes, session secrets, PII; system prompt has non-disclosure rule (FR-023, R-must); never fabricate (FR-042, §7.11) | ✅ PASS — pending R4 (logger usage) and R9 (injection logging) |
| VI | Bounded, Observable Agent | `maxSteps: 5` enforced (FR-029); rate limits enforced (R1); structured-log events for every conversation event (R4) | ✅ PASS — pending R1 + R4 gaps |
| VII | Phased Incremental Delivery | Phase 3 of §12.5; depends on Foundation, Crawler, Context Search; produces input for Widget (Phase 4); `captureLead` tool deferred to Phase 5 wiring/ownership | ✅ PASS |

**Architectural Limits**:
- Per-conversation messages ≤ 50 (§11.1, R1).
- Per-API-key daily conversations ≤ 1000 (§11.1, R1).
- Tool-call recursion `maxSteps ≤ 5` (§7.2, FR-029).
- Context injection cap ~4500 tokens (§7.7, FR-024) — owned by
  `003-context-search` budget module plus the system-prompt
  composer here.

**Result**: All gates PASS pre-design. Implementation gaps R1, R4,
R9 are the binding fixes that must land before this phase is
declared complete. No Constitution amendments required.

## Project Structure

### Documentation (this feature)

```text
specs/004-chat-api-agent/
├── plan.md
├── research.md
├── data-model.md           # Session lifecycle, message memory, tool wiring
├── quickstart.md
├── contracts/
│   ├── chat-endpoint-contract.md   # POST /api/chat HTTP contract
│   ├── system-prompt-contract.md   # 4-block composition + non-disclosure rule
│   ├── rate-limit-contract.md      # 50/conv + 1000/key/day semantics
│   └── input-sanitation-contract.md # control-char strip + length cap + injection flag
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (`packages/api/`)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/api/src/
├── app/api/chat/
│   ├── route.ts                    # ⚠ EXTEND — wire R1, R2, R3, R4, R5, R6, R7, R8, R9, R10
│   ├── route.test.ts               # ❌ NEW — integration tests for the route
│   └── cors.ts                     # ✅ keep
├── lib/
│   ├── auth.ts                     # ✅ keep (verifies API key)
│   ├── config.ts                   # ✅ keep (loads published config)
│   ├── session.ts                  # ⚠ EXTEND — add account-scoped session lookup (R6) + expiry check (R11)
│   ├── session.test.ts             # ⚠ EXTEND — cross-account test
│   ├── system-prompt.ts            # ⚠ EXTEND — add non-disclosure rule explicitly (R-FR-023) + intake-state block
│   ├── system-prompt.test.ts       # ⚠ EXTEND
│   ├── rate-limit.ts               # ⚠ REPLACE — implement 50/conv + 1000/key/day (R1)
│   ├── rate-limit.test.ts          # ⚠ REPLACE — match new semantics
│   ├── input-sanitize.ts           # ❌ NEW — control-char strip, length cap (R2)
│   ├── input-sanitize.test.ts      # ❌ NEW
│   ├── injection-detector.ts       # ❌ NEW — pattern match + log (R9)
│   ├── injection-detector.test.ts  # ❌ NEW
│   ├── memory-window.ts            # ❌ NEW — sliding window summarizer (R5)
│   ├── memory-window.test.ts       # ❌ NEW
│   ├── token-usage.ts              # ❌ NEW — write usage records to DB (R3)
│   ├── token-usage.test.ts         # ❌ NEW
│   ├── repeated-inability.ts       # ❌ NEW — counter + threshold (R10)
│   └── repeated-inability.test.ts  # ❌ NEW
└── db/
    └── schema.ts                   # ⚠ EXTEND — add `token_usage` table (R3)
```

The `packages/shared` env-loader and logger from Foundation are
imported, not duplicated here.

**Structure Decision**: Keep the existing
`packages/api/src/app/api/chat/route.ts` as the orchestration
point and refactor each concern into its own helper under
`packages/api/src/lib/`. The route file becomes thinner; helpers
are unit-testable in isolation. The agent's tool definitions remain
inline in the route (per Vercel AI SDK pattern) but their `execute`
bodies delegate to helpers in `lib/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All seven Constitution principles pass once R1, R4, R9 land.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/004-chat-api-agent/plan.md` | ✅ written |
| Research | `specs/004-chat-api-agent/research.md` | ✅ written (14 research items: R1–R14) |
| Data model | `specs/004-chat-api-agent/data-model.md` | ✅ written (read entities + new `token_usage` table + 4 in-memory entities + state diagrams + cross-feature coordination) |
| Contracts | `specs/004-chat-api-agent/contracts/` | ✅ written (4 contracts: chat-endpoint, system-prompt, rate-limit, input-sanitation) |
| Quickstart | `specs/004-chat-api-agent/quickstart.md` | ✅ written (full §12.8 done-when verification + auth + rate-limit + injection + token-usage + CORS) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; `captureLead` ownership explicitly carved out to Phase 5 | ✅ |
| II | Type Safety & Zod | `chat-endpoint-contract.md` mandates Zod body validation (R12); env via Foundation loader; tool params Zod | ✅ |
| III | TDD layered | Each new helper has a test file in the project structure; route gets `route.test.ts`; existing 502-line context-search tests inherited unchanged | ✅ |
| IV | Serverless / Stateless | All in-memory caches/counters acknowledged process-local; manifest cache consolidated (R8); no Server Actions; bcryptjs only | ✅ |
| V | Privilege & Privacy | Cross-account session isolation (R6); logger redaction (R4); injection logging (R9); message text excluded from log payloads (Foundation contract); non-disclosure rule front-loaded (R13) | ✅ |
| VI | Observable Agent | maxSteps:5 (FR-029); 50/conv + 1000/key/day rate limits (R1); structured logs (R4); injection events (R9); token-usage records (R3) | ✅ |
| VII | Phased Delivery | Manifest cache consolidation with Phase 2 (R8); `captureLead` ownership shared with Phase 5; downstream Widget contract honored | ✅ |

**Architectural Limits**: 50/conv + 1000/key/day (R1); maxSteps:5
(FR-029); ~4500 token cap (FR-024); ~1000 guardrails-block budget
owned here.

**Result**: All gates PASS post-design. The 11 gap-fills (R1–R11)
are the binding work; Constitution amendments are not required.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 6 user stories in `spec.md` (P1×4, P2×2).
- 54 FRs in 12 groups.
- 14 research items.
- 4 contracts.

Task graph is moderately parallelizable: most new helpers
(`input-sanitize.ts`, `injection-detector.ts`, `memory-window.ts`,
`token-usage.ts`, `repeated-inability.ts`) are independent modules
with their own tests and contracts. The route handler integration
(`route.ts` + `route.test.ts`) is the convergence point. The
schema migration for `token_usage` (R3) must land before
token-usage write paths; otherwise tests fail.
