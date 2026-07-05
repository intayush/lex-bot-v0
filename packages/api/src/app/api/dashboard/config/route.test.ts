/**
 * Tests for the config dashboard route — version history UI (022).
 *
 * Covers:
 *   T010 — GET /api/dashboard/config returns { versions: ConfigVersionSummary[] }
 *           ordered by version DESC, including the label field.
 *   T011 — POST action:'restore' inserts a new row with copied config_json,
 *           is_published=false, label=null, returns { success, new_version }.
 *   T012 — PATCH /api/dashboard/config/label updates the label field;
 *           rejects labels >80 chars with 400; accepts null to clear.
 *
 * Uses in-memory SQLite to avoid Neon dependency. Mocks getAuthSession so
 * auth is bypassed and only route logic is under test.
 */

// ---------------------------------------------------------------------------
// DB mock — in-memory SQLite with the project test-schema
// ---------------------------------------------------------------------------
vi.mock('../../../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../../../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

vi.mock('../../../../db/schema.js', async () => {
  return await import('../../../../db/test-schema.js');
});

// Auth mock — always returns a test account
vi.mock('../../../../lib/dashboard-session.js', () => ({
  getAuthSession: vi.fn().mockResolvedValue({ accountId: 'acct_001' }),
}));

// Cache mocks — no-ops for unit tests
vi.mock('../../../../lib/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../../lib/config.js')>();
  return {
    ...mod,
    invalidateConfigCache: vi.fn(),
  };
});
vi.mock('../../../../lib/system-prompt-cache.js', () => ({
  invalidateSystemPromptCache: vi.fn(),
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from './route.js';
import { PATCH } from './label/route.js';
import { db, schema } from '../../../../db/index.js';
import { eq } from 'drizzle-orm';

const { __sqlite: sqlite } = await import('../../../../db/index.js') as unknown as {
  __sqlite: import('better-sqlite3').Database
};

const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`email\` text NOT NULL,
  \`password_hash\` text NOT NULL,
  \`firm_name\` text,
  \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`onboarding_status\` text DEFAULT 'live' NOT NULL,
  \`deleted_at\` text, \`domain\` text
);
CREATE UNIQUE INDEX \`accounts_email_unique\` ON \`accounts\` (\`email\`);

CREATE TABLE \`configurations\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`version\` integer NOT NULL,
  \`config_json\` text NOT NULL,
  \`is_published\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL,
  \`label\` text,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action
);
`;

const ACCOUNT_ID = 'acct_001';
const NOW = '2026-06-21T10:00:00.000Z';

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) {
    sqlite.exec(stmt);
  }
  sqlite.exec(`INSERT INTO accounts (id, email, password_hash, firm_name, created_at) VALUES ('${ACCOUNT_ID}', 'test@test.com', 'hash', 'Test Firm', '${NOW}')`);
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS configurations');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// T010 — GET /api/dashboard/config returns version history
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/config — T010', () => {
  it('returns versions ordered by version DESC with label field', async () => {
    await db.insert(schema.configurations).values([
      { id: 'cfg_1', account_id: ACCOUNT_ID, version: 1, config_json: '{"v":1}', is_published: false, created_at: NOW, label: null },
      { id: 'cfg_2', account_id: ACCOUNT_ID, version: 2, config_json: '{"v":2}', is_published: true, created_at: NOW, label: 'Summer Campaign' },
      { id: 'cfg_3', account_id: ACCOUNT_ID, version: 3, config_json: '{"v":3}', is_published: false, created_at: NOW, label: null },
    ]);

    const req = new Request('http://localhost/api/dashboard/config');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.versions).toHaveLength(3);
    // Newest first
    expect(data.versions[0].version).toBe(3);
    expect(data.versions[1].version).toBe(2);
    expect(data.versions[2].version).toBe(1);
    // Label field present
    expect(data.versions[1].label).toBe('Summer Campaign');
    expect(data.versions[0].label).toBeNull();
    // Published field present
    expect(data.versions[1].is_published).toBe(true);
    // No config_json in response
    expect(data.versions[0].config_json).toBeUndefined();
  });

  it('returns empty array when account has no versions', async () => {
    const req = new Request('http://localhost/api/dashboard/config');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.versions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T011 — POST action:'restore' creates new draft from historical version
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/config action:restore — T011', () => {
  beforeEach(async () => {
    await db.insert(schema.configurations).values([
      { id: 'cfg_v1', account_id: ACCOUNT_ID, version: 1, config_json: '{"persona":{"chatbot_name":"OldAlex"}}', is_published: false, created_at: NOW, label: 'Original' },
      { id: 'cfg_v2', account_id: ACCOUNT_ID, version: 2, config_json: '{"persona":{"chatbot_name":"NewAlex"}}', is_published: true, created_at: NOW, label: null },
    ]);
  });

  it('creates new draft copying config_json from source, label=null, is_published=false', async () => {
    const req = new Request('http://localhost/api/dashboard/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', source_version_id: 'cfg_v1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.new_version).toBe(3);

    // Verify DB state
    const rows = await db.select().from(schema.configurations).where(eq(schema.configurations.version, 3));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.config_json).toBe('{"persona":{"chatbot_name":"OldAlex"}}');
    expect(rows[0]!.is_published).toBe(false);
    expect(rows[0]!.label).toBeNull();
    // Source row is unchanged
    const source = await db.select().from(schema.configurations).where(eq(schema.configurations.id, 'cfg_v1'));
    expect(source[0]!.label).toBe('Original');
    expect(source[0]!.config_json).toBe('{"persona":{"chatbot_name":"OldAlex"}}');
  });

  it('returns 404 when source_version_id not found', async () => {
    const req = new Request('http://localhost/api/dashboard/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore', source_version_id: 'cfg_nonexistent' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 400 when source_version_id is missing', async () => {
    const req = new Request('http://localhost/api/dashboard/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restore' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// T012 — PATCH /api/dashboard/config/label updates label field
// ---------------------------------------------------------------------------

describe('PATCH /api/dashboard/config/label — T012', () => {
  beforeEach(async () => {
    await db.insert(schema.configurations).values([
      { id: 'cfg_label_test', account_id: ACCOUNT_ID, version: 1, config_json: '{}', is_published: true, created_at: NOW, label: null },
    ]);
  });

  it('updates label successfully', async () => {
    const req = new Request('http://localhost/api/dashboard/config/label', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: 'cfg_label_test', label: 'My Label' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    const rows = await db.select().from(schema.configurations).where(eq(schema.configurations.id, 'cfg_label_test'));
    expect(rows[0]!.label).toBe('My Label');
  });

  it('clears label when null is sent', async () => {
    await db.update(schema.configurations).set({ label: 'Existing' }).where(eq(schema.configurations.id, 'cfg_label_test'));
    const req = new Request('http://localhost/api/dashboard/config/label', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: 'cfg_label_test', label: null }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const rows = await db.select().from(schema.configurations).where(eq(schema.configurations.id, 'cfg_label_test'));
    expect(rows[0]!.label).toBeNull();
  });

  it('returns 400 for label longer than 80 characters', async () => {
    const req = new Request('http://localhost/api/dashboard/config/label', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: 'cfg_label_test', label: 'x'.repeat(81) }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when version_id not found for account', async () => {
    const req = new Request('http://localhost/api/dashboard/config/label', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: 'cfg_nonexistent', label: 'X' }),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });
});
