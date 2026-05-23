# Data Model: Context Search

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

Context Search is a stateless retrieval module. It introduces no
persistent entities. Its data model consists of:

1. **Inputs (read from upstream)** — the manifest and markdown
   files produced by `002-crawler-cli`.
2. **Internal entities** — the in-memory cache entry, the scored
   file, and the assembled context.
3. **Output** — the assembled context returned to the agent
   runtime (Phase 3 consumer).

## Inputs (Read from Upstream)

These are produced by `002-crawler-cli` and consumed unchanged.
Both have Zod schemas in `packages/shared/src/schemas/`.

### Context Store Manifest (`_manifest.json`)

| Field | Type | Source | Notes |
|---|---|---|---|
| `version` | integer | §5.5 | MVP = `1` |
| `generated_at` | string (ISO 8601) | §5.5 | Read but not used for scoring |
| `base_url` | string (URL) | §5.5 | Used to resolve `path` for fetches |
| `files` | object[] | §5.5 | Per-file entries |

Per-file entry:

| Field | Type | Used by Context Search |
|---|---|---|
| `path` | string | Pass 2 fetch URL construction (FR-019) |
| `title` | string | `title_match` scoring (FR-011) |
| `section_type` | enum | `section_type_bonus` (FR-012) |
| `word_count` | integer | Read but not directly used in scoring |
| `content_hash` | string | Read but not used (Phase 2 cache uses URL+TTL, not hash) |
| `keywords` | string[] | `keyword_match` scoring (FR-010) |

Validation: read path applies `manifestSchema.parse()` (R2). Failure
yields a typed `ManifestValidationError`; `searchContext` returns
empty (FR-016) and logs the error.

### Crawled Page Markdown File

Used in Pass 2 only. The file body is fetched as text; frontmatter
is **not** parsed by Context Search (the manifest entry is the
authoritative source for metadata). The body string is included in
the assembled context.

## Internal Entities

### Cache Entry

```ts
type CacheEntry<V> = {
  value: V;
  expiresAt: number;        // Date.now() + ttlMs at insertion
};
```

Stored in `Map<string, CacheEntry<V>>`. Two singleton caches:

- `manifestCache`: keys are `contextStoreUrl`; values are validated
  `Manifest` objects.
- `fileCache`: keys are `${contextStoreUrl}::${path}`; values are
  markdown body strings.

Lifecycle:

- Created at module load (process start on Netlify Functions cold
  start).
- Populated on first fetch of a given key.
- Lazily expired on read (R6): `Date.now() > expiresAt` → cache miss.
- Explicitly invalidatable via `cache.invalidate(key)` (R6).
- Cleared on process exit (no persistence).

TTL: 5 minutes (300,000 ms) per §5.2. Configurable via constructor
parameter for tests.

### Scored File

```ts
type ScoredFile = {
  file: ManifestFile;        // shape from §5.5
  score: number;             // ∈ [0, 1]; rounded to 6 decimals for stability
};
```

Produced by Pass 1 scoring. Filtered to `score >= 0.15` (FR-014),
sorted descending, truncated to top 5 (FR-007). Never persisted.

### Search Result

```ts
type SearchResult = {
  file: ManifestFile;
  score: number;
  content: string;           // markdown body, possibly truncated to fit budget
};
```

The unit returned to the caller. The `content` field is the
markdown body — possibly the full body, possibly truncated by the
budget enforcer (R4). Order matches `ScoredFile` order
(highest score first).

### Assembled Context (output to caller)

The `searchContext` function returns `SearchResult[]`. The agent
runtime in Phase 3 will concatenate the `content` fields (with
optional separators) into the system prompt's "Retrieved context"
block per §7.8.

Empty array (`[]`) is the binding "no relevant context" signal,
which triggers the §7.11 fallback in Phase 3.

## Validation Rules

| Field | Rule | Source |
|---|---|---|
| `Manifest.version` | Equals `1` for MVP; unrecognized version → log warning, attempt to read anyway | §5.5 |
| `Manifest.files` | Array, may be empty (firm with no crawled pages → empty search) | §5.5 |
| `Manifest.files[].section_type` | One of: `practice-area`, `attorney-bio`, `faq`, `blog-post`, `contact`, `about`, `general` | §3.11 |
| Score | ∈ [0, 1] after weighted sum; values >1 indicate a scoring bug | §7.6 |
| Threshold | 0.15 (constant) | §7.6 |
| Top-N | 3–5; current implementation uses 5 (`MAX_RESULTS`) | §7.6 |
| Token budget (own) | ≤ 3500 tokens (page content 3000 + supplementary 500) | §7.7 |
| Cache TTL | 300,000 ms (5 min) | §5.2 |

## State Transitions

### Cache State

```text
[empty] ──first read── miss ──fetch──▶ [populated, fresh]
                                        │
                                        ├──read within TTL── hit ──▶ [populated, fresh]
                                        │
                                        └──read after TTL── miss ──fetch──▶ [populated, fresh]

[populated, fresh] ──invalidate(key)──▶ [empty]
```

### Search Pipeline

```text
query
  └─→ tokenize → query_tokens
        └─→ Pass 1: manifestCache.get / fetchManifest
              └─→ scoreFiles(manifest, query_tokens, sectionTypes)
                    └─→ filter(score >= 0.15)
                          └─→ sort desc, slice top-5
                                └─→ ScoredFile[]
                                      │
                                      ├ if empty → return [] (triggers fallback in Phase 3)
                                      │
                                      └─→ Pass 2: for each scored file:
                                            └─→ fileCache.get / fetchFileContent
                                                  └─→ enforce budget (3500 tokens)
                                                        └─→ SearchResult[]
```

## Coordination With Other Features

### Upstream: `002-crawler-cli`

- Manifest schema (§5.5) is the input contract.
- Frontmatter schema (§3.11) is read indirectly through manifest
  fields (`title`, `section_type`, `word_count`, `content_hash`).
  The optional `alternate_urls` field added by Crawler R10 is
  per-page only, not mirrored into the manifest, so Context Search
  is unaffected.

### Downstream: `004-chat-api-agent`

- Phase 3 will register `searchContext(query, sectionTypes?)` as
  the agent's first tool (per §2.8 / §7.3).
- Phase 3 owns the `guardrails` slot of the §7.7 token budget
  (1000 tokens, never truncated).
- Phase 3 calls `searchContext` once per agent turn (or more, if
  the LLM issues multiple tool calls within `maxSteps: 5`).

### Downstream: `007-dashboard`

- Phase 6's "Test context retrieval" action (§8.9) calls
  `searchContext` with a sample query and surfaces the results to
  the lawyer. Phase 6 will use `cache.invalidate(contextStoreUrl)`
  before testing so the lawyer sees the freshest manifest.

