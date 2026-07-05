import { describe, it, expect } from 'vitest';
import { DEFAULT_CASE_TYPE_MATRIX } from './default-case-types.js';

describe('DEFAULT_CASE_TYPE_MATRIX', () => {
  it('has the 6 canonical case types', () => {
    expect(DEFAULT_CASE_TYPE_MATRIX.map((c) => c.slug)).toEqual([
      'dui', 'criminal_defense', 'personal_injury', 'family_law', 'drug_crime', 'estate_planning',
    ]);
  });
  it('personal_injury includes car_accident sub-type', () => {
    const pi = DEFAULT_CASE_TYPE_MATRIX.find((c) => c.slug === 'personal_injury')!;
    expect(pi.subTypes.map((s) => s.slug)).toContain('car_accident');
  });
  it('every case type has at least 3 sub-types', () => {
    for (const ct of DEFAULT_CASE_TYPE_MATRIX) {
      expect(ct.subTypes.length).toBeGreaterThanOrEqual(3);
    }
  });
});
