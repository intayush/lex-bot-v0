/**
 * 027 US1 — admin login + super-admin guard (T016).
 * In-memory SQLite; mocks the admin session so we control cookie state.
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

// Admin session mock — an in-memory bag we can inspect + preset.
const sessionState: { adminId?: string; email?: string } = {};
const saveMock = vi.fn(async () => {});
const destroyMock = vi.fn(() => {
  delete sessionState.adminId;
  delete sessionState.email;
});
vi.mock('../../../../lib/admin-session.js', () => ({
  getAdminSession: vi.fn(async () => ({
    get adminId() { return sessionState.adminId; },
    set adminId(v: string | undefined) { sessionState.adminId = v; },
    get email() { return sessionState.email; },
    set email(v: string | undefined) { sessionState.email = v; },
    save: saveMock,
    destroy: destroyMock,
  })),
}));

import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { POST as login } from './route.js';
import { GET as listTenants } from '../tenants/route.js';
import { db, schema } from '../../../../db/index.js';

const { __sqlite: sqlite } = (await import('../../../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL, \`email\` text NOT NULL, \`password_hash\` text NOT NULL,
  \`firm_name\` text, \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL, \`onboarding_status\` text DEFAULT 'live' NOT NULL, \`deleted_at\` text
);
CREATE TABLE \`super_admins\` (
  \`id\` text PRIMARY KEY NOT NULL, \`email\` text NOT NULL, \`password_hash\` text NOT NULL, \`created_at\` text NOT NULL
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

const NOW = '2026-07-05T10:00:00.000Z';

beforeEach(async () => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  delete sessionState.adminId;
  delete sessionState.email;
  saveMock.mockClear();
  const hash = await bcrypt.hash('correct-password', 10);
  await db.insert(schema.superAdmins).values({
    id: 'admin_1', email: 'admin@lexbot.dev', password_hash: hash, created_at: NOW,
  });
});

afterEach(() => {
  for (const t of ['usage_events', 'sessions', 'leads', 'super_admins', 'accounts']) {
    sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
  }
});

function req(body: unknown) {
  return new Request('http://localhost/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('POST /api/admin/login — T016', () => {
  it('sets the admin session on valid credentials', async () => {
    const res = await login(req({ email: 'admin@lexbot.dev', password: 'correct-password' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.redirect).toBe('/admin');
    expect(sessionState.adminId).toBe('admin_1');
    expect(saveMock).toHaveBeenCalled();
  });

  it('rejects wrong password with 401', async () => {
    const res = await login(req({ email: 'admin@lexbot.dev', password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(sessionState.adminId).toBeUndefined();
  });

  it('rejects unknown email with 401', async () => {
    const res = await login(req({ email: 'nobody@x.com', password: 'x' }));
    expect(res.status).toBe(401);
  });

  it('rejects malformed body with 400', async () => {
    const res = await login(req({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });
});

describe('requireSuperAdmin guard via GET /api/admin/tenants — T016/T017', () => {
  it('returns 401 when there is no admin session (firm session ≈ absent adminId)', async () => {
    // sessionState.adminId is unset → simulates a firm/no session.
    const res = await listTenants();
    expect(res.status).toBe(401);
  });

  it('allows access once an admin session is present', async () => {
    sessionState.adminId = 'admin_1';
    const res = await listTenants();
    expect(res.status).toBe(200);
  });
});
