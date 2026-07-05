/**
 * Tests for SOP dashboard route — version history UI additions (022).
 *
 * Covers:
 *   T018 — GET /api/dashboard/sop returns history entries with label + step_count.
 *   T019 — POST action:'rollback' creates new draft with label=null and
 *           duplicated sopSteps.
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

vi.mock('../../../../db/schema.js', async () => {
  return await import('../../../../db/test-schema.js');
});

vi.mock('../../../../lib/dashboard-session.js', () => ({
  getAuthSession: vi.fn().mockResolvedValue({ accountId: 'acct_sop_001' }),
}));

vi.mock('../../../../lib/sop-config.js', () => ({
  getPublishedSOP: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../../lib/system-prompt-cache.js', () => ({
  invalidateSystemPromptCache: vi.fn(),
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from './route.js';
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
  \`deleted_at\` text, \`domain\` text, \`onboarding_draft_json\` text
);
CREATE UNIQUE INDEX \`accounts_email_unique\` ON \`accounts\` (\`email\`);

CREATE TABLE \`sop_configurations\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`version\` integer NOT NULL,
  \`qualified_lead_threshold\` integer DEFAULT 5 NOT NULL,
  \`is_published\` integer DEFAULT 0 NOT NULL,
  \`derived_from_legacy\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL,
  \`label\` text,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE \`sop_steps\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`sop_configuration_id\` text NOT NULL,
  \`position\` integer NOT NULL,
  \`slug\` text NOT NULL,
  \`question_text\` text NOT NULL,
  \`chip_source\` text,
  \`inline_chips_json\` text,
  \`accepts_free_text\` integer DEFAULT 1 NOT NULL,
  \`is_required\` integer DEFAULT 1 NOT NULL,
  \`counts_toward_threshold\` integer DEFAULT 1 NOT NULL,
  \`is_default\` integer DEFAULT 0 NOT NULL,
  \`applies_when_sub_type_slug\` text,
  \`skip_condition_json\` text,
  FOREIGN KEY (\`sop_configuration_id\`) REFERENCES \`sop_configurations\`(\`id\`) ON UPDATE no action ON DELETE no action
);
`;

const ACCOUNT_ID = 'acct_sop_001';
const NOW = '2026-06-21T10:00:00.000Z';

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) {
    sqlite.exec(stmt);
  }
  sqlite.exec(`INSERT INTO accounts (id, email, password_hash, firm_name, created_at) VALUES ('${ACCOUNT_ID}', 'sop@test.com', 'hash', 'SOP Firm', '${NOW}')`);
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS sop_steps');
  sqlite.exec('DROP TABLE IF EXISTS sop_configurations');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// T018 — GET /api/dashboard/sop returns label and step_count
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/sop history — T018', () => {
  it('includes label and step_count in history entries', async () => {
    await db.insert(schema.sopConfigurations).values([
      { id: 'sop_v1', account_id: ACCOUNT_ID, version: 1, qualified_lead_threshold: 6, is_published: false, derived_from_legacy: false, created_at: NOW, label: 'Original SOP' },
      { id: 'sop_v2', account_id: ACCOUNT_ID, version: 2, qualified_lead_threshold: 6, is_published: true, derived_from_legacy: false, created_at: NOW, label: null },
    ]);
    // Add 3 steps to v1, 2 steps to v2
    await db.insert(schema.sopSteps).values([
      { id: 's1', sop_configuration_id: 'sop_v1', position: 1, slug: 'case_type', question_text: 'Q1', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
      { id: 's2', sop_configuration_id: 'sop_v1', position: 2, slug: 'where', question_text: 'Q2', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
      { id: 's3', sop_configuration_id: 'sop_v1', position: 3, slug: 'what', question_text: 'Q3', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
      { id: 's4', sop_configuration_id: 'sop_v2', position: 1, slug: 'case_type', question_text: 'Q1', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
      { id: 's5', sop_configuration_id: 'sop_v2', position: 2, slug: 'where', question_text: 'Q2', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
    ]);

    const req = new Request('http://localhost/api/dashboard/sop');
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();

    const v2 = data.history.find((h: { version: number }) => h.version === 2);
    const v1 = data.history.find((h: { version: number }) => h.version === 1);
    expect(v2).toBeDefined();
    expect(v1).toBeDefined();
    expect(v2.label).toBeNull();
    expect(v1.label).toBe('Original SOP');
    expect(v2.step_count).toBe(2);
    expect(v1.step_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T019 — POST action:'rollback' creates new draft with label=null
// ---------------------------------------------------------------------------

describe('POST /api/dashboard/sop action:rollback — T019', () => {
  beforeEach(async () => {
    await db.insert(schema.sopConfigurations).values([
      { id: 'sop_src', account_id: ACCOUNT_ID, version: 1, qualified_lead_threshold: 6, is_published: false, derived_from_legacy: false, created_at: NOW, label: 'Source Label' },
    ]);
    await db.insert(schema.sopSteps).values([
      { id: 'step_a', sop_configuration_id: 'sop_src', position: 1, slug: 'case_type', question_text: 'Case type?', chip_source: 'case_types', inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
      { id: 'step_b', sop_configuration_id: 'sop_src', position: 2, slug: 'where', question_text: 'Where?', chip_source: null, inline_chips_json: null, accepts_free_text: true, is_required: true, counts_toward_threshold: true, is_default: false, skip_condition_json: null, applies_when_sub_type_slug: null },
    ]);
  });

  it('creates new draft with label=null (not inherited from source) and copies all steps', async () => {
    const req = new Request('http://localhost/api/dashboard/sop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rollback', version_id: 'sop_src' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.new_version).toBe(2);

    // New config has label=null
    const newConfigs = await db.select().from(schema.sopConfigurations).where(eq(schema.sopConfigurations.version, 2));
    expect(newConfigs).toHaveLength(1);
    expect(newConfigs[0]!.label).toBeNull();
    expect(newConfigs[0]!.is_published).toBe(false);

    // Steps are duplicated
    const newSteps = await db.select().from(schema.sopSteps).where(eq(schema.sopSteps.sop_configuration_id, newConfigs[0]!.id));
    expect(newSteps).toHaveLength(2);
    expect(newSteps.map((s) => s.slug).sort()).toEqual(['case_type', 'where']);
    // New step IDs are different (not reused)
    expect(newSteps[0]!.id).not.toBe('step_a');
    expect(newSteps[1]!.id).not.toBe('step_b');

    // Source is unchanged
    const srcConfigs = await db.select().from(schema.sopConfigurations).where(eq(schema.sopConfigurations.id, 'sop_src'));
    expect(srcConfigs[0]!.label).toBe('Source Label');
  });
});
