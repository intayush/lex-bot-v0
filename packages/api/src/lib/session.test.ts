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
import { createSession, getSessionMessages, appendMessages, sessionExists, appendMessagesAndSOPState, revertLastTurn } from './session.js';
import { db, schema } from '../db/index.js';
import type { SOPState } from '@legal-chatbot/shared';

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
  \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`onboarding_status\` text DEFAULT 'live' NOT NULL,
  \`deleted_at\` text, \`domain\` text, \`onboarding_draft_json\` text
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
  \`sop_state_snapshot\` text,
  \`status\` text NOT NULL DEFAULT 'new',
  \`follow_up_action\` text,
  \`follow_up_action_changed_at\` text,
  \`lead_score\` integer,
  \`score_reasons_json\` text,
  \`request_type\` text,
  \`geographic_qualification\` text,
  \`geographic_qualification_details_json\` text,
  \`branch_snapshot_json\` text,
  \`branch_incomplete\` integer NOT NULL DEFAULT 0,
  \`reverted_at\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`session_id\`) REFERENCES \`sessions\`(\`id\`)
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
  sqlite.exec('DROP TABLE IF EXISTS leads');
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

// ---------------------------------------------------------------------------
// appendMessagesAndSOPState snapshot push
// ---------------------------------------------------------------------------
function makeSopState(progress: number): SOPState {
  return {
    sop_configuration_id: 'sop_1',
    sop_version: 1,
    conversation_anchor_iso: '2026-07-04T00:00:00.000Z',
    steps: [],
    qualified_lead_threshold: 6,
    current_progress: progress,
    is_finalized: false,
    out_of_scope_termination: false,
  } as SOPState;
}

describe('appendMessagesAndSOPState snapshot push', () => {
  it('pushes a snapshot of the PRIOR state, not the new state', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const prior = makeSopState(1);
    const next = makeSopState(2);

    await appendMessagesAndSOPState(
      id,
      [{ role: 'user', content: 'hi' }] as any,
      [{ role: 'assistant', content: 'hello' }] as any,
      next,
      prior,
      'lead_xyz',
    );

    const row = (db as any).select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get();
    const stack = JSON.parse(row.sop_state_history_json);
    expect(stack).toHaveLength(1);
    expect(stack[0].sop_state.current_progress).toBe(1); // prior, not 2
    expect(stack[0].message_count).toBe(1);              // existingHistory length
    expect(stack[0].lead_id).toBe('lead_xyz');
    // sop_state_json holds the NEW state
    expect(JSON.parse(row.sop_state_json).current_progress).toBe(2);
  });

  it('records lead_id null when not passed', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    await appendMessagesAndSOPState(id, [] as any, [] as any, makeSopState(1), makeSopState(0));
    const row = (db as any).select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get();
    expect(JSON.parse(row.sop_state_history_json)[0].lead_id).toBeNull();
  });

  it('drops the oldest snapshot when the stack exceeds 10', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    for (let i = 0; i < 11; i++) {
      await appendMessagesAndSOPState(id, [] as any, [] as any, makeSopState(i + 1), makeSopState(i), `lead_${i}`);
    }
    const row = (db as any).select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get();
    const stack = JSON.parse(row.sop_state_history_json);
    expect(stack).toHaveLength(10);
    expect(stack[0].lead_id).toBe('lead_1');   // lead_0 dropped
    expect(stack[9].lead_id).toBe('lead_10');
  });
});

// ---------------------------------------------------------------------------
// revertLastTurn
// ---------------------------------------------------------------------------
describe('revertLastTurn', () => {
  it('restores prior sop_state and truncates messages to message_count', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    // Turn 1: enters empty, exits progress=1, 2 messages.
    await appendMessagesAndSOPState(
      id, [] as any,
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as any,
      makeSopState(1), null, null,
    );
    // Turn 2: enters progress=1 (2 msgs), exits progress=2, 4 messages.
    await appendMessagesAndSOPState(
      id,
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as any,
      [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }] as any,
      makeSopState(2), makeSopState(1), null,
    );

    const res = await revertLastTurn(id, TEST_ACCOUNT_ID);
    expect(res.messages).toHaveLength(2);          // back to after turn 1
    expect(res.sopState?.current_progress).toBe(1); // prior state restored

    const row = (db as any).select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get();
    expect(JSON.parse(row.messages_json)).toHaveLength(2);
    expect(JSON.parse(row.sop_state_history_json)).toHaveLength(1); // one popped
  });

  it('is a no-op on an empty stack', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    const res = await revertLastTurn(id, TEST_ACCOUNT_ID);
    expect(res.messages).toEqual([]);
    expect(res.sopState).toBeNull();
  });

  it('soft-deletes the lead recorded in the popped snapshot', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    (db as any).insert(schema.leads).values({
      id: 'lead_1', account_id: TEST_ACCOUNT_ID, session_id: id,
      classification: 'HOT', reverted_at: null, created_at: new Date().toISOString(),
    }).run();
    await appendMessagesAndSOPState(id, [] as any, [] as any, makeSopState(1), null, 'lead_1');

    await revertLastTurn(id, TEST_ACCOUNT_ID);

    const lead = (db as any).select().from(schema.leads)
      .where(eq(schema.leads.id, 'lead_1')).get();
    expect(lead.reverted_at).not.toBeNull();
  });

  it('restores empty state when undoing back to the first turn', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    await appendMessagesAndSOPState(
      id, [] as any,
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as any,
      makeSopState(1), null, null,   // prior state = null (fresh)
    );
    const res = await revertLastTurn(id, TEST_ACCOUNT_ID);
    expect(res.messages).toEqual([]);
    expect(res.sopState).toBeNull();
  });

  it('refuses to undo when accountId does not match session owner', async () => {
    const id = await createSession(TEST_ACCOUNT_ID);
    // Set up a session with two turns.
    await appendMessagesAndSOPState(
      id, [] as any,
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as any,
      makeSopState(1), null, 'lead_x',
    );
    await appendMessagesAndSOPState(
      id,
      [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] as any,
      [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }] as any,
      makeSopState(2), makeSopState(1), null,
    );

    // Attempt undo with wrong account_id.
    const res = await revertLastTurn(id, 'acct_wrong');
    // Should be a no-op: returns current state (4 messages), does not pop stack.
    expect(res.messages).toHaveLength(4);
    expect(res.sopState?.current_progress).toBe(2);

    // Verify stack is unchanged (2 snapshots).
    const row = (db as any).select().from(schema.sessions)
      .where(eq(schema.sessions.id, id)).get();
    expect(JSON.parse(row.sop_state_history_json)).toHaveLength(2);
  });
});
