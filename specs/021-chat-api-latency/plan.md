# Implementation Plan: Chat API Latency Reduction

**Branch**: `021-chat-api-latency` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/021-chat-api-latency/spec.md`

## Summary

Trim avoidable work out of the `/api/chat` request handler so visitors see the assistant's first token ≥150ms sooner at P50 and the stream-`done` event ≥200ms sooner — with **zero user-visible behavior change** and **zero schema change**.

Five surgical edits, all application-layer:

1. Delete the dynamic off-SOP detour detector (`isOffTopic` + the `### Detour required NOW` prompt block); rely on the static "Off-SOP detour rule" already in the SOP block.
2. Defer the non-critical post-stream write chain (lead SOP-state update → branch-finalization UPDATE → hard-override application → partial-lead save) via Next.js 15's stable `after()` API. Keep the session write awaited on the critical path.
3. Replace the SELECT-then-write pattern in `appendMessagesAndSOPState` with a route-supplied in-memory history. Eliminates one Neon HTTP round trip per turn and is race-safe under deferred-write semantics.
4. Memoize the static prefix of `composeSystemPrompt` per `(accountId, configVersionId, isPreview)`. Wire invalidation through the existing `invalidateConfigCache` call sites.
5. Lazily build `BranchOrchestratorDeps` and its `whenChipWeights{,ByLabel}` lookups only when `sopState?.is_finalized === true`.

The feature is a behavior-preservation change. Success is measured by latency drops **paired with** byte-for-byte database equivalence and an unchanged e2e walk suite (minus the deliberately-deleted off-SOP-detour walk).

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 20+

**Primary Dependencies**: Next.js 15.3 (Route Handlers + `after()` from `next/server`), Vercel AI SDK (`ai`, `@ai-sdk/google`), Drizzle ORM (`drizzle-orm/neon-http`), `@neondatabase/serverless`, Zod

**Storage**: Neon serverless PostgreSQL (production), `better-sqlite3` (in-memory, tests). No schema changes in this feature.

**Testing**: Vitest (unit + integration), Playwright (e2e walks). LLM mocked via MSW or AI SDK test utilities per Constitution III.

**Target Platform**: Netlify Functions running Next.js 15 (Netlify Next.js Runtime). The `after()` primitive from `next/server` is the supported "complete work after response" mechanism on this runtime.

**Project Type**: pnpm + Turborepo monorepo. This feature touches `packages/api` only.

**Performance Goals**: P50 TTFB drop ≥150ms; P50 `done`-event drop ≥200ms on the SOP-driven traffic shape.

**Constraints**: Zero behavior change (FR-014). Zero schema change (FR-015). No new tool calls or new agent tools (FR-016, Constitution VI). Existing context-store cache TTL ≤ 5 minutes stays (Constitution V); the new system-prompt-prefix cache reuses the existing 60s config TTL so staleness bounds do not regress.

**Scale/Scope**: Same conversation/key limits as Constitution VI: 50 messages per session, 1000 conversations per API key per day, `maxSteps ≤ 5`, context budget ~4500 tokens. None of these limits are touched.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline (NON-NEGOTIABLE) | ✅ PASS | Pure performance work on the chat path that is already shipped. Cites no scope expansion; removes an internal heuristic whose value is unproven. Maps to operational quality of the existing MVP — no new product surface. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | All edits stay in TypeScript with strict typing. No new cross-boundary data shapes; the cached prompt prefix is a pure string, the deferred-writes batch is internal-only. No new Zod schemas required. |
| III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE) | ✅ PASS — with explicit deletes | Each edit introduces failing tests first. The off-SOP detour deletions are an exception (tests are *removed* alongside production code); the deletion is itself a tested change because the surviving widget e2e walks must continue to pass green without the deleted walk. New unit tests cover the system-prompt cache (hit, miss, invalidation, account-isolation, version-isolation, preview-isolation) and the route's lazy-deps construction. New integration tests cover the deferred-writes ordering and the message-append race scenario. |
| IV. Serverless-Compatible & Stateless Server Architecture | ✅ PASS | `after()` is the Next.js 15 primitive supported on Netlify Next.js Runtime — it does NOT depend on a persistent local filesystem and respects function lifecycle. The system-prompt-prefix cache is an in-process `Map` that follows the same model as the existing `verifyApiKey` and `getPublishedConfig` caches (cold-process empty, warm-process effective) — see `lib/auth.ts:30` and `lib/config.ts:26`. No native binaries added. No server actions; route stays a Route Handler. CORS unchanged. |
| V. Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE) | ✅ PASS | The cached prompt prefix contains lawyer-configured content (persona, practice areas, contact info, custom instructions) — already considered safe to hold in process (it's the same content `getPublishedConfig` already caches today). Strict per-`(accountId, configVersionId, isPreview)` keying prevents cross-account bleed. Cache invalidation hooks into `invalidateConfigCache` so a publish takes effect within the existing staleness window. No PII enters the cache (PII redaction in `composeSopBlock` is on the *dynamic* portion, which stays out of cache). Logs from the deferred-writes chain MUST follow Constitution V logging rules (no API keys / PII in plaintext). |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | Agent tools unchanged. `maxSteps: 5` unchanged. Token budget unchanged. Rate limits unchanged. Removing the dynamic off-topic block actually *reduces* prompt token consumption (~8 lines per detour turn), better aligning with §7.7. Structured-log coverage of the deferred-writes chain MUST match today's coverage (events still emitted; lifecycle timing changes but content does not). |
| VII. Phased Incremental Delivery | ✅ PASS | This is a Phase 3 (Chat API) improvement that does not depend on or block any later phase. Full test suite for prior phases must continue to pass per §12.12 — that's part of the success criteria (SC-004). |

**Result**: PASS on all seven principles. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/021-chat-api-latency/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Spec (already created)
├── research.md          # Phase 0 output (this command)
├── data-model.md        # Phase 1 output (this command)
├── quickstart.md        # Phase 1 output (this command)
├── contracts/           # Phase 1 output (this command)
│   ├── chat-route-flow.md
│   ├── system-prompt-cache.md
│   ├── deferred-writes.md
│   └── session-append.md
├── checklists/
│   └── requirements.md  # Created during /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Monorepo layout (pnpm + Turborepo, per Constitution §9.6). This feature edits files inside `packages/api` only; `packages/widget`, `packages/dashboard`, `packages/crawler`, and `packages/shared` are untouched.

```text
packages/
├── api/                                # <-- ONLY package edited by this feature
│   ├── src/
│   │   ├── app/api/chat/
│   │   │   ├── route.ts                # EDIT: remove isOffTopic call, lazy branch deps, after() for deferred writes
│   │   │   └── route.test.ts           # EDIT: update tests; remove off-topic flag assertion
│   │   ├── lib/
│   │   │   ├── session.ts              # EDIT: appendMessagesAndSOPState accepts in-memory history
│   │   │   ├── session.test.ts         # EDIT: cover no-extra-SELECT and cold-session path
│   │   │   ├── system-prompt.ts        # EDIT: split into cached prefix + dynamic suffix
│   │   │   ├── system-prompt.test.ts   # EDIT: drop isOffTopicNow param threading tests
│   │   │   ├── system-prompt-cache.ts  # NEW: per-(account, version, preview) LRU
│   │   │   ├── system-prompt-cache.test.ts  # NEW: hit/miss/invalidate/isolation tests
│   │   │   ├── config.ts               # EDIT: invalidateConfigCache also drops prompt-prefix cache
│   │   │   └── sop/
│   │   │       ├── off-sop-detour.ts            # DELETE
│   │   │       ├── off-sop-detour.test.ts       # DELETE
│   │   │       ├── system-prompt-extension.ts   # EDIT: drop isOffTopicNow param + ### Detour required NOW block
│   │   │       └── system-prompt-extension.test.ts  # EDIT: drop detour-now test cases
│   │   └── ...
│   ├── tests/e2e/
│   │   └── widget-us3-off-sop-detour.walk.spec.ts  # DELETE
│   └── package.json
├── widget/                             # untouched
├── dashboard/                          # untouched
├── crawler/                            # untouched
└── shared/                             # untouched
```

**Structure Decision**: Edits are confined to `packages/api/src/app/api/chat/route.ts`, `packages/api/src/lib/session.ts`, `packages/api/src/lib/system-prompt.ts`, `packages/api/src/lib/config.ts`, and `packages/api/src/lib/sop/system-prompt-extension.ts`. One new module (`packages/api/src/lib/system-prompt-cache.ts`) follows the shape of the existing `lib/config.ts` and `lib/auth.ts` caches. Three files (`off-sop-detour.ts`, its test, and the dedicated e2e walk) are deleted.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified.**

None. Constitution Check passes on all seven principles without deviation.

---

## Phase 0 — Research

See [research.md](./research.md) for the full write-up of:

- **R1: Which "complete after response" primitive to use on Netlify Next.js 15.3**
  - **Decision**: `after()` from `next/server` (stable in Next.js 15).
  - **Rationale**: Supported on Netlify Next.js Runtime, no external dependency, idiomatic for Route Handlers, scoped per request, automatically tied to the function lifecycle. Bare `void promise.catch(log)` is unsafe (worker can suspend mid-write).
  - **Alternatives considered**: bare unawaited promise (rejected — worker suspension), Netlify Background Functions (rejected — separate function, deploy churn, not necessary), durable queue (rejected — Constitution I + no infra for it).
  - **Fallback**: in environments where `after()` is unavailable (local dev under some runtimes, certain non-Next test harnesses), the deferred chain falls back to inline `await` via a small helper `runAfterResponse(fn)` that detects environment and chooses.

- **R2: Where to put the system-prompt-prefix cache**
  - **Decision**: New module `lib/system-prompt-cache.ts`, structured identically to `lib/config.ts` (in-process `Map`, TTL-bounded entries, test-only reset hook, `invalidate(accountId)` exposed for publish handlers).
  - **Rationale**: Matches the established pattern; the cache shares its TTL with `getPublishedConfig` (60s), so staleness bounds line up.
  - **Alternatives considered**: hoisting into `lib/config.ts` (rejected — single-purpose modules are easier to test); hashing the entire `Configuration` object (rejected — defeats the cache savings).

- **R3: SELECT-then-write replacement strategy for `appendMessagesAndSOPState`**
  - **Decision**: Pass the in-memory `history` array from the chat route into `appendMessagesAndSOPState`. The route already loaded the row via `getSessionForSOP` at the top of the turn.
  - **Rationale**: Simpler than a Postgres `jsonb` append (which would also work but requires raw SQL or a `sql\`...\`` Drizzle escape and adds testing surface). The route is the single chat-side writer; non-chat writers (`appendMessages`) keep the SELECT-then-write path.
  - **Race window**: With the leads-side writes deferred via `after()`, the session write completes on the critical path BEFORE the response closes. A concurrent double-send from the same widget is still ordered by HTTP arrival (Next.js single-request lifecycle). Last-writer-wins under widget double-click; the widget already single-flights send.
  - **Cold-session edge**: When `createSession` minted a new id in the same turn, `history` is `[]` — the helper writes `[newUserMessage, newAssistantMessage]` directly. No change in semantics vs. today's path.

- **R4: Cache-invalidation audit for `invalidateConfigCache`**
  - **Decision**: Audit and extend three call sites — `app/api/dashboard/config/route.ts` (save + publish), `app/api/dashboard/sop/route.ts` (publish SOP), and any theme-save handler. Each MUST call `invalidateSystemPromptCache(accountId)` alongside its existing `invalidateConfigCache(accountId)`.
  - **Rationale**: Spec FR-011 and SC-006 require no additional staleness vs. today's invalidation. Inverting the dependency (have `invalidateConfigCache` itself call the prompt-cache invalidator) couples the two modules; preferring explicit invalidation in handlers keeps the cache module standalone.
  - **Alternative considered**: Use a publish/subscribe pub-sub in-process. Rejected — overkill for two coupled caches.

- **R5: Branch-orchestrator deps lazy construction**
  - **Decision**: Build `branchDeps` inside an `if (sopState?.is_finalized)` block. The chip-weights builders for `when` are non-trivial JSON parsing — gate them on finalization.
  - **Rationale**: The orchestrator's Gate 1 already short-circuits on `!sopState.is_finalized`. Constructing the deps eagerly is wasted work pre-finalize.

- **R6: Behavior-equivalence test strategy**
  - **Decision**: Capture a baseline pre-change by running the existing widget e2e walks against `main`; record the assistant text and final database state for each fixture. Run the same walks against the change branch and diff. Reuse the existing `tests/e2e/fixtures.ts`.
  - **Rationale**: Behavioral equivalence is the dominant risk in this feature. Diffing real walk outputs is the cheapest way to make SC-003 falsifiable.

- **R7: Concurrent double-send test**
  - **Decision**: Add a Vitest integration test that fires two `POST /api/chat` calls for the same session with `Promise.all`, then asserts the final `sessions.messages_json` contains all four expected messages and `leads` reflects the later turn. Run against in-memory SQLite.
  - **Rationale**: SC-005 must be falsifiable in CI, not only by reasoning.

## Phase 1 — Design

### Data Model

See [data-model.md](./data-model.md). No DB schema changes. New in-memory entities only:

| Entity | Shape | Lifetime | Invalidation |
|--------|-------|----------|--------------|
| Cached static prompt prefix | `string`, keyed by `(accountId, configVersionId, isPreview)` | 60s TTL, bounded LRU 256 entries | On every `invalidateConfigCache(accountId)` call; on process restart |
| Deferred post-stream write batch | `Promise<void>` enqueued via `after()` | Per-request; resolves before function shutdown | N/A |

### Contracts

See `contracts/` — four short contract docs:

- `contracts/chat-route-flow.md` — Sequence diagram of the new chat-turn flow (auth → loads → lazy branch deps → stream → critical-path session write → `after()` defers leads chain).
- `contracts/system-prompt-cache.md` — API surface of `lib/system-prompt-cache.ts`: `getCachedStaticPrompt(args)`, `invalidateSystemPromptCache(accountId)`, `__resetForTests()`.
- `contracts/deferred-writes.md` — Defines `runAfterResponse(fn, onError)` helper, what falls inside it vs. outside, error-logging contract.
- `contracts/session-append.md` — New `appendMessagesAndSOPState(sessionId, history, newMessages, sopState)` signature; old signature deprecated for chat-route caller only; non-chat callers keep `appendMessages`.

### Quickstart

See [quickstart.md](./quickstart.md). Reproducible local validation: install deps → run dev DB → run `pnpm vitest run packages/api` → run the new concurrent-send integration test → run the surviving widget e2e walks → measure TTFB with a scripted SOP run.

### Agent Context Update

`CLAUDE.md` between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers is updated to point at `specs/021-chat-api-latency/plan.md`.

## Constitution Check (Post-Design Re-Evaluation)

Re-checked after authoring contracts and data model. Result: **PASS** — no design choices introduced a new violation. The `runAfterResponse` helper is the only new abstraction; it is a thin wrapper around `after()` from `next/server` (≤20 lines), tested in isolation, and does not introduce any new dependency.

Specifically re-confirmed:

- **§7.2 maxSteps** unchanged at 5.
- **§7.7 token budget** strictly improved (one dynamic prompt block removed; static prefix unchanged in content, just memoized).
- **§5.2 context-store cache TTL** ≤ 5 minutes — untouched (different cache).
- **§11.1 rate limits** untouched.
- **§11.7 structured logging** — the deferred-writes contract requires that every log event fired today continues to fire, just possibly after response close. No event is lost or silenced.

Cleared to proceed to `/speckit-tasks`.
