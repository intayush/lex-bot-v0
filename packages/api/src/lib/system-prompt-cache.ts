/**
 * In-process cache for the static portion of the chat-API system prompt
 * (021-chat-api-latency T006).
 *
 * Mirrors the Map + TTL + LRU pattern in auth.ts and config.ts exactly.
 *
 * Cache key: `${accountId}:${configVersionId}:${isPreview ? 'p' : 'l'}`
 *
 * The static prefix only changes when the Configuration row changes, so
 * the key uses configVersionId (= the row's `id` column) as the version
 * discriminant. Preview and live see different rows so we include the
 * isPreview flag to prevent cross-contamination.
 *
 * Invalidation: `invalidateSystemPromptCache(accountId)` drops all entries
 * whose key starts with `${accountId}:`. Call this next to every
 * `invalidateConfigCache(accountId)` call site.
 *
 * Audit list of call sites paired with invalidateConfigCache:
 *   - packages/api/src/app/api/dashboard/config/route.ts (save, publish, save_theme)
 *   - packages/api/src/app/api/dashboard/sop/route.ts    (publish)
 */

interface CachedEntry {
  value: string;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 256;

const cache = new Map<string, CachedEntry>();

function cacheGet(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  // Touch entry: delete + re-set bumps it to tail for approximate LRU eviction.
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function cachePut(key: string, value: string): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

export interface GetCachedStaticPromptArgs {
  accountId: string;
  configVersionId: string;
  isPreview: boolean;
  produce: () => string;
}

/**
 * Return the cached static system-prompt prefix for the given account +
 * config version, computing it via `produce` on a cache miss.
 */
export function getCachedStaticPrompt({
  accountId,
  configVersionId,
  isPreview,
  produce,
}: GetCachedStaticPromptArgs): string {
  const key = `${accountId}:${configVersionId}:${isPreview ? 'p' : 'l'}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  const value = produce();
  cachePut(key, value);
  return value;
}

/**
 * Drop all cached static prompts for the given account. Call this wherever
 * `invalidateConfigCache(accountId)` is called so live chats see the updated
 * system prompt immediately after a config publish / theme save.
 */
export function invalidateSystemPromptCache(accountId: string): void {
  const prefix = `${accountId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/**
 * Test-only hook. Production code must not import this.
 */
export function __resetSystemPromptCacheForTests(): void {
  cache.clear();
}
