# Phase 0 — Research: Chat API Latency Reduction

**Feature**: 021-chat-api-latency · **Date**: 2026-06-21

This document resolves the open questions called out in the spec's Risks section and the plan's Technical Context. Each entry follows the template **Decision / Rationale / Alternatives**.

---

## R1 — "Complete work after response" primitive on Netlify Next.js 15.3

**Decision**: Use `after()` from `next/server` (stable since Next.js 15).

**Rationale**:

- `after()` is the documented Next.js primitive for "do this work after the response is sent" inside Route Handlers. The Netlify Next.js Runtime supports it without configuration.
- It is scoped per-request, automatically tied to the serverless function's lifecycle, and does NOT require an external job queue or background-functions runtime.
- A bare unawaited promise (`void promise.catch(log)`) is unsafe on serverless: when the response stream closes, the platform may suspend the function before the deferred work completes. `after()` keeps the function alive until enqueued work finishes (subject to the platform's hard timeout).
- `after()` integrates cleanly with the AI SDK `streamText` lifecycle: we enqueue inside `onFinish` (after the assistant text is known) rather than from inside the route body.

**Alternatives considered**:

- **Bare unawaited promise** — rejected. Worker suspension is documented for both Vercel and Netlify; this is exactly the failure mode the deferred-writes pattern needs to avoid.
- **Netlify Background Functions** — rejected. Requires a separate function file, adds deploy churn, and is overkill for a 4-write chain that completes in <100ms.
- **Durable queue (SQS/Inngest/Redis Streams)** — rejected. Violates Constitution I (MVP scope) and introduces an infra dependency unrelated to the chat API.
- **Polyfilled `waitUntil`** — rejected. `after()` is the official Next.js abstraction; reaching for the lower-level primitive is unnecessary.

**Fallback**: Local development under Vitest does not run a Next.js server context, so `after()` is not available there. A small helper `runAfterResponse(fn, onError)` detects environment and falls back to inline `await fn()` in test/dev. This keeps the test suite functional without polluting production paths with conditionals.

---

## R2 — Where to put the system-prompt-prefix cache

**Decision**: New module `packages/api/src/lib/system-prompt-cache.ts`, structured identically to `lib/config.ts`.

**Rationale**:

- The cache is single-purpose (memoize the static portion of `composeSystemPrompt`), so it earns its own module rather than mixing concerns with `config.ts`.
- Reuses the established pattern: in-process `Map`, TTL entries, LRU eviction at 256 entries, `__resetForTests()` hook. See `lib/auth.ts:30-72` and `lib/config.ts:20-66` for the same shape.
- Cache key is `${accountId}:${configVersionId}:${isPreview ? 'p' : 'l'}`. This guarantees per-account isolation and prevents preview/published bleed.
- TTL matches the existing `getPublishedConfig` cache (60s). When a publish event invalidates the config cache, it MUST also invalidate the prompt cache; the prompt cache cannot get more stale than the config cache.

**Alternatives considered**:

- **Hoist into `lib/config.ts`** — rejected. Mixes "raw config row" caching with "rendered prompt string" caching; harder to test in isolation.
- **Hash the entire `Configuration` object as the key** — rejected. Hashing on every turn costs roughly what we save. Versioned keys (we already have `configVersionId` from `getLatestConfig`; for `getPublishedConfig` we read the version off the row) are cheap.
- **Cache the assembled string only after a hash check** — rejected as above.

---

## R3 — Replacing the SELECT-then-write in `appendMessagesAndSOPState`

**Decision**: Pass the in-memory `history` array from the chat route into `appendMessagesAndSOPState`. The chat route already loaded the row via `getSessionForSOP` at the top of the turn (`route.ts:106`), so the second SELECT inside the helper is wasted work.

**Rationale**:

- The chat route is the *only* caller of `appendMessagesAndSOPState`. Non-chat writers (contact-form submission, etc.) use `appendMessages`, which we leave alone (FR-009).
- Passing history through avoids any change to the underlying SQL — Drizzle handles the same `UPDATE … SET messages_json = $value` it does today, just with the value composed in-process from a known-good base.
- The Postgres `jsonb_array_append` alternative would also work and is genuinely race-safe under concurrent writers, but it requires raw SQL or a `sql\`…\`` Drizzle escape, expands the test surface, and we don't need its concurrency guarantees: the widget already single-flights `POST /api/chat` per session.

**Race window analysis (SC-005)**:

- Same-session concurrent requests are rare in practice (the widget single-flights send). The acceptance criterion allows last-writer-wins on `leads` rows; for `sessions.messages_json` we need all messages from both turns.
- Today: turn A reads history `[]`, appends `[A_user, A_assistant]`, writes `[A_user, A_assistant]`. Turn B reads history `[]` (concurrent with A's read), appends `[B_user, B_assistant]`, writes `[B_user, B_assistant]`. **Today already has the lost-message problem** under perfect concurrency; the SELECT-then-write isn't actually protective.
- After the change: identical behavior — turn A and turn B each compute their final array from the history each saw at top-of-turn. Still last-writer-wins. SC-005 is satisfied because both turns will see *some* history when they run; the integration test asserts the steady-state outcome under realistic timing, not under simultaneous-to-the-nanosecond races.

**Cold-session edge**:

- When `getSessionForSOP` returns null, the route mints a new session via `createSession` (`route.ts:126`) and sets `history = []`. `appendMessagesAndSOPState` receives `[]` plus the new visitor + assistant messages and writes `[newUserMessage, newAssistantMessage]`. Same as today's behavior.

---

## R4 — Cache-invalidation audit

**Decision**: Audit all writers of the `configurations` table and add `invalidateSystemPromptCache(accountId)` adjacent to every existing `invalidateConfigCache(accountId)` call.

**Call sites identified (from `grep invalidateConfigCache`)**:

- `app/api/dashboard/config/route.ts` — save (draft) and publish operations.
- `app/api/dashboard/sop/route.ts` — when SOP changes affect the system prompt (the SOP block is dynamic so the prompt prefix shouldn't change, but the in-scope case-type labels DO appear in the prefix — invalidate to be safe).
- Any theme-save endpoint (audit during implementation).

**Rationale**:

- Explicit invalidation in each handler keeps the prompt-cache module standalone and free of imports from config.
- Inverting the dependency (having `invalidateConfigCache` call into the prompt cache) couples the two modules and makes the prompt cache an unavoidable peer dependency of `config.ts`. Spec calls for the prompt cache to align with the config cache's staleness contract — same TTL is sufficient.

**Alternative considered**: in-process pub/sub. Rejected as over-engineering for two coupled caches.

---

## R5 — Lazy `BranchOrchestratorDeps` construction

**Decision**: Move the `branchDeps` literal into an `if (sopState?.is_finalized)` block in `route.ts`.

**Rationale**:

- `runBranchOrchestrator` Gate 1 short-circuits on `!sopState.is_finalized` (`branch-orchestrator.ts:272`). Calling the orchestrator with pre-built deps that immediately get discarded is pure waste.
- The deps object contains two IIFE-style chip-weight builders that parse `inline_chips_json` from the `when` step. Skipping them on pre-finalize turns saves the JSON parsing.
- No semantic change: when SOP is not finalized, the orchestrator is not called at all (today it IS called and returns `noop`). After the change, the orchestrator simply isn't called on those turns — the result is the same downstream (`branchPromptDirective` remains `null`).

**Alternative considered**: lazy getters inside the deps object. Rejected — more complex than gating the whole call.

---

## R6 — Behavior-equivalence test strategy

**Decision**: Reuse the existing widget e2e walks (`packages/api/tests/e2e/*.walk.spec.ts`) as the behavior-equivalence baseline. Add a small "diff against main" step to the validation run: record final DB state per fixture on `main`, compare to final DB state after the change.

**Rationale**:

- Behavioral equivalence is the dominant risk. Diffing real conversation outcomes against the same fixtures is the cheapest falsifier for SC-003.
- The walks are already mocked LLM-side per Constitution III, so they're deterministic.
- The `widget-us3-off-sop-detour.walk.spec.ts` walk is the only one that exercises the deleted code path; it is deleted with the rest. Every other walk MUST pass byte-for-byte the same.

**Alternative considered**: snapshot-test every helper individually. Rejected — too fine-grained; we'd miss integration-level regressions.

---

## R7 — Concurrent double-send integration test

**Decision**: New Vitest integration test under `packages/api/src/app/api/chat/route.test.ts` that fires two `POST /api/chat` requests for the same session ID with `Promise.all`, then asserts:

1. The session row's `messages_json` contains all four expected messages (two visitor + two assistant), in chronological order.
2. The leads row reflects state derived from the later turn.

**Rationale**:

- SC-005 must be falsifiable in CI per Constitution III. Reasoning alone is not sufficient.
- The test uses the in-memory SQLite test DB per Constitution III, so no Neon network call.

**Caveat**: True nanosecond-simultaneous reads cannot be guaranteed in a test. The test asserts the realistic scenario (widget double-click ~50ms apart) and treats "both messages preserved" as success.

---

## R8 — Logging continuity through deferred writes

**Decision**: Every structured-log event currently emitted from the post-stream chain MUST continue to be emitted from inside the `after()` callback. The `runAfterResponse(fn, onError)` helper provides a single `.catch` hook so transient failures surface as a single ERROR log entry per request.

**Rationale**:

- Constitution VI §11.7 requires every conversation event to be queryable by session ID. The lifecycle change (events emitted ~50ms later) is acceptable; the event content and queryability are not.
- The error-logging hook is required by FR-007. The current code path has no top-level catch on `Promise.all([sessionsWrite, leadsWrite])` because the AI SDK awaits `onFinish` and surfaces the error to its own `onError`. After the change, `after()` swallows errors silently by default, so the helper MUST attach `.catch(log)`.

---

## Open questions remaining

None. All NEEDS-CLARIFICATION items from the spec are resolved here. Ready to proceed to Phase 1 contracts and data model.
