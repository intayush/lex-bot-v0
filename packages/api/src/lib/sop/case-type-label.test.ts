/**
 * Tests for resolveCaseTypeLabel (014-fix-sop-case-subtypes T006).
 */
import { describe, it, expect } from 'vitest';
import type { CaseType } from '@legal-chatbot/shared';
import { resolveCaseTypeLabel } from './case-type-label';

const SAMPLE_CASE_TYPES: CaseType[] = [
  {
    id: 'ct_1', account_id: 'acct_1', slug: 'dui', label: 'DUI',
    position: 1, is_in_scope: true, created_at: '2026-05-25T10:00:00Z',
    sub_types: [],
  },
  {
    id: 'ct_2', account_id: 'acct_1', slug: 'personal_injury', label: 'Personal Injury',
    position: 2, is_in_scope: true, created_at: '2026-05-25T10:00:00Z',
    sub_types: [],
  },
];

describe('resolveCaseTypeLabel', () => {
  it('returns null when slug is null', () => {
    expect(resolveCaseTypeLabel(null, SAMPLE_CASE_TYPES)).toBeNull();
  });

  it('returns the label for a matching slug', () => {
    expect(resolveCaseTypeLabel('dui', SAMPLE_CASE_TYPES)).toBe('DUI');
    expect(resolveCaseTypeLabel('personal_injury', SAMPLE_CASE_TYPES)).toBe('Personal Injury');
  });

  it('returns null when slug is not in the catalog (deleted case type)', () => {
    expect(resolveCaseTypeLabel('drug_crime', SAMPLE_CASE_TYPES)).toBeNull();
  });
});
