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
  \`sop_state_json\` text,
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

// ---------------------------------------------------------------------------
// 010-sop-workflow T026: SOP state snapshot persistence (paired with T032)
// ---------------------------------------------------------------------------
describe('captureLead — SOP state snapshot (010-sop-workflow)', () => {
  const SAMPLE_SOP_STATE = {
    sop_configuration_id: 'cfg_test',
    sop_version: 1,
    conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
    steps: [
      {
        step_id: 'step_1',
        slug: 'case_type',
        status: 'complete' as const,
        captured_value: 'dui',
        captured_at: '2026-05-23T10:01:00.000Z',
        inferred: false,
      },
    ],
    qualified_lead_threshold: 5,
    current_progress: 1,
    is_finalized: true,
    out_of_scope_termination: false,
  };

  it('with sopState=null persists null sop_state_snapshot (legacy backward compat)', async () => {
    const result = await captureLead(makeLeadInput({ sopState: null }));

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row!.sop_state_snapshot).toBeNull();
  });

  it('with sopState omitted entirely persists null sop_state_snapshot', async () => {
    // Backward compatibility: existing call sites that don't pass the
    // optional `sopState` parameter must continue to work.
    const result = await captureLead(makeLeadInput());

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row!.sop_state_snapshot).toBeNull();
  });

  it('with populated sopState persists JSON-serialized snapshot', async () => {
    const result = await captureLead(makeLeadInput({ sopState: SAMPLE_SOP_STATE }));

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    expect(row!.sop_state_snapshot).not.toBeNull();
    const parsed = JSON.parse(row!.sop_state_snapshot);
    expect(parsed.sop_configuration_id).toBe('cfg_test');
    expect(parsed.is_finalized).toBe(true);
    expect(parsed.steps[0].slug).toBe('case_type');
  });

  it('snapshot roundtrips Zod-valid against sopStateSchema', async () => {
    const { sopStateSchema } = await import('@legal-chatbot/shared');
    const result = await captureLead(makeLeadInput({ sopState: SAMPLE_SOP_STATE }));

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    const parsed = JSON.parse(row!.sop_state_snapshot);
    expect(() => sopStateSchema.parse(parsed)).not.toThrow();
  });

  it('preserves out_of_scope_termination flag through the roundtrip', async () => {
    const oosState = { ...SAMPLE_SOP_STATE, out_of_scope_termination: true };
    const result = await captureLead(makeLeadInput({ sopState: oosState }));

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();

    const parsed = JSON.parse(row!.sop_state_snapshot);
    expect(parsed.out_of_scope_termination).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 010-sop-workflow: per-session dedup (multi-call captureLead bug fix)
// ---------------------------------------------------------------------------
//
// Surfaced during live verification on 2026-05-23: the LLM ignored the
// system-prompt instruction "Call captureLead exactly ONCE per
// conversation" and invoked the tool 3 times in one session. Each call
// inserted a separate leads row. The dashboard would see 3 leads for
// what's actually one visitor.
//
// Server-side dedup: if a lead already exists for the session, UPDATE
// the existing row rather than insert a new one. The latest call's
// fields win (the LLM's later judgment generally has more context).
// Notification fires when classification transitions normal/unqualified
// → urgent on the same row.

describe('captureLead — per-session dedup (multi-call fix)', () => {
  it('second call for the same session UPDATES the existing row instead of inserting', async () => {
    const r1 = await captureLead(makeLeadInput({
      caseType: 'DUI', incidentDate: null, briefDescription: 'Initial brief',
    }));
    const r2 = await captureLead(makeLeadInput({
      caseType: 'DUI', incidentDate: '2026-05-22',
      briefDescription: 'Refined brief with more context',
    }));

    expect(r2.leadId).toBe(r1.leadId);

    const all = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .all();
    expect(all).toHaveLength(1);

    const row = all[0];
    expect(row.case_type).toBe('DUI');
    expect(row.incident_date).toBe('2026-05-22');
    expect(row.brief_description).toBe('Refined brief with more context');
  });

  it('different sessions still each get their own lead row', async () => {
    // Need a second session in the FK chain.
    (db as any).insert(schema.sessions).values({
      id: 'sess_test_002',
      account_id: TEST_ACCOUNT_ID,
      messages_json: '[]',
      is_preview: false,
      sop_state_json: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).run();

    const r1 = await captureLead(makeLeadInput({ sessionId: TEST_SESSION_ID }));
    const r2 = await captureLead(makeLeadInput({ sessionId: 'sess_test_002' }));

    expect(r2.leadId).not.toBe(r1.leadId);

    const all = (db as any).select().from(schema.leads).all();
    expect(all).toHaveLength(2);
  });

  it('classification escalation normal→urgent on update fires a new notification', async () => {
    // First call: normal. No notification.
    await captureLead(makeLeadInput({ classification: 'normal' }));
    let notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(0);

    // Second call: urgent. Notification fires for the (now-updated) lead.
    const r2 = await captureLead(makeLeadInput({
      classification: 'urgent',
      caseType: 'DUI',
      urgencyFactors: ['recent_arrest'],
    }));
    notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(1);
    expect(notifs[0].lead_id).toBe(r2.leadId);
    expect(notifs[0].title).toContain('DUI');
  });

  it('repeated urgent calls do NOT fire duplicate notifications', async () => {
    await captureLead(makeLeadInput({ classification: 'urgent' }));
    await captureLead(makeLeadInput({ classification: 'urgent', caseType: 'DUI Updated' }));

    const notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(1);
  });

  it('downgrade urgent→normal on update does NOT fire a notification', async () => {
    // Edge case: LLM initially classified urgent, then downgraded.
    await captureLead(makeLeadInput({ classification: 'urgent' }));
    let notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(1); // from first call

    await captureLead(makeLeadInput({ classification: 'normal' }));
    notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    // No new notification on downgrade — one total still.
    expect(notifs).toHaveLength(1);

    // The lead row's classification reflects the latest value.
    const lead = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(lead.classification).toBe('normal');
  });

  it('updates sop_state_snapshot when the second call provides a richer SOP state', async () => {
    const partialState = {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_1', slug: 'case_type', status: 'complete' as const,
          captured_value: 'dui', captured_at: '2026-05-23T10:01:00.000Z', inferred: false },
      ],
      qualified_lead_threshold: 5,
      current_progress: 1,
      is_finalized: false,
      out_of_scope_termination: false,
    };
    const fullState = { ...partialState, current_progress: 5, is_finalized: true };

    await captureLead(makeLeadInput({ sopState: partialState }));
    await captureLead(makeLeadInput({ sopState: fullState }));

    const lead = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    const parsed = JSON.parse(lead.sop_state_snapshot);
    expect(parsed.current_progress).toBe(5);
    expect(parsed.is_finalized).toBe(true);
  });
});
