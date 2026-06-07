import { describe, expect, it } from 'vitest';

import type { Chip, ScoringConfig, SOPState } from '@legal-chatbot/shared';

import { scoreLead } from './score-lead.js';

/**
 * Default seeded car-accident scoring config (matches xlsx + spec
 * §Assumptions). Used as the base fixture across HOT/WARM/COLD/SPAM
 * walk tests; individual tests may override fields.
 */
const carAccidentDefaultConfig: ScoringConfig = {
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
};

/**
 * Minimal chip catalog covering the chips referenced by the HOT/WARM
 * walks below. Each chip's `score_weight` matches the xlsx values per
 * `contracts/scoring-config.md` §"Default values shipped".
 */
const chipsBySlug: Map<string, Chip> = new Map([
  // request_type — 0 weight (metadata)
  ['myself', { label: 'Myself', slug: 'myself', score_weight: 0 }],
  ['friend_family', { label: 'Friend / Family Member', slug: 'friend_family', score_weight: 0 }],
  // geographic_qualification — 0 weight (metadata)
  ['yes_in_area', { label: 'Yes', slug: 'yes_in_area', score_weight: 0 }],
  // accident_timing
  ['today', { label: 'Today', slug: 'today', score_weight: 20 }],
  ['within_last_7_days', { label: 'Within Last 7 Days', slug: 'within_last_7_days', score_weight: 15 }],
  ['within_last_30_days', { label: 'Within Last 30 Days', slug: 'within_last_30_days', score_weight: 10 }],
  ['within_last_6_months', { label: 'Within Last 6 Months', slug: 'within_last_6_months', score_weight: 5 }],
  ['more_than_6_months_ago', { label: 'More Than 6 Months Ago', slug: 'more_than_6_months_ago', score_weight: 0 }],
  // injury
  ['injury_yes', { label: 'Yes', slug: 'injury_yes', score_weight: 15 }],
  ['injury_no', { label: 'No', slug: 'injury_no', score_weight: -20 }],
  // medical_treatment
  ['er_visit', { label: 'Emergency Room Visit', slug: 'er_visit', score_weight: 15 }],
  ['doctor_visit', { label: 'Doctor Visit', slug: 'doctor_visit', score_weight: 10 }],
  ['no_treatment', { label: 'No Treatment', slug: 'no_treatment', score_weight: -10 }],
  // accident_role
  ['driver', { label: 'Driver', slug: 'driver', score_weight: 5 }],
  // insurance_activity
  ['requested_recorded_statement', { label: 'Requested Recorded Statement', slug: 'requested_recorded_statement', score_weight: 15 }],
  ['not_yet', { label: 'Not Yet', slug: 'not_yet', score_weight: 0 }],
  // work_impact
  ['missed_work', { label: 'Missed Work', slug: 'missed_work', score_weight: 10 }],
  ['no_impact', { label: 'No Impact', slug: 'no_impact', score_weight: 0 }],
  // attorney_status
  ['no_lawyer', { label: 'No', slug: 'no_lawyer', score_weight: 20 }],
  ['yes_have_lawyer', { label: 'Yes, I Have A Lawyer', slug: 'yes_have_lawyer', score_weight: -20 }],
  // I Don't Know — 0 weight on every applicable question
  ['i_dont_know', { label: "I Don't Know", slug: 'i_dont_know', score_weight: 0 }],
]);

/**
 * Build a finalized SOPState fixture with the given step captures.
 * Each entry maps a step slug → the chip slug captured for that step.
 * Only the fields scoreLead reads are populated; other fields use
 * sensible defaults.
 */
function buildSOPState(captures: Record<string, string>): SOPState {
  const stepSlugs = [
    'case_type',
    'sub_type',
    'where',
    'what',
    'request_type',
    'geographic_qualification',
    'accident_timing',
    'injury',
    'medical_treatment',
    'accident_role',
    'insurance_activity',
    'work_impact',
    'attorney_status',
    'when',
    'contact',
  ];

  return {
    sop_configuration_id: 'sop_test',
    sop_version: 1,
    conversation_anchor_iso: '2026-06-06T00:00:00Z',
    qualified_lead_threshold: 6,
    current_progress: 6,
    is_finalized: true,
    out_of_scope_termination: false,
    steps: stepSlugs.map((slug, i) => ({
      step_id: `step_${i + 1}`,
      slug,
      status: captures[slug] !== undefined ? 'complete' : 'pending',
      captured_value: captures[slug] ?? null,
      captured_label:
        captures[slug] !== undefined
          ? (chipsBySlug.get(captures[slug])?.label ?? null)
          : null,
      captured_at: captures[slug] !== undefined ? '2026-06-06T00:01:00Z' : null,
      inferred: false,
    })),
  };
}

describe('scoreLead — public signature', () => {
  it('exists and returns a ScoredLead-shaped object', () => {
    const sopState = buildSOPState({});
    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });
    expect(result).toHaveProperty('classification');
    expect(result).toHaveProperty('lead_score');
    expect(result).toHaveProperty('reasons');
    expect(result).toHaveProperty('scoring_path');
  });
});

describe('scoreLead — null-config fallback path (FR-022)', () => {
  it('returns scoring_path "llm_fallback" with classification null when scoringConfig is null', () => {
    const sopState = buildSOPState({ case_type: 'dui', sub_type: 'first_offense' });
    const result = scoreLead({
      sopState,
      scoringConfig: null,
      chipsBySlug,
    });
    expect(result.classification).toBeNull();
    expect(result.lead_score).toBeNull();
    expect(result.reasons).toEqual([]);
    expect(result.scoring_path).toBe('llm_fallback');
  });
});

describe('scoreLead — HOT walk (Self table)', () => {
  it('produces classification HOT with capped score 100 for the spec HOT walk', () => {
    /**
     * Spec §User Story 1 acceptance scenario 1 / contracts/lead-finalization-log.md
     * example: every scoring question answered with the highest-weighted
     * chip. Sum: 20+15+15+5+15+10+20 = 100; capped at 100. Tier: HOT.
     */
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      geographic_qualification: 'yes_in_area',
      accident_timing: 'today',                      // +20
      injury: 'injury_yes',                          // +15
      medical_treatment: 'er_visit',                 // +15
      accident_role: 'driver',                       // +5
      insurance_activity: 'requested_recorded_statement', // +15
      work_impact: 'missed_work',                    // +10
      attorney_status: 'no_lawyer',                  // +20
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.classification).toBe('HOT');
    expect(result.lead_score).toBe(100); // capped per FR-005 (raw 100, cap is no-op)
    expect(result.scoring_path).toBe('rule_based');
    expect(result.request_type).toBe('SELF');
    expect(result.geographic_qualification).toBe('IN_SERVICE_AREA');
  });

  it('caps score at 100 when sum would exceed 100', () => {
    /** Phone +10 + Email +5 from contact form would push 100 to 115; verify cap. */
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      geographic_qualification: 'yes_in_area',
      accident_timing: 'today',
      injury: 'injury_yes',
      medical_treatment: 'er_visit',
      accident_role: 'driver',
      insurance_activity: 'requested_recorded_statement',
      work_impact: 'missed_work',
      attorney_status: 'no_lawyer',
      // when this contact-form-derived weight pushes us over 100, the
      // cap MUST apply.
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
      // Hypothetical contactBonus = 15. Real production formula
      // (leads.ts) is +5 phone +5 email = max +10 per
      // lead-classification-revamp.md Q9; we pass +15 here only to
      // exercise the score-clamp behaviour at >100.
      contactBonus: 15,
    });

    expect(result.lead_score).toBe(100);
  });
});

describe('scoreLead — WARM walk (Self table)', () => {
  it('produces classification WARM for a mid-range answer set', () => {
    /**
     * Spec §User Story 1 acceptance scenario 2: accident a few months
     * ago, injured, doctor visit, no insurance contact, no work impact,
     * no lawyer, full contact info. Sum: 5+15+10+5+0+0+20 = 55; +15
     * contact = 70. Self table → WARM (51-75).
     */
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      geographic_qualification: 'yes_in_area',
      accident_timing: 'within_last_6_months', // +5
      injury: 'injury_yes',                    // +15
      medical_treatment: 'doctor_visit',       // +10
      accident_role: 'driver',                 // +5
      insurance_activity: 'not_yet',           // 0
      work_impact: 'no_impact',                // 0
      attorney_status: 'no_lawyer',            // +20
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
      contactBonus: 15,
    });

    expect(result.classification).toBe('WARM');
    expect(result.lead_score).toBeGreaterThanOrEqual(51);
    expect(result.lead_score).toBeLessThanOrEqual(75);
    expect(result.scoring_path).toBe('rule_based');
  });
});

describe('scoreLead — score floor + flooring at 0', () => {
  it('floors negative raw scores at 0', () => {
    /**
     * Visitor answers worst-case: long-ago, no injury, no treatment,
     * has lawyer. Raw sum: 0 - 20 - 10 + 0 + 0 + 0 - 20 = -50.
     * Floored at 0 per FR-005.
     */
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      geographic_qualification: 'yes_in_area',
      accident_timing: 'more_than_6_months_ago', // 0
      injury: 'injury_no',                       // -20
      medical_treatment: 'no_treatment',         // -10
      accident_role: 'driver',                   // +5
      insurance_activity: 'not_yet',             // 0
      work_impact: 'no_impact',                  // 0
      attorney_status: 'yes_have_lawyer',        // -20
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.lead_score).toBe(0);
    expect(result.classification).toBe('SPAM');
  });
});

describe('scoreLead — Family/Friend table boundary differences (FR-006/039)', () => {
  it('classifies score 35 as COLD for SELF requester', () => {
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      accident_timing: 'within_last_6_months', // +5
      injury: 'injury_yes',                    // +15
      medical_treatment: 'doctor_visit',       // +10
      accident_role: 'driver',                 // +5
      // sum so far: 35
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.lead_score).toBe(35);
    expect(result.classification).toBe('COLD');
  });

  it('classifies score 35 as WARM for FRIEND_FAMILY requester (no COLD bucket)', () => {
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'friend_family',
      accident_timing: 'within_last_6_months',
      injury: 'injury_yes',
      medical_treatment: 'doctor_visit',
      accident_role: 'driver',
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.lead_score).toBe(35);
    expect(result.classification).toBe('WARM');
    expect(result.request_type).toBe('FRIEND_FAMILY');
  });
});

describe('scoreLead — defaults Self table when request_type missing', () => {
  it('treats missing request_type as SELF', () => {
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      accident_timing: 'within_last_6_months', // +5
      injury: 'injury_yes',                    // +15
      medical_treatment: 'doctor_visit',       // +10
      accident_role: 'driver',                 // +5
      // sum: 35; Self → COLD; Family/Friend → WARM
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.lead_score).toBe(35);
    expect(result.classification).toBe('COLD'); // Self default
    expect(result.request_type).toBeNull();
  });
});

describe('scoreLead — captures geographic qualification metadata', () => {
  it('exposes geographic_qualification on the output', () => {
    const sopState = buildSOPState({
      case_type: 'personal_injury',
      sub_type: 'car_accident',
      request_type: 'myself',
      geographic_qualification: 'yes_in_area',
      accident_timing: 'today',
    });

    const result = scoreLead({
      sopState,
      scoringConfig: carAccidentDefaultConfig,
      chipsBySlug,
    });

    expect(result.geographic_qualification).toBe('IN_SERVICE_AREA');
  });
});
