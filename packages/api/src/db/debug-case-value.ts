/**
 * Debug script — check case value estimator state in the DB.
 * Run: DATABASE_URL=... pnpm --filter @legal-chatbot/api exec tsx src/db/debug-case-value.ts
 */
import { eq, isNotNull } from 'drizzle-orm';
import { db, schema } from './index.js';

async function main() {
  // 1. PI branches — are they enabled?
  const branches = await db
    .select({
      case_type_slug: schema.branches.case_type_slug,
      sub_type_slug: schema.branches.sub_type_slug,
      is_case_value_enabled: schema.branches.is_case_value_enabled,
      current_version_id: schema.branches.current_version_id,
    })
    .from(schema.branches)
    .where(eq(schema.branches.case_type_slug, 'personal_injury'));

  console.log('PI branches:');
  for (const b of branches) {
    console.log(`  ${b.sub_type_slug}: enabled=${b.is_case_value_enabled} version=${b.current_version_id ?? 'null'}`);
  }

  // 2. Branch versions — do they have case_value_config_json?
  const allVersions = await db
    .select({ id: schema.branchVersions.id, config: schema.branchVersions.case_value_config_json })
    .from(schema.branchVersions);
  const withConfig = allVersions.filter((v) => v.config !== null);
  console.log(`\nBranch versions with case_value_config_json: ${withConfig.length} of ${allVersions.length}`);

  // 3. Leads — how many have lead_score? How many are PI?
  const allLeads = await db
    .select({ id: schema.leads.id, case_type: schema.leads.case_type, lead_score: schema.leads.lead_score, classification: schema.leads.classification })
    .from(schema.leads);
  const scored = allLeads.filter((l) => l.lead_score !== null);
  const piScored = scored.filter((l) => l.case_type === 'personal_injury');
  console.log(`\nAll leads: ${allLeads.length}`);
  console.log(`Leads with non-null lead_score: ${scored.length}`);
  console.log(`PI leads with non-null lead_score: ${piScored.length}`);
  console.log('Sample scored leads (any type):', JSON.stringify(scored.slice(0, 5).map((l) => ({ case_type: l.case_type, score: l.lead_score, cls: l.classification })), null, 2));

  // 4. Simulate the badge join query
  const enabledBranches = await db
    .select({
      case_type_slug: schema.branches.case_type_slug,
      is_case_value_enabled: schema.branches.is_case_value_enabled,
      case_value_config_json: schema.branchVersions.case_value_config_json,
    })
    .from(schema.branches)
    .innerJoin(schema.branchVersions, eq(schema.branchVersions.id, schema.branches.current_version_id))
    .where(eq(schema.branches.is_case_value_enabled, true));

  console.log(`\nBadge join query result (enabled branches with version): ${enabledBranches.length} rows`);
  for (const r of enabledBranches) {
    const hasConfig = r.case_value_config_json !== null;
    console.log(`  ${r.case_type_slug}: has_config=${hasConfig}`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
