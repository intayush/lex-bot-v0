/**
 * 027 US1 — GET /api/admin/tenants fleet overview (T017).
 * Verifies fleet summaries, soft-delete exclusion, and the guard.
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
    save: vi.fn(async () => {}),
    destroy: vi.fn(),
  })),
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from './route.js';
import { db, schema } from '../../../../db/index.js';

const { __sqlite: sqlite } = (await import('../../../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL, \`email\` text NOT NULL, \`password_hash\` text NOT NULL,
  \`firm_name\` text, \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL, \`onboarding_status\` text DEFAULT 'live' NOT NULL, \`deleted_at\` text, \`domain\` text
);
CREATE TABLE \`leads\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`session_id\` text NOT NULL,
  \`classification\` text NOT NULL, \`status\` text NOT NULL DEFAULT 'new', \`created_at\` text NOT NULL
);
CREATE TABLE \`sessions\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`messages_json\` text NOT NULL DEFAULT '[]',
  \`is_preview\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL
);
CREATE TABLE \`usage_events\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`session_id\` text,
  \`provider\` text NOT NULL, \`model\` text NOT NULL, \`prompt_tokens\` integer NOT NULL DEFAULT 0,
  \`completion_tokens\` integer NOT NULL DEFAULT 0, \`total_tokens\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL
);
`;

const NOW = new Date().toISOString();

beforeEach(async () => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sessionState.adminId = 'admin_1';
  await db.insert(schema.accounts).values([
    { id: 'acct_a', email: 'a@f.com', password_hash: 'h', firm_name: 'Firm A', created_at: NOW, status: 'active', onboarding_status: 'live', deleted_at: null },
    { id: 'acct_b', email: 'b@f.com', password_hash: 'h', firm_name: 'Firm B', created_at: NOW, status: 'suspended', onboarding_status: 'draft', deleted_at: null },
    { id: 'acct_del', email: 'd@f.com', password_hash: 'h', firm_name: 'Deleted', created_at: NOW, status: 'active', onboarding_status: 'live', deleted_at: NOW },
  ]);
  // Raw inserts with explicit columns — the test `leads` table is intentionally
  // minimal (only the columns the fleet query touches).
  sqlite.exec(`INSERT INTO leads (id, account_id, session_id, classification, status, created_at) VALUES ('l1','acct_a','s1','HOT','new','${NOW}')`);
  sqlite.exec(`INSERT INTO leads (id, account_id, session_id, classification, status, created_at) VALUES ('l2','acct_a','s1','WARM','new','${NOW}')`);
  await db.insert(schema.usageEvents).values([
    { id: 'u1', account_id: 'acct_a', session_id: 's1', provider: 'google', model: 'gemini-2.5-flash', prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000, created_at: NOW },
  ]);
});

afterEach(() => {
  for (const t of ['usage_events', 'sessions', 'leads', 'accounts']) sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
});

describe('GET /api/admin/tenants — T017', () => {
  it('lists all non-deleted tenants with summary fields', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const { tenants } = await res.json();
    const ids = tenants.map((t: { accountId: string }) => t.accountId).sort();
    expect(ids).toEqual(['acct_a', 'acct_b']); // acct_del excluded
    const a = tenants.find((t: { accountId: string }) => t.accountId === 'acct_a');
    expect(a.leadCount30d).toBe(2);
    expect(a.status).toBe('active');
    expect(a.estimatedSpend30d).toBeCloseTo(0.3, 5); // 1M google input tokens @ $0.30/M
    const b = tenants.find((t: { accountId: string }) => t.accountId === 'acct_b');
    expect(b.status).toBe('suspended');
    expect(b.onboardingStatus).toBe('draft');
    expect(b.leadCount30d).toBe(0);
  });

  it('excludes soft-deleted tenants', async () => {
    const res = await GET();
    const { tenants } = await res.json();
    expect(tenants.find((t: { accountId: string }) => t.accountId === 'acct_del')).toBeUndefined();
  });

  it('returns 401 without an admin session', async () => {
    sessionState.adminId = undefined;
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
