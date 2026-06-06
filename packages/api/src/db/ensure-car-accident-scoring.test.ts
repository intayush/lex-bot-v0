import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory SQLite mock (mirrors the pattern from leads.test.ts).
// ---------------------------------------------------------------------------
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

// Import module under test AFTER mock declarations (vitest hoists vi.mock).
import {
  ensureCarAccidentScoringForAccount,
  ensureCarAccidentScoringForAllAccounts,
  type CarAccidentScoringMigrationResult,
} from './ensure-car-accident-scoring.js';
import { db } from './index.js';
import * as schema from './test-schema.js';
import {
  CAR_ACCIDENT_SCORING_CONFIG_JSON,
  DEFAULT_SOP_STEPS,
} from './seed-defaults/sop.js';

const { __sqlite: sqlite } = (await import('./index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

// ---------------------------------------------------------------------------
// DDL — minimum subset of tables needed for ensure-car-accident-scoring.
// Mirrors the production schema for accounts, sop_configurations,
// sop_steps, case_types, sub_types.
// ---------------------------------------------------------------------------
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
`;

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

interface SeededAccount {
  accountId: string;
  cfgId: string;
  caseTypeId: string; // personal_injury
  carAccidentSubTypeId: string;
}

/**
 * Seed an account with a published SOP that has the existing 6
 * default steps (case_type, sub_type, where, what, when, contact)
 * but NOT yet the 9 new car-accident scoring steps. This is the
 * "legacy" account shape the remediation script needs to migrate.
 *
 * Also seeds personal_injury → car_accident with `scoring_config_json
 * = null` so the script can fill it in.
 */
function seedLegacyAccount(suffix: string): SeededAccount {
  const accountId = `acct_${suffix}`;
  const cfgId = `cfg_${suffix}`;
  const caseTypeId = `ct_${suffix}`;
  const carAccidentSubTypeId = `st_${suffix}`;
  const now = '2026-06-06T00:00:00Z';

  // accounts
  db.insert(schema.accounts).values({
    id: accountId,
    email: `${suffix}@test.local`,
    password_hash: 'hash',
    firm_name: 'Test Firm',
    created_at: now,
  }).run();

  // sop_configurations
  db.insert(schema.sopConfigurations).values({
    id: cfgId,
    account_id: accountId,
    version: 1,
    qualified_lead_threshold: 6,
    is_published: true,
    derived_from_legacy: false,
    created_at: now,
  }).run();

  // 6 default SOP steps (no car-accident-scoped ones yet)
  const legacyDefaults = DEFAULT_SOP_STEPS.filter(
    (s) => s.applies_when_sub_type_slug === null,
  );
  // Renumber to 1..6 since the seed file now has when=14 contact=15
  // and we want the legacy positions for this fixture.
  const legacyPositions: Record<string, number> = {
    case_type: 1,
    sub_type: 2,
    where: 3,
    what: 4,
    when: 5,
    contact: 6,
  };
  for (const step of legacyDefaults) {
    db.insert(schema.sopSteps).values({
      id: `step_${step.slug}_${suffix}`,
      sop_configuration_id: cfgId,
      position: legacyPositions[step.slug] ?? step.position,
      slug: step.slug,
      question_text: step.question_text,
      chip_source: step.chip_source,
      inline_chips_json: step.inline_chips_json,
      accepts_free_text: step.accepts_free_text,
      is_required: step.is_required,
      counts_toward_threshold: step.counts_toward_threshold,
      is_default: step.is_default,
      skip_condition_json: step.skip_condition_json,
      applies_when_sub_type_slug: null,
    }).run();
  }

  // case_types: personal_injury
  db.insert(schema.caseTypes).values({
    id: caseTypeId,
    account_id: accountId,
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 3,
    is_in_scope: true,
    created_at: now,
  }).run();

  // sub_types: car_accident with NO scoring_config_json yet
  db.insert(schema.subTypes).values({
    id: carAccidentSubTypeId,
    case_type_id: caseTypeId,
    slug: 'car_accident',
    label: 'Car Accident',
    position: 1,
    scoring_config_json: null,
    created_at: now,
  }).run();

  return { accountId, cfgId, caseTypeId, carAccidentSubTypeId };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  sqlite.exec(MIGRATION_SQL);
});

afterEach(() => {
  sqlite.exec(`
    DROP TABLE IF EXISTS sub_types;
    DROP TABLE IF EXISTS case_types;
    DROP TABLE IF EXISTS sop_steps;
    DROP TABLE IF EXISTS sop_configurations;
    DROP TABLE IF EXISTS accounts;
  `);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureCarAccidentScoringForAccount — single-account behavior', () => {
  it('returns "inserted" when account has no car-accident scoring steps and no scoring_config_json', async () => {
    const { accountId } = seedLegacyAccount('a1');

    const result: CarAccidentScoringMigrationResult =
      await ensureCarAccidentScoringForAccount(accountId);

    expect(result.account_id).toBe(accountId);
    expect(result.outcome).toBe('inserted');
  });

  it('inserts exactly 9 new sop_steps with applies_when_sub_type_slug = "car_accident"', async () => {
    const { accountId, cfgId } = seedLegacyAccount('a2');

    await ensureCarAccidentScoringForAccount(accountId);

    const count = sqlite
      .prepare(
        `SELECT COUNT(*) as n FROM sop_steps WHERE sop_configuration_id = ? AND applies_when_sub_type_slug = 'car_accident'`,
      )
      .get(cfgId) as { n: number };
    expect(count.n).toBe(9);
  });

  it('shifts when from position 5 → 14 and contact from 6 → 15', async () => {
    const { accountId, cfgId } = seedLegacyAccount('a3');
    await ensureCarAccidentScoringForAccount(accountId);

    const whenStep = sqlite
      .prepare(
        `SELECT position FROM sop_steps WHERE sop_configuration_id = ? AND slug = 'when'`,
      )
      .get(cfgId) as { position: number } | undefined;
    const contactStep = sqlite
      .prepare(
        `SELECT position FROM sop_steps WHERE sop_configuration_id = ? AND slug = 'contact'`,
      )
      .get(cfgId) as { position: number } | undefined;

    expect(whenStep?.position).toBe(14);
    expect(contactStep?.position).toBe(15);
  });

  it('populates scoring_config_json on the car_accident sub_type', async () => {
    const { accountId, carAccidentSubTypeId } = seedLegacyAccount('a4');
    await ensureCarAccidentScoringForAccount(accountId);

    const row = sqlite
      .prepare(`SELECT scoring_config_json FROM sub_types WHERE id = ?`)
      .get(carAccidentSubTypeId) as { scoring_config_json: string } | undefined;
    expect(row?.scoring_config_json).toBe(CAR_ACCIDENT_SCORING_CONFIG_JSON);
  });

  it('returns "skipped_already_present" when the 9 steps + scoring_config exist', async () => {
    const { accountId } = seedLegacyAccount('a5');

    // First call inserts.
    const first = await ensureCarAccidentScoringForAccount(accountId);
    expect(first.outcome).toBe('inserted');

    // Second call is a no-op.
    const second = await ensureCarAccidentScoringForAccount(accountId);
    expect(second.outcome).toBe('skipped_already_present');
  });

  it('idempotency: 9 steps remain exactly 9 after a second run', async () => {
    const { accountId, cfgId } = seedLegacyAccount('a6');

    await ensureCarAccidentScoringForAccount(accountId);
    await ensureCarAccidentScoringForAccount(accountId);

    const count = sqlite
      .prepare(
        `SELECT COUNT(*) as n FROM sop_steps WHERE sop_configuration_id = ? AND applies_when_sub_type_slug = 'car_accident'`,
      )
      .get(cfgId) as { n: number };
    expect(count.n).toBe(9);
  });

  it('returns "skipped_has_customizations" when ANY of the 9 step slugs already exists with non-default content', async () => {
    const { accountId, cfgId } = seedLegacyAccount('a7');

    // Pre-insert a custom version of accident_timing so the script
    // sees an admin customization and refuses to clobber.
    db.insert(schema.sopSteps).values({
      id: 'step_custom_accident_timing',
      sop_configuration_id: cfgId,
      position: 99,
      slug: 'accident_timing',
      question_text: 'CUSTOMIZED — when did this happen exactly?',
      chip_source: 'inline',
      inline_chips_json: JSON.stringify([{ label: 'Now', slug: 'now', score_weight: 100 }]),
      accepts_free_text: false,
      is_required: false,
      counts_toward_threshold: false,
      is_default: false,
      skip_condition_json: null,
      applies_when_sub_type_slug: 'car_accident',
    }).run();

    const result = await ensureCarAccidentScoringForAccount(accountId);
    expect(result.outcome).toBe('skipped_has_customizations');

    // Verify the custom row was NOT touched.
    const customRow = sqlite
      .prepare(
        `SELECT question_text FROM sop_steps WHERE sop_configuration_id = ? AND slug = 'accident_timing'`,
      )
      .get(cfgId) as { question_text: string };
    expect(customRow.question_text).toBe('CUSTOMIZED — when did this happen exactly?');
  });

  it('returns "skipped_has_customizations" when car_accident.scoring_config_json is already set to a custom value', async () => {
    const { accountId, carAccidentSubTypeId } = seedLegacyAccount('a8');

    sqlite
      .prepare(`UPDATE sub_types SET scoring_config_json = ? WHERE id = ?`)
      .run('{"schema_version":1,"custom":"yes"}', carAccidentSubTypeId);

    const result = await ensureCarAccidentScoringForAccount(accountId);
    expect(result.outcome).toBe('skipped_has_customizations');

    // Verify the custom config was NOT clobbered.
    const row = sqlite
      .prepare(`SELECT scoring_config_json FROM sub_types WHERE id = ?`)
      .get(carAccidentSubTypeId) as { scoring_config_json: string };
    expect(row.scoring_config_json).toBe('{"schema_version":1,"custom":"yes"}');
  });

  it('returns "no_published_sop" when the account has no published SOP', async () => {
    const accountId = 'acct_no_sop';
    const now = '2026-06-06T00:00:00Z';
    db.insert(schema.accounts).values({
      id: accountId,
      email: 'nosop@test.local',
      password_hash: 'hash',
      firm_name: 'No SOP Firm',
      created_at: now,
    }).run();

    const result = await ensureCarAccidentScoringForAccount(accountId);
    expect(result.outcome).toBe('no_published_sop');
  });

  it('returns "no_car_accident_subtype" when the account has no personal_injury → car_accident sub_type', async () => {
    const accountId = 'acct_no_subtype';
    const now = '2026-06-06T00:00:00Z';
    db.insert(schema.accounts).values({
      id: accountId,
      email: 'nosub@test.local',
      password_hash: 'hash',
      firm_name: 'No SubType Firm',
      created_at: now,
    }).run();
    db.insert(schema.sopConfigurations).values({
      id: 'cfg_no_subtype',
      account_id: accountId,
      version: 1,
      qualified_lead_threshold: 6,
      is_published: true,
      derived_from_legacy: false,
      created_at: now,
    }).run();

    const result = await ensureCarAccidentScoringForAccount(accountId);
    expect(result.outcome).toBe('no_car_accident_subtype');
  });
});

describe('ensureCarAccidentScoringForAllAccounts — multi-account isolation', () => {
  it('processes every account and never crosses account boundaries', async () => {
    const a = seedLegacyAccount('m1');
    const b = seedLegacyAccount('m2');
    const c = seedLegacyAccount('m3');

    const results = await ensureCarAccidentScoringForAllAccounts();

    expect(results.length).toBe(3);
    expect(results.every((r) => r.outcome === 'inserted')).toBe(true);

    // Each account gets exactly 9 scoped steps; never 18 or 27.
    for (const seeded of [a, b, c]) {
      const count = sqlite
        .prepare(
          `SELECT COUNT(*) as n FROM sop_steps WHERE sop_configuration_id = ? AND applies_when_sub_type_slug = 'car_accident'`,
        )
        .get(seeded.cfgId) as { n: number };
      expect(count.n).toBe(9);
    }
  });

  it('idempotent across multiple accounts (run twice → all skipped on second run)', async () => {
    seedLegacyAccount('m4');
    seedLegacyAccount('m5');

    await ensureCarAccidentScoringForAllAccounts();
    const second = await ensureCarAccidentScoringForAllAccounts();

    expect(second.length).toBe(2);
    expect(second.every((r) => r.outcome === 'skipped_already_present')).toBe(true);
  });
});
