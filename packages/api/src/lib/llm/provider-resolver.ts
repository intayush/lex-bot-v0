/**
 * 027-platform-admin-console — per-tenant LLM provider/model resolution (US3).
 *
 * Single resolution point (Constitution VI): the chat runtime calls
 * `resolveModelForAccount(accountId)` instead of hardcoding a model. Falls back
 * to the platform default (gemini-2.5-flash) when a tenant has no active config.
 * Per-tenant API keys are decrypted here only; never logged or returned.
 *
 * Result is cached with a 60s TTL (mirrors lib/auth.ts) keyed by accountId, and
 * invalidated on config writes via `invalidateLlmConfigCache`.
 */
import type { LanguageModelV1 } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { eq } from 'drizzle-orm';
import {
  PLATFORM_DEFAULT_PROVIDER,
  PLATFORM_DEFAULT_MODEL,
  type LlmProvider,
} from '@legal-chatbot/shared';
import { db, schema } from '../../db/index';
import { decrypt } from '../crypto';
import { getPlatformProviderKey } from '../env';

const CACHE_TTL_MS = 60_000;
interface Resolved {
  provider: LlmProvider;
  model: string;
  /** Decrypted per-tenant key, or null to use the platform key. */
  tenantKey: string | null;
}
interface CacheEntry {
  value: Resolved;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Invalidate the cached resolution for an account (call on config write). */
export function invalidateLlmConfigCache(accountId: string): void {
  cache.delete(accountId);
}

/** Test-only cache reset. */
export function __resetLlmResolverCacheForTests(): void {
  cache.clear();
}

async function loadResolution(accountId: string): Promise<Resolved> {
  const rows = await db
    .select()
    .from(schema.accountLlmConfig)
    .where(eq(schema.accountLlmConfig.account_id, accountId));
  const cfg = rows[0];
  if (!cfg || !cfg.is_active) {
    return { provider: PLATFORM_DEFAULT_PROVIDER, model: PLATFORM_DEFAULT_MODEL, tenantKey: null };
  }
  return {
    provider: cfg.provider as LlmProvider,
    model: cfg.model,
    tenantKey: cfg.api_key_encrypted ? decrypt(cfg.api_key_encrypted) : null,
  };
}

/** Build an AI SDK model instance from a resolution. */
function instantiate(resolved: Resolved): LanguageModelV1 {
  const { provider, model, tenantKey } = resolved;
  const apiKey = tenantKey ?? getPlatformProviderKey(provider);
  switch (provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(model);
    case 'anthropic':
      return createAnthropic({ apiKey })(model);
    case 'openai':
      return createOpenAI({ apiKey })(model);
  }
}

/**
 * Resolve the LanguageModel for a tenant. Cached (60s TTL). Never throws for a
 * missing tenant config — falls back to the platform default.
 */
export async function resolveModelForAccount(accountId: string): Promise<LanguageModelV1> {
  const now = Date.now();
  const cached = cache.get(accountId);
  let resolved: Resolved;
  if (cached && now < cached.expiresAt) {
    resolved = cached.value;
  } else {
    resolved = await loadResolution(accountId);
    cache.set(accountId, { value: resolved, expiresAt: now + CACHE_TTL_MS });
  }
  return instantiate(resolved);
}

/** Resolve just the provider/model labels (for usage attribution), cached. */
export async function resolveProviderModel(
  accountId: string,
): Promise<{ provider: LlmProvider; model: string }> {
  const now = Date.now();
  const cached = cache.get(accountId);
  if (cached && now < cached.expiresAt) {
    return { provider: cached.value.provider, model: cached.value.model };
  }
  const resolved = await loadResolution(accountId);
  cache.set(accountId, { value: resolved, expiresAt: now + CACHE_TTL_MS });
  return { provider: resolved.provider, model: resolved.model };
}
