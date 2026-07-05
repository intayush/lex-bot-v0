/**
 * Tests for `ensure-default-branches.ts` — the spec 017 follow-up
 * idempotent per-account boot-time function that seeds Branch rows for
 * every default sub-type EXCEPT family_law/* and estate_planning/*.
 *
 * Mirrors the structure of `ensure-car-accident-branch.test.ts`.
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

import { eq } from 'drizzle-orm';
import {
  ensureDefaultBranchForAccount,
  ensureDefaultBranchesForAccount,
  ensureDefaultBranchesForAllAccounts,
} from './ensure-default-branches.js';
import { DEFAULT_BRANCH_SEEDS } from './seed-defaults/branches.js';
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
  \`deleted_at\` text
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

/**
 * Seed an account with the full DEFAULT_CASE_TYPES taxonomy that
 * `seedSopForAccount` would have created. Lets each test exercise the
 * helper against a realistically-populated account.
 */
async function seedAccountWithDefaultTaxonomy(accountId: string): Promise<void> {
  const ts = '2026-06-07T00:00:00Z';
  await db.insert(schema.accounts).values({
    id: accountId,
    email: `${accountId}@example.com`,
    password_hash: 'x',
    firm_name: null,
    created_at: ts,
  });

  // Mirror DEFAULT_CASE_TYPES (seed-defaults/sop.ts:367-437) — every
  // case_type and sub_type slug we might need to look up.
  const taxonomy: Array<{ ct: string; sts: string[] }> = [
    { ct: 'dui', sts: ['first_offense', 'repeat_offense', 'dui_with_injury', 'dui_with_property'] },
    { ct: 'criminal_defense', sts: ['theft', 'assault', 'fraud', 'gun_charge'] },
    { ct: 'personal_injury', sts: ['car_accident', 'slip_fall', 'medical_malpractice', 'dog_bite'] },
    { ct: 'family_law', sts: ['divorce', 'custody', 'adoption'] },
    { ct: 'drug_crime', sts: ['possession', 'distribution', 'trafficking'] },
    { ct: 'estate_planning', sts: ['will', 'trust', 'probate'] },
  ];

  let position = 1;
  for (const { ct, sts } of taxonomy) {
    const ctId = `ct_${accountId}_${ct}`;
    await db.insert(schema.caseTypes).values({
      id: ctId,
      account_id: accountId,
      slug: ct,
      label: ct,
      position: position++,
      is_in_scope: true,
      created_at: ts,
    });
    let stPosition = 1;
    for (const stSlug of sts) {
      await db.insert(schema.subTypes).values({
        id: `st_${accountId}_${ct}_${stSlug}`,
        case_type_id: ctId,
        slug: stSlug,
        label: stSlug,
        position: stPosition++,
        scoring_config_json: null,
        created_at: ts,
      });
    }
  }
}

describe('ensureDefaultBranchForAccount', () => {
  it('inserts a single branch + published version when none exists', async () => {
    await seedAccountWithDefaultTaxonomy('acct_a');
    const seed = DEFAULT_BRANCH_SEEDS.find(
      (s) => s.case_type_slug === 'dui' && s.sub_type_slug === 'first_offense',
    )!;
    expect(seed).toBeDefined();

    const result = await ensureDefaultBranchForAccount(
      'acct_a',
      seed,
      () => '2026-06-07T01:00:00Z',
    );

    expect(result.outcome).toBe('inserted');
    expect(result.branch_id).toBeDefined();
    expect(result.branch_version_id).toBeDefined();

    const branches = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.account_id, 'acct_a'));
    expect(branches).toHaveLength(1);
    expect(branches[0].is_active).toBe(true);
    expect(branches[0].case_type_slug).toBe('dui');
    expect(branches[0].sub_type_slug).toBe('first_offense');

    const versions = await db.select().from(schema.branchVersions);
    expect(versions).toHaveLength(1);
    expect(versions[0].is_published).toBe(true);
    expect(versions[0].created_by_user_id).toBe('system_seed_017');

    // Spot-check: questions_json is the seed JSON (8 questions for first_offense:
    // 2 unscored metadata + 6 scored).
    const questions = JSON.parse(versions[0].questions_json) as Array<{ id: string }>;
    expect(questions.length).toBeGreaterThanOrEqual(8);
    expect(questions[0].id).toBe('request_type');
    expect(questions[1].id).toBe('geographic_qualification');
    expect(questions.map((q) => q.id)).toContain('arrest_status');
    expect(questions.map((q) => q.id)).toContain('attorney_status');
  });

  it('idempotent: second run for the same seed is a no-op', async () => {
    await seedAccountWithDefaultTaxonomy('acct_b');
    const seed = DEFAULT_BRANCH_SEEDS.find(
      (s) => s.sub_type_slug === 'theft',
    )!;

    const first = await ensureDefaultBranchForAccount('acct_b', seed);
    expect(first.outcome).toBe('inserted');

    const second = await ensureDefaultBranchForAccount('acct_b', seed);
    expect(second.outcome).toBe('skipped_already_present');
    expect(second.branch_id).toBe(first.branch_id);

    const branches = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.account_id, 'acct_b'));
    expect(branches).toHaveLength(1);
  });

  it('returns no_sub_type when the account is missing the case_type/sub_type pair', async () => {
    const ts = '2026-06-07T00:00:00Z';
    await db.insert(schema.accounts).values({
      id: 'acct_c',
      email: 'c@b.co',
      password_hash: 'x',
      firm_name: null,
      created_at: ts,
    });
    // Account exists but no case_types/sub_types rows.

    const seed = DEFAULT_BRANCH_SEEDS[0];
    const result = await ensureDefaultBranchForAccount('acct_c', seed);
    expect(result.outcome).toBe('no_sub_type');
    expect(result.case_type_slug).toBe(seed.case_type_slug);
    expect(result.sub_type_slug).toBe(seed.sub_type_slug);
  });
});

describe('ensureDefaultBranchesForAccount', () => {
  it('inserts a branch for every entry in DEFAULT_BRANCH_SEEDS', async () => {
    await seedAccountWithDefaultTaxonomy('acct_d');

    const results = await ensureDefaultBranchesForAccount('acct_d');
    expect(results).toHaveLength(DEFAULT_BRANCH_SEEDS.length);
    expect(results.every((r) => r.outcome === 'inserted')).toBe(true);

    const branches = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.account_id, 'acct_d'));
    expect(branches).toHaveLength(DEFAULT_BRANCH_SEEDS.length);

    // No family_law or estate_planning branches must be inserted.
    const slugs = branches.map((b) => `${b.case_type_slug}/${b.sub_type_slug}`);
    expect(slugs.some((s) => s.startsWith('family_law/'))).toBe(false);
    expect(slugs.some((s) => s.startsWith('estate_planning/'))).toBe(false);

    // car_accident is NOT in DEFAULT_BRANCH_SEEDS (it's seeded separately
    // by ensureCarAccidentBranchForAccount). This helper must not touch it.
    expect(slugs).not.toContain('personal_injury/car_accident');
  });

  it('idempotent at the batch level: second run is all skipped', async () => {
    await seedAccountWithDefaultTaxonomy('acct_e');

    await ensureDefaultBranchesForAccount('acct_e');
    const second = await ensureDefaultBranchesForAccount('acct_e');

    expect(second).toHaveLength(DEFAULT_BRANCH_SEEDS.length);
    expect(second.every((r) => r.outcome === 'skipped_already_present')).toBe(true);

    const branches = await db
      .select()
      .from(schema.branches)
      .where(eq(schema.branches.account_id, 'acct_e'));
    expect(branches).toHaveLength(DEFAULT_BRANCH_SEEDS.length);
  });

  it('mixed state: pre-existing branches are preserved, missing branches inserted', async () => {
    await seedAccountWithDefaultTaxonomy('acct_f');

    // Pre-seed exactly one branch (theft) by hand, with a sentinel
    // questions_json that must NOT be overwritten.
    const ts = '2026-06-07T02:00:00Z';
    await db.insert(schema.branches).values({
      id: 'pre_branch',
      account_id: 'acct_f',
      case_type_slug: 'criminal_defense',
      sub_type_slug: 'theft',
      is_active: true,
      current_version_id: 'pre_version',
      created_at: ts,
      updated_at: ts,
    });
    await db.insert(schema.branchVersions).values({
      id: 'pre_version',
      branch_id: 'pre_branch',
      version_number: 1,
      is_published: true,
      questions_json: JSON.stringify([{ id: 'sentinel', position: 0, text: 'x', preface: null, chips: [], free_text_allowed: true, multi_select: false }]),
      classification_thresholds_json: '{}',
      hard_override_toggles_json: '{}',
      published_at: ts,
      created_at: ts,
      created_by_user_id: 'pre_existing_user',
    });

    const results = await ensureDefaultBranchesForAccount('acct_f');

    const theftResult = results.find(
      (r) => r.case_type_slug === 'criminal_defense' && r.sub_type_slug === 'theft',
    )!;
    expect(theftResult.outcome).toBe('skipped_already_present');
    expect(theftResult.branch_id).toBe('pre_branch');

    // Every other seed should have been inserted.
    const insertedCount = results.filter((r) => r.outcome === 'inserted').length;
    expect(insertedCount).toBe(DEFAULT_BRANCH_SEEDS.length - 1);

    // Pre-existing version's questions_json must be untouched.
    const preVersion = await db
      .select()
      .from(schema.branchVersions)
      .where(eq(schema.branchVersions.id, 'pre_version'));
    expect(preVersion).toHaveLength(1);
    const preQs = JSON.parse(preVersion[0].questions_json) as Array<{ id: string }>;
    expect(preQs[0].id).toBe('sentinel');
    expect(preVersion[0].created_by_user_id).toBe('pre_existing_user');
  });
});

describe('ensureDefaultBranchesForAllAccounts', () => {
  it('processes every account independently', async () => {
    await seedAccountWithDefaultTaxonomy('acct_x');
    await seedAccountWithDefaultTaxonomy('acct_y');

    const results = await ensureDefaultBranchesForAllAccounts();
    expect(results).toHaveLength(DEFAULT_BRANCH_SEEDS.length * 2);
    expect(results.every((r) => r.outcome === 'inserted')).toBe(true);

    const branches = await db.select().from(schema.branches);
    expect(branches).toHaveLength(DEFAULT_BRANCH_SEEDS.length * 2);
    const accountIds = new Set(branches.map((b) => b.account_id));
    expect(accountIds.has('acct_x')).toBe(true);
    expect(accountIds.has('acct_y')).toBe(true);
  });
});
