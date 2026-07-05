/**
 * 027 US2 — register + onboarding + publish integration (T024, T026).
 * In-memory SQLite. `seedSopAndBranches` is mocked (it delegates to seed.ts's
 * neon-bound machinery, out of scope for the SQLite mock).
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

const { seedSopAndBranchesMock, provisionAttorneysMock } = vi.hoisted(() => ({
  seedSopAndBranchesMock: vi.fn(async () => {}),
  provisionAttorneysMock: vi.fn(async () => {}),
}));
vi.mock('../../../../lib/admin/tenant-provisioning.js', async (orig) => {
  const mod = await orig<typeof import('../../../../lib/admin/tenant-provisioning.js')>();
  return {
    ...mod,
    seedSopAndBranches: seedSopAndBranchesMock,
    provisionAttorneys: provisionAttorneysMock,
  };
});

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { POST as registerTenant } from './route.js';
import { PUT as onboarding } from './[id]/onboarding/route.js';
import { POST as publish } from './[id]/publish/route.js';
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
CREATE UNIQUE INDEX \`accounts_email_unique\` ON \`accounts\` (\`email\`);
CREATE TABLE \`api_keys\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`key_hash\` text NOT NULL,
  \`label\` text, \`context_store_url\` text NOT NULL, \`created_at\` text NOT NULL, \`revoked_at\` text
);
CREATE TABLE \`configurations\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`version\` integer NOT NULL,
  \`config_json\` text NOT NULL, \`is_published\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`label\` text
);
CREATE TABLE \`sop_configurations\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`version\` integer NOT NULL,
  \`qualified_lead_threshold\` integer NOT NULL DEFAULT 5, \`is_published\` integer NOT NULL DEFAULT 0,
  \`derived_from_legacy\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`label\` text
);
CREATE TABLE \`admin_audit_log\` (
  \`id\` text PRIMARY KEY NOT NULL, \`super_admin_id\` text NOT NULL, \`action\` text NOT NULL,
  \`target_account_id\` text, \`metadata_json\` text, \`created_at\` text NOT NULL
);
`;

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sessionState.adminId = 'admin_1';
  seedSopAndBranchesMock.mockClear();
  provisionAttorneysMock.mockClear();
});

afterEach(() => {
  for (const t of ['admin_audit_log', 'sop_configurations', 'configurations', 'api_keys', 'accounts']) {
    sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
  }
});

function jsonReq(url: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const fullWizard = {
  firmIdentity: { firmName: 'Acme', chatbotName: 'Ace', email: 'a@acme.law', domain: 'acme.law' },
  caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
  attorneys: [{ name: 'Lawyer A', email: 'la@f.com', subTypeAssignments: [{ caseTypeSlug: 'dui', subTypeSlug: 'first_offense' }] }],
};

describe('POST /api/admin/tenants (register) — T024', () => {
  it('creates account + api key and returns the plaintext key once', async () => {
    const res = await registerTenant(jsonReq('http://localhost/api/admin/tenants', { email: 'new@firm.com', firmName: 'New Firm' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.accountId).toBeTruthy();
    expect(data.apiKey).toMatch(/^lk_/);
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.id, data.accountId));
    expect(acct[0].onboarding_status).toBe('draft');
    const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.account_id, data.accountId));
    expect(keys).toHaveLength(1);
  });

  it('rejects a duplicate email with 409', async () => {
    await registerTenant(jsonReq('http://localhost/api/admin/tenants', { email: 'dup@firm.com', firmName: 'A' }));
    const res = await registerTenant(jsonReq('http://localhost/api/admin/tenants', { email: 'dup@firm.com', firmName: 'B' }));
    expect(res.status).toBe(409);
  });

  it('denies a request without an admin session', async () => {
    sessionState.adminId = undefined;
    const res = await registerTenant(jsonReq('http://localhost/api/admin/tenants', { email: 'x@y.com', firmName: 'X' }));
    expect(res.status).toBe(401);
  });
});

describe('onboarding finish + publish — T026', () => {
  async function register() {
    const res = await registerTenant(jsonReq('http://localhost/api/admin/tenants', { email: 'ob@firm.com', firmName: 'OB Firm' }));
    return (await res.json()).accountId as string;
  }

  it('422 on finish when required sections are missing', async () => {
    const id = await register();
    const res = await onboarding(jsonReq(`http://localhost/x`, { firmIdentity: fullWizard.firmIdentity, caseTypeSelection: [], finish: true }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.missing).toContain('caseTypeSelection');
  });

  it('finish generates a draft config + runs seed/branches', async () => {
    const id = await register();
    const res = await onboarding(jsonReq('http://localhost/x', { ...fullWizard, finish: true }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    expect(seedSopAndBranchesMock).toHaveBeenCalledWith(id, fullWizard.caseTypeSelection);
    expect(provisionAttorneysMock).toHaveBeenCalledWith(id, fullWizard.attorneys);
    const cfg = await db.select().from(schema.configurations).where(eq(schema.configurations.account_id, id));
    expect(cfg).toHaveLength(1);
    expect(cfg[0].is_published).toBe(false); // draft, not yet published
  });

  it('publish flips config published + sets onboarding live', async () => {
    const id = await register();
    await onboarding(jsonReq('http://localhost/x', { ...fullWizard, finish: true }), { params: Promise.resolve({ id }) });
    // Seed a SOP config so publish exercises that path too.
    await db.insert(schema.sopConfigurations).values({ id: 'sop_1', account_id: id, version: 1, qualified_lead_threshold: 5, is_published: false, derived_from_legacy: false, created_at: new Date().toISOString(), label: null });

    const res = await publish(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.onboardingStatus).toBe('live');

    const cfg = await db.select().from(schema.configurations).where(eq(schema.configurations.account_id, id));
    expect(cfg[0].is_published).toBe(true);
    const acct = await db.select().from(schema.accounts).where(eq(schema.accounts.id, id));
    expect(acct[0].onboarding_status).toBe('live');
    const sop = await db.select().from(schema.sopConfigurations).where(eq(schema.sopConfigurations.account_id, id));
    expect(sop[0].is_published).toBe(true);
  });

  it('publish returns 409 when there is no draft', async () => {
    // A bare account with no config rows.
    await db.insert(schema.accounts).values({ id: 'empty_1', email: 'e@e.com', password_hash: 'h', firm_name: 'E', created_at: new Date().toISOString(), status: 'active', onboarding_status: 'draft', deleted_at: null });
    const res = await publish(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id: 'empty_1' }) });
    expect(res.status).toBe(409);
  });
});
