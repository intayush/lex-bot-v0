# Contract: System-Prompt Static-Prefix Cache

**Feature**: 021-chat-api-latency · **File**: `packages/api/src/lib/system-prompt-cache.ts` (NEW)

## Purpose

Memoize the unchanging portion of the chat system prompt per `(accountId, configVersionId, isPreview)` so that the repetitive ~2KB string is assembled once per cache window instead of once per chat turn.

## Public API

```ts
export interface CachedPromptArgs {
  accountId: string;
  configVersionId: string;      // configurations.id (stable per published row)
  isPreview: boolean;
  // Lazy producer: invoked only on cache miss to avoid building the prefix
  // when it would just be thrown away.
  produce: () => string;
}

/**
 * Returns the cached static prompt prefix for the given key, computing
 * and caching it on miss. The producer MUST be deterministic for a given
 * (accountId, configVersionId, isPreview) tuple.
 */
export function getCachedStaticPrompt(args: CachedPromptArgs): string;

/**
 * Evict all cache entries for the given accountId, across all
 * configVersionId and isPreview variants. Call from publish/save handlers
 * adjacent to invalidateConfigCache(accountId).
 */
export function invalidateSystemPromptCache(accountId: string): void;

/**
 * Test-only: reset the cache between tests.
 */
export function __resetSystemPromptCacheForTests(): void;
```

## Implementation contract

- Backing store: `Map<string, { prefix: string; expiresAt: number }>`.
- Key format: `${accountId}:${configVersionId}:${isPreview ? 'p' : 'l'}`.
- TTL: `60_000` ms — matches `lib/config.ts`.
- Max entries: `256`; on overflow, drop oldest insertion-order entry (LRU-via-`Map`-reorder pattern used by `lib/auth.ts`).
- Cache reads MUST refresh LRU order (delete + re-set entry).
- On miss: call `produce()`, store, return.
- On hit (and not expired): return cached prefix.
- On hit-but-expired: delete and treat as miss.

## Invalidation behavior

`invalidateSystemPromptCache(accountId)` MUST evict EVERY entry whose key starts with `${accountId}:`, regardless of `configVersionId` or `isPreview`. This is the safest behavior because:

- A publish creates a new `configurations.id`, so the old key would TTL out eventually — but invalidating proactively prevents stale serves during the next 60s.
- The cost of over-invalidation is one recomputation on next miss; the cost of under-invalidation is a stale prompt.

## Account-isolation guarantees

- Keys MUST always begin with `accountId`. The cache MUST NOT expose any iteration API to callers.
- Tests MUST assert that no entry for account A is readable with account B's key (including identical `configVersionId` and `isPreview`).

## What goes IN the cache vs OUT

**IN (static — same across SOP step transitions for a given config version)**:

- Persona ("You are X, virtual assistant for Y")
- Tone line + AI-not-a-lawyer disclaimer
- "## Your Role" block
- "## Practice Areas (In Scope)" list (derived from `caseTypes` where `is_in_scope=true`)
- "## Out of Scope Response" line
- "## Boundaries (Never Do)" list
- "## Escalation" block
- "## Contact Information" block
- "## Additional Instructions" block (when `custom_instructions` is set)
- "## Instructions for Using Context" block
- "## Lead Capture Instructions" block (including classification guide)

**OUT (dynamic — recomputed per turn, concatenated after the cached prefix)**:

- SOP block (`composeSopBlock`) — varies per `sopState`
- Branch prompt directive — varies per turn
- Any future per-turn directive

## Producer contract

The `produce` callback that the chat route passes in MUST:

- Compute the static portion ONLY (never include SOP block or branch directive).
- Be a pure function of the `Configuration` object and the case-types list.
- Never throw on valid inputs; the route is responsible for upstream validation.

## Test surface

| Test | Behavior |
|------|----------|
| Miss then hit | First call computes, second call returns same string without re-invoking producer. |
| TTL expiry | After 60s, the entry is recomputed. |
| Explicit invalidation | `invalidateSystemPromptCache(accountId)` drops all entries for that account; other accounts unaffected. |
| Account isolation | Same `configVersionId` + `isPreview` across two accounts yields two separate entries. |
| Version isolation | Same `accountId` + `isPreview` across two `configVersionId`s yields two separate entries. |
| Preview isolation | Same `accountId` + `configVersionId` with `isPreview: true` vs `false` yields two separate entries. |
| LRU eviction | Inserting >256 entries drops the oldest. |
