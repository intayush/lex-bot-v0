/**
 * T013c live verification — confirms the remediation script's effect
 * on the actual dev Neon branch. Read-only after the remediation has
 * already run.
 *
 * Run with:
 *   node --env-file=.env.local --import tsx scripts/verify-015-live-remediation.mts
 */
import { neon } from '@neondatabase/serverless';

import { CAR_ACCIDENT_SCORING_CONFIG_JSON } from '../src/db/seed-defaults/sop.js';

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  const sql = neon(DATABASE_URL);

  let failures = 0;
  function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
      console.log(`  PASS  ${label}`);
    } else {
      failures++;
      console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
  }

  console.log('=== T013c — live remediation verification ===\n');

  console.log('SOP steps inventory:');
  const stepCounts = (await sql`
    SELECT applies_when_sub_type_slug, COUNT(*)::int as n
    FROM sop_steps
    GROUP BY applies_when_sub_type_slug
    ORDER BY applies_when_sub_type_slug NULLS FIRST
  `) as Array<{ applies_when_sub_type_slug: string | null; n: number }>;
  console.table(stepCounts);

  const carAccidentStepCount =
    stepCounts.find((r) => r.applies_when_sub_type_slug === 'car_accident')?.n ?? 0;
  check(
    'at least 9 car-accident-scoped sop_steps exist (across all configs)',
    carAccidentStepCount >= 9,
    `got ${carAccidentStepCount}`,
  );

  const defaultStepCount =
    stepCounts.find((r) => r.applies_when_sub_type_slug === null)?.n ?? 0;
  check(
    'at least 6 default-flow sop_steps exist (the original case_type/sub_type/where/what/when/contact)',
    defaultStepCount >= 6,
    `got ${defaultStepCount}`,
  );

  console.log('\nCar-accident scoring step slugs:');
  const slugs = (await sql`
    SELECT slug
    FROM sop_steps
    WHERE applies_when_sub_type_slug = 'car_accident'
    ORDER BY slug
  `) as Array<{ slug: string }>;
  const expectedSlugs = [
    'accident_role',
    'accident_timing',
    'attorney_status',
    'geographic_qualification',
    'injury',
    'insurance_activity',
    'medical_treatment',
    'request_type',
    'work_impact',
  ];
  const actualSlugs = slugs.map((r) => r.slug);
  check(
    'exactly 9 expected scoring slugs present',
    JSON.stringify(actualSlugs) === JSON.stringify(expectedSlugs),
    `got ${JSON.stringify(actualSlugs)}`,
  );

  console.log('\nposition renumbering (published configs only):');
  const positions = (await sql`
    SELECT s.slug, s.position
    FROM sop_steps s
    JOIN sop_configurations c ON s.sop_configuration_id = c.id
    WHERE s.slug IN ('when', 'contact') AND c.is_published = true
    ORDER BY s.slug
  `) as Array<{ slug: string; position: number }>;
  console.table(positions);
  const whenPositions = positions.filter((r) => r.slug === 'when');
  const contactPositions = positions.filter((r) => r.slug === 'contact');
  check(
    'all published when steps are at position 14',
    whenPositions.every((r) => r.position === 14),
    `got ${whenPositions.map((r) => r.position).join(',')}`,
  );
  check(
    'all published contact steps are at position 15',
    contactPositions.every((r) => r.position === 15),
    `got ${contactPositions.map((r) => r.position).join(',')}`,
  );

  console.log('\ncar_accident sub_type scoring_config_json:');
  const carAccidentRows = (await sql`
    SELECT scoring_config_json
    FROM sub_types st
    JOIN case_types ct ON st.case_type_id = ct.id
    WHERE ct.slug = 'personal_injury' AND st.slug = 'car_accident'
  `) as Array<{ scoring_config_json: string | null }>;
  check(
    'at least one car_accident sub_type exists',
    carAccidentRows.length > 0,
    `got ${carAccidentRows.length}`,
  );
  for (const row of carAccidentRows) {
    check(
      'scoring_config_json equals seeded default',
      row.scoring_config_json === CAR_ACCIDENT_SCORING_CONFIG_JSON,
      row.scoring_config_json === null
        ? 'NULL — remediation did not run for this account'
        : 'mismatch — admin customization?',
    );
  }

  console.log('\nidempotency check (chip count for accident_timing):');
  const accidentTimingChips = (await sql`
    SELECT inline_chips_json
    FROM sop_steps
    WHERE slug = 'accident_timing' AND applies_when_sub_type_slug = 'car_accident'
  `) as Array<{ inline_chips_json: string }>;
  for (const row of accidentTimingChips) {
    const chips = JSON.parse(row.inline_chips_json) as Array<{
      label: string;
      slug: string;
      score_weight?: number;
    }>;
    check(
      'accident_timing has 6 chips (5 weighted + I Don\'t Know)',
      chips.length === 6,
      `got ${chips.length}`,
    );
    const todayWeight = chips.find((c) => c.slug === 'today')?.score_weight;
    check('today chip carries score_weight = 20', todayWeight === 20, `got ${todayWeight}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
