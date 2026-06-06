/**
 * Production bootstrap — idempotent.
 *
 * Brings a deployed Neon DB to a fully spec-016-compliant state
 * WITHOUT touching real data. Safe to re-run.
 *
 * Steps (each guarded; skips when target state is already in place):
 *   1. Drizzle migrations  — applies 0000..0004 (idempotent: Drizzle
 *      tracks applied versions in the __drizzle_migrations table).
 *   2. Spec 016 data migration (0004 phase B) — copies any
 *      pre-existing sub_types.scoring_config_json into the new
 *      branches / branch_versions tables.
 *   3. Per-account seed bootstrap — for each account, calls
 *      `seedSopForAccount` (no-ops when an SOP already exists),
 *      then `ensureContactStepForAccount` (no-ops when contact step
 *      already in place), then `ensureCarAccidentBranchForAccount`
 *      (no-ops when the branch already exists).
 *
 * Usage:
 *
 *   DATABASE_URL=postgresql://… \
 *     pnpm --filter @legal-chatbot/api exec \
 *     tsx --env-file=.env.local src/db/bootstrap-prod.ts
 *
 * (Or pass `--env-file=.env.production` if you keep prod creds there.)
 *
 * The script exits non-zero on the first failure; partial state is
 * left for the operator to inspect. Re-running picks up where it
 * left off.
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { migrate } from 'drizzle-orm/neon-http/migrator';
import path from 'node:path';

import { runMultiBranchSopDataMigration } from './migrations/0004-multi-branch-sop.js';
import { seedSopForAccount } from './seed.js';
import { ensureContactStepForAccount } from './ensure-contact-step.js';
import { ensureCarAccidentBranchForAccount } from './ensure-car-accident-branch.js';
import { db, schema } from './index.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

console.log('[bootstrap] Target DB host:', new URL(DATABASE_URL).host);

// Step 1 — Drizzle migrations
console.log('[bootstrap] Step 1/3 — running Drizzle migrations...');
{
  const sql = neon(DATABASE_URL);
  const migrationDb = drizzle(sql);
  const migrationsFolder = path.resolve(import.meta.dirname, '../../drizzle');
  await migrate(migrationDb, { migrationsFolder });
  console.log('[bootstrap]   Drizzle migrations complete.');
}

// Step 2 — Spec 016 phase-B data migration (sub_types.scoring_config_json -> branches)
console.log('[bootstrap] Step 2/3 — running spec 016 data migration (phase B)...');
{
  const results = await runMultiBranchSopDataMigration({ db });
  const inserted = results.filter((r) => r.outcome === 'inserted').length;
  const skipped = results.filter((r) => r.outcome === 'skipped_already_present').length;
  console.log(
    `[bootstrap]   Phase B: ${inserted} inserted, ${skipped} skipped (already present), ` +
      `${results.length} total tuples processed.`,
  );
}

// Step 3 — Per-account seed bootstrap
console.log('[bootstrap] Step 3/3 — per-account SOP / contact-step / branch bootstrap...');
const accounts = await db.select({ id: schema.accounts.id, email: schema.accounts.email }).from(schema.accounts);
console.log(`[bootstrap]   Found ${accounts.length} account(s).`);

if (accounts.length === 0) {
  console.warn(
    '[bootstrap]   WARNING: no accounts on this DB. Run pnpm db:seed against this DATABASE_URL ' +
      'to create the dev account, OR create accounts via the dashboard signup flow first.',
  );
}

for (const acct of accounts) {
  console.log(`[bootstrap]   ${acct.email} (${acct.id})`);
  try {
    // 3a: seed default SOP + case_types + sub_types + goodbye_phrases + Car Accident branch.
    // No-ops when account already has an SOP.
    await seedSopForAccount(acct.id);

    // 3b: legacy 5-step seeded firms get Step 6 (contact) inserted at position 6
    // and threshold bumped 5 -> 6. No-ops when contact step already exists.
    const contactResult = await ensureContactStepForAccount(acct.id);
    console.log(`[bootstrap]     ensureContactStep: ${contactResult.outcome}`);

    // 3c: ensure the (personal_injury, car_accident) Branch row exists with the
    // current spec 016 published payload. No-ops when branch already exists.
    const branchResult = await ensureCarAccidentBranchForAccount(acct.id);
    console.log(`[bootstrap]     ensureCarAccidentBranch: ${branchResult.outcome}`);
  } catch (err) {
    console.error(`[bootstrap]   FAILED for ${acct.email}:`, err);
    process.exit(1);
  }
}

console.log('[bootstrap] Complete.');
