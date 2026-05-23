# Phase 0 Research: Context Search

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the Context
Search feature against `product-spec-legal-chatbot.md` (§5.2,
§5.5–5.8, §7.1–7.3, §7.6, §7.7, §7.11, §12.7) and the Lex Bot
Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers in the Technical Context;
items below are best-practices investigations and the plan for
gap-fills against the existing 166-line implementation.

## R1. In-Memory Cache (Manifest + Recently-Fetched Files)

**Decision**: Implement a small `Cache<K, V>` class in
`packages/api/src/lib/context-search/cache.ts` that stores values
keyed by string with a per-entry TTL of 5 minutes (configurable).
Two singleton cache instances are exported: one keyed by
`contextStoreUrl` for manifests, one keyed by
`(contextStoreUrl, path)` for markdown files. The cache uses a
`Map<string, { value: V; expiresAt: number }>` internally; reads
check `expiresAt` against `Date.now()` and treat expired entries
as misses.

**Rationale**:
- §5.2 binds "TTL: 5 minutes" explicitly. FR-020 / FR-021.
- Per-account stores have ~100 manifest entries (~30 KB) and
  ~12 KB markdown files (§5.7 cap); module-local cache fits
  comfortably in serverless function memory.
- A `Map`-based cache is the simplest correct implementation; no
  external dependency.
- Lazy expiry (on read) is simpler than scheduled eviction and
  matches §5.2's "TTL" semantics — entries are not actively purged
  but are treated as missing once stale.

**Alternatives considered**:
- LRU cache library (`lru-cache`): unnecessary; we have no size
  budget pressure, and TTL is the only eviction criterion.
- External cache (Redis, Memcached): rejected. §11.1 mandates
  "no external dependency for MVP" for rate-limiting; the same
  spirit applies here. §5.2 explicitly says "in memory."
- Per-request cache: defeats the purpose. The cache must persist
  across requests within a function instance to amortize the
  fetch cost.

**Implementation notes**:
- `cache.get(key)`: returns `value` if not expired; otherwise
  returns `undefined` (not the stale value).
- `cache.set(key, value, ttlMs?)`: stores with default 5-minute TTL.
- `cache.invalidate(key)`: removes a key — used by the §8.9 "Test
  context retrieval" action in Phase 6.
- The cache is a process-local singleton; on Netlify Functions cold
  starts begin with empty caches (acceptable per §5.2).
- Cache instance is created at module load (no lazy init); its
  lifecycle is the function instance's lifecycle.

## R2. Zod Validation on Manifest Reads

**Decision**: Wrap the existing `fetchManifest` call in a Zod
`.parse()` against the schema in
`packages/shared/src/schemas/manifest.ts`. Validation failure
throws a typed `ManifestValidationError` containing the Zod issues
and the offending URL. The orchestrator (`searchContext`) catches
this error and returns an empty result (so the agent issues the
§7.11 fallback) while emitting an error log via the Foundation
logger.

**Rationale**:
- Constitution Principle II demands Zod validation at every
  cross-boundary. The HTTPS fetch from the lawyer's context store
  is a cross-boundary.
- Currently `fetchManifest` returns `response.json() as Promise<Manifest>`
  — a TypeScript cast, no runtime validation. A malformed manifest
  (e.g., a stale `version: 0` or a missing `files` field) would
  silently corrupt scoring.
- §7.11 says the chatbot "never fabricates information. If it's not
  in the context store, it acknowledges the gap." Treating a
  validation failure as "context unavailable" is consistent with
  that posture: better an honest "I don't have specific information"
  than a confident wrong answer.

**Alternatives considered**:
- Throw the error to the agent runtime (Phase 3) and let the agent
  decide: rejected. §7.11 binds the response wording, so the
  empty-result-then-fallback pattern is the deterministic path.
- Soft-validate (warn but continue): rejected. The downstream
  scoring assumes shape; partial-shape data produces weird scores.

**Implementation notes**:
- The error path is logged as an `error` event with payload:
  `{ event: 'manifest_validation_failed', context_store_url, zod_issues }`.
- Phase 6's "Test context retrieval" action (§8.9) will surface
  this error to the lawyer so they can fix their manifest.

## R3. Reachability Error Handling

**Decision**: Wrap the manifest fetch and per-file fetches in
try/catch. On network errors (DNS, connection refused, timeout)
and non-2xx HTTP responses, return an empty array from
`searchContext` rather than throwing. Log an `error` event with
context (`context_store_url`, status code or error name).

**Rationale**:
- §5.2 does not enumerate the error path; the spec's Assumption
  ("returning an empty result so the agent issues the §7.11
  fallback") is the safer default.
- §7.11's "no relevant context files found" wording is the
  user-facing copy for the empty-result case — the agent issuing
  it when the network is down (rather than producing a 500) is the
  better visitor experience.
- Constitution Principle V: never fabricate. Empty result is the
  honest response when context is unreachable.

**Alternatives considered**:
- Throw to the agent runtime: rejected for the reason above.
- Stale-while-revalidate (return last known good): post-MVP. The
  spec is silent and the cache TTL provides a similar effect for
  recent queries.

**Implementation notes**:
- HTTP timeout: 5 seconds (Assumption already captured in spec).
  Implemented via `AbortController` + `setTimeout`.
- Per-file fetch failures (e.g., manifest entry references a path
  that 404s) skip that file and continue with the next candidate
  (FR — implicit; spec edge case "Manifest entry whose markdown
  file is missing").

## R4. Per-Priority Token Budget

**Decision**: Replace the current single `MAX_CONTEXT_TOKENS = 4500`
combined budget with a structured per-priority budget that mirrors
§7.7's table:

```ts
const TOKEN_BUDGET = {
  guardrails:  1000,   // never truncated; allocated by Phase 3 orchestrator
  pageContent: 3000,   // owned by Context Search
  supplementary: 500,  // owned by Context Search
};
const TOTAL_CAP = 4500;
```

Context Search owns the `pageContent` and `supplementary` slots
(combined 3500 tokens). The `guardrails` slot (1000) is reserved
by Phase 3 (Chat API + Agent) when composing the system prompt;
Context Search returns content up to 3500 tokens and the agent
adds the guardrails on top.

**Rationale**:
- §7.7 explicitly gives the three-tier budget and the "Total context
  injection cap: ~4500 tokens" total. The guardrails slot is
  Phase 3's responsibility (system-prompt composition); FR-024
  states the combined cap.
- Returning 3500 tokens of page content from this module gives
  Phase 3 a clean budget surface to compose against — no double
  accounting.
- The "supplementary" tier (500 tokens) is for related-page
  content "if room"; in MVP this can be left unused (FR-023 says
  "approximately 500 tokens for supplementary related pages 'if
  room'" — the "if room" qualifier makes it optional).

**Alternatives considered**:
- Keep the single 4500-token combined budget and let Phase 3 deal
  with sub-allocation: rejected because Phase 3 will then need to
  re-truncate Context Search's output, defeating
  FR-008 ("Files are ordered by score (highest first) so that if
  token budget forces truncation, the most relevant content is
  preserved" — truncation must happen at the lowest-priority end).

**Implementation notes**:
- `budget.ts` exposes `enforce(files: SearchResult[], budget: number): SearchResult[]`
  that walks the ordered file list, accumulates an estimated
  token count, and stops when adding the next file would exceed
  `budget`. The last file may be truncated (per §7.7 "lower-ranked
  files are truncated or excluded") if it pushes over the limit
  — implementation choice: truncate at the last whole paragraph
  before the cap.
- Token counting: use the simple `chars / 4` heuristic that the
  current code already uses (Assumption in spec). Future Phase 7
  may swap in the Gemini tokenizer if `@ai-sdk/google` exposes one.

## R5. Standalone Test Harness (`scripts/test-search.ts`)

**Decision**: Add `packages/api/scripts/test-search.ts` that takes a
query as `process.argv[2]`, calls `searchContext(devContextStoreUrl, query)`,
prints each result's `path`, `score`, and a content preview to
stdout. The dev `context_store_url` comes from the seed
(`http://localhost:5173/chatbot-context/` per §12.3) but can be
overridden by `CONTEXT_STORE_URL`.

**Rationale**:
- §12.7 deliverable explicitly: `npx tsx scripts/test-search.ts "I was in a car accident"`.
- FR-031, FR-032 bind the standalone-invocation surface and the
  score-visibility requirement.
- The harness is the manual verification mechanism for the §12.7
  done-when checklist (queries → expected files).

**Alternatives considered**:
- A repo-root `scripts/` directory: rejected. Per the workspace
  convention, package-specific scripts live under
  `packages/<pkg>/scripts/`.
- A Vitest-only verification (no separate harness): rejected. The
  spec explicitly delivers a script.

**Implementation notes**:
- The script reads a `--context-store-url` flag or
  `CONTEXT_STORE_URL` env to override the default.
- It prints results in a human-readable table:
  ```
  Score   Path                                        Title
  0.72    pages/practice-areas--personal-injury.md    Personal Injury Practice
  0.43    pages/contact.md                            Contact
  ```
- Exit codes: 0 success, 1 on no-results (so CI can verify the
  "tax law" query returns empty deterministically).

## R6. Cache TTL Refresh & Invalidation Surface

**Decision**: Lazy refresh on read. When a cached entry's
`expiresAt` is in the past, the read returns `undefined` (cache miss)
and the fetcher re-fetches and re-caches. No background refresh.
The cache exposes `invalidate(key)` for explicit invalidation —
used by Phase 6's "Test context retrieval" action (§8.9) to force a
fresh fetch when the lawyer wants to test a recent crawl.

**Rationale**:
- §5.2 specifies the TTL but not the refresh strategy. Lazy
  refresh is the simplest correct implementation and matches the
  "TTL" mental model.
- An explicit `invalidate` surface is needed by Phase 6 (per §8.9
  "Test context retrieval"); pre-allocating it now avoids a
  later round-trip.
- Background refresh would add complexity (timers across function
  invocations on Netlify), with no spec mandate.

**Alternatives considered**:
- Stale-while-revalidate: post-MVP.
- Aggressive eviction (timer-driven): rejected. Adds complexity,
  no spec mandate.

**Implementation notes**:
- `invalidate` is a public method on the cache; the
  `manifestCache` and `fileCache` singletons both expose it.
- A future "purge all" surface (e.g., for testing) returns to a
  fresh state by calling `invalidate` on every key — implemented
  as `cache.clear()`.

## R7. Module Placement: `packages/api` vs. New Package

**Decision**: Keep Context Search inside `packages/api` (already
the case). Do not create a new `packages/search` workspace package.

**Rationale**:
- Constitution Required Stack lists exactly five packages (widget,
  api, dashboard, crawler, shared). Adding a sixth requires
  Constitution amendment.
- The agent runtime in `004-chat-api-agent` will register
  `searchContext` as a tool; the tool's implementation and the
  agent both live in `packages/api`. Keeping them co-located
  simplifies the import graph.
- The standalone test harness (`scripts/test-search.ts`) sits
  under `packages/api/scripts/`, also co-located.

**Alternatives considered**:
- New `packages/search`: rejected per Constitution.
- Move into `packages/shared`: rejected. `shared` is for types
  and pure utilities used across packages; HTTP-fetching code
  doesn't belong there.

## R8. Section-Type Bonus Mapping

**Decision**: Keep the existing hardcoded mapping in
`packages/api/src/lib/context-search.ts` (lines 67–75 in current
implementation). The mapping is:

```ts
{
  'practice-area': ['injury', 'law', 'divorce', 'custody', 'estate', 'accident', 'case'],
  'attorney-bio': ['attorney', 'lawyer', 'partner', 'associate'],
  'faq':          ['question', 'how', 'what', 'cost', 'fee', 'long', 'much'],
  'contact':      ['call', 'phone', 'email', 'address', 'hours', 'location'],
  'about':        ['firm', 'history', 'team', 'experience', 'about'],
}
```

The spec's Assumption section permits "a small, deterministic
mapping ... is acceptable, provided it is documented and testable."
This mapping is already documented (in code) and tested (existing
test file).

**Rationale**:
- §7.6 gives one example ("query mentions an attorney name → bonus")
  but does not enumerate all triggers.
- The current mapping is conservative and predictable.
- Tuning is post-implementation; conversation-quality eval scripts
  (Phase 8) will surface any miscalibration.

**Alternatives considered**:
- Move the mapping to a config file: rejected. No Phase-2 spec
  mandate for runtime config of this internal heuristic.
- LLM-based section-type inference: rejected. Defeats the
  deterministic-scoring contract of §7.6.

**Implementation notes**:
- Move into `scoring.ts` as a `const SECTION_KEYWORDS` export.
- Test that each `(section_type, query_token)` pair from the
  mapping produces the expected 0.5 bonus, and that mismatches
  produce 0.0.

## R9. Read-Only Boundary Verification

**Decision**: No write paths exist in this module's code. Add a
test that asserts no `fetch()` call uses `method: 'POST'`,
`'PUT'`, `'DELETE'`, or `'PATCH'` in the implementation files.
This is a static guard against accidental future regressions.

**Rationale**:
- FR-030 binds read-only behavior. Constitution V binds the
  context store as the lawyer's data, never written by the API
  server.
- A grep-style test is simple insurance against drift; the cost
  is one test file.

**Alternatives considered**:
- Trust code review: insufficient given the spec's explicit
  Constitution-V coupling.
- Runtime instrumentation: overkill.

**Implementation notes**:
- Test reads `context-search/*.ts` files and asserts via regex
  that no non-GET fetch invocations appear. Works because the
  module doesn't use any other HTTP client.

## Constitution Cross-Reference Summary

| Constitution element | Context Search decision | Aligned |
|---|---|---|
| I (MVP-First) | Every research item cites §5.2 / §5.5–8 / §7.x / §12.7 | ✅ |
| II (Type Safety) | Manifest Zod-validated on read (R2); shared schemas reused | ✅ |
| III (TDD layered) | Existing 502-line test file extended; new modules test-first (R1, R3, R4, R6) | ✅ |
| IV (Serverless / Stateless) | Process-local cache only (R1); cold start is a cache miss; no fs writes; no native deps | ✅ |
| V (Privilege & Privacy) | Read-only (R9); reachability errors yield empty + log, not throw (R3); never fabricates | ✅ |
| VI (Observable Agent) | Foundation logger emits `context_retrieved` events with files, scores, tokens (R-spec); error events on validation/reachability failure | ✅ |
| VII (Phased Delivery) | Phase 2; consumes Crawler output via shared Zod; produces input for Phase 3 | ✅ |
| Required Stack | No new dependencies introduced; `zod` and Node `fetch` only | ✅ |
| Architectural Limits | 4500-token cap enforced (R4); 5-min cache TTL (R1) | ✅ |

## Open Questions — None

All research decisions resolve cleanly against the source spec and
the constitution. No `NEEDS CLARIFICATION` markers remain. Ready to
proceed to Phase 1.
