/**
 * One-off migration verifier for spec 015. Run with:
 *   node --env-file=.env.local --import tsx scripts/verify-015-migration.mts
 *
 * Asserts that 0003_bizarre_mongu.sql applied correctly to the
 * connected Neon branch. Outputs the new column inventory and the
 * post-migration classification distribution.
 *
 * Safe to run repeatedly. Read-only.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  const newLeadCols = await sql`
    SELECT column_name, is_nullable, data_type
    FROM information_schema.columns
    WHERE table_name = 'leads'
      AND column_name IN ('lead_score', 'score_reasons_json',
                          'request_type', 'geographic_qualification',
                          'geographic_qualification_details_json')
    ORDER BY column_name`;

  const subTypeCol = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sub_types' AND column_name = 'scoring_config_json'`;

  const sopStepsCol = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'sop_steps' AND column_name = 'applies_when_sub_type_slug'`;

  const classifications = await sql`
    SELECT classification, COUNT(*)::int as n
    FROM leads
    GROUP BY classification
    ORDER BY classification`;

  console.log('=== leads new columns (expect 5 rows, all nullable) ===');
  console.table(newLeadCols);

  console.log('=== sub_types.scoring_config_json present? (expect 1 row) ===');
  console.table(subTypeCol);

  console.log('=== sop_steps.applies_when_sub_type_slug present? (expect 1 row) ===');
  console.table(sopStepsCol);

  console.log('=== classification distribution (expect HOT/WARM/COLD/SPAM only — no urgent/normal/unqualified) ===');
  console.table(classifications);

  const legacyCount = (classifications as Array<{ classification: string; n: number }>)
    .filter((row) => ['urgent', 'normal', 'unqualified'].includes(row.classification))
    .reduce((acc, row) => acc + row.n, 0);

  if (legacyCount > 0) {
    console.error(`\nFAIL: ${legacyCount} rows still carry legacy classification values`);
    process.exit(1);
  }
  console.log('\nPASS: no rows carry legacy classification values.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
