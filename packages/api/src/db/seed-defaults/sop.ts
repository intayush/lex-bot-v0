/**
 * Default SOP seed data (010-sop-workflow R1).
 *
 * These constants define the out-of-the-box SOP, case-types, sub-types, and
 * goodbye phrases that ship with every fresh account. The dev seed
 * (`packages/api/src/db/seed.ts`) inserts them once per account; the legacy
 * migration helper (R11) seeds them lazily for accounts that haven't yet
 * customized their SOP.
 *
 * Contents validated against the shared SOP schemas (Constitution II) at
 * module-load time so any drift between the seed and the schema fails
 * loudly during `pnpm db:seed`.
 */
import {
  sopStepInputSchema,
  caseTypeInputSchema,
  scoringConfigSchema,
  type SOPStepInput,
  type CaseTypeInput,
  type ScoringConfig,
} from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Spec 015 — default scoring configuration for Personal Injury / Car Accident.
// Per contracts/scoring-config.md §"Default values shipped" and the xlsx Self
// + Family/Friend tables. Validated against scoringConfigSchema at module-load
// time so any drift fails loudly during pnpm db:seed.
// ---------------------------------------------------------------------------

const _CAR_ACCIDENT_SCORING_CONFIG: ScoringConfig = scoringConfigSchema.parse({
  schema_version: 1,
  thresholds_self: {
    hot: [76, 100],
    warm: [51, 75],
    cold: [26, 50],
    spam: [0, 25],
  },
  thresholds_family_friend: {
    hot: [76, 100],
    warm: [26, 75],
    spam: [0, 25],
  },
  hard_overrides_enabled: {
    missing_contact: true,
    out_of_scope: true,
    no_injury_no_treatment: true,
    fake_info: true,
  },
});

/** Pre-serialised JSON ready for `sub_types.scoring_config_json` writes. */
export const CAR_ACCIDENT_SCORING_CONFIG_JSON: string = JSON.stringify(
  _CAR_ACCIDENT_SCORING_CONFIG,
);

// ---------------------------------------------------------------------------
// 6 default SOP steps (FR-001 — spec 016 reordered default).
// case_type → sub_type → where → what → when → contact.
// Threshold N = 6 (DEFAULT_QUALIFIED_LEAD_THRESHOLD below).
// Spec 015's 9 inline scoring questions have moved to the Branch model;
// see CAR_ACCIDENT_BRANCH_QUESTIONS_JSON below.
// ---------------------------------------------------------------------------

const _RAW_DEFAULT_SOP_STEPS: SOPStepInput[] = [
  {
    slug: 'case_type',
    position: 1,
    question_text: 'What kind of legal matter can we help you with?',
    chip_source: 'case_types',
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
  {
    slug: 'sub_type',
    position: 2,
    question_text: 'What kind of {case_type} matter is this?',
    chip_source: 'sub_types',
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
  {
    slug: 'where',
    position: 3,
    question_text: 'Where did this happen?',
    chip_source: null,
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
  {
    slug: 'what',
    position: 4,
    question_text: 'Can you briefly tell us what happened?',
    chip_source: null,
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
  {
    slug: 'when',
    position: 5,
    question_text: 'When did this happen?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Today', slug: 'today' },
      { label: 'Yesterday', slug: 'yesterday' },
      { label: 'This week', slug: 'this_week' },
      { label: 'Last week', slug: 'last_week' },
      { label: 'This month', slug: 'this_month' },
      { label: 'Earlier this year', slug: 'earlier_this_year' },
      { label: 'Longer ago', slug: 'longer_ago' },
    ]),
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
  {
    slug: 'contact',
    position: 6,
    question_text: 'Last step — please share your contact info so we can follow up.',
    chip_source: 'contact_form',
    inline_chips_json: null,
    // The widget renders a form, not free-text inputs in the message
    // stream. accepts_free_text=false ensures the advancer doesn't try to
    // capture stray text into this step.
    accepts_free_text: false,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: null,
  },
];

// ---------------------------------------------------------------------------
// Spec 016 — Car Accident Branch (formerly the spec 015 inline scoring
// questions at sop_steps positions 5–13). These NINE questions move out
// of the default SOP (which is now 6 steps) and into the new Branch
// model. The seed inserts them as `branch_versions.questions_json` for
// the (personal_injury, car_accident) branch row at first boot.
//
// Question content / chip weights / order are preserved verbatim from
// spec 015's xlsx so SC-002 ("no score regressions") holds.
// ---------------------------------------------------------------------------

interface BranchQuestionSeed {
  id: string;
  position: number;
  text: string;
  preface: string | null;
  chips: Array<{ label: string; slug: string; score_weight: number }>;
  free_text_allowed: boolean;
  multi_select: boolean;
}

const _RAW_CAR_ACCIDENT_BRANCH_QUESTIONS: BranchQuestionSeed[] = [
  {
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
  },
  {
    id: 'geographic_qualification',
    position: 1,
    text: 'Did the accident happen in or near our service area?',
    preface: null,
    chips: [
      { label: 'Yes', slug: 'yes_in_area', score_weight: 0 },
      { label: 'No', slug: 'no_outside_area', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'accident_timing',
    position: 2,
    text: 'When did the accident happen?',
    preface: null,
    chips: [
      { label: 'Today', slug: 'today', score_weight: 20 },
      { label: 'Within Last 7 Days', slug: 'within_last_7_days', score_weight: 15 },
      { label: 'Within Last 30 Days', slug: 'within_last_30_days', score_weight: 10 },
      { label: 'Within Last 6 Months', slug: 'within_last_6_months', score_weight: 5 },
      { label: 'More Than 6 Months Ago', slug: 'more_than_6_months_ago', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'injury',
    position: 3,
    text: 'Were you (or they) injured?',
    preface: null,
    chips: [
      { label: 'Yes', slug: 'injury_yes', score_weight: 15 },
      { label: 'Still Being Evaluated', slug: 'injury_evaluating', score_weight: 10 },
      { label: 'Not Sure Yet', slug: 'injury_not_sure', score_weight: 5 },
      { label: 'No', slug: 'injury_no', score_weight: -20 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'medical_treatment',
    position: 4,
    text: 'What medical treatment was received?',
    preface: null,
    chips: [
      { label: 'Surgery', slug: 'surgery', score_weight: 25 },
      { label: 'Hospitalization', slug: 'hospitalization', score_weight: 20 },
      { label: 'Emergency Room Visit', slug: 'er_visit', score_weight: 15 },
      { label: 'Doctor Visit', slug: 'doctor_visit', score_weight: 10 },
      { label: 'Physical Therapy / Chiropractor', slug: 'pt_chiro', score_weight: 8 },
      { label: 'No Treatment Yet', slug: 'no_treatment_yet', score_weight: 5 },
      { label: 'No Treatment', slug: 'no_treatment', score_weight: -10 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'accident_role',
    position: 5,
    text: 'Were you (or they) a:',
    preface: null,
    chips: [
      { label: 'Passenger', slug: 'passenger', score_weight: 10 },
      { label: 'Pedestrian', slug: 'pedestrian', score_weight: 10 },
      { label: 'Cyclist', slug: 'cyclist', score_weight: 8 },
      { label: 'Driver', slug: 'driver', score_weight: 5 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    // lead-classification-revamp.md Q5 — Liability (-20..+15)
    id: 'liability',
    position: 6,
    text: 'Who do you believe was primarily responsible for the accident?',
    preface: null,
    chips: [
      { label: 'The Other Driver', slug: 'other_driver', score_weight: 15 },
      { label: 'Mostly The Other Driver', slug: 'mostly_other_driver', score_weight: 10 },
      { label: 'Not Sure', slug: 'liability_not_sure', score_weight: 5 },
      { label: 'Both Drivers', slug: 'both_drivers', score_weight: 0 },
      { label: 'Mostly Me', slug: 'mostly_me', score_weight: -20 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'insurance_activity',
    position: 7,
    text: 'Has an insurance company contacted you (or them)?',
    preface: null,
    chips: [
      { label: 'Requested Recorded Statement', slug: 'requested_recorded_statement', score_weight: 15 },
      { label: 'Offered Settlement', slug: 'offered_settlement', score_weight: 15 },
      { label: 'Asked To Sign Documents', slug: 'asked_to_sign', score_weight: 15 },
      { label: 'Contacted Me', slug: 'contacted_me', score_weight: 5 },
      { label: 'Not Yet', slug: 'not_yet', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'work_impact',
    position: 8,
    text: 'Has the accident affected your (or their) ability to work?',
    preface: null,
    chips: [
      { label: 'Unable To Work', slug: 'unable_to_work', score_weight: 15 },
      { label: 'Missed Work', slug: 'missed_work', score_weight: 10 },
      { label: 'No Impact', slug: 'no_impact', score_weight: 0 },
      { label: 'Not Applicable', slug: 'not_applicable', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
  {
    id: 'attorney_status',
    position: 9,
    text: 'Do you currently have a lawyer?',
    preface: null,
    chips: [
      // Per lead-classification-revamp.md Q8: weights are +15 / +12 / +5 / -25.
      { label: 'No', slug: 'no_lawyer', score_weight: 15 },
      { label: "Spoke With Lawyers, Haven't Signed Yet", slug: 'spoke_not_signed', score_weight: 12 },
      { label: 'Signed With Lawyer But Want To Change Lawyers', slug: 'want_to_change', score_weight: 5 },
      { label: 'Yes, I Have A Lawyer', slug: 'yes_have_lawyer', score_weight: -25 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ],
    free_text_allowed: false,
    multi_select: false,
  },
];

/**
 * Pre-serialised JSON ready for `branch_versions.questions_json` writes.
 * Materialized from the spec 015 xlsx fixtures (FR-016).
 */
export const CAR_ACCIDENT_BRANCH_QUESTIONS_JSON: string = JSON.stringify(
  _RAW_CAR_ACCIDENT_BRANCH_QUESTIONS,
);

/**
 * Pre-serialised JSON for `branch_versions.classification_thresholds_json`.
 * Same payload as spec 015's `_CAR_ACCIDENT_SCORING_CONFIG`, restructured
 * for the spec 016 Branch model: `{ self, family_friend }`.
 */
export const CAR_ACCIDENT_BRANCH_THRESHOLDS_JSON: string = JSON.stringify({
  self: _CAR_ACCIDENT_SCORING_CONFIG.thresholds_self,
  family_friend: _CAR_ACCIDENT_SCORING_CONFIG.thresholds_family_friend,
});

/**
 * Pre-serialised JSON for `branch_versions.hard_override_toggles_json`.
 * Same shape as spec 015 `_CAR_ACCIDENT_SCORING_CONFIG.hard_overrides_enabled`.
 */
export const CAR_ACCIDENT_BRANCH_HARD_OVERRIDES_JSON: string = JSON.stringify(
  _CAR_ACCIDENT_SCORING_CONFIG.hard_overrides_enabled,
);


/** 5 default SOP steps validated against the shared schema. */
export const DEFAULT_SOP_STEPS: readonly SOPStepInput[] = Object.freeze(
  _RAW_DEFAULT_SOP_STEPS.map((s) => sopStepInputSchema.parse(s)),
);

// ---------------------------------------------------------------------------
// 6 default case types with sub-types (FR-009)
// ---------------------------------------------------------------------------

const _RAW_DEFAULT_CASE_TYPES: CaseTypeInput[] = [
  {
    slug: 'dui',
    label: 'DUI',
    position: 1,
    is_in_scope: true,
    sub_types: [
      { slug: 'first_offense', label: 'First Offense', position: 1, scoring_config_json: null },
      { slug: 'repeat_offense', label: 'Repeat Offense', position: 2, scoring_config_json: null },
      { slug: 'dui_with_injury', label: 'DUI with Injury', position: 3, scoring_config_json: null },
      { slug: 'dui_with_property', label: 'DUI with Property Damage', position: 4, scoring_config_json: null },
    ],
  },
  {
    slug: 'criminal_defense',
    label: 'Criminal Defense',
    position: 2,
    is_in_scope: true,
    sub_types: [
      { slug: 'theft', label: 'Theft', position: 1, scoring_config_json: null },
      { slug: 'assault', label: 'Assault', position: 2, scoring_config_json: null },
      { slug: 'fraud', label: 'Fraud', position: 3, scoring_config_json: null },
      { slug: 'gun_charge', label: 'Gun Charge', position: 4, scoring_config_json: null },
    ],
  },
  {
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 3,
    is_in_scope: true,
    sub_types: [
      { slug: 'car_accident', label: 'Car Accident', position: 1, scoring_config_json: CAR_ACCIDENT_SCORING_CONFIG_JSON },
      { slug: 'slip_fall', label: 'Slip and Fall', position: 2, scoring_config_json: null },
      { slug: 'medical_malpractice', label: 'Medical Malpractice', position: 3, scoring_config_json: null },
      { slug: 'dog_bite', label: 'Dog Bite', position: 4, scoring_config_json: null },
    ],
  },
  {
    slug: 'family_law',
    label: 'Family Law',
    position: 4,
    is_in_scope: true,
    sub_types: [
      { slug: 'divorce', label: 'Divorce', position: 1, scoring_config_json: null },
      { slug: 'custody', label: 'Custody', position: 2, scoring_config_json: null },
      { slug: 'adoption', label: 'Adoption', position: 3, scoring_config_json: null },
    ],
  },
  {
    slug: 'drug_crime',
    label: 'Drug Crime',
    position: 5,
    is_in_scope: true,
    sub_types: [
      { slug: 'possession', label: 'Possession', position: 1, scoring_config_json: null },
      { slug: 'distribution', label: 'Distribution', position: 2, scoring_config_json: null },
      { slug: 'trafficking', label: 'Trafficking', position: 3, scoring_config_json: null },
    ],
  },
  {
    slug: 'estate_planning',
    label: 'Estate Planning',
    position: 6,
    is_in_scope: true,
    sub_types: [
      { slug: 'will', label: 'Will', position: 1, scoring_config_json: null },
      { slug: 'trust', label: 'Trust', position: 2, scoring_config_json: null },
      { slug: 'probate', label: 'Probate', position: 3, scoring_config_json: null },
    ],
  },
];

/** 6 default case types with ≥ 3 sub-types each, validated. */
export const DEFAULT_CASE_TYPES: readonly CaseTypeInput[] = Object.freeze(
  _RAW_DEFAULT_CASE_TYPES.map((ct) => caseTypeInputSchema.parse(ct)),
);

// ---------------------------------------------------------------------------
// Default goodbye phrases (FR-030)
// ---------------------------------------------------------------------------

/**
 * Default English goodbye phrases. Substring/word-boundary matched
 * case-insensitively against visitor messages by `lib/sop/goodbye-detector.ts`.
 *
 * Note: 'that\u2019s all' uses U+2019 (smart apostrophe). The detector
 * Unicode-normalizes both sides before matching so straight-ASCII apostrophe
 * input ("that's all") still matches.
 */
export const DEFAULT_GOODBYE_PHRASES: readonly string[] = Object.freeze([
  'bye',
  'goodbye',
  'thanks',
  'thank you',
  'good night',
  'see you',
  'that\u2019s all',
]);

/** Default qualified-lead threshold (FR-002). 6 = the default-step count
 *  (5 intake steps + the contact-form step that completes the lead). */
export const DEFAULT_QUALIFIED_LEAD_THRESHOLD = 6;
