# Implementation Plan: Context Search

**Branch**: `003-context-search` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-context-search/spec.md`

## Summary

Context Search is a deterministic retrieval module that, given a
natural-language query, returns the most relevant page content from
the context store produced by `002-crawler-cli`. Per §7.3 it is the
agent's first tool; per §7.6 retrieval is two-pass (manifest scan →
content fetch); per §7.7 the assembled output is bounded at ~4500
tokens; per §5.2 manifest and recently-fetched files are cached
in-memory with a 5-minute TTL.

This is **Phase 2** per §12.5. It depends on the Crawler's
`_manifest.json` and frontmatter shapes (consumed via Zod schemas
in `packages/shared`). Its `searchContext` function is the
implementation that `004-chat-api-agent` will register as the
agent's `searchContext` tool.

A working implementation already exists at
`packages/api/src/lib/context-search.ts` (166 lines) with the
weighted scoring formula, threshold filter, top-N selection, and a
character-budget approximation. There is also a substantial unit
test file (502 lines). This plan targets the **gaps** between that
implementation and the 32 FRs in the spec:

- **R1** — Self-managed in-memory cache (manifest + recently fetched files) with 5-minute TTL (FR-020 to FR-022). Currently `manifestCache` is a caller-supplied parameter; should be a module-level cache.
- **R2** — Zod validation on manifest reads (Constitution Principle II, FR-017). Currently the manifest is cast directly without validation.
- **R3** — Reachability error handling: return empty + log on context-store unreachable (Assumption recorded in spec.md). Currently throws to caller, which can produce unhelpful 500s rather than the §7.11 fallback.
- **R4** — Token-budget enforcement that respects §7.7's per-priority allocation (~3000 tokens for top matches, ~500 for supplementary). Current implementation uses a single combined budget which is correct in aggregate (~4500) but not in shape (FR-023, FR-024).
- **R5** — Standalone test harness `scripts/test-search.ts` per §12.7 deliverable (FR-031, FR-032).
- **R6** — Cache-eviction and TTL refresh semantics (lazy-on-read) plus a small public surface to invalidate (used by Phase 6 dashboard's "Test context retrieval" action — but Phase 6 will adapt; only document the surface here).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation
constraint). Module is ESM, executed inside the Next.js API package
(`packages/api`).

**Primary Dependencies** (already in `packages/api/package.json`):

- `@legal-chatbot/shared` — Zod schemas (`manifest.ts`,
  `frontmatter.ts`).
- `zod` — runtime validation (Constitution II).
- Node 20 `fetch` — HTTPS GETs against the lawyer's context store
  (no extra HTTP client dep).

No additional dependencies required by this feature.

**Storage**: None. Context Search is a stateless reader from the
perspective of any persistent store; its only "state" is the
in-memory cache keyed by `(contextStoreUrl, path)`. The cache is
process-local; on Netlify Functions each invocation begins with an
empty cache and warms it within a few seconds for hot paths
(acceptable per §5.2 "TTL: 5 minutes" — the cache is a latency
optimization, not a correctness requirement).

**Testing**: Vitest. The existing 502-line test file
(`packages/api/src/lib/context-search.test.ts`) covers tokenization,
Jaccard similarity, scoring formula correctness, threshold
filtering, top-N selection, section-type bonus rules, filename
matching, and the §12.7 done-when query expectations ("personal
injury" → PI; "John Smith" → bio; "divorce" → family-law; "tax law"
→ empty). Gap-fill tests will cover: in-memory cache hit/miss,
TTL expiry, manifest validation failure path, context-store
reachability error path.

**Target Platform**: Netlify Functions (serverless) under §9.7.
Cache is process-local; cold starts re-fetch the manifest. This is
acceptable per §5.2's latency consideration which assumes warm
caches reduce per-message round-trips, not eliminate them.

**Project Type**: TypeScript library inside `packages/api`. Not its
own package: per the workspace layout in §9.6, the API package owns
this module because the agent runtime (Phase 3) will register it
as a tool. (An alternative would be a separate `packages/search`
package; rejected — see research R7.)

**Performance Goals**:
- Pass 1 (manifest scan + scoring) MUST run with **zero file reads**
  (§7.6 binding; FR-006).
- Pass 2 fetches between 0 and 5 markdown files per query (FR-007,
  SC-008).
- Cache hit on `_manifest.json` MUST avoid the network round-trip
  (FR-022, SC-009).
- Total assembled context ≤ ~4500 tokens (§7.7, FR-026, SC-005).
- The standalone harness (FR-031) should return results in
  sub-second time against the seeded Shrager content.

**Constraints**:
- TS strict (Constitution II).
- Zod validation on all cross-boundary reads, including manifest
  fetches (Constitution II; FR-017).
- No fabrication: empty result on no-match is the binding behavior
  (FR-016, Constitution V).
- Read-only: MUST NEVER write to the context store (FR-030,
  Constitution V).
- Pass 1 reads only the manifest (FR-018; SC-012).
- Token budget cap is hard, not soft (FR-026; SC-005).
- Cache TTL = 5 minutes exactly (FR-020, FR-021; SC-009, SC-010).

**Scale/Scope**: Per-account context stores have ~100 pages each
(§12.4 Shrager seed = ~100 pages; spec assumes similar for typical
firms). Manifest entries with keyword arrays are ~300 bytes/entry,
so 100 entries × 300 bytes = ~30 KB manifest — trivial to cache.
Markdown files cap at ~2000 words ≈ 12 KB each (§5.7); top-5 = ~60
KB cached per query subject area.

## Constitution Check

| # | Principle | Context Search applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §5.2/§5.5/§7.x/§12.7. No scope creep beyond. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Manifest read path will Zod-validate; tool params will be Zod (Phase 3 boundary); shared types already in `packages/shared`. **Gap R2 explicit**. | ✅ PASS — pending R2 |
| III | Test-First, Layered Testing | Existing 502-line test file is comprehensive; gap-fill tests written before R1–R5 implementations. | ✅ PASS |
| IV | Serverless / Stateless Architecture | Module is process-local cache only — no fs writes; cache reset on cold start is acceptable per §5.2. No native binaries. | ✅ PASS |
| V | Privilege & Privacy | The lawyer's context store fetched over HTTPS contains only public website content (§5.2 security note); module is read-only. **Never fabricates** (FR-016) — empty-on-no-match is the binding behavior. | ✅ PASS |
| VI | Bounded, Observable Agent | Token budget enforcement is hard (§7.7, FR-026). Module emits structured-log events for `context_retrieved` (filenames, scores, token counts) per §11.7; standardized event names are reserved in `001-foundation`'s log-event contract. | ✅ PASS |
| VII | Phased Incremental Delivery | Phase 2 of §12.5; consumes Crawler output; produces input for Chat API. Schema reads (manifest, frontmatter) coordinated via shared Zod schemas. | ✅ PASS |

**Architectural Limits**:
- ~4500 token context budget (§7.7) — enforced by R4.
- 5-minute cache TTL (§5.2) — enforced by R1.

**Result**: All gates PASS. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/003-context-search/
├── plan.md
├── research.md
├── data-model.md           # Cache entry, scored-file, assembled-context
├── quickstart.md
├── contracts/
│   ├── searchcontext-contract.md   # Public function surface
│   ├── manifest-read-contract.md   # Zod-validated manifest read path
│   └── cache-contract.md           # In-memory cache semantics + TTL
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (`packages/api/src/lib/`)

```text
packages/api/src/lib/
├── context-search.ts                 # ⚠ EXTEND — orchestrator (existing 166 LOC)
│                                     #   Add: cache integration, Zod validation,
│                                     #        reachability error handling,
│                                     #        per-priority token budget
├── context-search.test.ts            # ⚠ EXTEND — gap-fill tests (existing 502 LOC)
├── context-search/                   # ❌ NEW — internal modules
│   ├── cache.ts                      # ❌ NEW — in-memory cache with TTL
│   ├── cache.test.ts                 # ❌ NEW
│   ├── manifest-fetcher.ts           # ❌ NEW — Zod-validated fetch + caching
│   ├── manifest-fetcher.test.ts      # ❌ NEW
│   ├── file-fetcher.ts               # ❌ NEW — content fetch + caching
│   ├── file-fetcher.test.ts          # ❌ NEW
│   ├── scoring.ts                    # ⚠ MOVE — extract from context-search.ts
│   ├── scoring.test.ts               # ⚠ MOVE — extract from context-search.test.ts
│   ├── tokenizer.ts                  # ⚠ MOVE — extract from context-search.ts
│   ├── tokenizer.test.ts             # ⚠ MOVE
│   ├── budget.ts                     # ❌ NEW — per-priority token budget enforcement
│   └── budget.test.ts                # ❌ NEW
└── ...                               # other lib/ files unchanged
```

`scripts/test-search.ts` at the **API package** root (not repo root):

```text
packages/api/scripts/
└── test-search.ts                    # ❌ NEW — standalone harness per §12.7
```

Invoked as: `pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "query"`
(matches §12.7 deliverable shape; the spec writes
`npx tsx scripts/test-search.ts "..."` which is functionally
equivalent inside the workspace).

### Shared Schemas (`packages/shared/src/schemas/`)

The existing `manifest.ts` and `frontmatter.ts` Zod schemas are
consumed unchanged. If the Crawler's R10 work adds an optional
`alternate_urls` frontmatter field, the manifest does not include
it — the field is per-page only — so no manifest-side change is
needed here.

**Structure Decision**: Refactor the existing
`packages/api/src/lib/context-search.ts` into a small `lib/context-search/`
sub-tree where each concern lives in its own file (cache, fetchers,
scoring, tokenizer, budget). The public entry point remains
`searchContext` exported from `lib/context-search.ts`. This keeps
the public surface stable while making the internals testable in
isolation. Existing tests are extended; new tests are written before
the new modules.

## Complexity Tracking

None. All seven Constitution principles pass.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/003-context-search/plan.md` | ✅ written |
| Research | `specs/003-context-search/research.md` | ✅ written (9 research items) |
| Data model | `specs/003-context-search/data-model.md` | ✅ written (inputs + 3 internal entities + state diagram + coordination) |
| Contracts | `specs/003-context-search/contracts/` | ✅ written (3 contracts: searchcontext, manifest-read, cache) |
| Quickstart | `specs/003-context-search/quickstart.md` | ✅ written |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; no scope creep | ✅ |
| II | Type Safety & Zod | `manifest-read-contract.md` mandates Zod parse on read; tool-param Zod owned by Phase 3 boundary | ✅ |
| III | TDD layered | Existing 502-line test file extended; `cache.test.ts`, `manifest-fetcher.test.ts`, `file-fetcher.test.ts`, `budget.test.ts` written before R1–R4 implementations | ✅ |
| IV | Serverless / Stateless | `cache-contract.md` makes process-local nature explicit; cold start = empty cache (acceptable) | ✅ |
| V | Privilege & Privacy | Read-only verified by R9 static guard; reachability errors yield empty + log (R3); never fabricates (FR-016) | ✅ |
| VI | Observable Agent | `searchcontext-contract.md` enumerates structured-log events and explicitly excludes the raw `query` text from logs | ✅ |
| VII | Phased Delivery | Schema reads coordinated via shared Zod schemas; Phase 6 invalidate surface pre-allocated | ✅ |

**Architectural Limits**: ~4500 token cap (R4); 5-min cache TTL (R1).

**Result**: All gates PASS post-design. No Complexity Tracking
entries required.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 4 user stories in `spec.md` (P1 + P2 + P1 + P2).
- 32 FRs in 10 groups.
- 9 research items in `research.md` (R1–R9).
- 3 contracts.

Task graph is highly parallelizable: `cache.ts`, `manifest-fetcher.ts`,
`file-fetcher.ts`, `budget.ts` are independent modules with their
own contracts and tests. Convergence point is the
`searchContext` orchestrator in `lib/context-search.ts` plus the
standalone harness `scripts/test-search.ts`.
