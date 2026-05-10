import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Mock ../db/index.js with an in-memory SQLite database.
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
// directly gets the SQLite-compatible test schema.
vi.mock('../db/schema.js', async () => {
  return await import('../db/test-schema.js');
});

// Import module under test AFTER mock declaration (vitest hoists vi.mock)
import { extractPartialLeadData, savePartialLead } from './partial-lead.js';
import { db } from '../db/index.js';
import * as schema from '../db/test-schema.js';

// Access the raw sqlite handle for DDL operations
const { __sqlite: sqlite } = (await import('../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

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

const TEST_ACCOUNT_ID = 'acct_test_partial';
const TEST_SESSION_ID = 'sess_test_partial';

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) {
    sqlite.exec(stmt);
  }

  (db as any)
    .insert(schema.accounts)
    .values({
      id: TEST_ACCOUNT_ID,
      email: 'partial@example.com',
      password_hash: 'hash_placeholder',
      created_at: new Date().toISOString(),
    })
    .run();

  const now = new Date().toISOString();
  (db as any)
    .insert(schema.sessions)
    .values({
      id: TEST_SESSION_ID,
      account_id: TEST_ACCOUNT_ID,
      messages_json: '[]',
      is_preview: false,
      created_at: now,
      updated_at: now,
    })
    .run();
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS notifications');
  sqlite.exec('DROP TABLE IF EXISTS leads');
  sqlite.exec('DROP TABLE IF EXISTS sessions');
  sqlite.exec('DROP INDEX IF EXISTS accounts_email_unique');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// extractPartialLeadData — pure function tests (no DB needed)
// ---------------------------------------------------------------------------
describe('extractPartialLeadData', () => {
  it('extracts email from user messages', () => {
    const messages = [
      { role: 'user', content: 'My email is john@example.com' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.contactEmail).toBe('john@example.com');
  });

  it('extracts phone number from user messages', () => {
    const messages = [
      { role: 'user', content: 'You can call me at (555) 123-4567' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.contactPhone).toBe('(555) 123-4567');
  });

  it('extracts phone with dots as separators', () => {
    const messages = [
      { role: 'user', content: 'My number is 555.123.4567' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.contactPhone).toBe('555.123.4567');
  });

  it('extracts name from "my name is X" pattern', () => {
    const messages = [
      { role: 'user', content: 'My name is John Smith' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBe('John Smith');
  });

  it('extracts name from "I\'m X" pattern', () => {
    const messages = [
      { role: 'user', content: "I'm Sarah Connor and I need help" },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBe('Sarah Connor');
  });

  it('extracts name from "I am X" pattern', () => {
    const messages = [
      { role: 'user', content: 'I am Michael Johnson, I was in an accident' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBe('Michael Johnson');
  });

  it('returns null for all fields when no data present', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello! How can I help?' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBeNull();
    expect(result.contactEmail).toBeNull();
    expect(result.contactPhone).toBeNull();
    expect(result.briefDescription).toBeNull();
  });

  it('uses first substantive user message (>20 chars) as brief description', () => {
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'I was in a car accident last week and need legal help' },
      { role: 'user', content: 'Another longer message about details' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.briefDescription).toBe(
      'I was in a car accident last week and need legal help',
    );
  });

  it('handles multiple user messages combining data', () => {
    const messages = [
      { role: 'user', content: 'My name is Alice Brown' },
      { role: 'assistant', content: 'Hi Alice, how can I help?' },
      { role: 'user', content: 'I had a slip and fall, my email is alice@test.com' },
      { role: 'assistant', content: 'Can I get your phone number?' },
      { role: 'user', content: 'Sure, 555-987-6543' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBe('Alice Brown');
    expect(result.contactEmail).toBe('alice@test.com');
    expect(result.contactPhone).toBe('555-987-6543');
    // "My name is Alice Brown" is 22 chars (>20), so it is the first substantive message
    expect(result.briefDescription).toBe('My name is Alice Brown');
  });

  it('ignores assistant messages for extraction', () => {
    const messages = [
      { role: 'assistant', content: 'My name is LegalBot, email me at bot@firm.com' },
      { role: 'user', content: 'Hello' },
    ];
    const result = extractPartialLeadData(messages);
    expect(result.name).toBeNull();
    expect(result.contactEmail).toBeNull();
  });

  it('handles empty messages array', () => {
    const result = extractPartialLeadData([]);
    expect(result.name).toBeNull();
    expect(result.contactEmail).toBeNull();
    expect(result.contactPhone).toBeNull();
    expect(result.briefDescription).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// savePartialLead — database tests
// ---------------------------------------------------------------------------
describe('savePartialLead', () => {
  it('saves partial lead when there is useful data', async () => {
    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: 'Jane',
      contactEmail: 'jane@example.com',
      contactPhone: null,
      briefDescription: null,
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Jane');
    expect(rows[0].contact_email).toBe('jane@example.com');
    expect(rows[0].classification).toBe('unqualified');
    expect(rows[0].classification_rationale).toBe(
      'Partial data from abandoned session',
    );
  });

  it('skips saving when no useful data is present', async () => {
    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: null,
      contactEmail: null,
      contactPhone: null,
      briefDescription: null,
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    expect(rows).toHaveLength(0);
  });

  it('skips saving when a full lead already exists for the session', async () => {
    // Insert a full lead first
    (db as any)
      .insert(schema.leads)
      .values({
        id: 'existing_lead_001',
        account_id: TEST_ACCOUNT_ID,
        session_id: TEST_SESSION_ID,
        name: 'Existing Lead',
        contact_email: 'existing@example.com',
        contact_phone: null,
        case_type: 'Personal Injury',
        incident_date: null,
        brief_description: 'Already captured',
        classification: 'normal',
        classification_rationale: 'Full lead capture',
        urgency_factors_json: '[]',
        status: 'new',
        created_at: new Date().toISOString(),
      })
      .run();

    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: 'Different Name',
      contactEmail: 'different@example.com',
      contactPhone: null,
      briefDescription: null,
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    // Should still have only the original lead, not a second one
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('existing_lead_001');
  });

  it('saves when only briefDescription is available', async () => {
    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: null,
      contactEmail: null,
      contactPhone: null,
      briefDescription: 'I was in a car accident and need help',
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].brief_description).toBe(
      'I was in a car accident and need help',
    );
  });

  it('saves when only contactPhone is available', async () => {
    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: null,
      contactEmail: null,
      contactPhone: '555-123-4567',
      briefDescription: null,
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    expect(rows).toHaveLength(1);
    expect(rows[0].contact_phone).toBe('555-123-4567');
  });

  it('saves with name-only still skips (name alone is not enough)', async () => {
    await savePartialLead(TEST_ACCOUNT_ID, TEST_SESSION_ID, {
      name: 'Just A Name',
      contactEmail: null,
      contactPhone: null,
      briefDescription: null,
    });

    const rows = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();

    // Name alone doesn't trigger save — need email, phone, or description
    expect(rows).toHaveLength(0);
  });
});
