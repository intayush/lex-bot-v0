# Contract: FAQ Semantic Cache (MAY-level)

**Owner**: Hardening (`008-hardening`)
**Source of Truth**: §11.6.

This contract defines the **operator-opt-in** FAQ semantic
cache. It is deployed only when
`apiEnv.FAQ_CACHE_ENABLED=true`.

## Module Surface

```ts
// packages/api/src/lib/faq-cache.ts

export async function getCachedResponse(
  accountId: string,
  query: string,
  contextStoreUrl: string,
): Promise<string | null>;

export async function cacheResponse(
  accountId: string,
  query: string,
  response: string,
): Promise<void>;
```

## getCachedResponse

1. Compute embedding for `query` via `@ai-sdk/google`'s
   embedding endpoint.
2. SELECT `faq_cache` rows for `accountId` WHERE
   `expires_at > now() AND invalidated_at IS NULL`.
3. For each row: parse `query_embedding` from JSON;
   compute cosine similarity with the query embedding.
4. If max similarity ≥ 0.92:
   - UPDATE the matched row's `hit_count++` and
     `last_hit_at = now()`.
   - Return the matched row's `response_text`.
5. Else: return `null` (cache miss).
6. Lazy invalidation: BEFORE step 2, fetch the account's
   `_manifest.json` `generated_at` (from the same context
   store cache as Phase 2). For any cache row where
   `created_at < manifest.generated_at`, set
   `invalidated_at = now()`. (One UPDATE per stale-row scan.)

## cacheResponse

1. Compute embedding for `query`.
2. INSERT a new `faq_cache` row with
   `expires_at = now() + 7d`, `query_embedding =
   JSON.stringify(embedding)`, `query_text = query`,
   `response_text = response`.

## Threshold Tuning

Initial threshold: 0.92 (high precision).

The threshold is a constant for MVP; tuning happens via
conversation-quality eval scripts (Phase 8). A future
admin-facing config column on `accounts` could expose it
post-MVP.

## Cost Modeling

Each cache check incurs ONE embedding call (cheaper than a
full LLM turn but not free). For FAQ-heavy workloads, the
hit rate must be > the cost ratio for the cache to be
net-negative. R7 estimate (per §11.6): "30-50% reduction in
LLM calls for firms with predictable intake questions."

## Integration Point

The Phase 3 chat-API route handler calls
`getCachedResponse(accountId, latestUserMessage, contextStoreUrl)`
BEFORE the LLM call. On hit, the route returns the cached
response immediately (no streaming, but with the same shape
the widget expects). On miss, proceeds with the normal LLM
call; on `onFinish`, calls `cacheResponse`.

The integration is gated on `apiEnv.FAQ_CACHE_ENABLED=true`.

## Schema Compatibility

The `query_embedding` column stores JSON-serialized
Float32Array. PostgreSQL's `pgvector` extension is NOT used
for MVP — keeping the table portable to SQLite for tests.

For production performance at scale, post-MVP migration to
pgvector (with a `<->` cosine-distance index) is the natural
upgrade path.

## Tests

- Cache miss: returns null; new row inserted on `cacheResponse`.
- Cache hit: returns cached text; `hit_count` incremented.
- Expired row: not returned.
- Invalidated row: not returned.
- Manifest-newer invalidation: stale rows marked
  `invalidated_at`.
- Threshold edge: similarity = 0.92 → hit; 0.91 → miss.

## Constitution Compliance

- Constitution I (MVP-First): MAY-level; opt-in via env.
- Constitution II: Zod-typed input.
- Constitution IV: serverless-compatible (no fs writes).
- Constitution V: cached responses contain LLM outputs only;
  no PII in `query_text` (the user's message is logged at
  cache-write time — already covered by Foundation logger
  redaction for the wider system, but the cache row itself
  stores `query_text` in plaintext for debugging; this is
  acceptable because the rows are scoped per account and
  never cross-account-leak).
- Constitution VI: cache hits/misses are loggable for
  observability.

