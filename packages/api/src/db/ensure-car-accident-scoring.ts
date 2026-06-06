/**
 * Idempotent remediation for spec 015 — Lead Classification Revamp.
 *
 * Per FR-036 / FR-037 and the ensure-contact-step.ts precedent. Adds the 9
 * car-accident-scoped scoring SOP steps (positions 5–13) and the seeded
 * scoring_config_json on the car_accident sub_type for any account whose
 * published SOP doesn't yet have them.
 *
 * Behavior:
 * - For each account, find the published SOP.
 * - If absent → outcome 'no_published_sop' (legacy / not-yet-bootstrapped account).
 * - If the personal_injury → car_accident sub_type doesn't exist for the
 *   account → outcome 'no_car_accident_subtype' (admin removed it; not our place
 *   to recreate).
 * - If ANY of the 9 expected step slugs already exists with non-default
 *   content (e.g., admin authored their own variant) OR car_accident already
 *   has a non-default scoring_config_json → outcome 'skipped_has_customizations'
 *   (FR-037: never overwrite admin work).
 * - If all 9 steps already exist (default content) AND scoring_config_json
 *   matches the seeded default → outcome 'skipped_already_present' (idempotent
 *   no-op on second run).
 * - Otherwise → insert the 9 new steps (renumbering when=5→14 and contact=6→15
 *   in the same operation), set car_accident.scoring_config_json to the
 *   seeded default, return 'inserted'.
 *
 * Safe to run multiple times. Multi-account: processes accounts in series,
 * one at a time, and never crosses account boundaries. The neon-http driver
 * does not support transactions (per the existing case-types/route.ts
 * comment), so partial-failure recovery is by re-running the script — each
 * account's outcome is independent.
 *
 * CLI usage:
 *   node --env-file=.env.local --import tsx src/db/ensure-car-accident-scoring.ts
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, schema } from './index.js';
import {
  CAR_ACCIDENT_SCORING_CONFIG_JSON,
  DEFAULT_SOP_STEPS,
} from './seed-defaults/sop.js';

export interface CarAccidentScoringMigrationResult {
  account_id: string;
  outcome:
    | 'inserted'
    | 'skipped_already_present'
    | 'skipped_has_customizations'
    | 'no_published_sop'
    | 'no_car_accident_subtype';
}

/**
 * Slugs of the 9 new SOP steps introduced by spec 015. Sourced from
 * the seed-defaults file via filter so a future seed change doesn't
 * silently drift this set out of sync.
 */
const CAR_ACCIDENT_SCORING_STEP_SLUGS: readonly string[] =
  DEFAULT_SOP_STEPS.filter(
    (s) => s.applies_when_sub_type_slug === 'car_accident',
  ).map((s) => s.slug);

/**
 * Seeded default `_RAW_DEFAULT_SOP_STEPS` rows for the 9 scoring steps,
 * keyed by slug. Used to insert and to detect "default" vs "customized".
 */
const SCORING_STEP_TEMPLATE_BY_SLUG = new Map(
  DEFAULT_SOP_STEPS.filter(
    (s) => s.applies_when_sub_type_slug === 'car_accident',
  ).map((s) => [s.slug, s]),
);

/**
 * Iterate all accounts and remediate each one. Results are returned
 * in account-iteration order; one entry per account.
 */
export async function ensureCarAccidentScoringForAllAccounts(): Promise<
  CarAccidentScoringMigrationResult[]
> {
  const results: CarAccidentScoringMigrationResult[] = [];
  const accounts = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts);
  for (const acct of accounts) {
    results.push(await ensureCarAccidentScoringForAccount(acct.id));
  }
  return results;
}

export async function ensureCarAccidentScoringForAccount(
  accountId: string,
): Promise<CarAccidentScoringMigrationResult> {
  // -------------------------------------------------------------------------
  // 1. Find the published SOP for the account.
  // -------------------------------------------------------------------------
  const cfgRows = await db
    .select()
    .from(schema.sopConfigurations)
    .where(
      and(
        eq(schema.sopConfigurations.account_id, accountId),
        eq(schema.sopConfigurations.is_published, true),
      ),
    )
    .limit(1);
  const cfgRow = cfgRows[0];
  if (!cfgRow) {
    return { account_id: accountId, outcome: 'no_published_sop' };
  }

  // -------------------------------------------------------------------------
  // 2. Find the personal_injury → car_accident sub_type for the account.
  // -------------------------------------------------------------------------
  const piCaseTypes = await db
    .select()
    .from(schema.caseTypes)
    .where(
      and(
        eq(schema.caseTypes.account_id, accountId),
        eq(schema.caseTypes.slug, 'personal_injury'),
      ),
    )
    .limit(1);
  const piCaseType = piCaseTypes[0];
  if (!piCaseType) {
    return { account_id: accountId, outcome: 'no_car_accident_subtype' };
  }

  const carAccidentRows = await db
    .select()
    .from(schema.subTypes)
    .where(
      and(
        eq(schema.subTypes.case_type_id, piCaseType.id),
        eq(schema.subTypes.slug, 'car_accident'),
      ),
    )
    .limit(1);
  const carAccident = carAccidentRows[0];
  if (!carAccident) {
    return { account_id: accountId, outcome: 'no_car_accident_subtype' };
  }

  // -------------------------------------------------------------------------
  // 3. Inspect existing sop_steps for the published SOP. We need to know:
  //    a) Are any of the 9 expected scoring slugs already present?
  //    b) If so, do they match the seeded default content (idempotent rerun)
  //       or are they customized (admin-authored)?
  //    c) Does car_accident already carry a scoring_config_json, and if so
  //       does it match the seeded default?
  // -------------------------------------------------------------------------
  const allSteps = await db
    .select()
    .from(schema.sopSteps)
    .where(eq(schema.sopSteps.sop_configuration_id, cfgRow.id));

  const existingScoringSteps = allSteps.filter((s) =>
    CAR_ACCIDENT_SCORING_STEP_SLUGS.includes(s.slug),
  );

  // Detect customizations: any pre-existing scoring step whose content
  // differs from the seeded default. We compare on the fields a customizer
  // would change: question_text, inline_chips_json, applies_when_sub_type_slug.
  const hasStepCustomizations = existingScoringSteps.some((existing) => {
    const template = SCORING_STEP_TEMPLATE_BY_SLUG.get(existing.slug);
    if (!template) return false; // unreachable given the filter above
    return (
      existing.question_text !== template.question_text ||
      existing.inline_chips_json !== template.inline_chips_json ||
      existing.applies_when_sub_type_slug !== 'car_accident'
    );
  });

  const hasScoringConfigCustomization =
    carAccident.scoring_config_json !== null &&
    carAccident.scoring_config_json !== CAR_ACCIDENT_SCORING_CONFIG_JSON;

  if (hasStepCustomizations || hasScoringConfigCustomization) {
    return { account_id: accountId, outcome: 'skipped_has_customizations' };
  }

  // -------------------------------------------------------------------------
  // 4. Idempotent no-op: all 9 default scoring steps already exist AND the
  //    sub_type already carries the seeded scoring_config_json. Second-run
  //    safety per FR-037.
  // -------------------------------------------------------------------------
  const allNineStepsPresent =
    existingScoringSteps.length === CAR_ACCIDENT_SCORING_STEP_SLUGS.length;
  const scoringConfigSeeded =
    carAccident.scoring_config_json === CAR_ACCIDENT_SCORING_CONFIG_JSON;

  if (allNineStepsPresent && scoringConfigSeeded) {
    return { account_id: accountId, outcome: 'skipped_already_present' };
  }

  // -------------------------------------------------------------------------
  // 5. Insert the missing steps. Also renumber pre-existing `when` and
  //    `contact` steps to positions 14 and 15 if they currently sit at
  //    positions 5/6 (the legacy layout).
  // -------------------------------------------------------------------------

  // Renumber `when` and `contact` if needed.
  const whenStep = allSteps.find((s) => s.slug === 'when');
  const contactStep = allSteps.find((s) => s.slug === 'contact');
  if (whenStep && whenStep.position !== 14) {
    await db
      .update(schema.sopSteps)
      .set({ position: 14 })
      .where(eq(schema.sopSteps.id, whenStep.id));
  }
  if (contactStep && contactStep.position !== 15) {
    await db
      .update(schema.sopSteps)
      .set({ position: 15 })
      .where(eq(schema.sopSteps.id, contactStep.id));
  }

  // Insert any missing scoring steps from the template. Existing rows are
  // left alone (they matched default content per the customization check
  // above).
  const existingScoringSlugs = new Set(existingScoringSteps.map((s) => s.slug));
  for (const slug of CAR_ACCIDENT_SCORING_STEP_SLUGS) {
    if (existingScoringSlugs.has(slug)) continue;
    const template = SCORING_STEP_TEMPLATE_BY_SLUG.get(slug);
    if (!template) continue; // unreachable
    await db.insert(schema.sopSteps).values({
      id: nanoid(),
      sop_configuration_id: cfgRow.id,
      position: template.position,
      slug: template.slug,
      question_text: template.question_text,
      chip_source: template.chip_source,
      inline_chips_json: template.inline_chips_json,
      accepts_free_text: template.accepts_free_text,
      is_required: template.is_required,
      counts_toward_threshold: template.counts_toward_threshold,
      is_default: template.is_default,
      skip_condition_json: template.skip_condition_json,
      applies_when_sub_type_slug: 'car_accident',
    });
  }

  // -------------------------------------------------------------------------
  // 6. Set car_accident.scoring_config_json to the seeded default if it's
  //    currently null. (Customized non-default values were caught above.)
  // -------------------------------------------------------------------------
  if (carAccident.scoring_config_json !== CAR_ACCIDENT_SCORING_CONFIG_JSON) {
    await db
      .update(schema.subTypes)
      .set({ scoring_config_json: CAR_ACCIDENT_SCORING_CONFIG_JSON })
      .where(eq(schema.subTypes.id, carAccident.id));
  }

  return { account_id: accountId, outcome: 'inserted' };
}

// CLI entry point — `tsx src/db/ensure-car-accident-scoring.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ensureCarAccidentScoringForAllAccounts()
    .then((results) => {
      for (const r of results) console.log(`  ${r.account_id}: ${r.outcome}`);
      console.log(
        `Spec 015 remediation complete (${results.length} accounts processed).`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
