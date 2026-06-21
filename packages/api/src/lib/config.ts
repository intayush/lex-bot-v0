import { db, schema } from '../db';
import { eq, and, desc } from 'drizzle-orm';
import type { Configuration } from '@legal-chatbot/shared';

/**
 * In-process per-account cache for `getPublishedConfig` and
 * `getLatestConfig`. The chat route reads these on every turn but
 * the underlying configurations row only changes when the lawyer
 * publishes a new version — typically once per session at most.
 *
 * 60 second TTL is chosen to bound staleness after a publish event;
 * if we want zero-lag invalidation later, expose
 * `invalidateConfigCache(accountId)` from this file and call it
 * from the publish endpoint. For now the bounded staleness is the
 * right trade-off.
 *
 * Cache keys include the variant (`'published' | 'latest'`) because
 * /api/config and the dashboard preview see different rows.
 */
interface CachedConfigEntry<T> {
  value: T | null;
  expiresAt: number;
}

const CONFIG_CACHE_TTL_MS = 60_000;
const publishedCache = new Map<string, CachedConfigEntry<{
  id: string;
  version: number;
  config: Configuration;
}>>();
const latestCache = new Map<
  string,
  CachedConfigEntry<{
    id: string;
    version: number;
    isPublished: boolean;
    config: Configuration;
  }>
>();

function getCached<T>(
  cache: Map<string, CachedConfigEntry<T>>,
  key: string,
): T | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function putCached<T>(
  cache: Map<string, CachedConfigEntry<T>>,
  key: string,
  value: T | null,
): void {
  cache.set(key, { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
}

/**
 * Test-only hook to clear the config caches. Production code never
 * imports this directly; it exists so unit tests can validate the
 * underlying DB path without stale-cache interference.
 */
export function __resetConfigCachesForTests(): void {
  publishedCache.clear();
  latestCache.clear();
}

/**
 * Read-time migration: backfill `out_of_scope_response` from the
 * legacy nested path for rows saved before 019-remove-practice-areas.
 * No-op for rows that already have the top-level field.
 */
function migrateConfig(config: Configuration): Configuration {
  if (!config.out_of_scope_response && config.practice_areas?.out_of_scope_response) {
    return { ...config, out_of_scope_response: config.practice_areas.out_of_scope_response };
  }
  return config;
}

/**
 * Production-callable cache invalidation. Drop both the published
 * and latest cache entries for an account so the next /api/config
 * read re-fetches from the DB.
 *
 * Call this from any handler that mutates the configurations table
 * (e.g. /api/dashboard/config save / publish / save_theme) so the
 * widget picks up the new value immediately instead of after up to
 * `CONFIG_CACHE_TTL_MS`. Without invalidation, a publish event
 * remains invisible to live conversations for up to 60s.
 */
export function invalidateConfigCache(accountId: string): void {
  publishedCache.delete(accountId);
  latestCache.delete(accountId);
}

/**
 * Return the published configuration row plus its stable row id and version
 * so callers can use the id as a `configVersionId` for the system-prompt
 * cache (021-chat-api-latency T026).
 *
 * Changed from `Configuration | null` → `{ id, version, config } | null`
 * to match the shape of `getLatestConfig`. All call sites in this package
 * now read `.config` off the result.
 */
export async function getPublishedConfig(accountId: string): Promise<{ id: string; version: number; config: Configuration } | null> {
  const cached = getCached(publishedCache, accountId);
  if (cached !== undefined) return cached;

  const rows = await db
    .select()
    .from(schema.configurations)
    .where(
      and(
        eq(schema.configurations.account_id, accountId),
        eq(schema.configurations.is_published, true)
      )
    )
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  const row = rows[0];
  if (!row) {
    putCached(publishedCache, accountId, null);
    return null;
  }
  const config = migrateConfig(JSON.parse(row.config_json) as Configuration);
  const value = { id: row.id, version: row.version, config };
  putCached(publishedCache, accountId, value);
  return value;
}

export async function getLatestConfig(accountId: string): Promise<{ id: string; version: number; isPublished: boolean; config: Configuration } | null> {
  const cached = getCached(latestCache, accountId);
  if (cached !== undefined) return cached;

  const rows = await db
    .select()
    .from(schema.configurations)
    .where(eq(schema.configurations.account_id, accountId))
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  const row = rows[0];
  if (!row) {
    putCached(latestCache, accountId, null);
    return null;
  }
  const value = {
    id: row.id,
    version: row.version,
    isPublished: !!row.is_published,
    config: migrateConfig(JSON.parse(row.config_json) as Configuration),
  };
  putCached(latestCache, accountId, value);
  return value;
}

export async function getMaxVersion(accountId: string): Promise<number> {
  const rows = await db
    .select({ version: schema.configurations.version })
    .from(schema.configurations)
    .where(eq(schema.configurations.account_id, accountId))
    .orderBy(desc(schema.configurations.version))
    .limit(1);

  return rows[0]?.version ?? 0;
}
