/**
 * Tests for spec 016 multi-branch SOP data migration (T010).
 *
 * The Drizzle SQL migration creates the new `branches` and
 * `branch_versions` tables plus the new `leads` columns. This
 * test exercises the TS data-copy that runs after the SQL
 * migration: every existing `sub_types.scoring_config_json` row
 * becomes a `branches` row + a published `branch_versions` row.
 *
 * Idempotency is the key contract: re-running the migration must
 * be a no-op. Verified by running `runMultiBranchSopDataMigration`
 * twice and asserting the second run reports `skipped_already_present`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./../index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./../test-schema.js');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

vi.mock('./../schema.js', async () => {
  return await import('./../test-schema.js');
});

import { runMultiBranchSopDataMigration } from './0004-multi-branch-sop.js';
import { db } from './../index.js';
import * as schema from './../test-schema.js';

const { __sqlite: sqlite } = (await import('./../index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`email\` text NOT NULL,
  \`password_hash\` text NOT NULL,
  \`firm_name\` text,
  \`created_at\` text NOT NULL
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
  \`current_version_id\` text,
  \`created_at\` text NOT NULL,
  \`updated_at\` text NOT NULL,
  FOREIGN KEY (\`account_id\`) REFERENCES \`accounts\`(\`id\`)
);

CREATE UNIQUE INDEX \`branches_account_pair_unique\` ON \`branches\` (\`account_id\`, \`case_type_slug\`, \`sub_type_slug\`);

CREATE TABLE \`branch_versions\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`branch_id\` text NOT NULL,
  \`version_number\` integer NOT NULL,
  \`is_published\` integer DEFAULT 0 NOT NULL,
  \`questions_json\` text NOT NULL,
  \`classification_thresholds_json\` text NOT NULL,
  \`hard_override_toggles_json\` text NOT NULL,
  \`published_at\` text,
  \`created_at\` text NOT NULL,
  \`created_by_user_id\` text NOT NULL,
  FOREIGN KEY (\`branch_id\`) REFERENCES \`branches\`(\`id\`)
);
`;

const SCORING_CONFIG_FIXTURE = JSON.stringify({
  schema_version: 1,
  thresholds_self: {
    hot: [76, 100],
    warm: [51, 75],
    cold: [26, 50],
    spam: [0, 25],
  },
  thresholds_family_friend: {
    hot: [71, 100],
    warm: [46, 70],
    spam: [0, 45],
  },
  hard_overrides_enabled: {
    missing_contact: true,
    out_of_scope: true,
    no_injury_no_treatment: true,
    fake_info: true,
  },
});

beforeEach(() => {
  // Drop tables in reverse FK order to leave a clean slate per test.
  sqlite.exec(
    'DROP TABLE IF EXISTS branch_versions; DROP TABLE IF EXISTS branches; DROP TABLE IF EXISTS sub_types; DROP TABLE IF EXISTS case_types; DROP TABLE IF EXISTS sop_steps; DROP TABLE IF EXISTS sop_configurations; DROP TABLE IF EXISTS accounts;',
  );
  sqlite.exec(MIGRATION_SQL);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedAccountWithCarAccidentScoring(): Promise<{ accountId: string }> {
  const accountId = 'acct_test';
  const ts = '2026-06-06T00:00:00Z';

  await db.insert(schema.accounts).values({
    id: accountId,
    email: 'a@b.co',
    password_hash: 'x',
    firm_name: null,
    created_at: ts,
  });

  await db.insert(schema.caseTypes).values({
    id: 'ct_pi',
    account_id: accountId,
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 1,
    is_in_scope: true,
    created_at: ts,
  });

  await db.insert(schema.subTypes).values({
    id: 'st_ca',
    case_type_id: 'ct_pi',
    slug: 'car_accident',
    label: 'Car Accident',
    position: 1,
    scoring_config_json: SCORING_CONFIG_FIXTURE,
    created_at: ts,
  });

  return { accountId };
}

describe('runMultiBranchSopDataMigration', () => {
  it('inserts a branch + published version for every sub_type with scoring_config_json', async () => {
    await seedAccountWithCarAccidentScoring();

    const results = await runMultiBranchSopDataMigration({
      db: db as unknown as Parameters<typeof runMultiBranchSopDataMigration>[0]['db'],
      now: () => '2026-06-06T01:00:00Z',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      account_id: 'acct_test',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      outcome: 'inserted',
    });

    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(1);
    expect(branches[0].account_id).toBe('acct_test');
    expect(branches[0].is_active).toBe(true);
    expect(branches[0].current_version_id).toBe(results[0].version_id);

    const versions = await db.select().from(schema.branchVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0].is_published).toBe(true);
    expect(versions[0].version_number).toBe(1);
    expect(versions[0].created_by_user_id).toBe('system_migration_0004');
    // Thresholds are preserved verbatim.
    const thresholds = JSON.parse(versions[0].classification_thresholds_json) as {
      self: { hot: [number, number] };
    };
    expect(thresholds.self.hot).toEqual([76, 100]);
  });

  it('is idempotent: re-running reports skipped_already_present', async () => {
    await seedAccountWithCarAccidentScoring();

    const first = await runMultiBranchSopDataMigration({
      db: db as unknown as Parameters<typeof runMultiBranchSopDataMigration>[0]['db'],
    });
    expect(first[0].outcome).toBe('inserted');

    const second = await runMultiBranchSopDataMigration({
      db: db as unknown as Parameters<typeof runMultiBranchSopDataMigration>[0]['db'],
    });
    expect(second).toHaveLength(1);
    expect(second[0].outcome).toBe('skipped_already_present');
    expect(second[0].branch_id).toBe(first[0].branch_id);

    // Still exactly one branch + one version after the second run.
    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(1);
    const versions = await db.select().from(schema.branchVersions);
    expect(versions).toHaveLength(1);
  });

  it('does NOT drop sub_types.scoring_config_json (R2 preservation)', async () => {
    await seedAccountWithCarAccidentScoring();

    await runMultiBranchSopDataMigration({
      db: db as unknown as Parameters<typeof runMultiBranchSopDataMigration>[0]['db'],
    });

    const subType = await db.select().from(schema.subTypes).limit(1);
    expect(subType[0].scoring_config_json).toBe(SCORING_CONFIG_FIXTURE);
  });

  it('skips sub_types with null scoring_config_json (no work to do)', async () => {
    await db.insert(schema.accounts).values({
      id: 'acct_no_scoring',
      email: 'b@c.co',
      password_hash: 'x',
      firm_name: null,
      created_at: '2026-06-06T00:00:00Z',
    });
    await db.insert(schema.caseTypes).values({
      id: 'ct_dui',
      account_id: 'acct_no_scoring',
      slug: 'dui',
      label: 'DUI',
      position: 1,
      is_in_scope: true,
      created_at: '2026-06-06T00:00:00Z',
    });
    await db.insert(schema.subTypes).values({
      id: 'st_first',
      case_type_id: 'ct_dui',
      slug: 'first_offense',
      label: 'First Offense',
      position: 1,
      scoring_config_json: null,
      created_at: '2026-06-06T00:00:00Z',
    });

    const results = await runMultiBranchSopDataMigration({
      db: db as unknown as Parameters<typeof runMultiBranchSopDataMigration>[0]['db'],
    });
    // sub_types with null scoring_config_json are filtered out by the
    // SELECT predicate; they don't appear in results at all.
    expect(results).toHaveLength(0);

    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(0);
  });
});
