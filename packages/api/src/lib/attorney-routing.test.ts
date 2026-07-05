/**
 * Tests for attorney routing — 024-attorney-routing T019, T020.
 *
 * Covers:
 *   T019 — getAttorneysForCaseType returns only attorneys matching the slug
 *   T020 — enqueueAttorneyRoutingNotifications inserts email-channel rows
 *          for matching attorneys, zero rows when no match
 */

vi.mock('../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

vi.mock('../db/schema.js', async () => await import('../db/test-schema.js'));

// Mock runAfterResponse to be a no-op — email dispatch is tested separately
vi.mock('./run-after-response.js', () => ({
  runAfterResponse: vi.fn(),
}));

// Mock sendEmail to avoid real network calls
vi.mock('./email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAttorneysForCaseType } from './attorneys.js';
import { enqueueAttorneyRoutingNotifications } from './attorney-routing.js';
import { db } from '../db/index.js';
import * as schema from '../db/test-schema.js';
import { eq } from 'drizzle-orm';

const { __sqlite: sqlite } = await import('../db/index.js') as unknown as {
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
  \`deleted_at\` text,
  \`domain\` text, \`onboarding_draft_json\` text
);

CREATE TABLE \`attorneys\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`name\` text NOT NULL,
  \`email\` text NOT NULL,
  \`mobile\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
);

CREATE TABLE \`attorney_case_type_assignments\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`attorney_id\` text NOT NULL,
  \`account_id\` text NOT NULL,
  \`case_type_slug\` text NOT NULL,
  \`sub_type_slug\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`attorney_id\`) REFERENCES \`attorneys\`(\`id\`)
);

CREATE TABLE \`leads\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`session_id\` text NOT NULL,
  \`classification\` text NOT NULL,
  \`created_at\` text NOT NULL,
  \`reverted_at\` text
);

CREATE TABLE \`notifications\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`type\` text NOT NULL,
  \`title\` text NOT NULL,
  \`body\` text NOT NULL,
  \`lead_id\` text,
  \`attorney_id\` text,
  \`read\` integer DEFAULT 0 NOT NULL,
  \`delivery_channel\` text DEFAULT 'dashboard' NOT NULL,
  \`delivered_at\` text,
  \`created_at\` text NOT NULL
);
`;

const ACCT = 'acct_routing_test';
const NOW = '2026-06-21T10:00:00.000Z';

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) {
    sqlite.exec(stmt);
  }
  sqlite.exec(`INSERT INTO accounts (id, email, password_hash, firm_name, created_at) VALUES ('${ACCT}', 'firm@test.com', 'hash', 'Test Firm', '${NOW}')`);
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS notifications');
  sqlite.exec('DROP TABLE IF EXISTS attorney_case_type_assignments');
  sqlite.exec('DROP TABLE IF EXISTS attorneys');
  sqlite.exec('DROP TABLE IF EXISTS leads');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// T019 — getAttorneysForCaseType
// ---------------------------------------------------------------------------

describe('getAttorneysForCaseType — T019', () => {
  it('returns only attorneys matching the given case type slug', async () => {
    await db.insert(schema.attorneys).values([
      { id: 'atty_dui', account_id: ACCT, name: 'Sarah Kim', email: 'sarah@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
      { id: 'atty_pi', account_id: ACCT, name: 'John Doe', email: 'john@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_1', attorney_id: 'atty_dui', account_id: ACCT, case_type_slug: 'dui', created_at: NOW },
      { id: 'ass_2', attorney_id: 'atty_pi', account_id: ACCT, case_type_slug: 'personal_injury', created_at: NOW },
    ]);

    const result = await getAttorneysForCaseType(ACCT, 'dui');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('atty_dui');
    expect(result[0]!.email).toBe('sarah@firm.com');
  });

  it('returns empty array when no attorneys match the slug', async () => {
    await db.insert(schema.attorneys).values([
      { id: 'atty_pi', account_id: ACCT, name: 'John Doe', email: 'john@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_1', attorney_id: 'atty_pi', account_id: ACCT, case_type_slug: 'personal_injury', created_at: NOW },
    ]);

    const result = await getAttorneysForCaseType(ACCT, 'dui');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T020 — enqueueAttorneyRoutingNotifications
// ---------------------------------------------------------------------------

describe('enqueueAttorneyRoutingNotifications — T020', () => {
  beforeEach(async () => {
    sqlite.exec(`INSERT INTO leads VALUES ('lead_1', '${ACCT}', 'sess_1', 'HOT', '${NOW}', null)`);
  });

  it('inserts one email-channel notification per matching attorney', async () => {
    await db.insert(schema.attorneys).values([
      { id: 'atty_dui', account_id: ACCT, name: 'Sarah Kim', email: 'sarah@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_1', attorney_id: 'atty_dui', account_id: ACCT, case_type_slug: 'dui', created_at: NOW },
    ]);

    await enqueueAttorneyRoutingNotifications({
      accountId: ACCT,
      leadId: 'lead_1',
      caseTypeSlug: 'dui',
      leadName: 'Pat Driver',
      leadEmail: 'pat@gmail.com',
      leadPhone: '+15551112222',
      leadDescription: 'DUI arrest last night',
      capturedAt: NOW,
    });

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.delivery_channel, 'email'));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe('attorney_lead_routing');
    expect(rows[0]!.attorney_id).toBe('atty_dui');
    expect(rows[0]!.lead_id).toBe('lead_1');
    // delivered_at is null until runAfterResponse fires (mocked as no-op here)
    expect(rows[0]!.delivery_channel).toBe('email');
  });

  it('inserts zero notifications when no attorneys match the case type', async () => {
    await db.insert(schema.attorneys).values([
      { id: 'atty_pi', account_id: ACCT, name: 'John Doe', email: 'john@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_1', attorney_id: 'atty_pi', account_id: ACCT, case_type_slug: 'personal_injury', created_at: NOW },
    ]);

    await enqueueAttorneyRoutingNotifications({
      accountId: ACCT,
      leadId: 'lead_1',
      caseTypeSlug: 'dui', // no attorney assigned to this
      leadName: null,
      leadEmail: null,
      leadPhone: null,
      leadDescription: null,
      capturedAt: NOW,
    });

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.delivery_channel, 'email'));
    expect(rows).toHaveLength(0);
  });

  it('prefers sub-type-assigned attorney when sub-type is provided', async () => {
    // Insert two attorneys: one assigned to case-type only, one to sub-type
    await db.insert(schema.attorneys).values([
      { id: 'atty_case_level', account_id: ACCT, name: 'General DUI Attorney', email: 'general@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
      { id: 'atty_subtype', account_id: ACCT, name: 'First Offense Specialist', email: 'specialist@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    // Case-type-level assignment (sub_type_slug IS NULL)
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_case', attorney_id: 'atty_case_level', account_id: ACCT, case_type_slug: 'dui', sub_type_slug: null, created_at: NOW },
    ]);
    // Sub-type-level assignment
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_sub', attorney_id: 'atty_subtype', account_id: ACCT, case_type_slug: 'dui', sub_type_slug: 'first_offense', created_at: NOW },
    ]);

    await enqueueAttorneyRoutingNotifications({
      accountId: ACCT,
      leadId: 'lead_1',
      caseTypeSlug: 'dui',
      subTypeSlug: 'first_offense',
      leadName: 'John Doe',
      leadEmail: 'john@example.com',
      leadPhone: '+15551234567',
      leadDescription: 'First time DUI offense',
      capturedAt: NOW,
    });

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.delivery_channel, 'email'));

    // Should only notify the sub-type specialist, not the case-type-level attorney
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attorney_id).toBe('atty_subtype');
    expect(rows[0]!.type).toBe('attorney_lead_routing');
  });

  it('falls back to case-type attorney when sub-type has no assignment', async () => {
    // Only a case-type-level attorney exists
    await db.insert(schema.attorneys).values([
      { id: 'atty_case_level', account_id: ACCT, name: 'General DUI Attorney', email: 'general@firm.com', mobile: null, created_at: NOW, updated_at: NOW },
    ]);
    await db.insert(schema.attorneyCaseTypeAssignments).values([
      { id: 'ass_case', attorney_id: 'atty_case_level', account_id: ACCT, case_type_slug: 'dui', sub_type_slug: null, created_at: NOW },
    ]);

    await enqueueAttorneyRoutingNotifications({
      accountId: ACCT,
      leadId: 'lead_1',
      caseTypeSlug: 'dui',
      subTypeSlug: 'repeat_offense',  // No attorney assigned to this sub-type
      leadName: 'Jane Doe',
      leadEmail: 'jane@example.com',
      leadPhone: '+15559876543',
      leadDescription: 'Repeat DUI offense',
      capturedAt: NOW,
    });

    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.delivery_channel, 'email'));

    // Should fall back to case-type-level attorney
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attorney_id).toBe('atty_case_level');
  });
});
