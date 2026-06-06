/**
 * Tests for spec 016 ensure-contact-step boot-time function (T015).
 *
 * The function is a spec 010 carry-over that adds Step 6 (contact) to
 * any seeded SOP that doesn't yet have one. This file verifies the
 * spec 016 fingerprint behaviour: only firms whose SOP matches the
 * seeded default get a contact step inserted; custom configurations
 * are left alone (R9 in research.md).
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

import { ensureContactStepForAccount } from './ensure-contact-step.js';
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
`;

beforeEach(() => {
  sqlite.exec(
    'DROP TABLE IF EXISTS sop_steps; DROP TABLE IF EXISTS sop_configurations; DROP TABLE IF EXISTS accounts;',
  );
  sqlite.exec(MIGRATION_SQL);
});

afterEach(() => {
  vi.clearAllMocks();
});

interface SeedOptions {
  accountId: string;
  cfgId: string;
  threshold: number;
  /** Step slugs to seed in position order (positions 1..N). */
  stepSlugs: string[];
}

async function seedAccount(opts: SeedOptions): Promise<void> {
  const ts = '2026-06-06T00:00:00Z';
  await db.insert(schema.accounts).values({
    id: opts.accountId,
    email: `${opts.accountId}@example.com`,
    password_hash: 'x',
    firm_name: null,
    created_at: ts,
  });
  await db.insert(schema.sopConfigurations).values({
    id: opts.cfgId,
    account_id: opts.accountId,
    version: 1,
    qualified_lead_threshold: opts.threshold,
    is_published: true,
    derived_from_legacy: false,
    created_at: ts,
  });
  for (let i = 0; i < opts.stepSlugs.length; i++) {
    const slug = opts.stepSlugs[i];
    await db.insert(schema.sopSteps).values({
      id: `step_${slug}`,
      sop_configuration_id: opts.cfgId,
      position: i + 1,
      slug,
      question_text: `Q ${slug}`,
      chip_source: slug === 'contact' ? 'contact_form' : null,
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
      is_default: true,
      skip_condition_json: null,
      applies_when_sub_type_slug: null,
    });
  }
}

describe('ensureContactStepForAccount', () => {
  it('inserts contact at position 6 and bumps threshold 5→6 for legacy 5-step seeded firms', async () => {
    await seedAccount({
      accountId: 'acct_legacy',
      cfgId: 'cfg_legacy',
      threshold: 5,
      stepSlugs: ['case_type', 'sub_type', 'where', 'what', 'when'],
    });

    const result = await ensureContactStepForAccount('acct_legacy');
    expect(result.outcome).toBe('inserted');

    const cfg = await db
      .select()
      .from(schema.sopConfigurations)
      .where(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('drizzle-orm')).eq(
          schema.sopConfigurations.account_id,
          'acct_legacy',
        ),
      )
      .limit(1);
    expect(cfg[0].qualified_lead_threshold).toBe(6);

    const steps = await db.select().from(schema.sopSteps);
    expect(steps).toHaveLength(6);
    const contactStep = steps.find((s) => s.slug === 'contact');
    expect(contactStep).toBeDefined();
    expect(contactStep?.position).toBe(6);
    expect(contactStep?.chip_source).toBe('contact_form');
  });

  it('idempotent: re-running on a firm that already has a contact step is a no-op', async () => {
    await seedAccount({
      accountId: 'acct_done',
      cfgId: 'cfg_done',
      threshold: 6,
      stepSlugs: ['case_type', 'sub_type', 'where', 'what', 'when', 'contact'],
    });

    const first = await ensureContactStepForAccount('acct_done');
    expect(first.outcome).toBe('skipped_already_present');

    const second = await ensureContactStepForAccount('acct_done');
    expect(second.outcome).toBe('skipped_already_present');

    const steps = await db.select().from(schema.sopSteps);
    expect(steps).toHaveLength(6);
  });

  it('preserves custom thresholds (does not bump if threshold was customized)', async () => {
    // Firm has a 4-step custom SOP with threshold=4 (matching their step count).
    // Function inserts contact at position 5 and bumps threshold to 5.
    await seedAccount({
      accountId: 'acct_custom',
      cfgId: 'cfg_custom',
      threshold: 4,
      stepSlugs: ['case_type', 'sub_type', 'where', 'what'],
    });

    const result = await ensureContactStepForAccount('acct_custom');
    expect(result.outcome).toBe('inserted');

    const cfg = await db
      .select()
      .from(schema.sopConfigurations)
      .where(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (await import('drizzle-orm')).eq(
          schema.sopConfigurations.account_id,
          'acct_custom',
        ),
      )
      .limit(1);
    // threshold was 4 = step count; new threshold = step count after = 5
    expect(cfg[0].qualified_lead_threshold).toBe(5);
  });

  it('leaves spec 015 firms (already have contact at position 15) alone', async () => {
    // Pre-spec-016 production firms have contact at position 15.
    // The function detects the existing contact_form step and does
    // nothing.
    await seedAccount({
      accountId: 'acct_015',
      cfgId: 'cfg_015',
      threshold: 6,
      stepSlugs: [
        'case_type',
        'sub_type',
        'where',
        'what',
        'request_type',
        'geographic_qualification',
        'accident_timing',
        'injury',
        'medical_treatment',
        'accident_role',
        'insurance_activity',
        'work_impact',
        'attorney_status',
        'when',
        'contact',
      ],
    });

    const result = await ensureContactStepForAccount('acct_015');
    expect(result.outcome).toBe('skipped_already_present');

    // No new step inserted, threshold unchanged.
    const steps = await db.select().from(schema.sopSteps);
    expect(steps).toHaveLength(15);
  });

  it('returns no_published_sop when the account has no published SOP', async () => {
    const ts = '2026-06-06T00:00:00Z';
    await db.insert(schema.accounts).values({
      id: 'acct_nosop',
      email: 'nosop@b.co',
      password_hash: 'x',
      firm_name: null,
      created_at: ts,
    });

    const result = await ensureContactStepForAccount('acct_nosop');
    expect(result.outcome).toBe('no_published_sop');
  });
});
