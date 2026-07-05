/**
 * Spec 016 T018 — branch-lookup unit tests.
 *
 * Maps to contracts/branch-runtime-contract.md §branch-lookup.ts.
 *
 * The function returns `{ branch: null }` when:
 *   - No `branches` row exists for the (account_id, case_type_slug,
 *     sub_type_slug) tuple.
 *   - The branch row's `is_active` is false.
 *   - The branch's current published version has zero questions.
 *
 * Otherwise returns the resolved Branch + BranchVersion.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../../db/test-schema.js');

  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});

vi.mock('../../db/schema.js', async () => {
  return await import('../../db/test-schema.js');
});

import { lookupBranch } from './branch-lookup.js';
import { db } from '../../db/index.js';
import * as schema from '../../db/test-schema.js';

const { __sqlite: sqlite } = (await import('../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const SCHEMA_SQL = `
CREATE TABLE \`accounts\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`email\` text NOT NULL,
  \`password_hash\` text NOT NULL,
  \`firm_name\` text,
  \`created_at\` text NOT NULL,
  \`status\` text DEFAULT 'active' NOT NULL,
  \`onboarding_status\` text DEFAULT 'live' NOT NULL,
  \`deleted_at\` text, \`domain\` text
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

const SAMPLE_QUESTIONS = JSON.stringify([
  {
    id: 'q1',
    position: 0,
    text: 'Q1',
    preface: null,
    chips: [{ slug: 'a', label: 'A', score_weight: 10 }],
    free_text_allowed: false,
    multi_select: false,
  },
]);

const EMPTY_QUESTIONS = JSON.stringify([]);

const SAMPLE_THRESHOLDS = JSON.stringify({
  self: { hot: [76, 100], warm: [51, 75], cold: [26, 50], spam: [0, 25] },
  family_friend: { hot: [71, 100], warm: [46, 70], spam: [0, 45] },
});

const SAMPLE_HARD_OVERRIDES = JSON.stringify({
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
});

beforeEach(() => {
  sqlite.exec(
    'DROP TABLE IF EXISTS branch_versions; DROP TABLE IF EXISTS branches; DROP TABLE IF EXISTS accounts;',
  );
  sqlite.exec(SCHEMA_SQL);
});

afterEach(() => {
  vi.clearAllMocks();
});

async function seedBranch(opts: {
  accountId: string;
  isActive: boolean;
  questions: string;
}): Promise<{ branchId: string; versionId: string }> {
  const ts = '2026-06-06T00:00:00Z';
  await db.insert(schema.accounts).values({
    id: opts.accountId,
    email: `${opts.accountId}@example.com`,
    password_hash: 'x',
    firm_name: null,
    created_at: ts,
  });
  const branchId = `br_${opts.accountId}`;
  const versionId = `bv_${opts.accountId}`;
  await db.insert(schema.branches).values({
    id: branchId,
    account_id: opts.accountId,
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    is_active: opts.isActive,
    current_version_id: versionId,
    created_at: ts,
    updated_at: ts,
  });
  await db.insert(schema.branchVersions).values({
    id: versionId,
    branch_id: branchId,
    version_number: 1,
    is_published: true,
    questions_json: opts.questions,
    classification_thresholds_json: SAMPLE_THRESHOLDS,
    hard_override_toggles_json: SAMPLE_HARD_OVERRIDES,
    published_at: ts,
    created_at: ts,
    created_by_user_id: 'u_admin',
  });
  return { branchId, versionId };
}

describe('lookupBranch', () => {
  it('returns null when no branches row exists for the pair', async () => {
    await db.insert(schema.accounts).values({
      id: 'acct_a',
      email: 'a@b.co',
      password_hash: 'x',
      firm_name: null,
      created_at: '2026-06-06T00:00:00Z',
    });

    const result = await lookupBranch({
      accountId: 'acct_a',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
    expect(result.branch).toBeNull();
  });

  it('returns null when the branches row is inactive', async () => {
    await seedBranch({
      accountId: 'acct_inactive',
      isActive: false,
      questions: SAMPLE_QUESTIONS,
    });

    const result = await lookupBranch({
      accountId: 'acct_inactive',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
    expect(result.branch).toBeNull();
  });

  it('returns null when the published version has zero questions', async () => {
    await seedBranch({
      accountId: 'acct_empty',
      isActive: true,
      questions: EMPTY_QUESTIONS,
    });

    const result = await lookupBranch({
      accountId: 'acct_empty',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
    expect(result.branch).toBeNull();
  });

  it('returns the branch and version when active and non-empty', async () => {
    const { branchId, versionId } = await seedBranch({
      accountId: 'acct_ok',
      isActive: true,
      questions: SAMPLE_QUESTIONS,
    });

    const result = await lookupBranch({
      accountId: 'acct_ok',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
    expect(result.branch).not.toBeNull();
    expect(result.branch?.id).toBe(branchId);
    expect(result.version?.id).toBe(versionId);
    expect(result.version?.is_published).toBe(true);
  });

  it('isolates per-account: another account with the same pair is invisible', async () => {
    await seedBranch({
      accountId: 'acct_x',
      isActive: true,
      questions: SAMPLE_QUESTIONS,
    });
    await db.insert(schema.accounts).values({
      id: 'acct_y',
      email: 'y@b.co',
      password_hash: 'x',
      firm_name: null,
      created_at: '2026-06-06T00:00:00Z',
    });

    const yResult = await lookupBranch({
      accountId: 'acct_y',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
    expect(yResult.branch).toBeNull();
  });

  it('returns null when the case_type/sub_type slugs do not match', async () => {
    await seedBranch({
      accountId: 'acct_pair',
      isActive: true,
      questions: SAMPLE_QUESTIONS,
    });

    // Same account but different sub_type slug.
    const wrongSubType = await lookupBranch({
      accountId: 'acct_pair',
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'slip_fall',
    });
    expect(wrongSubType.branch).toBeNull();
  });
});
