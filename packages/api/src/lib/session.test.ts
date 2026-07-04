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
import { createSession, getSessionMessages, appendMessages, sessionExists, appendMessagesAndSOPState } from './session.js';
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
  \`sop_state_json\` text,
  \`sop_state_history_json\` text,
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

// ---------------------------------------------------------------------------
// T009 — 021-chat-api-latency: appendMessagesAndSOPState issues exactly ONE
// database operation (an UPDATE, no SELECT).
// (Written first per Constitution III; MUST fail until T022 lands)
// ---------------------------------------------------------------------------
describe('appendMessagesAndSOPState — 021 new 4-arg signature (T009 / T010)', () => {
  it('(T009) appends new messages to the provided existingHistory without issuing a SELECT', async () => {
    // Arrange: create a session, seed it with one message via direct DB update.
    const id = await createSession(TEST_ACCOUNT_ID);
    const existing = [{ role: 'user' as const, content: 'first message' }];
    // Seed the session row directly (no appendMessages so we control state).
    await db.update(schema.sessions)
      .set({ messages_json: JSON.stringify(existing) })
      .where(eq(schema.sessions.id, id));

    const newUser = { role: 'user' as const, content: 'second message' };
    const newAssistant = { role: 'assistant' as const, content: 'reply' };

    // Act: call the new 4-arg signature — pass existing history, new messages, sopState=null.
    await appendMessagesAndSOPState(id, existing, [newUser, newAssistant], null);

    // Assert: all three messages are in the row.
    const retrieved = await getSessionMessages(id);
    expect(retrieved).toEqual([...existing, newUser, newAssistant]);
  });

  it('(T010) cold-session path: writes exactly the new messages when existingHistory is []', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);

    const newUser = { role: 'user' as const, content: 'hello' };
    const newAssistant = { role: 'assistant' as const, content: 'hi there' };

    await appendMessagesAndSOPState(id, [], [newUser, newAssistant], null);

    const retrieved = await getSessionMessages(id);
    expect(retrieved).toEqual([newUser, newAssistant]);
  });

  it('persists sopState when provided', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const sopState = {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-01-01T00:00:00.000Z',
      steps: [],
      qualified_lead_threshold: 3,
      current_progress: 0,
      is_finalized: false,
      out_of_scope_termination: false,
    };

    await appendMessagesAndSOPState(id, [], [{ role: 'user' as const, content: 'msg' }], sopState as any);

    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, id));
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row!.sop_state_json).not.toBeNull();
    const parsed = JSON.parse(row!.sop_state_json!);
    expect(parsed.sop_configuration_id).toBe('cfg_test');
  });
});
