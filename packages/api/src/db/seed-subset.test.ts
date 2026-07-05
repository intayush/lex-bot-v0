vi.mock('./index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('./schema.js', async () => await import('./test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedSopForAccount } from './seed.js';
import { db, schema } from './index.js';

const { __sqlite: sqlite } = (await import('./index.js')) as unknown as { __sqlite: import('better-sqlite3').Database };

// Full DDL for sop_configurations, sop_steps, case_types, sub_types, goodbye_phrases,
// branches, branch_versions, accounts — copy from src/db/ensure-default-branches.test.ts
// (that file already CREATEs this exact set). Reuse its MIGRATION_SQL verbatim.
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

CREATE TABLE \`case_types\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`slug\` text NOT NULL,
  \`label\` text NOT NULL,
  \`position\` integer NOT NULL,
  \`is_in_scope\` integer DEFAULT 1 NOT NULL,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
);

CREATE TABLE \`sub_types\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`case_type_id\` text NOT NULL,
  \`slug\` text NOT NULL,
  \`label\` text NOT NULL,
  \`position\` integer NOT NULL,
  \`scoring_config_json\` text,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`case_type_id\`) REFERENCES \`case_types\`(\`id\`)
);

CREATE TABLE \`branches\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`case_type_slug\` text NOT NULL,
  \`sub_type_slug\` text NOT NULL,
  \`is_active\` integer DEFAULT 1 NOT NULL,
  \`is_case_value_enabled\` integer DEFAULT 0 NOT NULL,
  \`current_version_id\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
);

CREATE TABLE \`branch_versions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`branch_id\` text NOT NULL,
  \`version_number\` integer NOT NULL,
  \`is_published\` integer DEFAULT 0 NOT NULL,
  \`questions_json\` text NOT NULL,
  \`classification_thresholds_json\` text NOT NULL,
  \`hard_override_toggles_json\` text NOT NULL,
  \`case_value_config_json\` text,
  \`published_at\` text,
  \`created_at\` text NOT NULL,
  \`created_by_user_id\` text NOT NULL,
  FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\`(\`id\`)
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
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
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
  FOREIGN KEY (\`sop_configuration_id\`) REFERENCES \`sop_configurations\`(\`id\`)
);

CREATE TABLE \`goodbye_phrases\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`account_id\` text NOT NULL,
  \`phrase\` text NOT NULL,
  \`created_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
);
`;

beforeEach(() => {
  sqlite.exec(
    'DROP TABLE IF EXISTS branch_versions; DROP TABLE IF EXISTS branches; DROP TABLE IF EXISTS goodbye_phrases; DROP TABLE IF EXISTS sop_steps; DROP TABLE IF EXISTS sop_configurations; DROP TABLE IF EXISTS sub_types; DROP TABLE IF EXISTS case_types; DROP TABLE IF EXISTS accounts;',
  );
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sqlite.exec(`INSERT INTO accounts (id, email, password_hash, firm_name, created_at) VALUES ('acct_1','a@f.com','h','F','2026-07-05T00:00:00.000Z')`);
});

describe('seedSopForAccount with selection', () => {
  it('creates only the selected case types and sub-types', async () => {
    await seedSopForAccount('acct_1', { selection: [
      { caseTypeSlug: 'personal_injury', subTypeSlugs: ['car_accident'] },
    ]});
    const cts = await db.select().from(schema.caseTypes).where(eq(schema.caseTypes.account_id, 'acct_1'));
    expect(cts.map((c) => c.slug)).toEqual(['personal_injury']);
    const cid = cts[0].id;
    const subs = await db.select().from(schema.subTypes).where(eq(schema.subTypes.case_type_id, cid));
    expect(subs.map((s) => s.slug)).toEqual(['car_accident']);
  });

  it('with no selection seeds all 6 default case types (unchanged behavior)', async () => {
    await seedSopForAccount('acct_1');
    const cts = await db.select().from(schema.caseTypes).where(eq(schema.caseTypes.account_id, 'acct_1'));
    expect(cts.length).toBe(6);
  });
});
