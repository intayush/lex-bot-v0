/**
 * Tests for the Lead Action shared schemas (013-lead-action-tracking T005).
 *
 * Pure Zod validation tests — no DB, no IO. Each invariant from
 * `data-model.md` "Validation Rules" + `contracts/lead-action-route-contract.md`
 * has a dedicated test case.
 */
import { describe, it, expect } from 'vitest';
import {
  leadActionEnum,
  leadActionUpdateSchema,
  leadActionResponseSchema,
  LEAD_ACTION_LABELS,
  type LeadAction,
} from './lead-action';

describe('leadActionEnum', () => {
  it('accepts each of the 3 valid slugs', () => {
    expect(leadActionEnum.parse('contacted')).toBe('contacted');
    expect(leadActionEnum.parse('call_no_answer')).toBe('call_no_answer');
    expect(leadActionEnum.parse('meeting_fixed')).toBe('meeting_fixed');
  });

  it('rejects an unknown slug', () => {
    expect(() => leadActionEnum.parse('foo')).toThrow();
  });

  it('rejects display-label form (must be slug, not label)', () => {
    expect(() => leadActionEnum.parse('Contacted')).toThrow();
    expect(() => leadActionEnum.parse("Call didn't answer")).toThrow();
  });
});

describe('leadActionUpdateSchema', () => {
  it('accepts each of the 3 valid action slugs', () => {
    expect(leadActionUpdateSchema.parse({ action: 'contacted' })).toEqual({ action: 'contacted' });
    expect(leadActionUpdateSchema.parse({ action: 'call_no_answer' })).toEqual({ action: 'call_no_answer' });
    expect(leadActionUpdateSchema.parse({ action: 'meeting_fixed' })).toEqual({ action: 'meeting_fixed' });
  });

  it('accepts null (clears the action)', () => {
    expect(leadActionUpdateSchema.parse({ action: null })).toEqual({ action: null });
  });

  it('rejects an invalid slug', () => {
    expect(() => leadActionUpdateSchema.parse({ action: 'invalid' })).toThrow();
  });

  it('rejects a missing action field', () => {
    expect(() => leadActionUpdateSchema.parse({})).toThrow();
  });

  it('rejects undefined explicitly (must use null to clear)', () => {
    expect(() => leadActionUpdateSchema.parse({ action: undefined })).toThrow();
  });

  it('rejects a non-object body', () => {
    expect(() => leadActionUpdateSchema.parse('contacted')).toThrow();
    expect(() => leadActionUpdateSchema.parse(null)).toThrow();
    expect(() => leadActionUpdateSchema.parse(undefined)).toThrow();
  });

  it('strips extra fields by default (Zod permissive mode)', () => {
    // Zod's default is to strip unknown keys, not to reject. Document
    // the behavior so future readers know the route handler does NOT
    // need to defensively check for extra keys.
    const parsed = leadActionUpdateSchema.parse({
      action: 'contacted',
      maliciousField: 'ignored',
    });
    expect(parsed).toEqual({ action: 'contacted' });
    expect((parsed as Record<string, unknown>).maliciousField).toBeUndefined();
  });
});

describe('leadActionResponseSchema', () => {
  it('accepts a valid success response with non-null action', () => {
    const valid = {
      success: true as const,
      follow_up_action: 'contacted' as LeadAction,
      follow_up_action_changed_at: '2026-05-24T14:14:00.000Z',
    };
    expect(leadActionResponseSchema.parse(valid)).toEqual(valid);
  });

  it('accepts a valid cleared-state response (both fields null)', () => {
    const valid = {
      success: true as const,
      follow_up_action: null,
      follow_up_action_changed_at: null,
    };
    expect(leadActionResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects success: false (route shouldn\'t emit non-200 with this schema)', () => {
    expect(() =>
      leadActionResponseSchema.parse({
        success: false,
        follow_up_action: null,
        follow_up_action_changed_at: null,
      }),
    ).toThrow();
  });
});

describe('LEAD_ACTION_LABELS', () => {
  it('has a label for each enum value', () => {
    expect(LEAD_ACTION_LABELS.contacted).toBe('Contacted');
    expect(LEAD_ACTION_LABELS.call_no_answer).toBe("Call didn't answer");
    expect(LEAD_ACTION_LABELS.meeting_fixed).toBe('Client meeting fixed');
  });

  it('covers exactly the three enum values (no extras)', () => {
    const keys = Object.keys(LEAD_ACTION_LABELS).sort();
    expect(keys).toEqual(['call_no_answer', 'contacted', 'meeting_fixed']);
  });
});
