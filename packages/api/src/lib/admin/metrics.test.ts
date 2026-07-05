/**
 * 027 US4 — metrics aggregation (T041), including zero-traffic (FR-022).
 */
vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('../../db/schema.js', async () => await import('../../db/test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { getTenantMetrics } from './metrics.js';

const { __sqlite: sqlite } = (await import('../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`sessions\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`messages_json\` text NOT NULL DEFAULT '[]',
  \`is_preview\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL
);
CREATE TABLE \`leads\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`session_id\` text NOT NULL,
  \`classification\` text NOT NULL, \`status\` text NOT NULL DEFAULT 'new', \`follow_up_action\` text, \`created_at\` text NOT NULL
);
CREATE TABLE \`usage_events\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`session_id\` text,
  \`provider\` text NOT NULL, \`model\` text NOT NULL, \`prompt_tokens\` integer NOT NULL DEFAULT 0,
  \`completion_tokens\` integer NOT NULL DEFAULT 0, \`total_tokens\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL
);
CREATE TABLE \`notifications\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`type\` text NOT NULL, \`title\` text NOT NULL,
  \`body\` text NOT NULL, \`lead_id\` text, \`read\` integer NOT NULL DEFAULT 0,
  \`delivery_channel\` text NOT NULL DEFAULT 'dashboard', \`delivered_at\` text, \`created_at\` text NOT NULL, \`attorney_id\` text
);
`;

const NOW = '2026-07-05T12:00:00.000Z';
const A = 'acct_metrics';

function q(sqlStr: string) { sqlite.exec(sqlStr); }

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
});
afterEach(() => {
  for (const t of ['notifications', 'usage_events', 'leads', 'sessions']) sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
});

describe('getTenantMetrics — T041', () => {
  it('returns all-zero metrics for a tenant with no traffic (FR-022)', async () => {
    const m = await getTenantMetrics(A, '30d', () => new Date(NOW));
    expect(m.funnel.conversationsStarted).toBe(0);
    expect(m.funnel.conversionRate).toBe(0);
    expect(m.usageCost.estimatedSpend).toBe(0);
    expect(m.usageCost.byProviderModel).toEqual([]);
    expect(m.routing.emailsDispatched).toBe(0);
  });

  it('aggregates funnel, usage/cost, and routing correctly', async () => {
    // 3 sessions, 2 leads (HOT+WARM), 1 email notification, follow-up actions.
    q(`INSERT INTO sessions (id,account_id,created_at,updated_at) VALUES ('s1','${A}','${NOW}','${NOW}'),('s2','${A}','${NOW}','${NOW}'),('s3','${A}','${NOW}','${NOW}')`);
    q(`INSERT INTO leads (id,account_id,session_id,classification,status,follow_up_action,created_at) VALUES
       ('l1','${A}','s1','HOT','new','contacted','${NOW}'),
       ('l2','${A}','s2','WARM','new',NULL,'${NOW}')`);
    q(`INSERT INTO usage_events (id,account_id,session_id,provider,model,prompt_tokens,completion_tokens,total_tokens,created_at) VALUES
       ('u1','${A}','s1','google','gemini-2.5-flash',1000000,0,1000000,'${NOW}')`);
    q(`INSERT INTO notifications (id,account_id,type,title,body,delivery_channel,created_at) VALUES
       ('n1','${A}','urgent_lead','t','b','email','${NOW}')`);

    const m = await getTenantMetrics(A, '30d', () => new Date(NOW));
    expect(m.funnel.conversationsStarted).toBe(3);
    expect(m.funnel.leadsCaptured).toBe(2);
    expect(m.funnel.breakdown).toEqual({ HOT: 1, WARM: 1, COLD: 0, SPAM: 0 });
    expect(m.funnel.conversionRate).toBeCloseTo(2 / 3, 4);
    // 1M google input tokens @ $0.30/M = $0.30
    expect(m.usageCost.estimatedSpend).toBeCloseTo(0.3, 4);
    expect(m.usageCost.byProviderModel).toHaveLength(1);
    expect(m.routing.hotLeadsRouted).toBe(1);
    expect(m.routing.emailsDispatched).toBe(1);
    expect(m.routing.followUpActions).toEqual({ contacted: 1, call_no_answer: 0, meeting_fixed: 0, none: 1 });
  });

  it('excludes data outside the window', async () => {
    const old = '2026-01-01T00:00:00.000Z';
    q(`INSERT INTO sessions (id,account_id,created_at,updated_at) VALUES ('sOld','${A}','${old}','${old}')`);
    const m = await getTenantMetrics(A, '30d', () => new Date(NOW));
    expect(m.funnel.conversationsStarted).toBe(0);
  });
});
