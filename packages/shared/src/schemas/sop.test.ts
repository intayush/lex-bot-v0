/**
 * 014-fix-sop-case-subtypes T002 + T004 tests.
 *
 * Validates the optional `captured_label` snapshot on `SOPStateStep`
 * and the optional `captured_case_type_label` field on
 * `sopStateHeaderPayloadSchema`. Both are added by 014 to support the
 * sub-type label snapshot (FR-022) and the system-prompt
 * `{case_type}` interpolation (FR-006) respectively.
 */
import { describe, it, expect } from 'vitest';
import {
  sopStateStepSchema,
  sopStateHeaderPayloadSchema,
} from './sop';

describe('sopStateStepSchema — captured_label', () => {
  function baseStep() {
    return {
      step_id: 'step_1',
      slug: 'case_type',
      status: 'complete' as const,
      captured_value: 'dui',
      captured_at: '2026-05-25T12:34:56.000Z',
      inferred: false,
    };
  }

  it('accepts a payload WITHOUT captured_label and defaults it to null', () => {
    const parsed = sopStateStepSchema.parse(baseStep());
    expect(parsed.captured_label).toBeNull();
  });

  it('accepts a payload WITH a string captured_label', () => {
    const parsed = sopStateStepSchema.parse({ ...baseStep(), captured_label: 'DUI' });
    expect(parsed.captured_label).toBe('DUI');
  });

  it('accepts an explicit null captured_label', () => {
    const parsed = sopStateStepSchema.parse({ ...baseStep(), captured_label: null });
    expect(parsed.captured_label).toBeNull();
  });

  it('rejects non-string non-null captured_label values', () => {
    expect(() =>
      sopStateStepSchema.parse({ ...baseStep(), captured_label: 42 as unknown as string }),
    ).toThrow();
    expect(() =>
      sopStateStepSchema.parse({ ...baseStep(), captured_label: ['DUI'] as unknown as string }),
    ).toThrow();
    expect(() =>
      sopStateStepSchema.parse({ ...baseStep(), captured_label: { label: 'DUI' } as unknown as string }),
    ).toThrow();
  });
});

describe('sopStateHeaderPayloadSchema — captured_case_type_label', () => {
  function baseHeader() {
    return {
      current: 1,
      total: 6,
      pending_step_id: 'step_2',
      pending_step_slug: 'sub_type',
      is_finalized: false,
      captured_case_type_slug: 'dui',
    };
  }

  it('accepts a payload WITHOUT captured_case_type_label', () => {
    const parsed = sopStateHeaderPayloadSchema.parse(baseHeader());
    // Optional field — undefined or null both acceptable; widget treats both as "no label".
    expect(parsed.captured_case_type_label ?? null).toBeNull();
  });

  it('accepts a payload WITH a string captured_case_type_label', () => {
    const parsed = sopStateHeaderPayloadSchema.parse({
      ...baseHeader(),
      captured_case_type_label: 'DUI',
    });
    expect(parsed.captured_case_type_label).toBe('DUI');
  });

  it('accepts an explicit null captured_case_type_label', () => {
    const parsed = sopStateHeaderPayloadSchema.parse({
      ...baseHeader(),
      captured_case_type_label: null,
    });
    expect(parsed.captured_case_type_label).toBeNull();
  });

  it('rejects non-string non-null captured_case_type_label values', () => {
    expect(() =>
      sopStateHeaderPayloadSchema.parse({
        ...baseHeader(),
        captured_case_type_label: 0 as unknown as string,
      }),
    ).toThrow();
    expect(() =>
      sopStateHeaderPayloadSchema.parse({
        ...baseHeader(),
        captured_case_type_label: false as unknown as string,
      }),
    ).toThrow();
  });
});
