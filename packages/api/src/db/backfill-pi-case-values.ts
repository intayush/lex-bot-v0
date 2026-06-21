/**
 * 025-case-value-estimator — one-time backfill script.
 *
 * Adds case value configuration to all Personal Injury branches that do not
 * yet have it, and enables `is_case_value_enabled` for those branches.
 *
 * Specifically:
 *   - Iterates every account that has PI branches (car_accident, slip_fall,
 *     medical_malpractice, dog_bite).
 *   - For each PI branch: if `case_value_config_json` is NULL on the current
 *     published version, writes the industry-standard bands to that row and
 *     sets `branches.is_case_value_enabled = true`.
 *   - Skips branches that already have case value config (idempotent).
 *   - Does NOT create new branch versions — updates the existing published row
 *     in-place since this is purely additive metadata on an immutable snapshot.
 *
 * After running, existing PI leads with a non-null `lead_score` will show a
 * value badge in the dashboard immediately (badge is computed at read-time).
 *
 * CLI usage:
 *   DATABASE_URL=... npx tsx src/db/backfill-pi-case-values.ts
 *
 * Or via package script (add to package.json if desired):
 *   pnpm --filter @legal-chatbot/api exec tsx src/db/backfill-pi-case-values.ts
 */

import { eq, and } from 'drizzle-orm';
import { db, schema } from './index.js';

// ---------------------------------------------------------------------------
// Industry-standard PI case value bands (same as seed data in seed.ts)
// ---------------------------------------------------------------------------

const PI_CASE_VALUE_CONFIGS: Record<string, string> = {
  car_accident: JSON.stringify({ bands: [
    { score_min: 76, score_max: 100, value_min_usd: 75000,  value_max_usd: 250000, position: 0 },
    { score_min: 51, score_max: 75,  value_min_usd: 15000,  value_max_usd: 75000,  position: 1 },
    { score_min: 26, score_max: 50,  value_min_usd: 3000,   value_max_usd: 15000,  position: 2 },
  ], classification_bands: [
    { classification: 'HOT',  value_min_usd: 75000,  value_max_usd: 250000 },
    { classification: 'WARM', value_min_usd: 15000,  value_max_usd: 75000  },
    { classification: 'COLD', value_min_usd: 3000,   value_max_usd: 15000  },
  ]}),
  slip_fall: JSON.stringify({ bands: [
    { score_min: 76, score_max: 100, value_min_usd: 50000,  value_max_usd: 150000, position: 0 },
    { score_min: 51, score_max: 75,  value_min_usd: 10000,  value_max_usd: 50000,  position: 1 },
    { score_min: 26, score_max: 50,  value_min_usd: 2000,   value_max_usd: 10000,  position: 2 },
  ], classification_bands: [
    { classification: 'HOT',  value_min_usd: 50000,  value_max_usd: 150000 },
    { classification: 'WARM', value_min_usd: 10000,  value_max_usd: 50000  },
    { classification: 'COLD', value_min_usd: 2000,   value_max_usd: 10000  },
  ]}),
  medical_malpractice: JSON.stringify({ bands: [
    { score_min: 76, score_max: 100, value_min_usd: 200000,  value_max_usd: 1000000, position: 0 },
    { score_min: 51, score_max: 75,  value_min_usd: 50000,   value_max_usd: 200000,  position: 1 },
    { score_min: 26, score_max: 50,  value_min_usd: 10000,   value_max_usd: 50000,   position: 2 },
  ], classification_bands: [
    { classification: 'HOT',  value_min_usd: 200000, value_max_usd: 1000000 },
    { classification: 'WARM', value_min_usd: 50000,  value_max_usd: 200000  },
    { classification: 'COLD', value_min_usd: 10000,  value_max_usd: 50000   },
  ]}),
  dog_bite: JSON.stringify({ bands: [
    { score_min: 76, score_max: 100, value_min_usd: 30000,  value_max_usd: 100000, position: 0 },
    { score_min: 51, score_max: 75,  value_min_usd: 8000,   value_max_usd: 30000,  position: 1 },
    { score_min: 26, score_max: 50,  value_min_usd: 1500,   value_max_usd: 8000,   position: 2 },
  ], classification_bands: [
    { classification: 'HOT',  value_min_usd: 30000,  value_max_usd: 100000 },
    { classification: 'WARM', value_min_usd: 8000,   value_max_usd: 30000  },
    { classification: 'COLD', value_min_usd: 1500,   value_max_usd: 8000   },
  ]}),
};

const PI_SUB_TYPE_SLUGS = Object.keys(PI_CASE_VALUE_CONFIGS);

interface BackfillResult {
  accountId: string;
  subTypeSlug: string;
  outcome: 'updated' | 'skipped_already_configured' | 'skipped_no_published_version';
}

async function backfillPiCaseValues(): Promise<void> {
  console.log('Starting Personal Injury case value backfill...\n');

  // Find all PI branches across all accounts.
  const piBranches = await db
    .select({
      id: schema.branches.id,
      account_id: schema.branches.account_id,
      sub_type_slug: schema.branches.sub_type_slug,
      is_case_value_enabled: schema.branches.is_case_value_enabled,
      current_version_id: schema.branches.current_version_id,
    })
    .from(schema.branches)
    .where(eq(schema.branches.case_type_slug, 'personal_injury'));

  console.log(`Found ${piBranches.length} personal_injury branch(es) across all accounts.\n`);

  const results: BackfillResult[] = [];

  for (const branch of piBranches) {
    const config = PI_CASE_VALUE_CONFIGS[branch.sub_type_slug];

    // Skip sub-types that don't have a predefined config (e.g. future sub-types).
    if (!config || !PI_SUB_TYPE_SLUGS.includes(branch.sub_type_slug)) {
      console.log(`  [${branch.account_id}] ${branch.sub_type_slug}: no config defined — skipping`);
      continue;
    }

    if (!branch.current_version_id) {
      console.log(`  [${branch.account_id}] ${branch.sub_type_slug}: no published version — skipping`);
      results.push({ accountId: branch.account_id, subTypeSlug: branch.sub_type_slug, outcome: 'skipped_no_published_version' });
      continue;
    }

    // Check if the current published version already has classification_bands.
    // If it has config but no classification_bands (old format), still update.
    const versionRows = await db
      .select({
        id: schema.branchVersions.id,
        case_value_config_json: schema.branchVersions.case_value_config_json,
      })
      .from(schema.branchVersions)
      .where(eq(schema.branchVersions.id, branch.current_version_id))
      .limit(1);

    if (versionRows.length === 0) {
      console.log(`  [${branch.account_id}] ${branch.sub_type_slug}: version row not found — skipping`);
      results.push({ accountId: branch.account_id, subTypeSlug: branch.sub_type_slug, outcome: 'skipped_no_published_version' });
      continue;
    }

    // If already has classification_bands, skip — idempotent
    const existing = versionRows[0]!;
    if (existing.case_value_config_json) {
      try {
        const parsed = JSON.parse(existing.case_value_config_json);
        if (Array.isArray(parsed?.classification_bands) && parsed.classification_bands.length > 0) {
          console.log(`  [${branch.account_id}] ${branch.sub_type_slug}: already has classification_bands — skipping`);
          results.push({ accountId: branch.account_id, subTypeSlug: branch.sub_type_slug, outcome: 'skipped_already_configured' });
          continue;
        }
      } catch { /* fall through to update */ }
    }

    const versionId = existing.id;

    // Write case value config to the published branch version.
    await db
      .update(schema.branchVersions)
      .set({ case_value_config_json: config })
      .where(eq(schema.branchVersions.id, versionId));

    // Enable the case value estimator on the branch if not already enabled.
    if (!branch.is_case_value_enabled) {
      await db
        .update(schema.branches)
        .set({ is_case_value_enabled: true, updated_at: new Date().toISOString() })
        .where(eq(schema.branches.id, branch.id));
    }

    console.log(`  [${branch.account_id}] ${branch.sub_type_slug}: ✓ updated (version ${versionId})`);
    results.push({ accountId: branch.account_id, subTypeSlug: branch.sub_type_slug, outcome: 'updated' });
  }

  // Summary.
  const updated = results.filter((r) => r.outcome === 'updated').length;
  const skipped = results.filter((r) => r.outcome !== 'updated').length;

  console.log(`\nBackfill complete.`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`\nExisting PI leads with a non-null lead_score will now show value badges in the dashboard.`);
}

backfillPiCaseValues().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
