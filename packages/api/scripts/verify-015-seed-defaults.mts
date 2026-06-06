/**
 * One-off T013a verifier. Read-only; safe to run repeatedly. Run with:
 *   node --import tsx scripts/verify-015-seed-defaults.mts
 *
 * Asserts the spec-015 seed extensions parse correctly:
 * - 15 default SOP steps in correct positions with correct slugs
 * - 9 car-accident-scoped steps (positions 5-13)
 * - car_accident sub_type carries the seeded scoring_config_json
 * - The seeded scoring config parses against scoringConfigSchema
 */
import {
  DEFAULT_SOP_STEPS,
  DEFAULT_CASE_TYPES,
  CAR_ACCIDENT_SCORING_CONFIG_JSON,
} from '../src/db/seed-defaults/sop.js';
import { scoringConfigSchema } from '@legal-chatbot/shared';

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures++;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('=== T013a — seed defaults verification ===\n');

console.log('SOP steps:');
check('15 default steps total', DEFAULT_SOP_STEPS.length === 15,
  `got ${DEFAULT_SOP_STEPS.length}`);

const positions = DEFAULT_SOP_STEPS.map((s) => s.position).sort((a, b) => a - b);
check('positions cover 1..15 contiguously',
  JSON.stringify(positions) === JSON.stringify([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]),
  `got ${JSON.stringify(positions)}`);

const expectedSlugs = [
  'case_type', 'sub_type', 'where', 'what',
  'request_type', 'geographic_qualification',
  'accident_timing', 'injury', 'medical_treatment',
  'accident_role', 'insurance_activity', 'work_impact',
  'attorney_status',
  'when', 'contact',
];
const sortedByPosition = [...DEFAULT_SOP_STEPS].sort((a, b) => a.position - b.position);
const actualSlugs = sortedByPosition.map((s) => s.slug);
check('slug ordering matches expected layout',
  JSON.stringify(actualSlugs) === JSON.stringify(expectedSlugs),
  `got ${JSON.stringify(actualSlugs)}`);

const scoped = DEFAULT_SOP_STEPS.filter((s) => s.applies_when_sub_type_slug === 'car_accident');
check('9 car-accident-scoped steps', scoped.length === 9,
  `got ${scoped.length}`);

const unscoped = DEFAULT_SOP_STEPS.filter((s) => s.applies_when_sub_type_slug === null);
check('6 default-flow (unscoped) steps', unscoped.length === 6,
  `got ${unscoped.length}`);

const allScopedHaveCountsZero = scoped.every((s) => s.counts_toward_threshold === false);
check('all scoped steps have counts_toward_threshold: false (FR-013)',
  allScopedHaveCountsZero);

console.log('\ncar_accident sub_type:');
const personalInjury = DEFAULT_CASE_TYPES.find((ct) => ct.slug === 'personal_injury');
check('personal_injury case type exists', personalInjury !== undefined);
const carAccident = personalInjury?.sub_types.find((st) => st.slug === 'car_accident');
check('car_accident sub_type exists', carAccident !== undefined);
check('car_accident.scoring_config_json is non-null',
  carAccident?.scoring_config_json !== null && carAccident?.scoring_config_json !== undefined);

console.log('\nscoring_config validation:');
try {
  const parsed = scoringConfigSchema.parse(JSON.parse(CAR_ACCIDENT_SCORING_CONFIG_JSON));
  check('CAR_ACCIDENT_SCORING_CONFIG_JSON parses against scoringConfigSchema', true);
  check('schema_version === 1', parsed.schema_version === 1);
  check('Self thresholds cover [0,100]',
    parsed.thresholds_self.spam[0] === 0 && parsed.thresholds_self.hot[1] === 100);
  check('Family/Friend thresholds cover [0,100]',
    parsed.thresholds_family_friend.spam[0] === 0 && parsed.thresholds_family_friend.hot[1] === 100);
  check('all 4 hard-overrides enabled by default',
    parsed.hard_overrides_enabled.missing_contact === true &&
    parsed.hard_overrides_enabled.out_of_scope === true &&
    parsed.hard_overrides_enabled.no_injury_no_treatment === true &&
    parsed.hard_overrides_enabled.fake_info === true);
} catch (e) {
  check('CAR_ACCIDENT_SCORING_CONFIG_JSON parses', false, String(e));
}

console.log('\ncar_accident sub_type DB-row carries the same JSON:');
check('car_accident.scoring_config_json equals CAR_ACCIDENT_SCORING_CONFIG_JSON',
  carAccident?.scoring_config_json === CAR_ACCIDENT_SCORING_CONFIG_JSON);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
