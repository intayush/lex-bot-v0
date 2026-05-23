# Contract: In-Memory Cache

**Owner**: Context Search (`003-context-search`)
**Source of Truth**: §5.2 (TTL: 5 minutes), Constitution IV (no fs at runtime).

## Class Surface

```ts
// packages/api/src/lib/context-search/cache.ts

export class Cache<V> {
  constructor(defaultTtlMs?: number);

  get(key: string): V | undefined;
  set(key: string, value: V, ttlMs?: number): void;
  invalidate(key: string): void;
  clear(): void;

  // Read-only accessors (testing)
  get size(): number;
}

// Singletons used by Context Search
export const manifestCache: Cache<Manifest>;
export const fileCache: Cache<string>;  // markdown body
```

## Semantics

### `get(key)`

- Returns the stored value if present and not expired.
- Returns `undefined` if the key is absent OR if `Date.now() > expiresAt`.
- Lazily expires (does not actively delete the stale entry; the next
  `set` will overwrite it; `clear` and `invalidate` are the only
  explicit deletions).
- `Date.now()` is the time source — not injected; tests use
  Vitest fake timers.

### `set(key, value, ttlMs?)`

- Stores `{ value, expiresAt: Date.now() + (ttlMs ?? defaultTtlMs) }`.
- `defaultTtlMs` = 300000 (5 min) per §5.2.
- An overriding `ttlMs` is permitted (e.g., for tests or future
  short-lived caches).

### `invalidate(key)`

- Removes the entry if present; no-op otherwise.
- Used by Phase 6 (`007-dashboard` §8.9 "Test context retrieval")
  to force a fresh fetch when the lawyer wants the latest crawl
  reflected immediately.

### `clear()`

- Removes all entries.
- Intended for tests only; not called in production paths.

## Concurrency

The cache is **single-process**. JavaScript's single-threaded event
loop means there is no in-process race; reads and writes are
atomic from the application's perspective.

Across Netlify Function instances (which scale horizontally), each
instance has its own cache. This is acceptable per §5.2 because
the TTL is a latency optimization, not a correctness requirement.

## Memory Footprint

- ~30 KB per manifest entry × 1 manifest per active firm.
- ~12 KB per markdown body × 5 bodies per recent query.
- Realistic upper bound for a hot single-firm function instance:
  ~100 KB. Well within Netlify Function limits.

## Lifecycle

- Constructed at module load (no lazy init).
- Lifetime = process instance lifetime.
- Cold start = empty cache; first request warms it.

## Testing

- Unit tests in `cache.test.ts` MUST verify:
  - `get` returns undefined for absent key.
  - `get` returns value within TTL.
  - `get` returns undefined after TTL expiry (using `vi.useFakeTimers`).
  - `set` overwrites existing entries.
  - `invalidate` removes entries.
  - `clear` empties the cache.
  - Singletons (`manifestCache`, `fileCache`) are distinct instances.

