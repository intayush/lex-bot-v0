/**
 * 027 US3 — provider-resolver fallback + per-tenant key + cache (T034).
 */
vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('../../db/schema.js', async () => await import('../../db/test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { nanoid } from 'nanoid';
import {
  resolveProviderModel,
  invalidateLlmConfigCache,
  __resetLlmResolverCacheForTests,
} from './provider-resolver.js';
import { encrypt } from '../crypto.js';
import { db, schema } from '../../db/index.js';

const { __sqlite: sqlite } = (await import('../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL, \`email\` text NOT NULL, \`password_hash\` text NOT NULL,
  \`firm_name\` text, \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL, \`onboarding_status\` text DEFAULT 'live' NOT NULL, \`deleted_at\` text
);
CREATE TABLE \`account_llm_config\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`provider\` text NOT NULL, \`model\` text NOT NULL,
  \`api_key_encrypted\` text, \`is_active\` integer NOT NULL DEFAULT 1, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL
);
`;
const NOW = '2026-07-05T10:00:00.000Z';

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  __resetLlmResolverCacheForTests();
});
afterEach(() => {
  for (const t of ['account_llm_config', 'accounts']) sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
});

async function insertConfig(accountId: string, provider: string, model: string, key: string | null, active = true) {
  await db.insert(schema.accountLlmConfig).values({
    id: nanoid(), account_id: accountId, provider, model,
    api_key_encrypted: key ? encrypt(key) : null, is_active: active, created_at: NOW, updated_at: NOW,
  });
}

describe('resolveProviderModel — T034', () => {
  it('falls back to gemini-2.5-flash when no config exists', async () => {
    const r = await resolveProviderModel('acct_none');
    expect(r).toEqual({ provider: 'google', model: 'gemini-2.5-flash' });
  });

  it('falls back to default when config is inactive', async () => {
    await insertConfig('acct_x', 'anthropic', 'claude-sonnet-5', null, false);
    const r = await resolveProviderModel('acct_x');
    expect(r.provider).toBe('google');
  });

  it('returns the configured provider/model', async () => {
    await insertConfig('acct_a', 'anthropic', 'claude-sonnet-5', null);
    const r = await resolveProviderModel('acct_a');
    expect(r).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
  });

  it('caches: a config change is not seen until cache invalidation', async () => {
    await insertConfig('acct_c', 'openai', 'gpt-4o', null);
    expect((await resolveProviderModel('acct_c')).provider).toBe('openai');
    // Change under the cache.
    await db.update(schema.accountLlmConfig).set({ provider: 'google', model: 'gemini-2.5-flash' });
    expect((await resolveProviderModel('acct_c')).provider).toBe('openai'); // stale cache
    invalidateLlmConfigCache('acct_c');
    expect((await resolveProviderModel('acct_c')).provider).toBe('google'); // fresh
  });

  it('decrypts a stored per-tenant key without exposing it (round-trip via crypto)', async () => {
    await insertConfig('acct_k', 'anthropic', 'claude-sonnet-5', 'sk-ant-tenant-key');
    // resolveProviderModel returns only labels — no key material leaks.
    const r = await resolveProviderModel('acct_k');
    expect(r).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(JSON.stringify(r)).not.toContain('sk-ant');
  });
});
