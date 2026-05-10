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

// Import module under test AFTER mock declaration (vitest hoists vi.mock)
import { createSession, getSessionMessages, appendMessages, sessionExists } from './session.js';
import { db, schema } from '../db/index.js';

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
`;

const TEST_ACCOUNT_ID = 'acct_test_001';

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
});

afterEach(() => {
  sqlite.exec('DROP TABLE IF EXISTS sessions');
  sqlite.exec('DROP INDEX IF EXISTS accounts_email_unique');
  sqlite.exec('DROP TABLE IF EXISTS accounts');
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe('createSession', () => {
  it('returns a session ID starting with "sess_"', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    expect(id).toMatch(/^sess_/);
  });

  it('creates a session that can be found in the database', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const row = (db as any)
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get();
    expect(row).toBeDefined();
    expect(row!.account_id).toBe(TEST_ACCOUNT_ID);
  });

  it('with isPreview=true creates a preview session', async () => {
    const id = await createSession(TEST_ACCOUNT_ID, true);
    const row = (db as any)
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get();
    expect(row).toBeDefined();
    expect(row!.is_preview).toBeTruthy();
  });

  it('defaults is_preview to 0', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const row = (db as any)
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .get();
    expect(row!.is_preview).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// getSessionMessages
// ---------------------------------------------------------------------------
describe('getSessionMessages', () => {
  it('returns empty array for new session', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const messages = await getSessionMessages(id);
    expect(messages).toEqual([]);
  });

  it('returns empty array for non-existent session', async () => {
    const messages = await getSessionMessages('sess_does_not_exist');
    expect(messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendMessages
// ---------------------------------------------------------------------------
describe('appendMessages', () => {
  it('adds messages to a session', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const msgs = [{ role: 'user' as const, content: 'Hello' }];

    await appendMessages(id, msgs);

    const retrieved = await getSessionMessages(id);
    expect(retrieved).toEqual(msgs);
  });

  it('preserves existing messages when appending', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const first = [{ role: 'user' as const, content: 'Hello' }];
    const second = [{ role: 'assistant' as const, content: 'Hi there' }];

    await appendMessages(id, first);
    await appendMessages(id, second);

    const retrieved = await getSessionMessages(id);
    expect(retrieved).toEqual([...first, ...second]);
  });
});

// ---------------------------------------------------------------------------
// sessionExists
// ---------------------------------------------------------------------------
describe('sessionExists', () => {
  it('returns true for existing session', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    expect(await sessionExists(id)).toBe(true);
  });

  it('returns false for non-existent session', async () => {
    expect(await sessionExists('sess_nope')).toBe(false);
  });
});
