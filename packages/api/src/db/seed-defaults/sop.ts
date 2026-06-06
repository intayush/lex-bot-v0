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
// 5 default SOP steps (FR-001)
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
  // -------------------------------------------------------------------------
  // 9 sub_type-scoped steps for spec 015 (Lead Classification Revamp).
  // Positions 5–13. Activate ONLY when captured sub_type matches
  // `applies_when_sub_type_slug` (per research.md §R2). All have
  // `counts_toward_threshold: false` so they don't gate finalization
  // (FR-013); the existing 6-step threshold continues to apply.
  // Chip weights match `lex-chat.xlsx` per `contracts/scoring-config.md`.
  // -------------------------------------------------------------------------
  {
    // Metadata — selects classification-threshold table (FR-014).
    slug: 'request_type',
    position: 5,
    question_text: 'Are you asking for yourself or a friend/family member?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Myself', slug: 'myself', score_weight: 0 },
      { label: 'Friend / Family Member', slug: 'friend_family', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // Metadata — service-area gate (FR-015).
    slug: 'geographic_qualification',
    position: 6,
    question_text: 'Did the accident happen in or near our service area?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Yes', slug: 'yes_in_area', score_weight: 0 },
      { label: 'No', slug: 'no_outside_area', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q1 — Accident Timing (0..+20)
    slug: 'accident_timing',
    position: 7,
    question_text: 'When did the accident happen?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Today', slug: 'today', score_weight: 20 },
      { label: 'Within Last 7 Days', slug: 'within_last_7_days', score_weight: 15 },
      { label: 'Within Last 30 Days', slug: 'within_last_30_days', score_weight: 10 },
      { label: 'Within Last 6 Months', slug: 'within_last_6_months', score_weight: 5 },
      { label: 'More Than 6 Months Ago', slug: 'more_than_6_months_ago', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q2 — Injury (-20..+15)
    slug: 'injury',
    position: 8,
    question_text: 'Were you (or they) injured?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Yes', slug: 'injury_yes', score_weight: 15 },
      { label: 'Still Being Evaluated', slug: 'injury_evaluating', score_weight: 10 },
      { label: 'Not Sure Yet', slug: 'injury_not_sure', score_weight: 5 },
      { label: 'No', slug: 'injury_no', score_weight: -20 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q3 — Medical Treatment (-10..+25)
    slug: 'medical_treatment',
    position: 9,
    question_text: 'What medical treatment was received?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Surgery', slug: 'surgery', score_weight: 25 },
      { label: 'Hospitalization', slug: 'hospitalization', score_weight: 20 },
      { label: 'Emergency Room Visit', slug: 'er_visit', score_weight: 15 },
      { label: 'Doctor Visit', slug: 'doctor_visit', score_weight: 10 },
      { label: 'Physical Therapy / Chiropractor', slug: 'pt_chiro', score_weight: 8 },
      { label: 'No Treatment Yet', slug: 'no_treatment_yet', score_weight: 5 },
      { label: 'No Treatment', slug: 'no_treatment', score_weight: -10 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q4 — Accident Role (0..+10) — Cyclist OMITTED per spec
    slug: 'accident_role',
    position: 10,
    question_text: 'Were you (or they) a:',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Passenger', slug: 'passenger', score_weight: 10 },
      { label: 'Pedestrian', slug: 'pedestrian', score_weight: 10 },
      { label: 'Driver', slug: 'driver', score_weight: 5 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q5 — Insurance Activity (0..+15)
    slug: 'insurance_activity',
    position: 11,
    question_text: 'Has an insurance company contacted you (or them)?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Requested Recorded Statement', slug: 'requested_recorded_statement', score_weight: 15 },
      { label: 'Offered Settlement', slug: 'offered_settlement', score_weight: 15 },
      { label: 'Asked To Sign Documents', slug: 'asked_to_sign', score_weight: 15 },
      { label: 'Contacted Me', slug: 'contacted_me', score_weight: 5 },
      { label: 'Not Yet', slug: 'not_yet', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q6 — Work Impact (0..+15)
    slug: 'work_impact',
    position: 12,
    question_text: 'Has the accident affected your (or their) ability to work?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'Unable To Work', slug: 'unable_to_work', score_weight: 15 },
      { label: 'Missed Work', slug: 'missed_work', score_weight: 10 },
      { label: 'No Impact', slug: 'no_impact', score_weight: 0 },
      { label: 'Not Applicable', slug: 'not_applicable', score_weight: 0 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    // xlsx Q7 — Attorney Status (-20..+20)
    slug: 'attorney_status',
    position: 13,
    question_text: 'Do you currently have a lawyer?',
    chip_source: 'inline',
    inline_chips_json: JSON.stringify([
      { label: 'No', slug: 'no_lawyer', score_weight: 20 },
      { label: "Spoke With Lawyers, Haven't Signed Yet", slug: 'spoke_not_signed', score_weight: 15 },
      { label: 'Signed With Lawyer But Want To Change Lawyers', slug: 'want_to_change', score_weight: 10 },
      { label: 'Yes, I Have A Lawyer', slug: 'yes_have_lawyer', score_weight: -20 },
      { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 },
    ]),
    accepts_free_text: false,
    is_required: false,
    counts_toward_threshold: false,
    is_default: true,
    skip_condition_json: null,
    applies_when_sub_type_slug: 'car_accident',
  },
  {
    slug: 'when',
    position: 14,
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
    position: 15,
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
