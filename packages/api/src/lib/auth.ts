import bcrypt from 'bcryptjs';
import { db, schema } from '../db';
import { DEV_API_KEY } from '@legal-chatbot/shared';

interface AuthResult {
  accountId: string;
  contextStoreUrl: string;
}

/**
 * In-process LRU-ish cache for `verifyApiKey` results. Each chat
 * turn (and every /api/config request) used to do:
 *   1. SELECT * FROM api_keys (no WHERE clause)
 *   2. bcrypt.compare against EVERY non-revoked row until a hit
 * That cost ~80–100ms per bcrypt × N rows of round-trip + CPU. With
 * even a handful of keys provisioned the auth phase dominated TTFB.
 *
 * Cache shape: Map<apiKey-string, { result, expiresAt }>.
 * - TTL: 60 seconds. Long enough that a steady-state visitor's
 *   conversation skips bcrypt; short enough that a key revocation
 *   propagates within a minute without manual invalidation.
 * - Negative caching: failed lookups also cache (as `null`) for the
 *   same TTL so a stream of forged keys can't reload bcrypt repeatedly.
 * - Bound: keys are never purged below CACHE_MAX_ENTRIES; oldest
 *   entries are dropped first when the cache grows past that size.
 *
 * The cache is process-local (a Map). On serverless this means each
 * cold lambda starts empty; that's fine — the win shows up on warm
 * containers, which is the common case after an initial visitor turn.
 */

interface CachedEntry {
  result: AuthResult | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 256;
const cache = new Map<string, CachedEntry>();

function cacheGet(apiKey: string): AuthResult | null | undefined {
  const entry = cache.get(apiKey);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(apiKey);
    return undefined;
  }
  // Touch entry so iteration order moves it to the end (Map keeps
  // insertion order; re-set bumps it). This gives the structure
  // approximate LRU eviction.
  cache.delete(apiKey);
  cache.set(apiKey, entry);
  return entry.result;
}

function cachePut(apiKey: string, result: AuthResult | null): void {
  cache.set(apiKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX_ENTRIES) {
    // Drop the oldest entry (first key in insertion order).
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
}

/**
 * Test-only hook to reset the cache between tests. Production code
 * never imports this directly; it exists so unit tests can validate
 * the underlying DB+bcrypt path without stale-cache interference.
 */
export function __resetVerifyApiKeyCacheForTests(): void {
  cache.clear();
}

export async function verifyApiKey(apiKey: string): Promise<AuthResult | null> {
  // Fast path: warm cache hit. Skip DB and bcrypt entirely.
  const cached = cacheGet(apiKey);
  if (cached !== undefined) return cached;

  // Slow path: DB scan + bcrypt as before.
  const allKeys = await db.select().from(schema.apiKeys);

  for (const row of allKeys) {
    if (row.revoked_at) continue;

    let match = false;
    if (apiKey === DEV_API_KEY) {
      match = await bcrypt.compare(DEV_API_KEY, row.key_hash);
    } else {
      match = await bcrypt.compare(apiKey, row.key_hash);
    }

    if (match) {
      const result: AuthResult = {
        accountId: row.account_id,
        contextStoreUrl: row.context_store_url,
      };
      cachePut(apiKey, result);
      return result;
    }
  }

  // Negative cache: don't re-do the bcrypt loop on the next forged
  // request within the TTL window.
  cachePut(apiKey, null);
  return null;
}
