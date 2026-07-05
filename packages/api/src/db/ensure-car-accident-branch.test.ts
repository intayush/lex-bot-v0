/**
 * Tests for spec 016 ensure-car-accident-branch boot-time function (T014).
 * Replaces ensure-car-accident-scoring.test.ts from spec 015.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./test-schema.js');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

vi.mock('./schema.js', async () => {
  return await import('./test-schema.js');
});

import {
  ensureCarAccidentBranchForAccount,
  ensureCarAccidentBranchForAllAccounts,
} from './ensure-car-accident-branch.js';
import { db } from './index.js';
import * as schema from './test-schema.js';

const { __sqlite: sqlite } = (await import('./index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

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
`;

beforeEach(() => {
  sqlite.exec(
    'DROP TABLE IF EXISTS branch_versions; DROP TABLE IF EXISTS branches; DROP TABLE IF EXISTS sub_types; DROP TABLE IF EXISTS case_types; DROP TABLE IF EXISTS accounts;',
  );
  sqlite.exec(MIGRATION_SQL);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedAccountWithCarAccidentSubType(
  accountId: string,
): Promise<void> {
  const ts = '2026-06-06T00:00:00Z';
  await db.insert(schema.accounts).values({
    id: accountId,
    email: `${accountId}@example.com`,
    password_hash: 'x',
    firm_name: null,
    created_at: ts,
  });
  await db.insert(schema.caseTypes).values({
    id: `ct_${accountId}`,
    account_id: accountId,
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 1,
    is_in_scope: true,
    created_at: ts,
  });
  await db.insert(schema.subTypes).values({
    id: `st_${accountId}`,
    case_type_id: `ct_${accountId}`,
    slug: 'car_accident',
    label: 'Car Accident',
    position: 1,
    scoring_config_json: null,
    created_at: ts,
  });
}

describe('ensureCarAccidentBranchForAccount', () => {
  it('inserts a branch + published version when none exists', async () => {
    await seedAccountWithCarAccidentSubType('acct_a');

    const result = await ensureCarAccidentBranchForAccount(
      'acct_a',
      () => '2026-06-06T01:00:00Z',
    );

    expect(result.outcome).toBe('inserted');
    expect(result.branch_id).toBeDefined();
    expect(result.branch_version_id).toBeDefined();

    const branches = await db
      .select()
      .from(schema.branches)
      .where(
        // @ts-expect-error drizzle eq compatibility in tests
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('drizzle-orm')).eq(schema.branches.account_id, 'acct_a'),
      );
    expect(branches).toHaveLength(1);
    expect(branches[0].is_active).toBe(true);
    expect(branches[0].case_type_slug).toBe('personal_injury');
    expect(branches[0].sub_type_slug).toBe('car_accident');

    const versions = await db.select().from(schema.branchVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0].is_published).toBe(true);
    expect(versions[0].created_by_user_id).toBe('system_seed_016');
    // Spot-check: questions_json must contain the 9 questions per
    // lead-classification-revamp.md (request_type, geographic_qualification,
    // injury, medical_treatment, accident_role, liability,
    // insurance_activity, work_impact, attorney_status).
    // accident_timing was merged into the default SOP `when` step
    // (spec 016 dedup fix) so the branch question set is 9, not 10.
    const questions = JSON.parse(versions[0].questions_json) as Array<{ id: string }>;
    expect(questions).toHaveLength(9);
    expect(questions.map((q) => q.id)).toContain('accident_role');
    expect(questions.map((q) => q.id)).toContain('liability');
    expect(questions.map((q) => q.id)).toContain('attorney_status');
    expect(questions.map((q) => q.id)).not.toContain('accident_timing');
  });

  it('idempotent: second run is a no-op', async () => {
    await seedAccountWithCarAccidentSubType('acct_b');

    const first = await ensureCarAccidentBranchForAccount('acct_b');
    expect(first.outcome).toBe('inserted');

    const second = await ensureCarAccidentBranchForAccount('acct_b');
    expect(second.outcome).toBe('skipped_already_present');
    expect(second.branch_id).toBe(first.branch_id);

    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(1);
  });

  it('returns no_car_accident_subtype when account has no Personal Injury → Car Accident pair', async () => {
    const ts = '2026-06-06T00:00:00Z';
    await db.insert(schema.accounts).values({
      id: 'acct_c',
      email: 'c@b.co',
      password_hash: 'x',
      firm_name: null,
      created_at: ts,
    });

    const result = await ensureCarAccidentBranchForAccount('acct_c');
    expect(result.outcome).toBe('no_car_accident_subtype');
  });
});

describe('ensureCarAccidentBranchForAllAccounts', () => {
  it('processes every account independently', async () => {
    await seedAccountWithCarAccidentSubType('acct_x');
    await seedAccountWithCarAccidentSubType('acct_y');

    const results = await ensureCarAccidentBranchForAllAccounts();
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.outcome === 'inserted')).toBe(true);

    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(2);
    const accountIds = new Set(branches.map((b) => b.account_id));
    expect(accountIds.has('acct_x')).toBe(true);
    expect(accountIds.has('acct_y')).toBe(true);
  });
});
