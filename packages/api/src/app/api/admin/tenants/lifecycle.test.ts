/**
 * 027 US6 — tenant lifecycle: suspend/reactivate, rotate-key, soft-delete
 * with archival, and audit attribution (T052, T053).
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

import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { PATCH as setStatus } from './[id]/status/route.js';
import { POST as rotateKey } from './[id]/rotate-key/route.js';
import { DELETE as deleteTenant } from './[id]/route.js';
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
CREATE TABLE \`api_keys\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`key_hash\` text NOT NULL,
  \`label\` text, \`context_store_url\` text NOT NULL, \`created_at\` text NOT NULL, \`revoked_at\` text
);
CREATE TABLE \`leads\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`session_id\` text NOT NULL,
  \`name\` text, \`contact_email\` text, \`contact_phone\` text, \`case_type\` text, \`incident_date\` text,
  \`brief_description\` text, \`classification\` text NOT NULL, \`classification_rationale\` text,
  \`urgency_factors_json\` text, \`sop_state_snapshot\` text, \`status\` text NOT NULL DEFAULT 'new',
  \`follow_up_action\` text, \`follow_up_action_changed_at\` text, \`lead_score\` integer,
  \`score_reasons_json\` text, \`request_type\` text, \`geographic_qualification\` text,
  \`geographic_qualification_details_json\` text, \`branch_snapshot_json\` text,
  \`branch_incomplete\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`reverted_at\` text
);
CREATE TABLE \`archived_data\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`original_table\` text NOT NULL,
  \`original_id\` text NOT NULL, \`data_json\` text NOT NULL, \`deleted_by_user_at\` text NOT NULL, \`archived_at\` text NOT NULL
);
CREATE TABLE \`admin_audit_log\` (
  \`id\` text PRIMARY KEY NOT NULL, \`super_admin_id\` text NOT NULL, \`action\` text NOT NULL,
  \`target_account_id\` text, \`metadata_json\` text, \`created_at\` text NOT NULL
);
`;
const NOW = new Date().toISOString();

beforeEach(async () => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sessionState.adminId = 'admin_1';
  await db.insert(schema.accounts).values({ id: 'acct_1', email: 'a@f.com', password_hash: 'h', firm_name: 'Firm', created_at: NOW, status: 'active', onboarding_status: 'live', deleted_at: null });
  await db.insert(schema.apiKeys).values({ id: 'key_1', account_id: 'acct_1', key_hash: 'h', label: 'Primary', context_store_url: 'http://x', created_at: NOW });
});
afterEach(() => {
  for (const t of ['admin_audit_log', 'archived_data', 'leads', 'api_keys', 'accounts']) sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function statusReq(status: string) {
  return new Request('http://localhost/x', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
}

async function activeKeyCount() {
  return (await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.account_id, 'acct_1'), isNull(schema.apiKeys.revoked_at)))).length;
}
async function auditCount(action: string) {
  return (await db.select().from(schema.adminAuditLog).where(eq(schema.adminAuditLog.action, action))).length;
}

describe('PATCH status — T052', () => {
  it('suspend sets status and revokes keys', async () => {
    const res = await setStatus(statusReq('suspended'), params('acct_1'));
    expect(res.status).toBe(200);
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.id, 'acct_1'));
    expect(acct[0].status).toBe('suspended');
    expect(await activeKeyCount()).toBe(0);
    expect(await auditCount('tenant.suspend')).toBe(1);
  });

  it('reactivate restores status and un-revokes keys', async () => {
    await setStatus(statusReq('suspended'), params('acct_1'));
    await setStatus(statusReq('active'), params('acct_1'));
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.id, 'acct_1'));
    expect(acct[0].status).toBe('active');
    expect(await activeKeyCount()).toBe(1);
    expect(await auditCount('tenant.reactivate')).toBe(1);
  });

  it('denies without an admin session', async () => {
    sessionState.adminId = undefined;
    const res = await setStatus(statusReq('suspended'), params('acct_1'));
    expect(res.status).toBe(401);
  });
});

describe('POST rotate-key — T052', () => {
  it('issues a new key once and revokes the old one', async () => {
    const res = await rotateKey(new Request('http://localhost/x', { method: 'POST' }), params('acct_1'));
    expect(res.status).toBe(200);
    const { apiKey } = await res.json();
    expect(apiKey).toMatch(/^lk_/);
    // Old key revoked, exactly one active key remains.
    expect(await activeKeyCount()).toBe(1);
    const old = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, 'key_1'));
    expect(old[0].revoked_at).not.toBeNull();
    expect(await auditCount('tenant.rotate_key')).toBe(1);
  });
});

describe('DELETE (soft-delete + archival) — T053', () => {
  beforeEach(async () => {
    await db.insert(schema.leads).values([
      { id: 'l1', account_id: 'acct_1', session_id: 's1', classification: 'HOT', status: 'new', created_at: NOW },
      { id: 'l2', account_id: 'acct_1', session_id: 's1', classification: 'WARM', status: 'new', created_at: NOW },
    ]);
  });

  it('archives leads, sets deleted_at, and never hard-deletes', async () => {
    const res = await deleteTenant(new Request('http://localhost/x', { method: 'DELETE' }), params('acct_1'));
    expect(res.status).toBe(200);
    // deleted_at set.
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.id, 'acct_1'));
    expect(acct[0].deleted_at).not.toBeNull();
    // Leads still exist (no hard delete) AND archived.
    const leads = await db.select().from(schema.leads).where(eq(schema.leads.account_id, 'acct_1'));
    expect(leads).toHaveLength(2);
    const archived = await db.select().from(schema.archivedData).where(eq(schema.archivedData.account_id, 'acct_1'));
    expect(archived).toHaveLength(2);
    expect(archived[0].original_table).toBe('leads');
    expect(await auditCount('tenant.delete')).toBe(1);
  });

  it('returns 404 for an already-deleted tenant', async () => {
    await deleteTenant(new Request('http://localhost/x', { method: 'DELETE' }), params('acct_1'));
    const res = await deleteTenant(new Request('http://localhost/x', { method: 'DELETE' }), params('acct_1'));
    expect(res.status).toBe(404);
  });
});
