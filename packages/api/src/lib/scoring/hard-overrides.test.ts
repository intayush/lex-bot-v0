import { describe, expect, it } from 'vitest';

import type {
  CaseType,
  HardOverridesEnabled,
  Lead,
  SOPState,
} from '@legal-chatbot/shared';

import {
  applyHardOverrides,
  checkFakeInfo,
  checkMissingContact,
  checkNoInjuryNoTreatment,
  checkOutOfScope,
} from './hard-overrides.js';

/**
 * Minimal Lead fixture builder for predicate tests. Only the fields
 * each predicate inspects are required.
 */
function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead_test',
    account_id: 'acct_test',
    session_id: 'sess_test',
    name: null,
    contact_email: null,
    contact_phone: null,
    case_type: null,
    incident_date: null,
    brief_description: null,
    classification: 'WARM',
    classification_rationale: null,
    urgency_factors_json: null,
    lead_score: 50,
    score_reasons_json: null,
    request_type: null,
    geographic_qualification: null,
    geographic_qualification_details_json: null,
    sop_state_snapshot: null,
    status: 'new',
    follow_up_action: null,
    follow_up_action_changed_at: null,
    created_at: '2026-06-06T00:00:00Z',
    ...overrides,
  };
}

function makeSOPState(captures: Record<string, string> = {}): SOPState {
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
      captured_label: null,
      captured_at: captures[slug] !== undefined ? '2026-06-06T00:01:00Z' : null,
      inferred: false,
    })),
  };
}

const allEnabled: HardOverridesEnabled = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

// ---------------------------------------------------------------------------
// checkMissingContact
// ---------------------------------------------------------------------------

describe('checkMissingContact', () => {
  it('returns true when both phone and email are null', () => {
    expect(
      checkMissingContact(makeLead({ contact_email: null, contact_phone: null })),
    ).toBe(true);
  });

  it('returns true when both phone and email are empty strings', () => {
    expect(
      checkMissingContact(makeLead({ contact_email: '', contact_phone: '' })),
    ).toBe(true);
  });

  it('returns false when phone is provided', () => {
    expect(
      checkMissingContact(makeLead({ contact_email: null, contact_phone: '+16175550101' })),
    ).toBe(false);
  });

  it('returns false when email is provided', () => {
    expect(
      checkMissingContact(makeLead({ contact_email: 'a@b.com', contact_phone: null })),
    ).toBe(false);
  });

  it('returns false when both are provided', () => {
    expect(
      checkMissingContact(makeLead({ contact_email: 'a@b.com', contact_phone: '+16175550101' })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkOutOfScope
// ---------------------------------------------------------------------------

describe('checkOutOfScope', () => {
  it('returns true when caseType.is_in_scope is false', () => {
    const caseType: CaseType = {
      id: 'ct_1',
      account_id: 'acct_test',
      slug: 'something_oos',
      label: 'Something Out of Scope',
      position: 1,
      is_in_scope: false,
      created_at: '2026-06-06T00:00:00Z',
      sub_types: [],
    };
    expect(checkOutOfScope(caseType)).toBe(true);
  });

  it('returns false when caseType.is_in_scope is true', () => {
    const caseType: CaseType = {
      id: 'ct_1',
      account_id: 'acct_test',
      slug: 'personal_injury',
      label: 'Personal Injury',
      position: 1,
      is_in_scope: true,
      created_at: '2026-06-06T00:00:00Z',
      sub_types: [],
    };
    expect(checkOutOfScope(caseType)).toBe(false);
  });

  it('returns false when caseType is null (no captured case_type yet)', () => {
    expect(checkOutOfScope(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkNoInjuryNoTreatment
// ---------------------------------------------------------------------------

describe('checkNoInjuryNoTreatment', () => {
  it('returns true when injury=injury_no AND medical_treatment=no_treatment', () => {
    const sop = makeSOPState({
      injury: 'injury_no',
      medical_treatment: 'no_treatment',
    });
    expect(checkNoInjuryNoTreatment(sop)).toBe(true);
  });

  it('returns false when only injury=injury_no (treatment unspecified)', () => {
    const sop = makeSOPState({ injury: 'injury_no' });
    expect(checkNoInjuryNoTreatment(sop)).toBe(false);
  });

  it('returns false when only medical_treatment=no_treatment (injury unspecified)', () => {
    const sop = makeSOPState({ medical_treatment: 'no_treatment' });
    expect(checkNoInjuryNoTreatment(sop)).toBe(false);
  });

  it('returns false when injury=injury_yes AND medical_treatment=no_treatment', () => {
    const sop = makeSOPState({
      injury: 'injury_yes',
      medical_treatment: 'no_treatment',
    });
    expect(checkNoInjuryNoTreatment(sop)).toBe(false);
  });

  it('returns false when both steps are unanswered', () => {
    const sop = makeSOPState({});
    expect(checkNoInjuryNoTreatment(sop)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkFakeInfo
// ---------------------------------------------------------------------------

describe('checkFakeInfo', () => {
  describe('phone digit-count heuristic', () => {
    it('returns true when phone has < 7 digits when stripped', () => {
      expect(checkFakeInfo(makeLead({ contact_phone: '123456' }))).toBe(true);
    });

    it('returns true when phone is just punctuation', () => {
      expect(checkFakeInfo(makeLead({ contact_phone: '---' }))).toBe(true);
    });

    it('returns false when phone has >= 7 digits', () => {
      expect(checkFakeInfo(makeLead({ contact_phone: '+16175550101' }))).toBe(
        false,
      );
    });
  });

  describe('email pattern heuristic', () => {
    it('returns true when email matches /^test@/i', () => {
      expect(checkFakeInfo(makeLead({ contact_email: 'test@anywhere.com' }))).toBe(
        true,
      );
    });

    it('returns true when email matches /^test@/ case-insensitive', () => {
      expect(checkFakeInfo(makeLead({ contact_email: 'TEST@anywhere.com' }))).toBe(
        true,
      );
    });

    it('returns true when email domain is test.com', () => {
      expect(checkFakeInfo(makeLead({ contact_email: 'jane@test.com' }))).toBe(
        true,
      );
    });

    it('returns true when email domain is example.com', () => {
      expect(checkFakeInfo(makeLead({ contact_email: 'jane@example.com' }))).toBe(
        true,
      );
    });

    it('returns false for legitimate email addresses', () => {
      expect(checkFakeInfo(makeLead({ contact_email: 'jane@gmail.com' }))).toBe(
        false,
      );
    });
  });

  describe('name pattern heuristic', () => {
    it('returns true for name="test"', () => {
      expect(checkFakeInfo(makeLead({ name: 'test' }))).toBe(true);
    });

    it('returns true for name="Test User" (case-insensitive prefix)', () => {
      expect(checkFakeInfo(makeLead({ name: 'Test User' }))).toBe(true);
    });

    it('returns true for name="asdf"', () => {
      expect(checkFakeInfo(makeLead({ name: 'asdf' }))).toBe(true);
    });

    it('returns true for name="fake person"', () => {
      expect(checkFakeInfo(makeLead({ name: 'fake person' }))).toBe(true);
    });

    it('returns true for name with repeated x ("xxxx")', () => {
      expect(checkFakeInfo(makeLead({ name: 'xxxx' }))).toBe(true);
    });

    it('returns false for legitimate names', () => {
      expect(checkFakeInfo(makeLead({ name: 'Jane Doe' }))).toBe(false);
      expect(checkFakeInfo(makeLead({ name: 'John Smith' }))).toBe(false);
    });
  });

  it('returns false when all three fields are clean', () => {
    expect(
      checkFakeInfo(
        makeLead({
          name: 'Jane Doe',
          contact_email: 'jane@gmail.com',
          contact_phone: '+16175550101',
        }),
      ),
    ).toBe(false);
  });

  it('returns true when ANY of the three fields matches (OR logic)', () => {
    // Clean name + email; bad phone
    expect(
      checkFakeInfo(
        makeLead({
          name: 'Jane Doe',
          contact_email: 'jane@gmail.com',
          contact_phone: '12',
        }),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyHardOverrides
// ---------------------------------------------------------------------------

describe('applyHardOverrides', () => {
  it('returns null (no override fired) when all checks pass', () => {
    const result = applyHardOverrides({
      lead: makeLead({
        name: 'Jane Doe',
        contact_email: 'jane@gmail.com',
        contact_phone: '+16175550101',
      }),
      sopState: makeSOPState({
        injury: 'injury_yes',
        medical_treatment: 'er_visit',
      }),
      caseType: {
        id: 'ct_1',
        account_id: 'acct_test',
        slug: 'personal_injury',
        label: 'Personal Injury',
        position: 1,
        is_in_scope: true,
        created_at: '2026-06-06T00:00:00Z',
        sub_types: [],
      },
      enabled: allEnabled,
    });
    expect(result).toBeNull();
  });

  it('fires missing_contact when both contact fields are blank', () => {
    const result = applyHardOverrides({
      lead: makeLead({ contact_email: null, contact_phone: null }),
      sopState: makeSOPState(),
      caseType: null,
      enabled: allEnabled,
    });
    expect(result).not.toBeNull();
    expect(result?.firedRules).toContain('missing_contact');
  });

  it('fires multiple rules in fixed order (FR-008)', () => {
    const result = applyHardOverrides({
      lead: makeLead({
        name: 'test',
        contact_email: null,
        contact_phone: null,
      }),
      sopState: makeSOPState({
        injury: 'injury_no',
        medical_treatment: 'no_treatment',
      }),
      caseType: {
        id: 'ct_1',
        account_id: 'acct_test',
        slug: 'oos',
        label: 'OOS',
        position: 1,
        is_in_scope: false,
        created_at: '2026-06-06T00:00:00Z',
        sub_types: [],
      },
      enabled: allEnabled,
    });
    expect(result?.firedRules).toEqual([
      'missing_contact',
      'out_of_scope',
      'no_injury_no_treatment',
      'fake_info',
    ]);
  });

  it('respects per-rule disable toggles', () => {
    // Phone "test" matches fake_info heuristic, but fake_info is disabled
    const result = applyHardOverrides({
      lead: makeLead({
        name: 'test',
        contact_email: 'jane@gmail.com',
        contact_phone: '+16175550101',
      }),
      sopState: makeSOPState(),
      caseType: null,
      enabled: { ...allEnabled, fake_info: false },
    });
    expect(result).toBeNull();
  });

  it('returns classification: SPAM when any override fires', () => {
    const result = applyHardOverrides({
      lead: makeLead({ contact_email: null, contact_phone: null }),
      sopState: makeSOPState(),
      caseType: null,
      enabled: allEnabled,
    });
    expect(result?.classification).toBe('SPAM');
  });
});
