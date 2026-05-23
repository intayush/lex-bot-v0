# Contract: Manifest Read Path

**Owner**: Context Search (`003-context-search`)
**Reads from**: HTTPS context store (lawyer's server) — produced by
Crawler (`002-crawler-cli`) per its manifest-contract.md
**Source of Truth**: §5.5, §5.2 (caching), Constitution Principle II.

## Function Surface

```ts
// packages/api/src/lib/context-search/manifest-fetcher.ts

export async function getManifest(contextStoreUrl: string): Promise<Manifest>;
```

Where `Manifest` is the Zod-inferred type from
`packages/shared/src/schemas/manifest.ts`.

## Behavior

1. Compute cache key: `contextStoreUrl` (normalized — trailing
   slash preserved, query string ignored).
2. Check `manifestCache.get(key)`; on hit, return the cached
   `Manifest`.
3. On miss: HTTPS GET `<contextStoreUrl>_manifest.json` with a
   5-second timeout (R3).
4. Parse JSON.
5. Validate via `manifestSchema.parse()` — Zod (R2).
6. Insert into `manifestCache` with TTL = 5 min (R1, R6).
7. Return the validated `Manifest`.

## URL Construction

```ts
const url = new URL('_manifest.json', contextStoreUrl).href;
```

This handles both `https://example.com/chatbot-context/` and
`https://example.com/chatbot-context` (URL constructor normalizes).

## Failure Modes

| Failure | Behavior |
|---|---|
| Timeout (5 s) | Throw `ManifestUnreachableError` |
| Network error (DNS, connection refused) | Throw `ManifestUnreachableError` |
| HTTP non-2xx | Throw `ManifestUnreachableError` |
| Non-JSON response body | Throw `ManifestParseError` |
| JSON parses but fails Zod validation | Throw `ManifestValidationError` (carries Zod `issues`) |

The orchestrator (`searchContext`) catches these errors and returns
`[]` (per `searchcontext-contract.md`).

## Cache Semantics

| Operation | Behavior |
|---|---|
| `manifestCache.get(url)` | Returns `Manifest` on hit; `undefined` on miss or expired |
| `manifestCache.set(url, manifest)` | Stores with 5-min TTL |
| `manifestCache.invalidate(url)` | Removes entry; next read forces re-fetch |
| `manifestCache.clear()` | Empties entire cache (testing only) |

## Validation (Zod)

The `manifestSchema` in `packages/shared/src/schemas/manifest.ts`
enforces the §5.5 shape:

```ts
const manifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  base_url: z.string().url(),
  files: z.array(z.object({
    path: z.string(),
    title: z.string(),
    section_type: z.enum([
      'practice-area', 'attorney-bio', 'faq',
      'blog-post', 'contact', 'about', 'general',
    ]),
    word_count: z.number().int().nonnegative(),
    content_hash: z.string(),
    keywords: z.array(z.string()),
  })),
});
```

Future Crawler R10 may add optional fields to per-file entries
(e.g., `alternate_urls`); the schema MUST be permissive (`.passthrough()`
or explicit optional fields) to allow forward compatibility.

## Logging

- `manifest_cache_hit` / `manifest_cache_miss` (info level).
- `manifest_validation_failed` (error level) with Zod `issues`.
- `context_store_unreachable` (error level) with status code or
  error name.

