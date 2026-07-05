/**
 * 027 US3 — llm-config GET/PUT route (T035). Verifies upsert, allow-list
 * rejection, key never returned, and cache invalidation on write.
 */
vi.mock('../../../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../../../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('../../../../db/schema.js', async () => await import('../../../../db/test-schema.js'));

const sessionState: { adminId?: string } = { adminId: 'admin_1' };
vi.mock('../../../../lib/admin-session.js', () => ({
  getAdminSession: vi.fn(async () => ({
    get adminId() { return sessionState.adminId; },
    set adminId(v: string | undefined) { sessionState.adminId = v; },
    save: vi.fn(async () => {}), destroy: vi.fn(),
  })),
}));

const { invalidateMock } = vi.hoisted(() => ({ invalidateMock: vi.fn() }));
vi.mock('../../../../lib/llm/provider-resolver.js', () => ({
  invalidateLlmConfigCache: invalidateMock,
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { GET, PUT } from './[id]/llm-config/route.js';
import { db, schema } from '../../../../db/index.js';
import { eq } from 'drizzle-orm';

const { __sqlite: sqlite } = (await import('../../../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`account_llm_config\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`provider\` text NOT NULL, \`model\` text NOT NULL,
  \`api_key_encrypted\` text, \`is_active\` integer NOT NULL DEFAULT 1, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL
);
CREATE UNIQUE INDEX \`account_llm_config_account_unique\` ON \`account_llm_config\` (\`account_id\`);
CREATE TABLE \`admin_audit_log\` (
  \`id\` text PRIMARY KEY NOT NULL, \`super_admin_id\` text NOT NULL, \`action\` text NOT NULL,
  \`target_account_id\` text, \`metadata_json\` text, \`created_at\` text NOT NULL
);
`;

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sessionState.adminId = 'admin_1';
  invalidateMock.mockClear();
});
afterEach(() => {
  for (const t of ['account_llm_config', 'admin_audit_log']) sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
});

function putReq(body: unknown) {
  return new Request('http://localhost/x', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('PUT /api/admin/tenants/[id]/llm-config — T035', () => {
  it('creates config and never returns key material', async () => {
    const res = await PUT(putReq({ provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-ant-secret' }), params('acct_a'));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5', hasKey: true });
    expect(JSON.stringify(view)).not.toContain('sk-ant-secret');
    // Stored value is encrypted, not plaintext.
    const row = await db.select().from(schema.accountLlmConfig).where(eq(schema.accountLlmConfig.account_id, 'acct_a'));
    expect(row[0].api_key_encrypted).not.toBe('sk-ant-secret');
    expect(invalidateMock).toHaveBeenCalledWith('acct_a');
  });

  it('rejects an unsupported (provider, model) with 400', async () => {
    const res = await PUT(putReq({ provider: 'anthropic', model: 'gpt-4o' }), params('acct_b'));
    expect(res.status).toBe(400);
  });

  it('updates an existing config and can clear the key', async () => {
    await PUT(putReq({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-openai' }), params('acct_c'));
    const res = await PUT(putReq({ provider: 'google', model: 'gemini-2.5-flash', clearKey: true }), params('acct_c'));
    const view = await res.json();
    expect(view).toMatchObject({ provider: 'google', model: 'gemini-2.5-flash', hasKey: false });
  });

  it('denies without an admin session', async () => {
    sessionState.adminId = undefined;
    const res = await PUT(putReq({ provider: 'google', model: 'gemini-2.5-flash' }), params('acct_d'));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admin/tenants/[id]/llm-config — T035', () => {
  it('returns null when no config exists', async () => {
    const res = await GET(new Request('http://localhost/x'), params('acct_none'));
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('returns a key-free view when config exists', async () => {
    await PUT(putReq({ provider: 'anthropic', model: 'claude-sonnet-5', apiKey: 'sk-x' }), params('acct_e'));
    const res = await GET(new Request('http://localhost/x'), params('acct_e'));
    const view = await res.json();
    expect(view.hasKey).toBe(true);
    expect(JSON.stringify(view)).not.toContain('sk-x');
  });
});
