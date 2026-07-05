import { describe, it, expect } from 'vitest';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import { DEFAULT_CASE_TYPES } from './sop';

describe('matrix parity: shared matrix matches server DEFAULT_CASE_TYPES', () => {
  it('same case-type slugs in same order', () => {
    expect(DEFAULT_CASE_TYPE_MATRIX.map((c) => c.slug)).toEqual(DEFAULT_CASE_TYPES.map((c) => c.slug));
  });
  it('same case-type labels in same order', () => {
    expect(DEFAULT_CASE_TYPE_MATRIX.map((c) => c.label)).toEqual(DEFAULT_CASE_TYPES.map((c) => c.label));
  });
  it('same sub-type slugs per case type', () => {
    for (const ct of DEFAULT_CASE_TYPES) {
      const m = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === ct.slug)!;
      expect(m.subTypes.map((s) => s.slug)).toEqual(ct.sub_types.map((s) => s.slug));
    }
  });
  it('same sub-type labels per case type', () => {
    for (const ct of DEFAULT_CASE_TYPES) {
      const m = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === ct.slug)!;
      expect(m.subTypes.map((s) => s.label)).toEqual(ct.sub_types.map((s) => s.label));
    }
  });
});
