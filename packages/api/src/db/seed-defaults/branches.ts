/**
 * Default Branch seed data — spec 016 Branch model, expansion beyond the
 * spec 015 Personal Injury → Car Accident reference branch.
 *
 * Provides ready-to-seed `branch_versions` payloads for every default
 * sub-type EXCEPT:
 *   - personal_injury / car_accident (already seeded from
 *     `seed-defaults/sop.ts` as the canonical reference branch)
 *   - family_law / * (intentionally out of scope — see user request)
 *   - estate_planning / * (intentionally out of scope — see user request)
 *
 * For each in-scope sub-type this module exports three pre-serialised
 * JSON strings shaped to fit `branch_versions.{questions_json,
 * classification_thresholds_json, hard_override_toggles_json}`:
 *
 *   <SUB_TYPE>_BRANCH_QUESTIONS_JSON
 *   <SUB_TYPE>_BRANCH_THRESHOLDS_JSON
 *   <SUB_TYPE>_BRANCH_HARD_OVERRIDES_JSON
 *
 * Plus a single aggregated registry, `DEFAULT_BRANCH_SEEDS`, suitable
 * for iteration in `seed.ts` / a future `ensure-default-branches.ts`.
 *
 * Conventions (mirroring the Car Accident reference verbatim):
 *  - Every branch's questions[0] = `request_type` (unscored, single-select).
 *  - Every branch's questions[1] = `geographic_qualification` (unscored).
 *  - Branch then carries 6–7 SCORED questions at positions 2..N.
 *  - Slugs follow `branchSlugSchema` (lowercase a–z0–9_- only).
 *  - Score weights are integers in [-25, +25] — well inside the schema
 *    cap of [-50, +50] — so summed scores naturally land in roughly
 *    [0, 100] before the threshold cap is applied at finalize-time.
 *  - `preface` is always `null`. `free_text_allowed` is always `false`.
 *  - Self thresholds: hot [76,100] / warm [51,75] / cold [26,50] / spam [0,25].
 *  - Family/Friend thresholds: hot [76,100] / warm [26,75] / spam [0,25]
 *    (cold collapses into warm — cf. spec 015's intent for friend/family).
 *  - Hard overrides: `missing_contact`, `out_of_scope`, `fake_info` are
 *    enabled on EVERY branch; `no_injury_no_treatment` is enabled only on
 *    the three personal-injury branches (slip_fall, medical_malpractice,
 *    dog_bite). Disabled elsewhere because injury/treatment isn't asked
 *    on non-PI branches and the toggle would be dead config.
 *
 * Validated at module-load time against the shared Zod schemas (Constitution
 * II) so any drift between this seed and the schema fails loudly during
 * `pnpm db:seed`.
 */
import {
  branchQuestionSchema,
  thresholdsSelfSchema,
  thresholdsFamilyFriendSchema,
  hardOverridesEnabledSchema,
  type BranchQuestion,
  type ThresholdsSelf,
  type ThresholdsFamilyFriend,
  type HardOverridesEnabled,
} from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Self-tier thresholds shared by every default branch. */
const DEFAULT_THRESHOLDS_SELF: ThresholdsSelf = {
  hot: [76, 100],
  warm: [51, 75],
  cold: [26, 50],
  spam: [0, 25],
};

/** Family/Friend thresholds shared by every default branch. */
const DEFAULT_THRESHOLDS_FAMILY_FRIEND: ThresholdsFamilyFriend = {
  hot: [76, 100],
  warm: [26, 75],
  spam: [0, 25],
};

/** Hard-override toggles for non-PI branches (no injury/treatment ask). */
const NON_PI_HARD_OVERRIDES: HardOverridesEnabled = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: false,
  fake_info: true,
};

/** Hard-override toggles for PI branches (injury/treatment is asked). */
const PI_HARD_OVERRIDES: HardOverridesEnabled = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

// ---------------------------------------------------------------------------
// Standard unscored metadata questions (positions 0 and 1) — identical to
// the Car Accident reference. Captured into `leads.request_type` and
// `leads.geographic_qualification` respectively; do NOT contribute to score.
// ---------------------------------------------------------------------------

const REQUEST_TYPE_QUESTION: BranchQuestion = {
  id: 'request_type',
  position: 0,
  text: 'Are you asking for yourself or a friend/family member?',
  preface: null,
  chips: [
    { label: 'Myself', slug: 'myself', score_weight: 0 },
    { label: 'Friend / Family Member', slug: 'friend_family', score_weight: 0 },
  ],
  free_text_allowed: false,
  multi_select: false,
};

const GEOGRAPHIC_QUALIFICATION_QUESTION: BranchQuestion = {
  id: 'geographic_qualification',
  position: 1,
  text: 'Did this happen in or near our service area?',
  preface: null,
  chips: [
    { label: 'Yes', slug: 'yes_in_area', score_weight: 0 },
    { label: 'No', slug: 'no_outside_area', score_weight: 0 },
  ],
  free_text_allowed: false,
  multi_select: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ScoredQuestionSeed {
  id: string;
  text: string;
  multi_select?: boolean;
  chips: Array<{ label: string; slug: string; score_weight: number }>;
}

/**
 * Compose a full BranchQuestion[] for a sub-type by prepending the two
 * standard unscored metadata questions (positions 0, 1) to the provided
 * scored questions (positions 2..). Validates each question against
 * `branchQuestionSchema` so any drift fails at module load.
 */
function buildBranchQuestions(scored: ScoredQuestionSeed[]): BranchQuestion[] {
  const all: BranchQuestion[] = [
    REQUEST_TYPE_QUESTION,
    GEOGRAPHIC_QUALIFICATION_QUESTION,
    ...scored.map((q, idx) => ({
      id: q.id,
      position: idx + 2,
      text: q.text,
      preface: null,
      chips: q.chips,
      free_text_allowed: false,
      multi_select: q.multi_select ?? false,
    })),
  ];
  return all.map((q) => branchQuestionSchema.parse(q));
}

/** Validate threshold/override blocks at module load. */
const _SELF = thresholdsSelfSchema.parse(DEFAULT_THRESHOLDS_SELF);
const _FF = thresholdsFamilyFriendSchema.parse(
  DEFAULT_THRESHOLDS_FAMILY_FRIEND,
);
const _PI_HO = hardOverridesEnabledSchema.parse(PI_HARD_OVERRIDES);
const _NON_PI_HO = hardOverridesEnabledSchema.parse(NON_PI_HARD_OVERRIDES);

/** Pre-serialised threshold JSON shared by every default branch. */
const DEFAULT_THRESHOLDS_JSON: string = JSON.stringify({
  self: _SELF,
  family_friend: _FF,
});

const PI_HARD_OVERRIDES_JSON: string = JSON.stringify(_PI_HO);
const NON_PI_HARD_OVERRIDES_JSON: string = JSON.stringify(_NON_PI_HO);

// ---------------------------------------------------------------------------
// Branch seed registry — populated below as each branch is appended.
// Each entry: keyed by `<case_type_slug>:<sub_type_slug>`. Consumers
// (seed.ts, ensure-default-branches.ts) iterate this once per account.
// ---------------------------------------------------------------------------

export interface DefaultBranchSeed {
  case_type_slug: string;
  sub_type_slug: string;
  questions_json: string;
  classification_thresholds_json: string;
  hard_override_toggles_json: string;
}

const _DEFAULT_BRANCH_SEEDS: DefaultBranchSeed[] = [];

function registerBranch(
  case_type_slug: string,
  sub_type_slug: string,
  scored: ScoredQuestionSeed[],
  variant: 'pi' | 'non_pi',
): {
  questions_json: string;
  thresholds_json: string;
  hard_overrides_json: string;
} {
  const questions = buildBranchQuestions(scored);
  const questions_json = JSON.stringify(questions);
  const thresholds_json = DEFAULT_THRESHOLDS_JSON;
  const hard_overrides_json =
    variant === 'pi' ? PI_HARD_OVERRIDES_JSON : NON_PI_HARD_OVERRIDES_JSON;

  _DEFAULT_BRANCH_SEEDS.push({
    case_type_slug,
    sub_type_slug,
    questions_json,
    classification_thresholds_json: thresholds_json,
    hard_override_toggles_json: hard_overrides_json,
  });

  return { questions_json, thresholds_json, hard_overrides_json };
}

// ===========================================================================
// BRANCH DEFINITIONS — appended below in groups: DUI, Criminal Defense,
// Personal Injury (slip_fall, medical_malpractice, dog_bite), Drug Crime.
// ===========================================================================

// ---------------------------------------------------------------------------
// DUI — first_offense
// First-offense DUI triage hinges on urgency (arrested + court date),
// BAC/test refusal exposure, accident facts, and existing counsel.
// ---------------------------------------------------------------------------

const _FIRST_OFFENSE_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'arrest_status',
    text: "What's the current status of the case?",
    chips: [
      { label: 'I was arrested and released', slug: 'arrested_released', score_weight: 22 },
      { label: "I'm still in custody / bail hearing coming", slug: 'in_custody', score_weight: 25 },
      { label: 'I got a citation, no arrest', slug: 'cited_only', score_weight: 12 },
      { label: "I'm under investigation, not charged yet", slug: 'under_investigation', score_weight: 6 },
      { label: 'Nothing happened yet, just want info', slug: 'no_action_yet', score_weight: -10 },
    ],
  },
  {
    id: 'court_date_window',
    text: 'Do you have a court date scheduled?',
    chips: [
      { label: 'Within 7 days', slug: 'within_7_days', score_weight: 25 },
      { label: '8–30 days', slug: 'within_30_days', score_weight: 18 },
      { label: '31–60 days', slug: 'within_60_days', score_weight: 10 },
      { label: 'More than 60 days out', slug: 'beyond_60_days', score_weight: 4 },
      { label: 'No court date yet', slug: 'no_date', score_weight: 2 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'chemical_test',
    text: 'Did you take a breath or blood test?',
    chips: [
      { label: 'Yes, and I was over the limit', slug: 'tested_over', score_weight: 18 },
      { label: 'Yes, results borderline / just over', slug: 'tested_borderline', score_weight: 20 },
      { label: 'Yes, results came back under the limit', slug: 'tested_under', score_weight: 10 },
      { label: 'I refused the test', slug: 'refused', score_weight: 22 },
      { label: 'No test was given', slug: 'no_test', score_weight: 12 },
      { label: "I don't know / don't remember", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'incident_severity',
    text: 'Was anyone hurt or was there an accident?',
    chips: [
      { label: 'No accident, just a traffic stop', slug: 'traffic_stop_only', score_weight: 6 },
      { label: 'Minor accident, no injuries', slug: 'minor_accident', score_weight: 10 },
      { label: 'Property damage only', slug: 'property_damage', score_weight: 12 },
      { label: 'Someone was injured', slug: 'injury', score_weight: 18 },
      { label: 'Someone was seriously hurt or killed', slug: 'serious_injury', score_weight: 22 },
    ],
  },
  {
    id: 'license_status',
    text: "What's happening with your driver's license?",
    chips: [
      { label: 'It was suspended on the spot', slug: 'suspended_now', score_weight: 20 },
      { label: 'I got a temporary / hardship permit', slug: 'temp_permit', score_weight: 15 },
      { label: 'Hearing deadline is coming up', slug: 'hearing_pending', score_weight: 22 },
      { label: 'Nothing has happened to it yet', slug: 'no_action', score_weight: 6 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney for this?',
    chips: [
      { label: "No, I'm looking now", slug: 'none_looking', score_weight: 20 },
      { label: 'I have a public defender but want private counsel', slug: 'pd_wants_private', score_weight: 15 },
      { label: "I'm getting quotes from a few firms", slug: 'shopping', score_weight: 10 },
      { label: 'I already hired a private attorney', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching, not ready to hire', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const FIRST_OFFENSE_BRANCH = registerBranch(
  'dui',
  'first_offense',
  _FIRST_OFFENSE_QUESTIONS,
  'non_pi',
);
export const FIRST_OFFENSE_BRANCH_QUESTIONS_JSON = FIRST_OFFENSE_BRANCH.questions_json;
export const FIRST_OFFENSE_BRANCH_THRESHOLDS_JSON = FIRST_OFFENSE_BRANCH.thresholds_json;
export const FIRST_OFFENSE_BRANCH_HARD_OVERRIDES_JSON = FIRST_OFFENSE_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// DUI — repeat_offense
// Almost always HOT base-rate; discriminators are recency of priors,
// felony status, custody, supervision, and license posture.
// ---------------------------------------------------------------------------

const _REPEAT_OFFENSE_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'prior_dui_count',
    text: 'How many prior DUI or impaired-driving offenses do you have?',
    chips: [
      { label: 'One prior, more than 10 years ago', slug: 'one_old', score_weight: 10 },
      { label: 'One prior, within last 10 years', slug: 'one_recent', score_weight: 18 },
      { label: 'Two priors', slug: 'two_priors', score_weight: 22 },
      { label: 'Three or more priors', slug: 'three_plus', score_weight: 25 },
      { label: "I don't remember exactly", slug: 'unknown', score_weight: 12 },
    ],
  },
  {
    id: 'charge_level',
    text: 'Has this been charged as a felony?',
    chips: [
      { label: 'Yes, felony DUI', slug: 'felony', score_weight: 25 },
      { label: 'Misdemeanor with enhancements', slug: 'enhanced_misdemeanor', score_weight: 20 },
      { label: 'Standard misdemeanor', slug: 'misdemeanor', score_weight: 12 },
      { label: 'Not charged yet', slug: 'not_charged', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'custody_status',
    text: 'Where are things right now?',
    chips: [
      { label: 'Currently in jail', slug: 'in_jail', score_weight: 25 },
      { label: 'Out on bail / bond', slug: 'out_on_bond', score_weight: 20 },
      { label: 'Released on own recognizance', slug: 'released_or', score_weight: 15 },
      { label: 'Cited, not arrested', slug: 'cited', score_weight: 10 },
      { label: 'Just got a notice / summons', slug: 'summons', score_weight: 8 },
    ],
  },
  {
    id: 'chemical_test',
    text: 'Did you take a breath or blood test, and what happened?',
    chips: [
      { label: 'Refused', slug: 'refused', score_weight: 20 },
      { label: 'Tested very high (1.5x+ legal limit)', slug: 'high_bac', score_weight: 22 },
      { label: 'Tested over the limit', slug: 'over_limit', score_weight: 15 },
      { label: 'Tested borderline / under', slug: 'low_or_under', score_weight: 10 },
      { label: 'No test given', slug: 'no_test', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'license_status',
    text: "What's happening with your license?",
    chips: [
      { label: 'Already suspended from a prior', slug: 'already_suspended', score_weight: 20 },
      { label: 'Suspended on this arrest', slug: 'suspended_now', score_weight: 22 },
      { label: 'Have an interlock requirement', slug: 'interlock', score_weight: 15 },
      { label: 'Still valid', slug: 'valid', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'supervision_status',
    text: 'Are you currently on probation or parole?',
    chips: [
      { label: 'Yes, for a prior DUI', slug: 'probation_dui', score_weight: 25 },
      { label: 'Yes, for something else', slug: 'probation_other', score_weight: 20 },
      { label: 'No', slug: 'none', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney for this case?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Have a public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const REPEAT_OFFENSE_BRANCH = registerBranch(
  'dui',
  'repeat_offense',
  _REPEAT_OFFENSE_QUESTIONS,
  'non_pi',
);
export const REPEAT_OFFENSE_BRANCH_QUESTIONS_JSON = REPEAT_OFFENSE_BRANCH.questions_json;
export const REPEAT_OFFENSE_BRANCH_THRESHOLDS_JSON = REPEAT_OFFENSE_BRANCH.thresholds_json;
export const REPEAT_OFFENSE_BRANCH_HARD_OVERRIDES_JSON = REPEAT_OFFENSE_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// DUI — dui_with_injury
// High-stakes (felony exposure, civil overlap). Discriminators: injury
// severity, victim status, fatality, civil claim activity.
// ---------------------------------------------------------------------------

const _DUI_WITH_INJURY_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'injury_severity',
    text: 'How seriously was the other person hurt?',
    chips: [
      { label: 'Fatality', slug: 'fatality', score_weight: 25 },
      { label: 'Hospitalized / serious injury', slug: 'serious', score_weight: 22 },
      { label: 'Moderate injury, treated and released', slug: 'moderate', score_weight: 18 },
      { label: 'Minor injury, declined treatment', slug: 'minor', score_weight: 12 },
      { label: "I don't know yet", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'victim_relationship',
    text: 'Who was injured?',
    chips: [
      { label: 'Another driver or passenger', slug: 'other_driver', score_weight: 18 },
      { label: 'A pedestrian or cyclist', slug: 'pedestrian', score_weight: 22 },
      { label: 'A passenger in my own vehicle', slug: 'own_passenger', score_weight: 15 },
      { label: 'Only me (the driver)', slug: 'self_only', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'charge_level',
    text: 'What have you been charged with?',
    chips: [
      { label: 'Vehicular manslaughter / homicide', slug: 'manslaughter', score_weight: 25 },
      { label: 'Felony DUI with injury', slug: 'felony_dui', score_weight: 22 },
      { label: 'Aggravated / gross misdemeanor DUI', slug: 'agg_misdemeanor', score_weight: 18 },
      { label: 'Standard DUI plus separate charges', slug: 'standard_plus', score_weight: 15 },
      { label: 'Not formally charged yet', slug: 'not_charged', score_weight: 10 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'custody_status',
    text: 'Are you currently in custody?',
    chips: [
      { label: 'In jail, no bail set', slug: 'held_no_bail', score_weight: 25 },
      { label: 'In jail awaiting bail hearing', slug: 'awaiting_bail', score_weight: 22 },
      { label: 'Out on bail', slug: 'out_on_bail', score_weight: 18 },
      { label: 'Released, charges pending', slug: 'released', score_weight: 12 },
    ],
  },
  {
    id: 'chemical_test',
    text: 'Was there a breath, blood, or drug test?',
    chips: [
      { label: 'Refused', slug: 'refused', score_weight: 18 },
      { label: 'Yes, over the limit', slug: 'over', score_weight: 18 },
      { label: 'Yes, very high BAC', slug: 'high_bac', score_weight: 20 },
      { label: 'Yes, drugs detected', slug: 'drugs_detected', score_weight: 18 },
      { label: 'No test taken', slug: 'no_test', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'civil_claim_status',
    text: 'Has the injured person or their lawyer reached out about a civil claim?',
    chips: [
      { label: 'Yes, lawsuit already filed', slug: 'lawsuit_filed', score_weight: 20 },
      { label: 'Yes, demand letter received', slug: 'demand_letter', score_weight: 18 },
      { label: 'Insurance is asking questions', slug: 'insurer_inquiry', score_weight: 12 },
      { label: 'Not yet', slug: 'not_yet', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you have a criminal defense attorney for this?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender only, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just gathering info', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const DUI_WITH_INJURY_BRANCH = registerBranch(
  'dui',
  'dui_with_injury',
  _DUI_WITH_INJURY_QUESTIONS,
  'non_pi',
);
export const DUI_WITH_INJURY_BRANCH_QUESTIONS_JSON = DUI_WITH_INJURY_BRANCH.questions_json;
export const DUI_WITH_INJURY_BRANCH_THRESHOLDS_JSON = DUI_WITH_INJURY_BRANCH.thresholds_json;
export const DUI_WITH_INJURY_BRANCH_HARD_OVERRIDES_JSON = DUI_WITH_INJURY_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// DUI — dui_with_property
// Lowest-stakes DUI sub-case. Discriminators: damage type/scale,
// hit-and-run posture, civil pressure.
// ---------------------------------------------------------------------------

const _DUI_WITH_PROPERTY_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'property_type',
    text: 'What kind of property was damaged?',
    chips: [
      { label: "Another person's vehicle", slug: 'other_vehicle', score_weight: 15 },
      { label: 'Public property (guardrail, sign, pole)', slug: 'public_property', score_weight: 18 },
      { label: 'Commercial building / business', slug: 'commercial', score_weight: 20 },
      { label: 'Private residence / fence', slug: 'residence', score_weight: 15 },
      { label: 'Only my own vehicle', slug: 'own_only', score_weight: 6 },
    ],
  },
  {
    id: 'damage_amount',
    text: 'Roughly how much damage was done?',
    chips: [
      { label: 'Under $1,000', slug: 'under_1k', score_weight: 5 },
      { label: '$1,000–$5,000', slug: 'mid_damage', score_weight: 12 },
      { label: '$5,000–$25,000', slug: 'high_damage', score_weight: 18 },
      { label: 'Over $25,000', slug: 'very_high_damage', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'left_scene',
    text: 'Did you stay at the scene?',
    chips: [
      { label: 'Yes, stayed and reported it', slug: 'stayed', score_weight: 5 },
      { label: 'Left briefly, came back', slug: 'left_returned', score_weight: 15 },
      { label: 'Left the scene', slug: 'left_scene', score_weight: 22 },
      { label: "I don't remember", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'chemical_test',
    text: 'Was there a breath or blood test?',
    chips: [
      { label: 'Refused', slug: 'refused', score_weight: 20 },
      { label: 'Yes, over the limit', slug: 'over', score_weight: 15 },
      { label: 'Yes, very high BAC', slug: 'high_bac', score_weight: 18 },
      { label: 'Yes, under the limit', slug: 'under', score_weight: 10 },
      { label: 'No test taken', slug: 'no_test', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'charge_status',
    text: 'Where does the case stand?',
    chips: [
      { label: 'Arrested and charged', slug: 'charged', score_weight: 20 },
      { label: 'Cited, court date pending', slug: 'cited', score_weight: 15 },
      { label: 'Under investigation', slug: 'investigation', score_weight: 10 },
      { label: 'No charges yet', slug: 'no_charges', score_weight: 5 },
    ],
  },
  {
    id: 'civil_pressure',
    text: 'Is anyone asking you to pay for damages?',
    chips: [
      { label: 'Lawsuit or demand letter', slug: 'lawsuit_or_demand', score_weight: 18 },
      { label: 'Insurance is denying coverage', slug: 'insurer_denial', score_weight: 15 },
      { label: 'Owner is asking informally', slug: 'informal_request', score_weight: 10 },
      { label: 'Not yet', slug: 'not_yet', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 20 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 15 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const DUI_WITH_PROPERTY_BRANCH = registerBranch(
  'dui',
  'dui_with_property',
  _DUI_WITH_PROPERTY_QUESTIONS,
  'non_pi',
);
export const DUI_WITH_PROPERTY_BRANCH_QUESTIONS_JSON = DUI_WITH_PROPERTY_BRANCH.questions_json;
export const DUI_WITH_PROPERTY_BRANCH_THRESHOLDS_JSON = DUI_WITH_PROPERTY_BRANCH.thresholds_json;
export const DUI_WITH_PROPERTY_BRANCH_HARD_OVERRIDES_JSON = DUI_WITH_PROPERTY_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Criminal Defense — theft
// Mostly about felony vs. misdemeanor, prior record, value, evidence;
// pretrial diversion makes first-offenders HOT-tier.
// ---------------------------------------------------------------------------

const _THEFT_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'theft_type',
    text: 'What were you accused of?',
    chips: [
      { label: 'Shoplifting', slug: 'shoplifting', score_weight: 12 },
      { label: 'Larceny / petty theft', slug: 'larceny', score_weight: 15 },
      { label: 'Burglary (entering a building)', slug: 'burglary', score_weight: 22 },
      { label: 'Robbery (force or threat)', slug: 'robbery', score_weight: 25 },
      { label: 'Auto theft', slug: 'auto_theft', score_weight: 20 },
      { label: 'Receiving stolen property', slug: 'receiving', score_weight: 15 },
    ],
  },
  {
    id: 'property_value',
    text: 'Roughly what was the value of the property involved?',
    chips: [
      { label: 'Under $500', slug: 'under_500', score_weight: 8 },
      { label: '$500–$1,500', slug: 'low', score_weight: 12 },
      { label: '$1,500–$10,000', slug: 'mid', score_weight: 18 },
      { label: 'Over $10,000', slug: 'high', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'charge_level',
    text: 'Is the charge a misdemeanor or felony?',
    chips: [
      { label: 'Felony', slug: 'felony', score_weight: 22 },
      { label: 'Misdemeanor', slug: 'misdemeanor', score_weight: 12 },
      { label: 'Not yet charged', slug: 'not_charged', score_weight: 10 },
      { label: "I don't know", slug: 'unknown', score_weight: 8 },
    ],
  },
  {
    id: 'arrest_status',
    text: "What's the status right now?",
    chips: [
      { label: 'In custody', slug: 'in_custody', score_weight: 25 },
      { label: 'Out on bail', slug: 'out_on_bail', score_weight: 20 },
      { label: 'Cited and released', slug: 'cited', score_weight: 15 },
      { label: 'Under investigation', slug: 'investigation', score_weight: 10 },
      { label: 'Trespass / no-trespass letter only', slug: 'letter_only', score_weight: 5 },
    ],
  },
  {
    id: 'prior_record',
    text: 'Do you have any prior theft or related convictions?',
    chips: [
      { label: 'No prior record', slug: 'none', score_weight: 12 },
      { label: 'One prior, non-theft', slug: 'one_other', score_weight: 10 },
      { label: 'One prior theft', slug: 'one_theft', score_weight: 18 },
      { label: 'Multiple priors', slug: 'multiple', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'evidence_strength',
    text: 'What kind of evidence do they have?',
    multi_select: true,
    chips: [
      { label: 'Surveillance / security video', slug: 'video', score_weight: 15 },
      { label: 'Eyewitnesses', slug: 'witnesses', score_weight: 12 },
      { label: 'I gave a statement to police', slug: 'gave_statement', score_weight: 20 },
      { label: 'Property was recovered on me', slug: 'recovered_on_me', score_weight: 18 },
      { label: "I don't think they have much", slug: 'weak_evidence', score_weight: 6 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const THEFT_BRANCH = registerBranch(
  'criminal_defense',
  'theft',
  _THEFT_QUESTIONS,
  'non_pi',
);
export const THEFT_BRANCH_QUESTIONS_JSON = THEFT_BRANCH.questions_json;
export const THEFT_BRANCH_THRESHOLDS_JSON = THEFT_BRANCH.thresholds_json;
export const THEFT_BRANCH_HARD_OVERRIDES_JSON = THEFT_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Criminal Defense — assault
// Discriminators: weapon, victim injury, domestic context, restraining
// orders, self-defense posture.
// ---------------------------------------------------------------------------

const _ASSAULT_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'assault_type',
    text: 'What kind of assault charge is it?',
    chips: [
      { label: 'Simple assault / battery', slug: 'simple', score_weight: 12 },
      { label: 'Aggravated assault', slug: 'aggravated', score_weight: 22 },
      { label: 'Domestic violence', slug: 'domestic', score_weight: 20 },
      { label: 'Assault on an officer', slug: 'on_officer', score_weight: 25 },
      { label: 'Sexual assault', slug: 'sexual', score_weight: 25 },
      { label: "I don't know yet", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'weapon_used',
    text: 'Was a weapon involved?',
    chips: [
      { label: 'Firearm', slug: 'firearm', score_weight: 25 },
      { label: 'Knife / edged weapon', slug: 'knife', score_weight: 22 },
      { label: 'Other object', slug: 'other_object', score_weight: 18 },
      { label: 'Hands / feet only', slug: 'hands_feet', score_weight: 10 },
      { label: 'No physical contact (threats only)', slug: 'threats_only', score_weight: 12 },
    ],
  },
  {
    id: 'victim_injury',
    text: 'How badly was the other person hurt?',
    chips: [
      { label: 'Hospitalized / serious injury', slug: 'serious', score_weight: 22 },
      { label: 'Treated at ER, released', slug: 'er_treated', score_weight: 18 },
      { label: 'Visible bruising / minor', slug: 'minor', score_weight: 12 },
      { label: 'No injury', slug: 'none', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'arrest_status',
    text: 'Where do things stand right now?',
    chips: [
      { label: 'In custody', slug: 'in_custody', score_weight: 25 },
      { label: 'Out on bail', slug: 'out_on_bail', score_weight: 20 },
      { label: 'Cited and released', slug: 'cited', score_weight: 15 },
      { label: 'Under investigation', slug: 'investigation', score_weight: 12 },
      { label: 'No charges, just want to be ready', slug: 'preemptive', score_weight: 8 },
    ],
  },
  {
    id: 'protective_order',
    text: 'Has a restraining or protective order been filed?',
    chips: [
      { label: 'Yes, against me', slug: 'against_me', score_weight: 22 },
      { label: 'Hearing coming up', slug: 'hearing_pending', score_weight: 20 },
      { label: 'Filed but not served', slug: 'not_served', score_weight: 15 },
      { label: 'No', slug: 'no', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'defense_context',
    text: 'Do you believe you were acting in self-defense or defense of another?',
    chips: [
      { label: 'Yes, clearly self-defense', slug: 'self_defense', score_weight: 18 },
      { label: 'Defending someone else', slug: 'defense_other', score_weight: 18 },
      { label: 'Mutual fight', slug: 'mutual', score_weight: 12 },
      { label: 'No, I was the aggressor', slug: 'aggressor', score_weight: 10 },
      { label: "I don't want to say", slug: 'decline', score_weight: 5 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have a criminal defense attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const ASSAULT_BRANCH = registerBranch(
  'criminal_defense',
  'assault',
  _ASSAULT_QUESTIONS,
  'non_pi',
);
export const ASSAULT_BRANCH_QUESTIONS_JSON = ASSAULT_BRANCH.questions_json;
export const ASSAULT_BRANCH_THRESHOLDS_JSON = ASSAULT_BRANCH.thresholds_json;
export const ASSAULT_BRANCH_HARD_OVERRIDES_JSON = ASSAULT_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Criminal Defense — fraud
// Skews federal-or-state-felony fast. Discriminators: federal exposure,
// dollar amount, search/subpoena activity, prior statements.
// ---------------------------------------------------------------------------

const _FRAUD_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'fraud_type',
    text: 'What kind of fraud is it?',
    chips: [
      { label: 'Identity theft', slug: 'identity', score_weight: 18 },
      { label: 'Credit card / check fraud', slug: 'card_check', score_weight: 15 },
      { label: 'Wire fraud', slug: 'wire', score_weight: 22 },
      { label: 'Bank fraud', slug: 'bank', score_weight: 22 },
      { label: 'Embezzlement', slug: 'embezzlement', score_weight: 20 },
      { label: 'Healthcare / insurance fraud', slug: 'healthcare_insurance', score_weight: 22 },
      { label: 'Tax fraud', slug: 'tax', score_weight: 20 },
      { label: "Other / I don't know", slug: 'other', score_weight: 12 },
    ],
  },
  {
    id: 'jurisdiction_level',
    text: 'Is it a federal or state case?',
    chips: [
      { label: 'Federal', slug: 'federal', score_weight: 25 },
      { label: 'State', slug: 'state', score_weight: 15 },
      { label: 'Both', slug: 'both', score_weight: 25 },
      { label: 'Not charged yet', slug: 'not_charged', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'loss_amount',
    text: 'Roughly how much money is involved?',
    chips: [
      { label: 'Under $10,000', slug: 'under_10k', score_weight: 10 },
      { label: '$10,000–$100,000', slug: 'mid', score_weight: 18 },
      { label: '$100,000–$1M', slug: 'high', score_weight: 22 },
      { label: 'Over $1M', slug: 'very_high', score_weight: 25 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'investigation_activity',
    text: 'Has any of this happened?',
    multi_select: true,
    chips: [
      { label: 'Search warrant executed', slug: 'search_warrant', score_weight: 22 },
      { label: 'Subpoena received', slug: 'subpoena', score_weight: 20 },
      { label: 'Grand jury target letter', slug: 'target_letter', score_weight: 25 },
      { label: 'Interviewed by agents / detectives', slug: 'interviewed', score_weight: 18 },
      { label: 'Assets / accounts frozen', slug: 'assets_frozen', score_weight: 22 },
      { label: 'Nothing yet, just suspicious', slug: 'nothing_yet', score_weight: 5 },
    ],
  },
  {
    id: 'statements_made',
    text: 'Have you spoken to investigators about this?',
    chips: [
      { label: 'Yes, gave a full statement', slug: 'full_statement', score_weight: 22 },
      { label: 'Yes, partial / informal conversation', slug: 'partial', score_weight: 18 },
      { label: 'Declined to speak', slug: 'declined', score_weight: 12 },
      { label: "Haven't been contacted", slug: 'not_contacted', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'co_defendants',
    text: 'Are other people charged with you?',
    chips: [
      { label: 'Yes, multiple co-defendants', slug: 'multiple_co_d', score_weight: 20 },
      { label: 'Yes, one co-defendant', slug: 'one_co_d', score_weight: 15 },
      { label: 'No, just me', slug: 'solo', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const FRAUD_BRANCH = registerBranch(
  'criminal_defense',
  'fraud',
  _FRAUD_QUESTIONS,
  'non_pi',
);
export const FRAUD_BRANCH_QUESTIONS_JSON = FRAUD_BRANCH.questions_json;
export const FRAUD_BRANCH_THRESHOLDS_JSON = FRAUD_BRANCH.thresholds_json;
export const FRAUD_BRANCH_HARD_OVERRIDES_JSON = FRAUD_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Criminal Defense — gun_charge
// Discriminators: prohibited-person status, federal exposure, gun usage
// (vs. mere possession), companion charges.
// ---------------------------------------------------------------------------

const _GUN_CHARGE_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'gun_charge_type',
    text: "What's the gun charge?",
    chips: [
      { label: 'Unlawful / unlicensed possession', slug: 'possession', score_weight: 15 },
      { label: 'Possession by prohibited person (felon, DV, etc.)', slug: 'prohibited_person', score_weight: 25 },
      { label: 'Concealed carry violation', slug: 'ccw_violation', score_weight: 12 },
      { label: 'Brandishing / menacing', slug: 'brandishing', score_weight: 18 },
      { label: 'Unlawful discharge', slug: 'discharge', score_weight: 22 },
      { label: 'Possession in commission of another crime', slug: 'in_furtherance', score_weight: 25 },
      { label: "I don't know", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'jurisdiction_level',
    text: 'Federal or state charge?',
    chips: [
      { label: 'Federal (ATF, US Attorney)', slug: 'federal', score_weight: 25 },
      { label: 'State', slug: 'state', score_weight: 15 },
      { label: 'Both', slug: 'both', score_weight: 25 },
      { label: 'Not charged yet', slug: 'not_charged', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'prohibited_status',
    text: 'Are you legally prohibited from possessing a firearm for any reason?',
    chips: [
      { label: 'Prior felony', slug: 'prior_felony', score_weight: 25 },
      { label: 'Domestic violence conviction or order', slug: 'dv', score_weight: 22 },
      { label: 'Pending charges', slug: 'pending_charges', score_weight: 18 },
      { label: 'Other prohibition (mental health, immigration)', slug: 'other', score_weight: 20 },
      { label: 'Not prohibited', slug: 'not_prohibited', score_weight: 10 },
      { label: "I don't know", slug: 'unknown', score_weight: 12 },
    ],
  },
  {
    id: 'gun_used',
    text: 'Was the firearm used or fired?',
    chips: [
      { label: 'Fired, someone hurt', slug: 'fired_injury', score_weight: 25 },
      { label: 'Fired, no one hurt', slug: 'fired_no_injury', score_weight: 22 },
      { label: 'Pointed / brandished', slug: 'brandished', score_weight: 18 },
      { label: 'Carried but not displayed', slug: 'carried_only', score_weight: 12 },
      { label: 'Found in a vehicle / home', slug: 'constructive', score_weight: 15 },
    ],
  },
  {
    id: 'arrest_status',
    text: "What's the case status now?",
    chips: [
      { label: 'In custody', slug: 'in_custody', score_weight: 25 },
      { label: 'Out on bail', slug: 'out_on_bail', score_weight: 20 },
      { label: 'Cited and released', slug: 'cited', score_weight: 12 },
      { label: 'Under investigation', slug: 'investigation', score_weight: 12 },
      { label: 'No charges yet', slug: 'no_charges', score_weight: 8 },
    ],
  },
  {
    id: 'companion_charges',
    text: 'Are there other charges attached to this?',
    multi_select: true,
    chips: [
      { label: 'Drug charges', slug: 'drugs', score_weight: 18 },
      { label: 'Violent offense', slug: 'violent', score_weight: 22 },
      { label: 'Theft / property', slug: 'theft', score_weight: 12 },
      { label: 'None, gun only', slug: 'gun_only', score_weight: 10 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const GUN_CHARGE_BRANCH = registerBranch(
  'criminal_defense',
  'gun_charge',
  _GUN_CHARGE_QUESTIONS,
  'non_pi',
);
export const GUN_CHARGE_BRANCH_QUESTIONS_JSON = GUN_CHARGE_BRANCH.questions_json;
export const GUN_CHARGE_BRANCH_THRESHOLDS_JSON = GUN_CHARGE_BRANCH.thresholds_json;
export const GUN_CHARGE_BRANCH_HARD_OVERRIDES_JSON = GUN_CHARGE_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Personal Injury — slip_fall (premises liability)
// Discriminators: location/control (commercial vs. private), injury
// severity, treatment paper trail, hazard/notice evidence, damages.
// ---------------------------------------------------------------------------

const _SLIP_FALL_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'location_type',
    text: 'Where did the fall happen?',
    chips: [
      { label: 'Retail store / restaurant', slug: 'retail', score_weight: 22 },
      { label: 'Hotel / resort', slug: 'hotel', score_weight: 20 },
      { label: 'Apartment complex / common area', slug: 'apartment_common', score_weight: 18 },
      { label: 'Office / workplace (not employer)', slug: 'other_workplace', score_weight: 15 },
      { label: 'Government / public property', slug: 'government', score_weight: 10 },
      { label: 'Private home', slug: 'private_home', score_weight: 5 },
      { label: 'Sidewalk / parking lot', slug: 'parking_sidewalk', score_weight: 15 },
    ],
  },
  {
    id: 'hazard_type',
    text: 'What caused you to fall?',
    chips: [
      { label: 'Wet floor / spill, no warning sign', slug: 'wet_no_sign', score_weight: 22 },
      { label: 'Snow / ice not cleared', slug: 'snow_ice', score_weight: 18 },
      { label: 'Broken / uneven flooring or stairs', slug: 'broken_floor', score_weight: 20 },
      { label: 'Poor lighting', slug: 'lighting', score_weight: 15 },
      { label: 'Loose rug / mat / cord', slug: 'loose_object', score_weight: 18 },
      { label: "I'm not sure / tripped on nothing obvious", slug: 'unknown_cause', score_weight: 5 },
    ],
  },
  {
    id: 'injury_severity',
    text: 'How badly were you hurt?',
    chips: [
      { label: 'Surgery required / hospitalized', slug: 'surgery', score_weight: 25 },
      { label: 'Broken bone / fracture', slug: 'fracture', score_weight: 22 },
      { label: 'Soft tissue, ongoing PT', slug: 'soft_tissue_ongoing', score_weight: 15 },
      { label: 'Bruising / scrapes, recovered', slug: 'minor', score_weight: 5 },
      { label: 'No real injury', slug: 'none', score_weight: -15 },
      { label: "I don't know yet", slug: 'unknown', score_weight: 8 },
    ],
  },
  {
    id: 'treatment_status',
    text: 'Did you get medical treatment?',
    chips: [
      { label: 'ER / hospital admission', slug: 'er_admit', score_weight: 20 },
      { label: 'ER, released same day', slug: 'er_released', score_weight: 15 },
      { label: 'Saw a doctor or urgent care', slug: 'doctor', score_weight: 12 },
      { label: 'Still treating now', slug: 'still_treating', score_weight: 18 },
      { label: "Didn't get treatment", slug: 'none', score_weight: -15 },
    ],
  },
  {
    id: 'notice_evidence',
    text: 'Is there evidence the property owner knew about the hazard?',
    multi_select: true,
    chips: [
      { label: 'Filed an incident report on site', slug: 'incident_report', score_weight: 18 },
      { label: 'Surveillance video likely exists', slug: 'video_likely', score_weight: 15 },
      { label: 'Witnesses saw it', slug: 'witnesses', score_weight: 15 },
      { label: 'Hazard had been there a while', slug: 'longstanding', score_weight: 18 },
      { label: 'Photos taken at the scene', slug: 'photos', score_weight: 15 },
      { label: 'None of these / not sure', slug: 'none', score_weight: -5 },
    ],
  },
  {
    id: 'damages_scope',
    text: 'Has the injury affected your work or daily life?',
    multi_select: true,
    chips: [
      { label: 'Missed work / lost wages', slug: 'lost_wages', score_weight: 15 },
      { label: 'Medical bills over $10k', slug: 'bills_high', score_weight: 18 },
      { label: 'Permanent limitation expected', slug: 'permanent', score_weight: 20 },
      { label: 'Just inconvenience', slug: 'minor', score_weight: 5 },
      { label: 'No real impact', slug: 'none', score_weight: -15 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Have you already hired an attorney for this?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: "Talked to one, didn't hire", slug: 'consulted_only', score_weight: 15 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired one', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const SLIP_FALL_BRANCH = registerBranch(
  'personal_injury',
  'slip_fall',
  _SLIP_FALL_QUESTIONS,
  'pi',
);
export const SLIP_FALL_BRANCH_QUESTIONS_JSON = SLIP_FALL_BRANCH.questions_json;
export const SLIP_FALL_BRANCH_THRESHOLDS_JSON = SLIP_FALL_BRANCH.thresholds_json;
export const SLIP_FALL_BRANCH_HARD_OVERRIDES_JSON = SLIP_FALL_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Personal Injury — medical_malpractice
// High-cost litigation; firms only want strong cases. Discriminators:
// permanent harm, expert/second-opinion availability, discovery date
// (SOL exposure), provider type, records availability.
// ---------------------------------------------------------------------------

const _MEDICAL_MALPRACTICE_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'malpractice_type',
    text: 'What happened during your medical care?',
    chips: [
      { label: 'Surgical error', slug: 'surgical', score_weight: 22 },
      { label: 'Misdiagnosis or delayed diagnosis', slug: 'misdiagnosis', score_weight: 20 },
      { label: 'Birth injury', slug: 'birth_injury', score_weight: 25 },
      { label: 'Medication / prescription error', slug: 'medication', score_weight: 18 },
      { label: 'Anesthesia error', slug: 'anesthesia', score_weight: 22 },
      { label: 'Hospital-acquired infection', slug: 'infection', score_weight: 15 },
      { label: 'Failure to treat / abandonment', slug: 'failure_to_treat', score_weight: 18 },
      { label: 'Other / not sure', slug: 'other', score_weight: 10 },
    ],
  },
  {
    id: 'harm_severity',
    text: 'How serious was the resulting harm?',
    chips: [
      { label: 'Death', slug: 'death', score_weight: 25 },
      { label: 'Permanent disability or impairment', slug: 'permanent', score_weight: 25 },
      { label: 'Long-term but recovering', slug: 'long_term', score_weight: 20 },
      { label: 'Required additional surgery', slug: 'additional_surgery', score_weight: 22 },
      { label: 'Temporary, fully recovered', slug: 'temporary', score_weight: 5 },
      { label: 'No real lasting harm', slug: 'none', score_weight: -20 },
    ],
  },
  {
    id: 'discovery_date',
    text: 'When did you realize something had gone wrong?',
    chips: [
      { label: 'Within the last 6 months', slug: 'within_6mo', score_weight: 22 },
      { label: '6 months to 1 year ago', slug: 'within_1yr', score_weight: 18 },
      { label: '1–2 years ago', slug: 'within_2yr', score_weight: 12 },
      { label: '2–3 years ago', slug: 'within_3yr', score_weight: 5 },
      { label: 'More than 3 years ago', slug: 'over_3yr', score_weight: -20 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'provider_type',
    text: 'Where did the treatment happen?',
    chips: [
      { label: 'Hospital', slug: 'hospital', score_weight: 18 },
      { label: 'Surgical / outpatient center', slug: 'surgical_center', score_weight: 18 },
      { label: "Private doctor's office", slug: 'private_office', score_weight: 12 },
      { label: 'Federal facility (VA, military)', slug: 'federal', score_weight: 10 },
      { label: 'Nursing home / long-term care', slug: 'nursing_home', score_weight: 20 },
      { label: 'Urgent care / clinic', slug: 'urgent_care', score_weight: 12 },
    ],
  },
  {
    id: 'records_status',
    text: 'Do you have your medical records from this treatment?',
    chips: [
      { label: 'Yes, I already have them', slug: 'have_them', score_weight: 18 },
      { label: 'Requested, waiting', slug: 'requested', score_weight: 12 },
      { label: "Haven't requested yet", slug: 'not_requested', score_weight: 5 },
      { label: 'Provider is refusing / dragging feet', slug: 'refused', score_weight: 15 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'second_opinion',
    text: 'Has another doctor told you something was done wrong?',
    chips: [
      { label: 'Yes, in writing', slug: 'written', score_weight: 22 },
      { label: 'Yes, verbally', slug: 'verbal', score_weight: 18 },
      { label: 'Strongly suspected, not confirmed', slug: 'suspected', score_weight: 10 },
      { label: 'No, just my own concern', slug: 'self_only', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Have you spoken with a med-mal attorney already?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: "Talked to one, didn't hire", slug: 'consulted_only', score_weight: 12 },
      { label: 'One declined the case', slug: 'declined_by_other', score_weight: -10 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired one', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const MEDICAL_MALPRACTICE_BRANCH = registerBranch(
  'personal_injury',
  'medical_malpractice',
  _MEDICAL_MALPRACTICE_QUESTIONS,
  'pi',
);
export const MEDICAL_MALPRACTICE_BRANCH_QUESTIONS_JSON = MEDICAL_MALPRACTICE_BRANCH.questions_json;
export const MEDICAL_MALPRACTICE_BRANCH_THRESHOLDS_JSON = MEDICAL_MALPRACTICE_BRANCH.thresholds_json;
export const MEDICAL_MALPRACTICE_BRANCH_HARD_OVERRIDES_JSON = MEDICAL_MALPRACTICE_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Personal Injury — dog_bite
// Discriminators: bite severity, identifiable owner with insurance,
// location, provocation, medical/reporting paper trail.
// ---------------------------------------------------------------------------

const _DOG_BITE_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'bite_severity',
    text: 'How serious was the bite?',
    chips: [
      { label: 'Required surgery / reconstructive', slug: 'surgery', score_weight: 25 },
      { label: 'Stitches / staples needed', slug: 'stitches', score_weight: 22 },
      { label: 'Puncture wounds, ER visit', slug: 'puncture_er', score_weight: 18 },
      { label: 'Scratches / minor break in skin', slug: 'minor', score_weight: 8 },
      { label: 'No broken skin', slug: 'no_break', score_weight: -15 },
    ],
  },
  {
    id: 'victim_age',
    text: 'Who was bitten?',
    chips: [
      { label: 'A child under 12', slug: 'child', score_weight: 22 },
      { label: 'Elderly person (65+)', slug: 'elderly', score_weight: 18 },
      { label: 'Adult', slug: 'adult', score_weight: 12 },
      { label: 'Bite to face / head / neck', slug: 'facial', score_weight: 25 },
      { label: "I don't want to say", slug: 'decline', score_weight: 5 },
    ],
  },
  {
    id: 'owner_known',
    text: 'Do you know who owns the dog?',
    chips: [
      { label: 'Yes, fully identified', slug: 'fully_known', score_weight: 22 },
      { label: 'Know them by name only', slug: 'name_only', score_weight: 15 },
      { label: 'Got contact info but limited', slug: 'partial', score_weight: 12 },
      { label: 'Stray / unidentified', slug: 'unknown_owner', score_weight: -15 },
      { label: "Don't know", slug: 'unknown', score_weight: -10 },
    ],
  },
  {
    id: 'location_type',
    text: 'Where did the bite happen?',
    chips: [
      { label: 'Public place (park, sidewalk)', slug: 'public', score_weight: 18 },
      { label: "Owner's property, I was invited", slug: 'owner_invited', score_weight: 20 },
      { label: "Owner's property, delivering / working", slug: 'owner_business', score_weight: 22 },
      { label: 'My own property', slug: 'my_property', score_weight: 18 },
      { label: "Owner's property, uninvited / trespassing", slug: 'trespassing', score_weight: -10 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'provocation',
    text: 'Was the dog provoked in any way?',
    chips: [
      { label: 'No, completely unprovoked', slug: 'unprovoked', score_weight: 22 },
      { label: 'Was just walking past / near it', slug: 'passive', score_weight: 18 },
      { label: 'Was petting / interacting calmly', slug: 'interacting', score_weight: 12 },
      { label: 'Some interaction, possibly startled it', slug: 'possibly', score_weight: 5 },
      { label: 'Yes, was teasing / hitting it', slug: 'provoked', score_weight: -20 },
    ],
  },
  {
    id: 'medical_and_report',
    text: 'What did you do after the bite?',
    multi_select: true,
    chips: [
      { label: 'Went to ER / urgent care', slug: 'medical_treatment', score_weight: 18 },
      { label: 'Got rabies / tetanus shots', slug: 'rabies_tetanus', score_weight: 15 },
      { label: 'Reported to animal control / police', slug: 'reported', score_weight: 18 },
      { label: 'Took photos of injuries', slug: 'photos', score_weight: 12 },
      { label: "Didn't get treatment or report it", slug: 'nothing', score_weight: -15 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Have you hired an attorney for this?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: "Talked to one, didn't hire", slug: 'consulted_only', score_weight: 12 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired one', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const DOG_BITE_BRANCH = registerBranch(
  'personal_injury',
  'dog_bite',
  _DOG_BITE_QUESTIONS,
  'pi',
);
export const DOG_BITE_BRANCH_QUESTIONS_JSON = DOG_BITE_BRANCH.questions_json;
export const DOG_BITE_BRANCH_THRESHOLDS_JSON = DOG_BITE_BRANCH.thresholds_json;
export const DOG_BITE_BRANCH_HARD_OVERRIDES_JSON = DOG_BITE_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Drug Crime — possession
// Lowest-stakes drug branch. Discriminators: substance schedule, felony
// exposure, custody, prior record, search circumstances, distribution
// signals (paraphernalia/quantity).
// ---------------------------------------------------------------------------

const _POSSESSION_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'substance_type',
    text: 'What substance was involved?',
    chips: [
      { label: 'Marijuana / cannabis', slug: 'marijuana', score_weight: 8 },
      { label: 'Prescription pills (no Rx)', slug: 'rx_pills', score_weight: 15 },
      { label: 'Cocaine / methamphetamine', slug: 'stimulants', score_weight: 18 },
      { label: 'Heroin / fentanyl / opioids', slug: 'opioids', score_weight: 22 },
      { label: 'Psychedelics (LSD, mushrooms)', slug: 'psychedelics', score_weight: 15 },
      { label: "I don't know / multiple", slug: 'other', score_weight: 12 },
    ],
  },
  {
    id: 'charge_level',
    text: 'Is it charged as a misdemeanor or felony?',
    chips: [
      { label: 'Felony', slug: 'felony', score_weight: 22 },
      { label: 'Misdemeanor', slug: 'misdemeanor', score_weight: 12 },
      { label: 'Infraction / citation', slug: 'infraction', score_weight: 5 },
      { label: 'Not charged yet', slug: 'not_charged', score_weight: 10 },
      { label: "I don't know", slug: 'unknown', score_weight: 8 },
    ],
  },
  {
    id: 'arrest_status',
    text: 'Where do things stand right now?',
    chips: [
      { label: 'In custody', slug: 'in_custody', score_weight: 25 },
      { label: 'Out on bail', slug: 'out_on_bail', score_weight: 20 },
      { label: 'Cited and released', slug: 'cited', score_weight: 12 },
      { label: 'Under investigation', slug: 'investigation', score_weight: 10 },
      { label: 'No action yet', slug: 'none', score_weight: 5 },
    ],
  },
  {
    id: 'search_context',
    text: 'How did the police find it?',
    chips: [
      { label: 'Traffic stop search', slug: 'traffic_stop', score_weight: 15 },
      { label: 'Search warrant', slug: 'warrant', score_weight: 18 },
      { label: 'Consent search', slug: 'consent', score_weight: 15 },
      { label: 'Probable cause / plain view', slug: 'plain_view', score_weight: 12 },
      { label: 'Stop and frisk', slug: 'frisk', score_weight: 18 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'prior_record',
    text: 'Any prior drug convictions?',
    chips: [
      { label: 'None', slug: 'none', score_weight: 12 },
      { label: 'One prior', slug: 'one', score_weight: 18 },
      { label: 'Multiple priors', slug: 'multiple', score_weight: 22 },
      { label: 'On probation/parole now', slug: 'on_supervision', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'quantity_signals',
    text: 'How much was involved, and was anything else found?',
    chips: [
      { label: 'Personal-use amount only', slug: 'personal', score_weight: 10 },
      { label: 'Larger amount but for personal use', slug: 'larger_personal', score_weight: 15 },
      { label: 'Scales, baggies, or cash also found', slug: 'distribution_signals', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 18 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const POSSESSION_BRANCH = registerBranch(
  'drug_crime',
  'possession',
  _POSSESSION_QUESTIONS,
  'non_pi',
);
export const POSSESSION_BRANCH_QUESTIONS_JSON = POSSESSION_BRANCH.questions_json;
export const POSSESSION_BRANCH_THRESHOLDS_JSON = POSSESSION_BRANCH.thresholds_json;
export const POSSESSION_BRANCH_HARD_OVERRIDES_JSON = POSSESSION_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Drug Crime — distribution / PWID
// Felony territory. Discriminators: federal exposure, weight, evidence
// type (controlled buys, wiretaps), enhancements (school zone, firearm),
// co-defendants.
// ---------------------------------------------------------------------------

const _DISTRIBUTION_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'distribution_charge',
    text: "What's the charge?",
    chips: [
      { label: 'Possession with intent to distribute', slug: 'pwid', score_weight: 20 },
      { label: 'Sale / delivery', slug: 'sale', score_weight: 22 },
      { label: 'Conspiracy to distribute', slug: 'conspiracy', score_weight: 22 },
      { label: 'Manufacturing / cultivation', slug: 'manufacturing', score_weight: 22 },
      { label: 'Not formally charged yet', slug: 'not_charged', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'jurisdiction_level',
    text: 'Federal or state case?',
    chips: [
      { label: 'Federal', slug: 'federal', score_weight: 25 },
      { label: 'State', slug: 'state', score_weight: 18 },
      { label: 'Both', slug: 'both', score_weight: 25 },
      { label: "I don't know", slug: 'unknown', score_weight: 12 },
    ],
  },
  {
    id: 'substance_quantity',
    text: 'What substance and roughly how much?',
    chips: [
      { label: 'Marijuana, small amount', slug: 'mj_small', score_weight: 10 },
      { label: 'Marijuana, large amount', slug: 'mj_large', score_weight: 18 },
      { label: 'Cocaine / meth, under an ounce', slug: 'stim_small', score_weight: 18 },
      { label: 'Cocaine / meth, ounce or more', slug: 'stim_large', score_weight: 22 },
      { label: 'Fentanyl / heroin, any amount', slug: 'opioids_any', score_weight: 25 },
      { label: 'Pills, any amount', slug: 'pills', score_weight: 18 },
      { label: "I don't know", slug: 'unknown', score_weight: 10 },
    ],
  },
  {
    id: 'enhancements',
    text: 'Do any of these apply to your case?',
    multi_select: true,
    chips: [
      { label: 'Near a school / playground', slug: 'school_zone', score_weight: 20 },
      { label: 'Firearm involved', slug: 'firearm', score_weight: 22 },
      { label: 'Sale to a minor alleged', slug: 'minor_buyer', score_weight: 22 },
      { label: 'Death allegedly resulted', slug: 'death_resulted', score_weight: 25 },
      { label: 'None of these', slug: 'none', score_weight: 5 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'evidence_type',
    text: 'What evidence do they have against you?',
    multi_select: true,
    chips: [
      { label: 'Controlled buy / informant', slug: 'controlled_buy', score_weight: 20 },
      { label: 'Wiretap / recorded calls', slug: 'wiretap', score_weight: 22 },
      { label: 'Search warrant on home', slug: 'search_warrant', score_weight: 18 },
      { label: 'Surveillance / undercover', slug: 'surveillance', score_weight: 18 },
      { label: 'Statements I made', slug: 'statements', score_weight: 20 },
      { label: 'Just possession circumstances', slug: 'possession_only', score_weight: 12 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'co_defendants',
    text: 'Are others charged with you?',
    chips: [
      { label: 'Yes, multiple', slug: 'multiple', score_weight: 22 },
      { label: 'Yes, one', slug: 'one', score_weight: 18 },
      { label: 'No, just me', slug: 'solo', score_weight: 15 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 22 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 20 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 10 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -10 },
    ],
  },
];

export const DISTRIBUTION_BRANCH = registerBranch(
  'drug_crime',
  'distribution',
  _DISTRIBUTION_QUESTIONS,
  'non_pi',
);
export const DISTRIBUTION_BRANCH_QUESTIONS_JSON = DISTRIBUTION_BRANCH.questions_json;
export const DISTRIBUTION_BRANCH_THRESHOLDS_JSON = DISTRIBUTION_BRANCH.thresholds_json;
export const DISTRIBUTION_BRANCH_HARD_OVERRIDES_JSON = DISTRIBUTION_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Drug Crime — trafficking
// Almost always HOT. Discriminators: weight thresholds (mandatory
// minimums), federal indictment status, custody, conspiracy size,
// asset/forfeiture exposure.
// ---------------------------------------------------------------------------

const _TRAFFICKING_QUESTIONS: ScoredQuestionSeed[] = [
  {
    id: 'jurisdiction_level',
    text: 'Federal or state trafficking charge?',
    chips: [
      { label: 'Federal indictment', slug: 'federal_indicted', score_weight: 25 },
      { label: 'Federal investigation, not indicted', slug: 'federal_uncharged', score_weight: 22 },
      { label: 'State trafficking', slug: 'state', score_weight: 20 },
      { label: 'Both', slug: 'both', score_weight: 25 },
      { label: "I don't know", slug: 'unknown', score_weight: 15 },
    ],
  },
  {
    id: 'weight_threshold',
    text: 'What substance and roughly what weight?',
    chips: [
      { label: 'Marijuana, large', slug: 'mj_large', score_weight: 18 },
      { label: 'Cocaine, kilo-level', slug: 'cocaine_kilo', score_weight: 22 },
      { label: 'Methamphetamine, any trafficking weight', slug: 'meth_any', score_weight: 22 },
      { label: 'Fentanyl, any trafficking weight', slug: 'fent_any', score_weight: 25 },
      { label: 'Heroin, any trafficking weight', slug: 'heroin_any', score_weight: 25 },
      { label: 'Pills, large quantity', slug: 'pills_large', score_weight: 20 },
      { label: "I don't know exact amount", slug: 'unknown', score_weight: 18 },
    ],
  },
  {
    id: 'custody_status',
    text: 'Where are you right now?',
    chips: [
      { label: 'In federal custody', slug: 'federal_custody', score_weight: 25 },
      { label: 'In state custody', slug: 'state_custody', score_weight: 25 },
      { label: 'Out on bond', slug: 'out_on_bond', score_weight: 22 },
      { label: 'Detention hearing pending', slug: 'detention_pending', score_weight: 25 },
      { label: 'Released, charges pending', slug: 'released', score_weight: 18 },
      { label: 'No charges yet', slug: 'none', score_weight: 12 },
    ],
  },
  {
    id: 'investigation_tools',
    text: 'What kind of investigation is/was involved?',
    multi_select: true,
    chips: [
      { label: 'Wiretap', slug: 'wiretap', score_weight: 22 },
      { label: 'Confidential informant / controlled buys', slug: 'informant', score_weight: 20 },
      { label: 'Surveillance / GPS tracking', slug: 'surveillance', score_weight: 18 },
      { label: 'Search of home / stash location', slug: 'search', score_weight: 18 },
      { label: 'Traffic stop interdiction', slug: 'interdiction', score_weight: 18 },
      { label: 'Border / airport seizure', slug: 'border', score_weight: 22 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'conspiracy_size',
    text: 'How many people are charged with you?',
    chips: [
      { label: 'Just me', slug: 'solo', score_weight: 15 },
      { label: '2–3 co-defendants', slug: 'small_group', score_weight: 20 },
      { label: '4–10 co-defendants', slug: 'mid_group', score_weight: 22 },
      { label: 'Large conspiracy (10+)', slug: 'large', score_weight: 25 },
      { label: "I don't know", slug: 'unknown', score_weight: 12 },
    ],
  },
  {
    id: 'forfeiture',
    text: 'Has anything been seized?',
    multi_select: true,
    chips: [
      { label: 'Cash', slug: 'cash', score_weight: 18 },
      { label: 'Vehicle(s)', slug: 'vehicles', score_weight: 18 },
      { label: 'Real estate', slug: 'real_estate', score_weight: 22 },
      { label: 'Bank / crypto accounts', slug: 'accounts', score_weight: 20 },
      { label: 'Nothing seized', slug: 'nothing', score_weight: 8 },
      { label: "I don't know", slug: 'unknown', score_weight: 0 },
    ],
  },
  {
    id: 'attorney_status',
    text: 'Do you already have an attorney?',
    chips: [
      { label: 'No, looking now', slug: 'none_looking', score_weight: 25 },
      { label: 'Public defender, want private', slug: 'pd_wants_private', score_weight: 22 },
      { label: 'Comparing firms', slug: 'shopping', score_weight: 12 },
      { label: 'Already hired private counsel', slug: 'already_retained', score_weight: -25 },
      { label: 'Just researching', slug: 'just_researching', score_weight: -15 },
    ],
  },
];

export const TRAFFICKING_BRANCH = registerBranch(
  'drug_crime',
  'trafficking',
  _TRAFFICKING_QUESTIONS,
  'non_pi',
);
export const TRAFFICKING_BRANCH_QUESTIONS_JSON = TRAFFICKING_BRANCH.questions_json;
export const TRAFFICKING_BRANCH_THRESHOLDS_JSON = TRAFFICKING_BRANCH.thresholds_json;
export const TRAFFICKING_BRANCH_HARD_OVERRIDES_JSON = TRAFFICKING_BRANCH.hard_overrides_json;

// ---------------------------------------------------------------------------
// Aggregated registry — frozen export for seed.ts / ensure-helpers.
// Order: DUI → Criminal Defense → Personal Injury → Drug Crime, matching
// the case-types registration order in `seed-defaults/sop.ts`.
// ---------------------------------------------------------------------------

export const DEFAULT_BRANCH_SEEDS: readonly DefaultBranchSeed[] = Object.freeze(
  [..._DEFAULT_BRANCH_SEEDS],
);
