import { describe, expect, it } from 'vitest';

import {
  leadClassificationSchema,
  leadGeographicQualificationSchema,
  leadRequestTypeSchema,
  leadSchema,
} from './leads.js';

describe('leadClassificationSchema', () => {
  describe('new 4-value vocabulary (HOT/WARM/COLD/SPAM)', () => {
    it.each(['HOT', 'WARM', 'COLD', 'SPAM'])('accepts %s', (value) => {
      const result = leadClassificationSchema.safeParse(value);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(value);
      }
    });
  });

  describe('rejects legacy 3-value vocabulary', () => {
    it.each(['urgent', 'normal', 'unqualified'])('rejects %s', (value) => {
      const result = leadClassificationSchema.safeParse(value);
      expect(result.success).toBe(false);
    });
  });

  describe('rejects unknown values', () => {
    it.each(['hot', 'warm', 'cold', 'spam', 'INVALID', '', null, undefined])(
      'rejects %p',
      (value) => {
        const result = leadClassificationSchema.safeParse(value);
        expect(result.success).toBe(false);
      },
    );
  });
});

describe('leadRequestTypeSchema', () => {
  it.each(['SELF', 'FRIEND_FAMILY'])('accepts %s', (value) => {
    expect(leadRequestTypeSchema.safeParse(value).success).toBe(true);
  });

  it.each(['self', 'family', '', null, undefined])('rejects %p', (value) => {
    expect(leadRequestTypeSchema.safeParse(value).success).toBe(false);
  });
});

describe('leadGeographicQualificationSchema', () => {
  it.each(['IN_SERVICE_AREA', 'OUTSIDE_SERVICE_AREA'])(
    'accepts %s',
    (value) => {
      expect(leadGeographicQualificationSchema.safeParse(value).success).toBe(
        true,
      );
    },
  );

  it.each(['in_service_area', '', null, undefined])('rejects %p', (value) => {
    expect(leadGeographicQualificationSchema.safeParse(value).success).toBe(
      false,
    );
  });
});

describe('leadSchema (extended)', () => {
  const baseValidLead = {
    id: 'lead_123',
    account_id: 'acct_xyz',
    session_id: 'sess_abc',
    name: 'Jane Doe',
    contact_email: 'jane@example.org',
    contact_phone: '+16175550101',
    case_type: 'personal_injury',
    incident_date: '2026-06-01',
    brief_description: 'Other driver ran a red light',
    classification: 'HOT' as const,
    classification_rationale: 'Recent accident with injury',
    urgency_factors_json: '["recent_accident","injury"]',
    lead_score: 87,
    score_reasons_json: '["Recent accident","Emergency room treatment"]',
    request_type: 'SELF' as const,
    geographic_qualification: 'IN_SERVICE_AREA' as const,
    geographic_qualification_details_json: null,
    sop_state_snapshot: null,
    status: 'new' as const,
    follow_up_action: null,
    follow_up_action_changed_at: null,
    created_at: '2026-06-06T12:00:00.000Z',
  };

  it('accepts a fully-populated rule-based-scored lead', () => {
    expect(leadSchema.safeParse(baseValidLead).success).toBe(true);
  });

  it('accepts a legacy migrated lead with null score and metadata', () => {
    const legacy = {
      ...baseValidLead,
      classification: 'WARM' as const,
      lead_score: null,
      score_reasons_json: null,
      request_type: null,
      geographic_qualification: null,
      geographic_qualification_details_json: null,
    };
    expect(leadSchema.safeParse(legacy).success).toBe(true);
  });

  it('rejects lead_score below 0', () => {
    expect(
      leadSchema.safeParse({ ...baseValidLead, lead_score: -1 }).success,
    ).toBe(false);
  });

  it('rejects lead_score above 100', () => {
    expect(
      leadSchema.safeParse({ ...baseValidLead, lead_score: 101 }).success,
    ).toBe(false);
  });

  it('rejects non-integer lead_score', () => {
    expect(
      leadSchema.safeParse({ ...baseValidLead, lead_score: 50.5 }).success,
    ).toBe(false);
  });

  it('accepts lead_score at boundary 0 and 100', () => {
    expect(
      leadSchema.safeParse({ ...baseValidLead, lead_score: 0 }).success,
    ).toBe(true);
    expect(
      leadSchema.safeParse({ ...baseValidLead, lead_score: 100 }).success,
    ).toBe(true);
  });

  it('rejects legacy classification values on leadSchema', () => {
    expect(
      leadSchema.safeParse({ ...baseValidLead, classification: 'urgent' })
        .success,
    ).toBe(false);
  });
});
