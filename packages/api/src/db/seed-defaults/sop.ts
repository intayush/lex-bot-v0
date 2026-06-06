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
  type SOPStepInput,
  type CaseTypeInput,
} from '@legal-chatbot/shared';

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
      { slug: 'car_accident', label: 'Car Accident', position: 1, scoring_config_json: null },
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
