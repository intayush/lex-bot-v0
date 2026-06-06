/**
 * Spec 016 T059 — branch-events tests.
 *
 * Verifies (a) the emitter routes to console.info with valid JSON,
 * (b) PII boundary: payloads contain ONLY chip slugs (controlled
 * vocabulary) and never chip labels, free-text, or contact fields.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitBranchEvent } from './branch-events';

let infoSpy: ReturnType<typeof vi.spyOn>;
const captured: string[] = [];

beforeEach(() => {
  captured.length = 0;
  infoSpy = vi
    .spyOn(console, 'info')
    .mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    });
});

afterEach(() => {
  infoSpy.mockRestore();
});

function lastPayload(): Record<string, unknown> {
  expect(captured.length).toBeGreaterThan(0);
  return JSON.parse(captured[captured.length - 1]);
}

describe('emitBranchEvent', () => {
  it('emits branch_started with required fields', () => {
    emitBranchEvent({
      event: 'branch_started',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      branch_id: 'br',
      branch_version_id: 'bv',
    });
    const p = lastPayload();
    expect(p.event).toBe('branch_started');
    expect(p.case_type_slug).toBe('personal_injury');
    expect(p.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits branch_question_answered with chip slugs only', () => {
    emitBranchEvent({
      event: 'branch_question_answered',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      branch_id: 'br',
      branch_version_id: 'bv',
      question_id: 'q_role',
      chip_slugs: ['driver'],
      is_free_text: false,
    });
    const p = lastPayload();
    expect(p.chip_slugs).toEqual(['driver']);
    expect(p.is_free_text).toBe(false);
  });

  it('emits branch_completed with lead_score and reasons (rule names)', () => {
    emitBranchEvent({
      event: 'branch_completed',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      branch_id: 'br',
      branch_version_id: 'bv',
      lead_score: 87,
      classification: 'HOT',
      reasons: ['Driver', 'Today'],
    });
    const p = lastPayload();
    expect(p.lead_score).toBe(87);
    expect(p.classification).toBe('HOT');
    expect(p.reasons).toEqual(['Driver', 'Today']);
  });

  it('emits branch_skipped with the reason discriminator', () => {
    emitBranchEvent({
      event: 'branch_skipped',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'criminal_defense',
      sub_type_slug: 'assault',
      reason: 'no_branch_configured',
    });
    const p = lastPayload();
    expect(p.event).toBe('branch_skipped');
    expect(p.reason).toBe('no_branch_configured');
  });

  it('emits branch_incomplete_finalized with chips_captured_count + chips_total_count', () => {
    emitBranchEvent({
      event: 'branch_incomplete_finalized',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      branch_id: 'br',
      branch_version_id: 'bv',
      lead_score: 35,
      classification: 'COLD',
      reasons: ['Driver'],
      chips_captured_count: 3,
      chips_total_count: 9,
    });
    const p = lastPayload();
    expect(p.chips_captured_count).toBe(3);
    expect(p.chips_total_count).toBe(9);
  });

  it('PII boundary: payload contains no email, phone, or free-text content', () => {
    emitBranchEvent({
      event: 'branch_question_answered',
      account_id: 'acct',
      session_id: 'sess',
      case_type_slug: 'personal_injury',
      sub_type_slug: 'car_accident',
      branch_id: 'br',
      branch_version_id: 'bv',
      question_id: 'q_role',
      chip_slugs: ['driver'],
      is_free_text: false,
    });
    const json = captured[captured.length - 1];
    // None of these PII patterns should appear in the payload.
    expect(json).not.toMatch(/@/); // no email
    expect(json).not.toMatch(/\b\d{3}[-.\s]?\d{4}\b/); // no phone
    // No PII-bearing keys (chip_slugs is allowed; chip_labels would not be).
    expect(json).not.toMatch(/"contact_email"|"contact_phone"|"chip_labels"|"captured_value"/);
  });
});
