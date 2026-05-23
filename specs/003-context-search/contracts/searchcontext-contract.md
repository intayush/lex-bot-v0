# Contract: `searchContext` Function

**Owner**: Context Search (`003-context-search`)
**Consumers**: Chat API + Agent (`004-chat-api-agent`), Dashboard (`007-dashboard` for §8.9 "Test context retrieval"), CLI harness (`packages/api/scripts/test-search.ts`)
**Source of Truth**: §7.3, §7.6, §7.7, §7.11, §12.7.

## Function Surface

```ts
// packages/api/src/lib/context-search.ts

export async function searchContext(
  contextStoreUrl: string,
  query: string,
  sectionTypes?: string[]
): Promise<SearchResult[]>;

export type SearchResult = {
  file: ManifestFile;        // shape from packages/shared/src/schemas/manifest.ts
  score: number;             // ∈ [0, 1], rounded to 6 decimals
  content: string;           // markdown body, may be truncated to fit budget
};
```

## Parameters

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `contextStoreUrl` | string (URL) | yes | The lawyer's HTTPS context-store base URL (e.g., `https://example-lawfirm.com/chatbot-context/`) — comes from `api_keys.context_store_url` in production, from the dev seed locally |
| `query` | string | yes | Free-text query; agent-supplied (may be the user's literal message or an agent-reformulation) |
| `sectionTypes` | string[] | no | Section-type filter (per §7.3). When set, matching candidates receive the full 1.0 section-type bonus (§7.6) |

## Return Value

An array of `SearchResult` objects, ordered by `score` descending,
length 0–5. Empty array (`[]`) is the binding signal for "no
relevant context" and triggers the §7.11 fallback in Phase 3.

## Behavior Summary

1. **Pass 1 (manifest scan)** — Fetch (or cache-hit) the manifest;
   tokenize the query; score every file via the §7.6 weighted
   formula; filter by threshold 0.15; sort desc; slice top 5.
2. **Pass 2 (content retrieval)** — For each scored file, fetch
   (or cache-hit) the markdown body; assemble; enforce budget
   (≤ 3500 tokens combined).
3. Return the assembled results.

## Failure Modes

| Failure | Behavior |
|---|---|
| Manifest fetch network error / timeout | Return `[]`; emit `error` log event with `context_store_url` and error type |
| Manifest fetch HTTP non-2xx | Return `[]`; emit `error` log event |
| Manifest schema validation fails (Zod) | Return `[]`; emit `error` log event with Zod issues |
| Per-file fetch failure (one of many) | Skip that file; continue with next candidate |
| All candidates' files fail to fetch | Return `[]` |
| `query` empty or all-stopwords | Return `[]` (no tokens to match) |
| `contextStoreUrl` invalid URL | Throw immediately (programmer error, not a runtime condition) |

## Determinism

- Identical inputs (manifest content + query + sectionTypes) yield
  identical outputs. The score computation is deterministic; sort
  is stable; truncation cuts at consistent boundaries.
- Cache hits MUST yield identical behavior to cache misses (the
  cache is purely a latency optimization).

## Performance

- Pass 1 reads zero markdown files (FR-018, SC-012).
- Pass 2 reads ≤ 5 markdown files (FR-007, SC-008).
- Cache-warm queries: 0 network round-trips beyond the model call.

## Logging (per Foundation log-event contract)

The function emits these structured-log events via the Foundation
logger:

- `context_search_started` — `{ query_length, sectionTypes }`.
- `manifest_cache_hit` / `manifest_cache_miss` — `{ context_store_url }`.
- `file_cache_hit` / `file_cache_miss` — `{ context_store_url, path }`.
- `context_retrieved` — `{ files: string[], scores: number[], tokens_assembled }` (per §11.7).
- `manifest_validation_failed` — error event with Zod issues.
- `context_store_unreachable` — error event with status / error.

All events redact secret-bearing payload fields per the Foundation
log-event contract. The `query` text is **not** logged at top
level (treated as potentially sensitive); only `query_length` is.
