import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock ../db/index.js with an in-memory SQLite database.
// The factory is async so we can use dynamic imports inside vi.mock.
// ---------------------------------------------------------------------------
vi.mock('../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../db/test-schema.js');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

// Mock ../db/schema.js so that library code importing table definitions
// directly (e.g. `import { leads, notifications } from '../db/schema'`)
// gets the SQLite-compatible test schema instead of the pg schema.
vi.mock('../db/schema.js', async () => {
  return await import('../db/test-schema.js');
});

// Import module under test AFTER mock declaration (vitest hoists vi.mock)
import { captureLead } from './leads.js';
import { db } from '../db/index.js';
import * as schema from '../db/test-schema.js';

// Access the raw sqlite handle for DDL operations
const { __sqlite: sqlite } = await import('../db/index.js') as unknown as { __sqlite: import('better-sqlite3').Database };

// ---------------------------------------------------------------------------
// Migration SQL (creates all tables needed for FK constraints)
// ---------------------------------------------------------------------------
const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`email\` text NOT NULL,
  \`password_hash\` text NOT NULL,
  \`firm_name\` text,
  \`created_at\` text NOT NULL
);
CREATE UNIQUE INDEX \`accounts_email_unique\` ON \`accounts\` (\`email\`);

CREATE TABLE \`sessions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`messages_json\` text DEFAULT '[]' NOT NULL,
  \`is_preview\` integer DEFAULT 0 NOT NULL,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE \`leads\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`session_id\` text NOT NULL,
  \`name\` text,
  \`contact_email\` text,
  \`contact_phone\` text,
  \`case_type\` text,
  \`incident_date\` text,
  \`brief_description\` text,
  \`classification\` text NOT NULL,
  \`classification_rationale\` text,
  \`urgency_factors_json\` text,
  \`status\` text DEFAULT 'new' NOT NULL,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE \`notifications\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`type\` text NOT NULL,
  \`title\` text NOT NULL,
  \`body\` text NOT NULL,
  \`lead_id\` text,
  \`read\` integer DEFAULT 0 NOT NULL,
  \`delivery_channel\` text DEFAULT 'dashboard' NOT NULL,
  \`delivered_at\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (\`lead_id\`) REFERENCES \`leads\`(\`id\`) ON UPDATE no action ON DELETE no action
);
`;

const TEST_ACCOUNT_ID = 'acct_test_001';
const TEST_SESSION_ID = 'sess_test_001';

// ---------------------------------------------------------------------------
// Helper: build a default CaptureLeadInput
// ---------------------------------------------------------------------------
function makeLeadInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: TEST_ACCOUNT_ID,
    sessionId: TEST_SESSION_ID,
    name: 'Jane Doe',
    contactEmail: 'jane@example.com',
    contactPhone: '555-0100',
    caseType: 'Personal Injury',
    incidentDate: '2026-01-15',
    briefDescription: 'Slip and fall at grocery store',
    classification: 'normal' as const,
    classificationRationale: 'Standard slip and fall case',
    urgencyFactors: ['recent_incident'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) {
    sqlite.exec(stmt);
  }

  // Insert test account (FK requirement)
  (db as any).insert(schema.accounts).values({
    id: TEST_ACCOUNT_ID,
    email: 'test@example.com',
    password_hash: 'hash_placeholder',
    created_at: new Date().toISOString(),
  }).run();

  // Insert test session (FK requirement for leads)
  const now = new Date().toISOString();
  (db as any).insert(schema.sessions).values({
    id: TEST_SESSION_ID,
    account_id: TEST_ACCOUNT_ID,
    messages_json: '[]',
    is_preview: false,
    created_at: now,
    updated_at: now,
  }).run();
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS notifications');
  sqlite.exec('DROP TABLE IF EXISTS leads');
  sqlite.exec('DROP TABLE IF EXISTS sessions');
  sqlite.exec('DROP INDEX IF EXISTS accounts_email_unique');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// captureLead
// ---------------------------------------------------------------------------
describe('captureLead', () => {
  it('returns a leadId and classification', async () => {
    const result = await captureLead(makeLeadInput());
    expect(result.leadId).toBeDefined();
    expect(typeof result.leadId).toBe('string');
    expect(result.classification).toBe('normal');
  });

  it('with "normal" classification does NOT create a notification', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'normal' }));

    const notifs = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .all();
    expect(notifs).toHaveLength(0);
  });

  it('with "urgent" classification DOES create a notification', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'urgent' }));

    const notifs = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .all();
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe('urgent_lead');
  });

  it('stores all lead fields correctly in the database', async () => {
    const input = makeLeadInput();
    const result = await captureLead(input);

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row).toBeDefined();
    expect(row!.account_id).toBe(input.accountId);
    expect(row!.session_id).toBe(input.sessionId);
    expect(row!.name).toBe(input.name);
    expect(row!.contact_email).toBe(input.contactEmail);
    expect(row!.contact_phone).toBe(input.contactPhone);
    expect(row!.case_type).toBe(input.caseType);
    expect(row!.incident_date).toBe(input.incidentDate);
    expect(row!.brief_description).toBe(input.briefDescription);
    expect(row!.classification).toBe(input.classification);
    expect(row!.classification_rationale).toBe(input.classificationRationale);
    expect(row!.status).toBe('new');
  });

  it('with null optional fields works correctly', async () => {
    const input = makeLeadInput({
      name: null,
      contactEmail: null,
      contactPhone: null,
      caseType: null,
      incidentDate: null,
      briefDescription: null,
    });
    const result = await captureLead(input);

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row).toBeDefined();
    expect(row!.name).toBeNull();
    expect(row!.contact_email).toBeNull();
    expect(row!.contact_phone).toBeNull();
    expect(row!.case_type).toBeNull();
    expect(row!.incident_date).toBeNull();
    expect(row!.brief_description).toBeNull();
  });

  it('stores urgency_factors_json as JSON string', async () => {
    const factors = ['statute_of_limitations', 'severe_injury'];
    const result = await captureLead(makeLeadInput({ urgencyFactors: factors }));

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row!.urgency_factors_json).toBe(JSON.stringify(factors));
  });

  it('with "unqualified" classification works correctly', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'unqualified' }));
    expect(result.classification).toBe('unqualified');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row!.classification).toBe('unqualified');

    // No notification for unqualified
    const notifs = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .all();
    expect(notifs).toHaveLength(0);
  });

  it('urgent notification has correct title format', async () => {
    const result = await captureLead(
      makeLeadInput({ classification: 'urgent', caseType: 'Medical Malpractice' })
    );

    const notif = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .get();

    expect(notif).toBeDefined();
    expect(notif!.title).toBe('New Urgent Lead: Medical Malpractice');
  });

  it('urgent notification references the lead_id', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'urgent' }));

    const notif = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .get();

    expect(notif).toBeDefined();
    expect(notif!.lead_id).toBe(result.leadId);
  });
});
