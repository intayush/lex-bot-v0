/**
 * 027 US5 — SOP flow assembler (T048). Verifies steps/case-types/sub-types/
 * branch questions; sub-types with no branch → branch:null.
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
import { getSopFlowView } from './sop-view.js';
import { db, schema } from '../../db/index.js';

const { __sqlite: sqlite } = (await import('../../db/index.js')) as unknown as {
  __sqlite: import('better-sqlite3').Database;
};

const MIGRATION_SQL = `
CREATE TABLE \`sop_configurations\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`version\` integer NOT NULL,
  \`qualified_lead_threshold\` integer NOT NULL DEFAULT 5, \`is_published\` integer NOT NULL DEFAULT 0,
  \`derived_from_legacy\` integer NOT NULL DEFAULT 0, \`created_at\` text NOT NULL, \`label\` text
);
CREATE TABLE \`sop_steps\` (
  \`id\` text PRIMARY KEY NOT NULL, \`sop_configuration_id\` text NOT NULL, \`position\` integer NOT NULL,
  \`slug\` text NOT NULL, \`question_text\` text NOT NULL, \`chip_source\` text, \`inline_chips_json\` text,
  \`accepts_free_text\` integer NOT NULL DEFAULT 1, \`is_required\` integer NOT NULL DEFAULT 1,
  \`counts_toward_threshold\` integer NOT NULL DEFAULT 1, \`is_default\` integer NOT NULL DEFAULT 0,
  \`skip_condition_json\` text, \`applies_when_sub_type_slug\` text
);
CREATE TABLE \`case_types\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`slug\` text NOT NULL, \`label\` text NOT NULL,
  \`position\` integer NOT NULL, \`is_in_scope\` integer NOT NULL DEFAULT 1, \`created_at\` text NOT NULL
);
CREATE TABLE \`sub_types\` (
  \`id\` text PRIMARY KEY NOT NULL, \`case_type_id\` text NOT NULL, \`slug\` text NOT NULL, \`label\` text NOT NULL,
  \`position\` integer NOT NULL, \`scoring_config_json\` text, \`created_at\` text NOT NULL
);
CREATE TABLE \`branches\` (
  \`id\` text PRIMARY KEY NOT NULL, \`account_id\` text NOT NULL, \`case_type_slug\` text NOT NULL,
  \`sub_type_slug\` text NOT NULL, \`is_active\` integer NOT NULL DEFAULT 1, \`is_case_value_enabled\` integer NOT NULL DEFAULT 0,
  \`current_version_id\` text, \`created_at\` text NOT NULL, \`updated_at\` text NOT NULL
);
CREATE TABLE \`branch_versions\` (
  \`id\` text PRIMARY KEY NOT NULL, \`branch_id\` text NOT NULL, \`version_number\` integer NOT NULL,
  \`is_published\` integer NOT NULL DEFAULT 0, \`questions_json\` text NOT NULL,
  \`classification_thresholds_json\` text NOT NULL, \`hard_override_toggles_json\` text NOT NULL,
  \`case_value_config_json\` text, \`published_at\` text, \`created_at\` text NOT NULL, \`created_by_user_id\` text NOT NULL
);
`;
const NOW = '2026-07-05T10:00:00.000Z';
const A = 'acct_sop';

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
});
afterEach(() => {
  for (const t of ['branch_versions', 'branches', 'sub_types', 'case_types', 'sop_steps', 'sop_configurations']) {
    sqlite.exec(`DROP TABLE IF EXISTS ${t}`);
  }
});

describe('getSopFlowView — T048', () => {
  it('returns null when the tenant has no published SOP', async () => {
    expect(await getSopFlowView(A)).toBeNull();
  });

  it('assembles steps, case types, sub-types, and branch questions', async () => {
    await db.insert(schema.sopConfigurations).values({ id: 'sop_1', account_id: A, version: 2, qualified_lead_threshold: 6, is_published: true, derived_from_legacy: false, created_at: NOW, label: null });
    await db.insert(schema.sopSteps).values([
      { id: 'st1', sop_configuration_id: 'sop_1', position: 1, slug: 'case_type', question_text: 'What type?', chip_source: 'case_types', inline_chips_json: null, accepts_free_text: false, is_required: true, counts_toward_threshold: true, is_default: true, skip_condition_json: null, applies_when_sub_type_slug: null },
    ]);
    await db.insert(schema.caseTypes).values({ id: 'ct1', account_id: A, slug: 'pi', label: 'Personal Injury', position: 1, is_in_scope: true, created_at: NOW });
    await db.insert(schema.subTypes).values([
      { id: 'sub1', case_type_id: 'ct1', slug: 'car_accident', label: 'Car Accident', position: 1, scoring_config_json: null, created_at: NOW },
      { id: 'sub2', case_type_id: 'ct1', slug: 'slip_fall', label: 'Slip & Fall', position: 2, scoring_config_json: null, created_at: NOW },
    ]);
    const questionsJson = JSON.stringify([
      { id: 'q1', position: 0, text: 'Were you injured?', preface: null, chips: [{ label: 'Yes', slug: 'yes', score_weight: 10 }], free_text_allowed: false, multi_select: false },
    ]);
    await db.insert(schema.branches).values({ id: 'br1', account_id: A, case_type_slug: 'pi', sub_type_slug: 'car_accident', is_active: true, is_case_value_enabled: false, current_version_id: 'bv1', created_at: NOW, updated_at: NOW });
    await db.insert(schema.branchVersions).values({ id: 'bv1', branch_id: 'br1', version_number: 1, is_published: true, questions_json: questionsJson, classification_thresholds_json: '{}', hard_override_toggles_json: '{}', case_value_config_json: null, published_at: NOW, created_at: NOW, created_by_user_id: 'seed' });

    const view = await getSopFlowView(A);
    expect(view).not.toBeNull();
    expect(view!.version).toBe(2);
    expect(view!.qualifiedLeadThreshold).toBe(6);
    expect(view!.steps).toHaveLength(1);
    expect(view!.steps[0].slug).toBe('case_type');
    expect(view!.caseTypes).toHaveLength(1);
    const ct = view!.caseTypes[0];
    expect(ct.subTypes).toHaveLength(2);
    // car_accident has a configured branch; slip_fall does not.
    const car = ct.subTypes.find((s) => s.slug === 'car_accident')!;
    expect(car.branch).not.toBeNull();
    expect(car.branch!.questions[0].text).toBe('Were you injured?');
    expect(car.branch!.questions[0].chips[0]).toEqual({ label: 'Yes', weight: 10 });
    const slip = ct.subTypes.find((s) => s.slug === 'slip_fall')!;
    expect(slip.branch).toBeNull();
  });

  it('falls back gracefully when a branch has no current version', async () => {
    await db.insert(schema.sopConfigurations).values({ id: 'sop_2', account_id: A, version: 1, qualified_lead_threshold: 5, is_published: true, derived_from_legacy: false, created_at: NOW, label: null });
    await db.insert(schema.caseTypes).values({ id: 'ct2', account_id: A, slug: 'dui', label: 'DUI', position: 1, is_in_scope: true, created_at: NOW });
    await db.insert(schema.subTypes).values({ id: 'sub3', case_type_id: 'ct2', slug: 'first', label: 'First Offense', position: 1, scoring_config_json: null, created_at: NOW });
    await db.insert(schema.branches).values({ id: 'br2', account_id: A, case_type_slug: 'dui', sub_type_slug: 'first', is_active: true, is_case_value_enabled: false, current_version_id: null, created_at: NOW, updated_at: NOW });

    const view = await getSopFlowView(A);
    expect(view!.caseTypes[0].subTypes[0].branch).toBeNull();
  });
});
