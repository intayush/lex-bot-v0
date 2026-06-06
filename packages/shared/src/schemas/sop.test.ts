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
  chipSchema,
  scoringConfigSchema,
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

/**
 * 015 T003 — chipSchema extension with optional score_weight.
 *
 * Per `contracts/chip-with-score.md`: chips on scoring SOP steps carry
 * an integer `score_weight` in [-50, +50]; chips on existing default
 * steps leave the field undefined. Three states matter: absent, 0, non-zero.
 */
describe('chipSchema — score_weight extension (015)', () => {
  it('accepts a chip with score_weight = 20', () => {
    const result = chipSchema.safeParse({
      label: 'Today',
      slug: 'today',
      score_weight: 20,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a chip with score_weight = 0 ("I Don\'t Know" pattern)', () => {
    const result = chipSchema.safeParse({
      label: "I Don't Know",
      slug: 'i_dont_know',
      score_weight: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a chip with score_weight absent (existing default-step chips)', () => {
    const result = chipSchema.safeParse({
      label: 'Today',
      slug: 'today',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a chip with negative score_weight', () => {
    const result = chipSchema.safeParse({
      label: 'No',
      slug: 'no',
      score_weight: -20,
    });
    expect(result.success).toBe(true);
  });

  it('accepts boundary values -50 and +50', () => {
    expect(
      chipSchema.safeParse({
        label: 'Min',
        slug: 'min',
        score_weight: -50,
      }).success,
    ).toBe(true);
    expect(
      chipSchema.safeParse({
        label: 'Max',
        slug: 'max',
        score_weight: 50,
      }).success,
    ).toBe(true);
  });

  it('rejects score_weight = 51 (above bounds)', () => {
    const result = chipSchema.safeParse({
      label: 'Bad',
      slug: 'bad',
      score_weight: 51,
    });
    expect(result.success).toBe(false);
  });

  it('rejects score_weight = -51 (below bounds)', () => {
    const result = chipSchema.safeParse({
      label: 'Bad',
      slug: 'bad',
      score_weight: -51,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer score_weight', () => {
    const result = chipSchema.safeParse({
      label: 'Bad',
      slug: 'bad',
      score_weight: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

/**
 * 015 T004 — scoringConfigSchema (NEW).
 *
 * Per `contracts/scoring-config.md`: validates the JSON shape persisted in
 * `sub_types.scoring_config_json`. Enforces:
 * - schema_version === 1
 * - thresholds_self covers [0,100] contiguously, no overlap, 4 buckets
 * - thresholds_family_friend covers [0,100] contiguously, no overlap, 3 buckets (no COLD)
 * - hard_overrides_enabled has all 4 boolean keys
 *
 * Stable params.code values surface on validation errors so the dashboard
 * can render actionable inline errors per FR-021.
 */
describe('scoringConfigSchema (015)', () => {
  const validCarAccidentDefault = {
    schema_version: 1 as const,
    thresholds_self: {
      hot: [76, 100] as [number, number],
      warm: [51, 75] as [number, number],
      cold: [26, 50] as [number, number],
      spam: [0, 25] as [number, number],
    },
    thresholds_family_friend: {
      hot: [76, 100] as [number, number],
      warm: [26, 75] as [number, number],
      spam: [0, 25] as [number, number],
    },
    hard_overrides_enabled: {
      missing_contact: true,
      out_of_scope: true,
      no_injury_no_treatment: true,
      fake_info: true,
    },
  };

  it('accepts the seeded car-accident default config', () => {
    const result = scoringConfigSchema.safeParse(validCarAccidentDefault);
    expect(result.success).toBe(true);
  });

  it('accepts a config with all hard-overrides disabled', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      hard_overrides_enabled: {
        missing_contact: false,
        out_of_scope: false,
        no_injury_no_treatment: false,
        fake_info: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects schema_version = 2 with code SCHEMA_VERSION_UNSUPPORTED', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      schema_version: 2,
    });
    expect(result.success).toBe(false);
  });

  it('rejects Self thresholds with a gap (cold = [26,49], warm = [51,75])', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      thresholds_self: {
        hot: [76, 100],
        warm: [51, 75],
        cold: [26, 49],
        spam: [0, 25],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues;
      const hasGapCode = issues.some(
        (i) => (i.params as { code?: string } | undefined)?.code === 'THRESHOLDS_GAP',
      );
      expect(hasGapCode).toBe(true);
    }
  });

  it('rejects Self thresholds with overlap (cold = [26,55], warm = [51,75])', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      thresholds_self: {
        hot: [76, 100],
        warm: [51, 75],
        cold: [26, 55],
        spam: [0, 25],
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues;
      const hasOverlapCode = issues.some(
        (i) => (i.params as { code?: string } | undefined)?.code === 'THRESHOLDS_OVERLAP',
      );
      expect(hasOverlapCode).toBe(true);
    }
  });

  it('rejects thresholds where lower bound > upper bound', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      thresholds_self: {
        hot: [100, 76],
        warm: [51, 75],
        cold: [26, 50],
        spam: [0, 25],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects bounds outside [0, 100]', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      thresholds_self: {
        hot: [76, 101],
        warm: [51, 75],
        cold: [26, 50],
        spam: [0, 25],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects Family/Friend thresholds with a gap', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      thresholds_family_friend: {
        hot: [76, 100],
        warm: [27, 75],
        spam: [0, 25],
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing thresholds_family_friend', () => {
    const { thresholds_family_friend, ...withoutFamily } = validCarAccidentDefault;
    const result = scoringConfigSchema.safeParse(withoutFamily);
    expect(result.success).toBe(false);
  });

  it('rejects missing hard_overrides_enabled key', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      hard_overrides_enabled: {
        missing_contact: true,
        out_of_scope: true,
        no_injury_no_treatment: true,
        // fake_info missing
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean hard_overrides_enabled values', () => {
    const result = scoringConfigSchema.safeParse({
      ...validCarAccidentDefault,
      hard_overrides_enabled: {
        missing_contact: 'yes' as unknown as boolean,
        out_of_scope: true,
        no_injury_no_treatment: true,
        fake_info: true,
      },
    });
    expect(result.success).toBe(false);
  });
});
