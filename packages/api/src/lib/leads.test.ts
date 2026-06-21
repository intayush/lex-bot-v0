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
import { captureLead, updateLeadSOPState } from './leads.js';
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
  \`follow_up_action\` text,
  \`follow_up_action_changed_at\` text,
  \`lead_score\` integer,
  \`score_reasons_json\` text,
  \`request_type\` text,
  \`geographic_qualification\` text,
  \`geographic_qualification_details_json\` text,
  \`branch_snapshot_json\` text,
  \`branch_incomplete\` integer DEFAULT 0 NOT NULL,
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
  \`skip_condition_json\` text,
  \`applies_when_sub_type_slug\` text,
  FOREIGN KEY (\`sop_configuration_id\`) REFERENCES \`sop_configurations\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE \`case_types\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`slug\` text NOT NULL,
  \`label\` text NOT NULL,
  \`position\` integer NOT NULL,
  \`is_in_scope\` integer DEFAULT 1 NOT NULL,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE \`sub_types\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`case_type_id\` text NOT NULL,
  \`slug\` text NOT NULL,
  \`label\` text NOT NULL,
  \`position\` integer NOT NULL,
  \`scoring_config_json\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`case_type_id\`) REFERENCES \`case_types\`(\`id\`) ON UPDATE no action ON DELETE no action
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
    // NOTE: avoid `@example.com` / `@test.com` and `test@…` patterns —
    // they trip the `fake_info` hard-override and downgrade every
    // captured lead to SPAM, masking the behaviour these tests want
    // to exercise. Use a vanilla TLD instead.
    contactEmail: 'jane@gmail.com',
    contactPhone: '555-0100',
    caseType: 'Personal Injury',
    incidentDate: '2026-01-15',
    briefDescription: 'Slip and fall at grocery store',
    classification: 'WARM' as const,
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
  sqlite.exec('DROP TABLE IF EXISTS sub_types');
  sqlite.exec('DROP TABLE IF EXISTS case_types');
  sqlite.exec('DROP TABLE IF EXISTS sop_steps');
  sqlite.exec('DROP TABLE IF EXISTS sop_configurations');
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
    expect(result.classification).toBe('WARM');
  });

  it('with "normal" classification does NOT create a notification', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'WARM' }));

    const notifs = (db as any)
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.lead_id, result.leadId))
      .all();
    expect(notifs).toHaveLength(0);
  });

  it('with "urgent" classification DOES create a notification', async () => {
    const result = await captureLead(makeLeadInput({ classification: 'HOT' }));

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

  it('throws when both contact_email and contact_phone are null (FR-002b partial-gate)', async () => {
    // Spec 016 FR-002b / SC-003: every captured lead must carry at
    // least one reachable channel. captureLead refuses to insert a
    // row that violates this invariant. The chat route's contact-
    // form short-circuit + retry flow guarantee contact is on file
    // before captureLead fires; this guard catches buggy upstream
    // paths that would otherwise create invalid leads.
    const input = makeLeadInput({
      name: null,
      contactEmail: null,
      contactPhone: null,
      caseType: null,
      incidentDate: null,
      briefDescription: null,
    });
    await expect(captureLead(input)).rejects.toThrow(/at least one of contactEmail or contactPhone/);
  });

  it('accepts email-only payload (partial-gate satisfied with phone null)', async () => {
    const input = makeLeadInput({
      name: null,
      contactEmail: 'visitor@example.com',
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
    expect(row!.contact_email).toBe('visitor@example.com');
    expect(row!.contact_phone).toBeNull();
  });

  it('accepts phone-only payload (partial-gate satisfied with email null)', async () => {
    const input = makeLeadInput({
      name: null,
      contactEmail: null,
      contactPhone: '+15555555555',
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
    expect(row!.contact_email).toBeNull();
    expect(row!.contact_phone).toBe('+15555555555');
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
    const result = await captureLead(makeLeadInput({ classification: 'SPAM' }));
    expect(result.classification).toBe('SPAM');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row!.classification).toBe('SPAM');

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
      makeLeadInput({ classification: 'HOT', caseType: 'Medical Malpractice' })
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
    const result = await captureLead(makeLeadInput({ classification: 'HOT' }));

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
    await captureLead(makeLeadInput({ classification: 'WARM' }));
    let notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(0);

    // Second call: urgent. Notification fires for the (now-updated) lead.
    const r2 = await captureLead(makeLeadInput({
      classification: 'HOT',
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
    await captureLead(makeLeadInput({ classification: 'HOT' }));
    await captureLead(makeLeadInput({ classification: 'HOT', caseType: 'DUI Updated' }));

    const notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(1);
  });

  it('downgrade urgent→normal on update does NOT fire a notification', async () => {
    // Edge case: LLM initially classified urgent, then downgraded.
    await captureLead(makeLeadInput({ classification: 'HOT' }));
    let notifs = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifs).toHaveLength(1); // from first call

    await captureLead(makeLeadInput({ classification: 'WARM' }));
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
    expect(lead.classification).toBe('WARM');
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

// ---------------------------------------------------------------------------
// 010-sop-workflow: server-side incident_date override from SOP when-step
// ---------------------------------------------------------------------------
//
// Live verification on 2026-05-23 surfaced this: the LLM passed verbatim
// phrases like 'last night' as incidentDate even when the SOP runtime had
// captured an ISO date in the when step. The SOP runtime is the source of
// truth; the LLM's interpretation is advisory. captureLead now overrides
// incidentDate with the SOP's when-step value when it's a valid ISO date.

describe('captureLead — SOP when-step incident_date override', () => {
  const T1 = '2026-05-23T10:01:00.000Z';

  function buildSOPStateWithWhen(whenValue: string | null) {
    return {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_1', slug: 'case_type', status: 'complete' as const,
          captured_value: 'dui', captured_at: T1, inferred: false },
        { step_id: 'step_5', slug: 'when',
          status: (whenValue ? 'complete' : 'pending') as 'complete' | 'pending',
          captured_value: whenValue, captured_at: whenValue ? T1 : null, inferred: false },
      ],
      qualified_lead_threshold: 5,
      current_progress: whenValue ? 2 : 1,
      is_finalized: false,
      out_of_scope_termination: false,
    };
  }

  it('overrides LLM incidentDate with SOP when-step ISO value', async () => {
    const result = await captureLead(makeLeadInput({
      incidentDate: 'last night', // LLM's verbatim phrase
      sopState: buildSOPStateWithWhen('2026-05-22'),
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('2026-05-22');
  });

  it('overrides on UPDATE path too (second call)', async () => {
    await captureLead(makeLeadInput({
      incidentDate: null,
      sopState: buildSOPStateWithWhen(null),
    }));
    const result = await captureLead(makeLeadInput({
      incidentDate: 'yesterday afternoon', // LLM's verbatim phrase
      sopState: buildSOPStateWithWhen('2026-05-22'),
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('2026-05-22');
  });

  it('falls through to LLM value when SOP when-step is pending', async () => {
    const result = await captureLead(makeLeadInput({
      incidentDate: 'sometime last week',
      sopState: buildSOPStateWithWhen(null), // when not yet captured
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('sometime last week');
  });

  it('falls through to LLM value when SOP when-step has non-ISO captured value', async () => {
    // Defensive: advancer fallback path captures the chip slug ('yesterday')
    // when date inference fails. That's not a date — pass through LLM value
    // (which may also not be an ISO, but we don't second-guess).
    const result = await captureLead(makeLeadInput({
      incidentDate: 'yesterday',
      sopState: buildSOPStateWithWhen('yesterday'), // slug not ISO
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('yesterday');
  });

  it('passes through unchanged when sopState is omitted', async () => {
    const result = await captureLead(makeLeadInput({
      incidentDate: 'last night',
      sopState: null,
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('last night');
  });

  it('passes through unchanged when SOP has no when-slug step at all', async () => {
    // Lawyer customized the SOP without a 'when' step.
    const customSOPState = {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_1', slug: 'case_type', status: 'complete' as const,
          captured_value: 'dui', captured_at: T1, inferred: false },
      ],
      qualified_lead_threshold: 1,
      current_progress: 1,
      is_finalized: true,
      out_of_scope_termination: false,
    };
    const result = await captureLead(makeLeadInput({
      incidentDate: 'last night',
      sopState: customSOPState,
    }));
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.incident_date).toBe('last night');
  });
});

// ---------------------------------------------------------------------------
// 010-sop-workflow: updateLeadSOPState — onFinish backfill helper
// ---------------------------------------------------------------------------
//
// Even with the captureLead override, a lead row can end up stale if the
// agent invoked captureLead BEFORE the SOP runtime captured the when-step
// ISO date and didn't call captureLead again later. updateLeadSOPState
// runs in the chat route's onFinish hook to backfill the lead row's
// sop_state_snapshot AND incident_date with the latest SOP runtime
// state for the session.

describe('updateLeadSOPState — onFinish backfill helper', () => {
  const T1 = '2026-05-23T10:01:00.000Z';

  function buildSOPStateWithWhen(whenValue: string | null) {
    return {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_1', slug: 'case_type', status: 'complete' as const,
          captured_value: 'dui', captured_at: T1, inferred: false },
        { step_id: 'step_5', slug: 'when',
          status: (whenValue ? 'complete' : 'pending') as 'complete' | 'pending',
          captured_value: whenValue, captured_at: whenValue ? T1 : null, inferred: false },
      ],
      qualified_lead_threshold: 5,
      current_progress: whenValue ? 5 : 4,
      is_finalized: false,
      out_of_scope_termination: false,
    };
  }

  it('no-ops when no lead exists for the session', async () => {
    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithWhen('2026-05-22'));
    const all = (db as any).select().from(schema.leads).all();
    expect(all).toHaveLength(0);
  });

  it('no-ops when sopState is null', async () => {
    const r = await captureLead(makeLeadInput({ incidentDate: 'last night', sopState: null }));
    await updateLeadSOPState(TEST_SESSION_ID, null);
    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.id, r.leadId))
      .get();
    // Row unchanged.
    expect(row.incident_date).toBe('last night');
    expect(row.sop_state_snapshot).toBeNull();
  });

  it('backfills sop_state_snapshot with latest SOP state', async () => {
    // captureLead fired at turn 4 with when=pending snapshot
    const partialState = buildSOPStateWithWhen(null);
    await captureLead(makeLeadInput({ sopState: partialState }));

    // Later: SOP advanced to when=complete with ISO. onFinish runs the backfill.
    const fullState = buildSOPStateWithWhen('2026-05-22');
    await updateLeadSOPState(TEST_SESSION_ID, fullState);

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    const parsed = JSON.parse(row.sop_state_snapshot);
    expect(parsed.current_progress).toBe(5);
    expect(parsed.steps.find((s: any) => s.slug === 'when').captured_value).toBe('2026-05-22');
  });

  it('backfills incident_date with SOP ISO when row currently has non-ISO', async () => {
    // captureLead fired with LLM's "last night" + partial SOP (when pending)
    await captureLead(makeLeadInput({
      incidentDate: 'last night',
      sopState: buildSOPStateWithWhen(null),
    }));

    // SOP advanced; backfill picks up the ISO.
    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithWhen('2026-05-22'));

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.incident_date).toBe('2026-05-22');
  });

  it('does NOT clobber an existing ISO incident_date', async () => {
    // captureLead fired with proper ISO from the override path.
    await captureLead(makeLeadInput({
      incidentDate: 'last night',
      sopState: buildSOPStateWithWhen('2026-05-20'),
    }));

    // Later backfill with a different ISO from a later SOP advance.
    // Should preserve the existing ISO (don't overwrite a good value).
    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithWhen('2026-05-22'));

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    // Existing ISO from captureLead override stays put.
    expect(row.incident_date).toBe('2026-05-20');
  });

  it('does NOT touch classification, name, contact_email, or other LLM-supplied fields', async () => {
    await captureLead(makeLeadInput({
      classification: 'HOT',
      name: 'Jane Doe',
      // Use a non-fake-info-tripping email; @example.com hits the
      // fake_info regex and SPAM-downgrades the lead.
      contactEmail: 'jane@gmail.com',
      caseType: 'DUI',
      sopState: buildSOPStateWithWhen(null),
    }));

    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithWhen('2026-05-22'));

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.classification).toBe('HOT');
    expect(row.name).toBe('Jane Doe');
    expect(row.contact_email).toBe('jane@gmail.com');
    expect(row.case_type).toBe('DUI');
  });

  it('does NOT fire a notification on backfill (notifications come from captureLead)', async () => {
    await captureLead(makeLeadInput({
      classification: 'HOT',
      sopState: buildSOPStateWithWhen(null),
    }));

    const notifsBefore = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifsBefore).toHaveLength(1); // from captureLead

    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithWhen('2026-05-22'));

    const notifsAfter = (db as any)
      .select().from(schema.notifications)
      .where(eq(schema.notifications.account_id, TEST_ACCOUNT_ID))
      .all();
    expect(notifsAfter).toHaveLength(1); // unchanged
  });
});

// ---------------------------------------------------------------------------
// 010-sop-workflow contact step: updateLeadSOPState backfills name/email/phone
// from the contact step's captured value (JSON-stringified ContactFormPayload)
// ---------------------------------------------------------------------------

describe('updateLeadSOPState — contact step backfill', () => {
  function buildSOPStateWithContact(payload: { name: string; email?: string; phone?: string } | null) {
    const contactValue = payload
      ? JSON.stringify({
          name: payload.name,
          contact_email: payload.email ?? null,
          contact_phone: payload.phone ?? null,
        })
      : null;
    return {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_1', slug: 'case_type', status: 'complete' as const,
          captured_value: 'dui', captured_at: '2026-05-23T10:01:00.000Z', inferred: false },
        { step_id: 'step_6', slug: 'contact',
          status: (contactValue ? 'complete' : 'pending') as 'complete' | 'pending',
          captured_value: contactValue,
          captured_at: contactValue ? '2026-05-23T10:01:00.000Z' : null, inferred: false },
      ],
      qualified_lead_threshold: 6,
      current_progress: contactValue ? 6 : 1,
      is_finalized: false,
      out_of_scope_termination: false,
    };
  }

  it('populates null name/phone columns from contact step payload (spec 016: email-only initial captureLead)', async () => {
    // Spec 016 FR-002b: captureLead must be called with at least one
    // contact channel. The chat route's tool call resolves
    // contactEmail from the SOP contact step before invoking
    // captureLead. The backfill path then fills in name + phone.
    await captureLead(makeLeadInput({
      name: null, contactEmail: 'placeholder@example.com', contactPhone: null,
    }));

    // SOP advances; contact step captured. Backfill runs.
    await updateLeadSOPState(
      TEST_SESSION_ID,
      buildSOPStateWithContact({ name: 'Jane Doe', email: 'jane@example.com', phone: '555-867-5309' }),
    );

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.name).toBe('Jane Doe');
    // Existing email preserved (LLM had it first); phone backfilled.
    expect(row.contact_email).toBe('placeholder@example.com');
    expect(row.contact_phone).toBe('555-867-5309');
  });

  it('does NOT clobber existing non-null name/email/phone (LLM may have captured them earlier)', async () => {
    // captureLead fired with the LLM having extracted partial info
    await captureLead(makeLeadInput({
      name: 'LLM-extracted Name',
      contactEmail: 'llm@example.com',
      contactPhone: null,
    }));

    // Contact step captured with different values (visitor typed a richer form)
    await updateLeadSOPState(
      TEST_SESSION_ID,
      buildSOPStateWithContact({ name: 'Form Name', email: 'form@example.com', phone: '555-867-5309' }),
    );

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    // Existing non-null values preserved.
    expect(row.name).toBe('LLM-extracted Name');
    expect(row.contact_email).toBe('llm@example.com');
    // Previously-null phone gets backfilled from the form.
    expect(row.contact_phone).toBe('555-867-5309');
  });

  it('skips backfill when contact step is still pending', async () => {
    // Spec 016: captureLead requires at least one contact channel,
    // so we satisfy the partial-gate with a placeholder email.
    await captureLead(makeLeadInput({
      name: null,
      contactEmail: 'placeholder@example.com',
      contactPhone: null,
    }));
    await updateLeadSOPState(TEST_SESSION_ID, buildSOPStateWithContact(null));

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.name).toBeNull();
    expect(row.contact_email).toBe('placeholder@example.com');
    expect(row.contact_phone).toBeNull();
  });

  it('handles malformed contact payload gracefully (skips backfill, no throw)', async () => {
    await captureLead(makeLeadInput({
      name: null,
      contactEmail: 'placeholder@example.com',
      contactPhone: null,
    }));

    const sopState: any = {
      sop_configuration_id: 'cfg_test',
      sop_version: 1,
      conversation_anchor_iso: '2026-05-23T10:00:00.000Z',
      steps: [
        { step_id: 'step_6', slug: 'contact', status: 'complete',
          captured_value: 'this is not JSON', captured_at: '2026-05-23T10:01:00.000Z', inferred: false },
      ],
      qualified_lead_threshold: 6,
      current_progress: 6,
      is_finalized: false,
      out_of_scope_termination: false,
    };
    await expect(updateLeadSOPState(TEST_SESSION_ID, sopState)).resolves.not.toThrow();

    const row = (db as any)
      .select().from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T017 / T018 — captureLead and updateLeadSOPState invoke scoreLead at SOP
// finalization and write the new 015 columns. Per spec 015 FR-001..FR-006,
// FR-013, contracts/lead-finalization-log.md, and the user's decision that
// scoring runs only when sopState.is_finalized === true.
// ---------------------------------------------------------------------------

import {
  CAR_ACCIDENT_SCORING_CONFIG_JSON,
  DEFAULT_SOP_STEPS,
} from '../db/seed-defaults/sop.js';

// ---------------------------------------------------------------------------
// Legacy spec 015 scoring steps used to exercise the spec-015 rule-based
// scoring path that still operates on `sop_steps` rows tagged with
// `applies_when_sub_type_slug = 'car_accident'`. These steps were removed
// from `_RAW_DEFAULT_SOP_STEPS` in spec 016 (the same chip data lives on
// `branch_versions.questions_json` now). The harness re-inserts them so
// the spec 015 scorer still sees a chip catalog while spec 016's runtime
// migration is in flight.
// ---------------------------------------------------------------------------

const LEGACY_CAR_ACCIDENT_SCORING_STEPS = [
  {
    slug: 'request_type',
    position: 5,
    question_text: 'Are you asking for yourself or a friend/family member?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Myself', slug: 'myself', score_weight: 0 },
      { label: 'Friend / Family Member', slug: 'friend_family', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'geographic_qualification',
    position: 6,
    question_text: 'Did the accident happen in or near our service area?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Yes', slug: 'yes_in_area', score_weight: 0 },
      { label: 'No', slug: 'no_outside_area', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'accident_timing',
    position: 7,
    question_text: 'When did the accident happen?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Today', slug: 'today', score_weight: 20 },
      { label: 'Within Last 7 Days', slug: 'within_last_7_days', score_weight: 15 },
      { label: 'Within Last 30 Days', slug: 'within_last_30_days', score_weight: 10 },
      { label: 'Within Last 6 Months', slug: 'within_last_6_months', score_weight: 5 },
      { label: 'More Than 6 Months Ago', slug: 'more_than_6_months_ago', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'injury',
    position: 8,
    question_text: 'Were you (or they) injured?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Yes', slug: 'injury_yes', score_weight: 15 },
      { label: 'Still Being Evaluated', slug: 'injury_evaluating', score_weight: 10 },
      { label: 'Not Sure Yet', slug: 'injury_not_sure', score_weight: 5 },
      { label: 'No', slug: 'injury_no', score_weight: -20 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'medical_treatment',
    position: 9,
    question_text: 'What medical treatment was received?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Surgery', slug: 'surgery', score_weight: 25 },
      { label: 'Hospitalization', slug: 'hospitalization', score_weight: 20 },
      { label: 'Emergency Room Visit', slug: 'er_visit', score_weight: 15 },
      { label: 'Doctor Visit', slug: 'doctor_visit', score_weight: 10 },
      { label: 'Physical Therapy / Chiropractor', slug: 'pt_chiro', score_weight: 8 },
      { label: 'No Treatment Yet', slug: 'no_treatment_yet', score_weight: 5 },
      { label: 'No Treatment', slug: 'no_treatment', score_weight: -10 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'accident_role',
    position: 10,
    question_text: 'Were you (or they) a:',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Passenger', slug: 'passenger', score_weight: 10 },
      { label: 'Pedestrian', slug: 'pedestrian', score_weight: 10 },
      { label: 'Driver', slug: 'driver', score_weight: 5 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'insurance_activity',
    position: 11,
    question_text: 'Has an insurance company contacted you (or them)?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Requested Recorded Statement', slug: 'requested_recorded_statement', score_weight: 15 },
      { label: 'Offered Settlement', slug: 'offered_settlement', score_weight: 15 },
      { label: 'Asked To Sign Documents', slug: 'asked_to_sign', score_weight: 15 },
      { label: 'Contacted Me', slug: 'contacted_me', score_weight: 5 },
      { label: 'Not Yet', slug: 'not_yet', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'work_impact',
    position: 12,
    question_text: 'Has the accident affected your (or their) ability to work?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'Unable To Work', slug: 'unable_to_work', score_weight: 15 },
      { label: 'Missed Work', slug: 'missed_work', score_weight: 10 },
      { label: 'No Impact', slug: 'no_impact', score_weight: 0 },
      { label: 'Not Applicable', slug: 'not_applicable', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'attorney_status',
    position: 13,
    question_text: 'Do you currently have a lawyer?',
    chip_source: 'inline' as const,
    inline_chips_json: JSON.stringify([
      { label: 'No', slug: 'no_lawyer', score_weight: 20 },
      { label: "Spoke With Lawyers, Haven't Signed Yet", slug: 'spoke_not_signed', score_weight: 15 },
      { label: 'Signed With Lawyer But Want To Change Lawyers', slug: 'want_to_change', score_weight: 10 },
      { label: 'Yes, I Have A Lawyer', slug: 'yes_have_lawyer', score_weight: -20 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
];

/**
 * Seed a published SOP, the personal_injury → car_accident sub_type with
 * its scoring_config_json, and the 9 car-accident-scoped scoring step
 * rows. Returns IDs needed for crafting an SOPState fixture.
 */
function seedScoringHarness() {
  const cfgId = 'cfg_test_scored';
  const piCaseTypeId = 'ct_pi_test';
  const carAccidentSubTypeId = 'st_ca_test';
  const now = '2026-06-06T00:00:00Z';

  // sop_configurations
  (db as any).insert(schema.sopConfigurations).values({
    id: cfgId,
    account_id: TEST_ACCOUNT_ID,
    version: 1,
    qualified_lead_threshold: 6,
    is_published: true,
    derived_from_legacy: false,
    created_at: now,
  }).run();

  // case_types: personal_injury
  (db as any).insert(schema.caseTypes).values({
    id: piCaseTypeId,
    account_id: TEST_ACCOUNT_ID,
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 3,
    is_in_scope: true,
    created_at: now,
  }).run();

  // sub_types: car_accident with seeded scoring_config_json
  (db as any).insert(schema.subTypes).values({
    id: carAccidentSubTypeId,
    case_type_id: piCaseTypeId,
    slug: 'car_accident',
    label: 'Car Accident',
    position: 1,
    scoring_config_json: CAR_ACCIDENT_SCORING_CONFIG_JSON,
    created_at: now,
  }).run();

  // sop_steps: insert the 6 default steps (spec 016) plus the 9 legacy
  // car-accident-scoped steps (spec 015) so the rule-based scorer's chip
  // catalog is populated.
  const allSteps = [...DEFAULT_SOP_STEPS, ...LEGACY_CAR_ACCIDENT_SCORING_STEPS];
  for (const step of allSteps) {
    (db as any).insert(schema.sopSteps).values({
      id: `step_${step.slug}_test`,
      sop_configuration_id: cfgId,
      position: step.position,
      slug: step.slug,
      question_text: step.question_text,
      chip_source: step.chip_source,
      inline_chips_json: step.inline_chips_json,
      accepts_free_text: step.accepts_free_text,
      is_required: step.is_required,
      counts_toward_threshold: step.counts_toward_threshold,
      is_default: step.is_default,
      skip_condition_json: step.skip_condition_json,
      applies_when_sub_type_slug: step.applies_when_sub_type_slug ?? null,
    }).run();
  }

  return { cfgId, piCaseTypeId, carAccidentSubTypeId };
}

/**
 * Build a finalized SOPState for the HOT-walk fixture. Captures
 * personal_injury → car_accident plus the 9 scoring/metadata answers
 * that produce a HOT classification with capped score 100.
 */
function buildFinalizedHotWalkSOPState(): any {
  const stepCaptures: Record<string, string> = {
    case_type: 'personal_injury',
    sub_type: 'car_accident',
    where: 'Boston, MA',
    what: 'Other driver ran a red light',
    request_type: 'myself',
    geographic_qualification: 'yes_in_area',
    accident_timing: 'today',                       // +20
    injury: 'injury_yes',                           // +15
    medical_treatment: 'er_visit',                  // +15
    accident_role: 'driver',                        // +5
    insurance_activity: 'requested_recorded_statement', // +15
    work_impact: 'missed_work',                     // +10
    attorney_status: 'no_lawyer',                   // +20
    when: '2026-06-06',
    contact: '{"name":"Jane Doe","contact_email":"jane@example.com","contact_phone":"5551234567"}',
  };

  return {
    sop_configuration_id: 'cfg_test_scored',
    sop_version: 1,
    conversation_anchor_iso: '2026-06-06T00:00:00Z',
    qualified_lead_threshold: 6,
    current_progress: 6,
    is_finalized: true,
    out_of_scope_termination: false,
    steps: [...DEFAULT_SOP_STEPS, ...LEGACY_CAR_ACCIDENT_SCORING_STEPS].map((s) => ({
      step_id: `step_${s.slug}_test`,
      slug: s.slug,
      status: stepCaptures[s.slug] !== undefined ? 'complete' : 'pending',
      captured_value: stepCaptures[s.slug] ?? null,
      captured_label: null,
      captured_at:
        stepCaptures[s.slug] !== undefined ? '2026-06-06T00:01:00Z' : null,
      inferred: false,
    })),
  };
}

describe('captureLead — spec 015 scoring engine wiring', () => {
  describe('when sopState is finalized AND sub_type has scoring_config_json', () => {
    beforeEach(() => {
      seedScoringHarness();
    });

    it('writes lead_score, score_reasons_json, classification, request_type, geographic_qualification', async () => {
      const sopState = buildFinalizedHotWalkSOPState();

      // The LLM-side classification is irrelevant for car_accident
      // (rule-based scorer wins per FR-001); pass anything valid.
      await captureLead(
        makeLeadInput({
          classification: 'WARM' as const,
          sopState,
        }),
      );

      const row = (db as any)
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.session_id, TEST_SESSION_ID))
        .get();

      expect(row.classification).toBe('HOT');
      expect(row.lead_score).toBe(100); // sum 100, cap 100
      expect(row.request_type).toBe('SELF');
      expect(row.geographic_qualification).toBe('IN_SERVICE_AREA');

      const reasons = JSON.parse(row.score_reasons_json) as string[];
      // 8 chip-derived phrases (each |w| >= 5) + 0 hard-overrides since
      // contact info is valid and case_type is in_scope. Per FR-010a.
      expect(reasons.length).toBeGreaterThanOrEqual(7);
      expect(reasons).toContain('Today');
      expect(reasons).toContain('Yes'); // injury_yes label = 'Yes'
      expect(reasons).toContain('Emergency Room Visit');
      expect(reasons).toContain('No'); // no_lawyer label = 'No'
    });

    it('produces deterministic output across two calls for the same session', async () => {
      const sopState = buildFinalizedHotWalkSOPState();

      // First call inserts; second call updates. Both should produce
      // identical scoring fields per FR-004.
      await captureLead(makeLeadInput({ sopState }));
      const row1 = (db as any)
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.session_id, TEST_SESSION_ID))
        .get();

      await captureLead(makeLeadInput({ sopState }));
      const row2 = (db as any)
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.session_id, TEST_SESSION_ID))
        .get();

      expect(row2.classification).toBe(row1.classification);
      expect(row2.lead_score).toBe(row1.lead_score);
      expect(row2.score_reasons_json).toBe(row1.score_reasons_json);
    });
  });

  describe('when sopState is NOT finalized (pre-finalize captureLead invocation)', () => {
    beforeEach(() => {
      seedScoringHarness();
    });

    it('does NOT invoke the scorer; lead_score and score_reasons_json stay null', async () => {
      // Per the user's decision: scoring runs only at SOP finalization.
      // Pre-finalize captureLead invocations skip the scorer entirely;
      // the LLM's classification is persisted as-is.
      const sopState = buildFinalizedHotWalkSOPState();
      sopState.is_finalized = false;
      sopState.current_progress = 4;

      await captureLead(
        makeLeadInput({
          classification: 'WARM' as const,
          sopState,
        }),
      );

      const row = (db as any)
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.session_id, TEST_SESSION_ID))
        .get();

      expect(row.classification).toBe('WARM'); // LLM value preserved
      expect(row.lead_score).toBeNull();
      expect(row.score_reasons_json).toBeNull();
      expect(row.request_type).toBeNull();
      expect(row.geographic_qualification).toBeNull();
    });
  });

  describe('when sub_type has NO scoring_config_json (LLM fallback path per FR-022)', () => {
    it('does NOT invoke the scorer; LLM classification is persisted; new columns stay null', async () => {
      // Seed with a non-scoring sub_type (e.g., DUI / first_offense)
      const cfgId = 'cfg_test_nosc';
      const duiCaseTypeId = 'ct_dui_test';
      const firstOffenseSubTypeId = 'st_fo_test';
      const now = '2026-06-06T00:00:00Z';

      (db as any).insert(schema.sopConfigurations).values({
        id: cfgId,
        account_id: TEST_ACCOUNT_ID,
        version: 1,
        qualified_lead_threshold: 6,
        is_published: true,
        derived_from_legacy: false,
        created_at: now,
      }).run();
      (db as any).insert(schema.caseTypes).values({
        id: duiCaseTypeId,
        account_id: TEST_ACCOUNT_ID,
        slug: 'dui',
        label: 'DUI',
        position: 1,
        is_in_scope: true,
        created_at: now,
      }).run();
      (db as any).insert(schema.subTypes).values({
        id: firstOffenseSubTypeId,
        case_type_id: duiCaseTypeId,
        slug: 'first_offense',
        label: 'First Offense',
        position: 1,
        scoring_config_json: null, // explicit fallback
        created_at: now,
      }).run();

      const sopState: any = {
        sop_configuration_id: cfgId,
        sop_version: 1,
        conversation_anchor_iso: '2026-06-06T00:00:00Z',
        qualified_lead_threshold: 6,
        current_progress: 6,
        is_finalized: true,
        out_of_scope_termination: false,
        steps: [
          { step_id: 'step_case_type', slug: 'case_type', status: 'complete',
            captured_value: 'dui', captured_label: 'DUI',
            captured_at: now, inferred: false },
          { step_id: 'step_sub_type', slug: 'sub_type', status: 'complete',
            captured_value: 'first_offense', captured_label: 'First Offense',
            captured_at: now, inferred: false },
        ],
      };

      await captureLead(
        makeLeadInput({
          classification: 'WARM' as const,
          sopState,
        }),
      );

      const row = (db as any)
        .select()
        .from(schema.leads)
        .where(eq(schema.leads.session_id, TEST_SESSION_ID))
        .get();

      expect(row.classification).toBe('WARM'); // LLM value preserved
      expect(row.lead_score).toBeNull();
      expect(row.score_reasons_json).toBeNull();
    });
  });
});

describe('updateLeadSOPState — spec 015 scoring engine wiring', () => {
  beforeEach(() => {
    seedScoringHarness();
  });

  it('invokes the scorer when transitioning to a finalized SOP state', async () => {
    // First captureLead with non-finalized SOP — no scoring yet.
    const sopState = buildFinalizedHotWalkSOPState();
    sopState.is_finalized = false;
    sopState.current_progress = 5;

    await captureLead(makeLeadInput({ sopState }));

    let row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.lead_score).toBeNull();

    // updateLeadSOPState with finalized SOP — should now score.
    const finalizedSop = buildFinalizedHotWalkSOPState();
    await updateLeadSOPState(TEST_SESSION_ID, finalizedSop);

    row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.classification).toBe('HOT');
    expect(row.lead_score).toBe(100);
    expect(row.request_type).toBe('SELF');
    expect(row.geographic_qualification).toBe('IN_SERVICE_AREA');
  });
});

// ---------------------------------------------------------------------------
// T024 — structured `lead_classified` log emission
//
// Per spec 015 FR-034, FR-010d, contracts/lead-finalization-log.md, and
// Constitution V (no PII in logs). The log line is emitted once per
// finalization (captureLead AND updateLeadSOPState) at console.info level
// for the success path or console.error for the scoring_error variant.
// ---------------------------------------------------------------------------

describe('captureLead — structured lead_classified log emission (spec 015 T024)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seedScoringHarness();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  /**
   * Find the first console.info call whose argument is a JSON string
   * with `event: "lead_classified"`. Returns the parsed JSON or null.
   */
  function findLogEntry(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | null {
    for (const call of spy.mock.calls) {
      const arg = call[0];
      if (typeof arg !== 'string') continue;
      try {
        const parsed = JSON.parse(arg);
        if (parsed && parsed.event === 'lead_classified') return parsed;
      } catch {
        // not JSON; skip
      }
    }
    return null;
  }

  it('emits a lead_classified log entry on rule-based scoring success', async () => {
    const sopState = buildFinalizedHotWalkSOPState();
    await captureLead(makeLeadInput({ sopState }));

    const log = findLogEntry(infoSpy);
    expect(log).not.toBeNull();
    expect(log!.event).toBe('lead_classified');
    expect(log!.scoring_path).toBe('rule_based');
    expect(log!.classification).toBe('HOT');
    expect(log!.lead_score).toBe(100);
    expect(log!.case_type_slug).toBe('personal_injury');
    expect(log!.sub_type_slug).toBe('car_accident');
    expect(log!.request_type).toBe('SELF');
    expect(log!.geographic_qualification).toBe('IN_SERVICE_AREA');
    expect(log!.hard_override_fired).toBeNull();
    expect(typeof log!.lead_id).toBe('string');
    expect(typeof log!.account_id).toBe('string');
    expect(typeof log!.session_id).toBe('string');
    expect(typeof log!.ts).toBe('string');
    expect(Array.isArray(log!.reasons)).toBe(true);
  });

  it('NEVER includes captured PII (name, contact_email, contact_phone) in the log payload', async () => {
    // PII-bearing fixture — every captured PII field is a unique string
    // we can grep for in the serialized log.
    const sopState = buildFinalizedHotWalkSOPState();
    await captureLead(
      makeLeadInput({
        name: 'PII_NAME_NEEDLE_42',
        contactEmail: 'pii_email_needle@hidden.local',
        contactPhone: '+1-555-PII-NEEDLE',
        sopState,
      }),
    );

    // Check ALL console.info calls (success path) for any occurrence
    // of the PII strings. None should appear ANYWHERE in the
    // serialized log entries — not as field values, not in reasons,
    // not in any nested structure.
    const allLogged = infoSpy.mock.calls
      .map((c) => (typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0])))
      .join('\n');

    expect(allLogged).not.toContain('PII_NAME_NEEDLE_42');
    expect(allLogged).not.toContain('pii_email_needle');
    expect(allLogged).not.toContain('PII-NEEDLE');
  });

  it('uses scoring_path = "llm_fallback" when sub_type has no scoring_config_json', async () => {
    // Seed an additional sub_type without scoring config (DUI / first_offense).
    const cfgId2 = 'cfg_dui_test';
    const duiCaseTypeId = 'ct_dui_test';
    const firstOffenseSubTypeId = 'st_fo_test';
    const now = '2026-06-06T00:00:00Z';

    (db as any).insert(schema.sopConfigurations).values({
      id: cfgId2,
      account_id: TEST_ACCOUNT_ID,
      version: 2,
      qualified_lead_threshold: 6,
      is_published: false, // not published; this account's published SOP is the scored one
      derived_from_legacy: false,
      created_at: now,
    }).run();
    (db as any).insert(schema.caseTypes).values({
      id: duiCaseTypeId,
      account_id: TEST_ACCOUNT_ID,
      slug: 'dui',
      label: 'DUI',
      position: 1,
      is_in_scope: true,
      created_at: now,
    }).run();
    (db as any).insert(schema.subTypes).values({
      id: firstOffenseSubTypeId,
      case_type_id: duiCaseTypeId,
      slug: 'first_offense',
      label: 'First Offense',
      position: 1,
      scoring_config_json: null,
      created_at: now,
    }).run();

    const sopState: any = {
      sop_configuration_id: cfgId2,
      sop_version: 2,
      conversation_anchor_iso: now,
      qualified_lead_threshold: 6,
      current_progress: 6,
      is_finalized: true,
      out_of_scope_termination: false,
      steps: [
        { step_id: 'step_case_type', slug: 'case_type', status: 'complete',
          captured_value: 'dui', captured_label: 'DUI',
          captured_at: now, inferred: false },
        { step_id: 'step_sub_type', slug: 'sub_type', status: 'complete',
          captured_value: 'first_offense', captured_label: 'First Offense',
          captured_at: now, inferred: false },
      ],
    };

    await captureLead(makeLeadInput({ classification: 'WARM' as const, sopState }));

    const log = findLogEntry(infoSpy);
    expect(log).not.toBeNull();
    expect(log!.scoring_path).toBe('llm_fallback');
    expect(log!.classification).toBe('WARM'); // LLM value preserved
    expect(log!.lead_score).toBeNull();
    expect(log!.reasons).toEqual([]);
  });

  it('emits ERROR-level log + scoring_error path when scoring config is malformed', async () => {
    // Corrupt the scoring config so the scorer fails the parse step.
    sqlite.prepare(
      `UPDATE sub_types SET scoring_config_json = ? WHERE id = ?`
    ).run('{"schema_version":1,"thresholds_self":"BAD"}', 'st_ca_test');

    const sopState = buildFinalizedHotWalkSOPState();
    await captureLead(makeLeadInput({ sopState }));

    // Per FR-010b: lead is captured, classification is SPAM, lead_score
    // is null, reasons are ['scoring_error'], log goes to console.error.
    const errorLog = findLogEntry(errorSpy);
    expect(errorLog).not.toBeNull();
    expect(errorLog!.event).toBe('lead_classified');
    expect(errorLog!.scoring_path).toBe('scoring_error');
    expect(errorLog!.classification).toBe('SPAM');
    expect(errorLog!.lead_score).toBeNull();
    expect(errorLog!.reasons).toEqual(['scoring_error']);

    // Verify the lead row also reflects the scoring_error fallback per FR-010b.
    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .get();
    expect(row.classification).toBe('SPAM');
    expect(row.lead_score).toBeNull();
    expect(row.score_reasons_json).toBe(JSON.stringify(['scoring_error']));
  });
});

describe('updateLeadSOPState — structured lead_classified log emission (spec 015 T024)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    seedScoringHarness();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('emits the log entry once when transitioning to is_finalized', async () => {
    // Pre-finalize captureLead — should NOT emit lead_classified
    const preFinalize = buildFinalizedHotWalkSOPState();
    preFinalize.is_finalized = false;
    await captureLead(makeLeadInput({ sopState: preFinalize }));

    // Reset the spy so we only see the upcoming emission, not the
    // pre-finalize captureLead's (which still emits with scoring_path
    // = 'llm_fallback' since the SOP isn't finalized).
    infoSpy.mockClear();

    // Now finalize via updateLeadSOPState
    const finalized = buildFinalizedHotWalkSOPState();
    await updateLeadSOPState(TEST_SESSION_ID, finalized);

    const allLogs = infoSpy.mock.calls
      .map((c) => {
        try {
          return JSON.parse(c[0] as string);
        } catch {
          return null;
        }
      })
      .filter((p) => p && p.event === 'lead_classified');

    expect(allLogs.length).toBe(1);
    expect(allLogs[0].scoring_path).toBe('rule_based');
    expect(allLogs[0].classification).toBe('HOT');
  });
});

// ---------------------------------------------------------------------------
// Spec 015 T064 — hard-override integration via captureLead
//
// These tests exercise the end-to-end wiring added in
// `apply-hard-overrides-to-lead.ts`: captureLead persists a row,
// applyAndPersistHardOverrides runs, and rows where any rule fires
// land on disk with classification='SPAM' and the rule names appended
// to score_reasons_json.
// ---------------------------------------------------------------------------

describe('captureLead — hard-override integration (spec 015 T064)', () => {
  it('downgrades classification to SPAM when fake_info fires (test@ email)', async () => {
    const result = await captureLead(
      makeLeadInput({
        classification: 'HOT',
        contactEmail: 'test@gmail.com',
      }),
    );
    expect(result.classification).toBe('SPAM');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.classification).toBe('SPAM');
    const reasons = JSON.parse(row.score_reasons_json ?? '[]') as string[];
    expect(reasons).toContain('fake_info');
  });

  it('downgrades to SPAM when missing_contact fires (no email AND no phone after row creation)', async () => {
    // captureLead refuses both null at the public API per FR-002b, so
    // we exercise missing_contact via the UPDATE path instead: insert
    // first with valid contact, then call again with both null.
    // FR-002b's throw guards inserts; updates can carry empty contact
    // (the FR-002b guard at leads.ts:453 only fires on the INSERT
    // branch, not UPDATE). The override then kicks in.
    await captureLead(makeLeadInput({ classification: 'WARM' }));
    // Wipe contact via direct DB update so the second captureLead call
    // sees the lead without contact info but reuses the session.
    (db as any)
      .update(schema.leads)
      .set({ contact_email: null, contact_phone: null })
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .run();

    const result = await captureLead(
      makeLeadInput({
        classification: 'HOT',
        contactEmail: null,
        contactPhone: null,
      }),
    );
    // captureLead's FR-002b guard only applies to first-time inserts;
    // updates pass through. The override fires post-update and returns
    // SPAM.
    expect(result.classification).toBe('SPAM');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    const reasons = JSON.parse(row.score_reasons_json ?? '[]') as string[];
    expect(reasons).toContain('missing_contact');
  });

  it('does NOT downgrade when no rule fires (clean lead)', async () => {
    const result = await captureLead(
      makeLeadInput({
        classification: 'HOT',
        name: 'Clean Lead',
        contactEmail: 'lead@gmail.com',
        contactPhone: '+15555550100',
      }),
    );
    expect(result.classification).toBe('HOT');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    expect(row.classification).toBe('HOT');
    const reasons = JSON.parse(row.score_reasons_json ?? '[]') as string[];
    expect(reasons).not.toContain('fake_info');
    expect(reasons).not.toContain('missing_contact');
    expect(reasons).not.toContain('out_of_scope');
    expect(reasons).not.toContain('no_injury_no_treatment');
  });

  it('appended override rule appears in fixed evaluation order in reasons', async () => {
    // Trigger fake_info AND no-injury-no-treatment via fake_info-style
    // name + missing-contact-style empty fields after first insert.
    await captureLead(makeLeadInput({ classification: 'WARM' }));
    (db as any)
      .update(schema.leads)
      .set({ contact_email: null, contact_phone: null })
      .where(eq(schema.leads.session_id, TEST_SESSION_ID))
      .run();

    const result = await captureLead(
      makeLeadInput({
        classification: 'HOT',
        name: 'Test User', // trips fake_info
        contactEmail: null,
        contactPhone: null,
      }),
    );
    expect(result.classification).toBe('SPAM');

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    const reasons = JSON.parse(row.score_reasons_json ?? '[]') as string[];
    // FIXED_ORDER puts missing_contact before fake_info.
    const missingIdx = reasons.indexOf('missing_contact');
    const fakeIdx = reasons.indexOf('fake_info');
    expect(missingIdx).toBeGreaterThanOrEqual(0);
    expect(fakeIdx).toBeGreaterThanOrEqual(0);
    expect(missingIdx).toBeLessThan(fakeIdx);
  });

  it('idempotent: second call to applyAndPersistHardOverrides does not duplicate rule names', async () => {
    // Run captureLead twice (UPDATE path) — both runs should land
    // with the same rule list, no duplicates.
    await captureLead(
      makeLeadInput({
        classification: 'HOT',
        contactEmail: 'test@gmail.com', // trips fake_info
      }),
    );
    const result = await captureLead(
      makeLeadInput({
        classification: 'HOT',
        contactEmail: 'test@gmail.com',
      }),
    );

    const row = (db as any)
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, result.leadId))
      .get();
    const reasons = JSON.parse(row.score_reasons_json ?? '[]') as string[];
    expect(reasons.filter((r) => r === 'fake_info')).toHaveLength(1);
  });
});
