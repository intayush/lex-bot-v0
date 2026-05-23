/**
 * Tests for the pure validation helpers used by the dashboard SOP-save route.
 *
 * Helpers under test (in `sop-config-validation.ts`):
 * - `validateSopSteps(steps)` — Zod-validated body has already produced
 *   well-typed steps; this layer enforces structural rules that Zod
 *   cannot express (slug uniqueness, position contiguity, chip_source
 *   coherence). Returns a discriminated `{ ok: true } | { ok: false; error }`.
 * - `validateThreshold(threshold, steps)` — threshold ≤ eligible step count.
 *
 * Pure functions — no DB, no IO. Tested in isolation so the Route Handler
 * stays mechanical (auth → Zod → these helpers → DB write).
 */
import { describe, it, expect } from 'vitest';
import {
  validateSopStepStructure,
  validateThreshold,
  type SopStepDraft,
} from './sop-config-validation';

const validStep = (overrides: Partial<SopStepDraft> = {}): SopStepDraft => ({
  slug: 'case_type',
  position: 1,
  question_text: 'What kind of legal matter?',
  chip_source: 'case_types',
  inline_chips_json: null,
  accepts_free_text: true,
  is_required: true,
  counts_toward_threshold: true,
  ...overrides,
});

describe('validateSopStepStructure', () => {
  it('accepts a single valid step', () => {
    const result = validateSopStepStructure([validStep()]);
    expect(result.ok).toBe(true);
  });

  it('accepts a 5-step default-shaped SOP', () => {
    const steps: SopStepDraft[] = [
      validStep({ slug: 'case_type', position: 1, chip_source: 'case_types' }),
      validStep({ slug: 'sub_type', position: 2, chip_source: 'sub_types' }),
      validStep({ slug: 'where', position: 3, chip_source: null }),
      validStep({ slug: 'what', position: 4, chip_source: null }),
      validStep({ slug: 'when', position: 5, chip_source: 'inline', inline_chips_json: '[{"label":"Today","slug":"today"}]' }),
    ];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(true);
  });

  it('rejects empty step list', () => {
    const result = validateSopStepStructure([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one step/i);
  });

  it('rejects duplicate slugs', () => {
    const steps = [
      validStep({ slug: 'case_type', position: 1 }),
      validStep({ slug: 'case_type', position: 2, chip_source: null }),
    ];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate slug/i);
  });

  it('rejects gaps in positions', () => {
    const steps = [
      validStep({ slug: 'a', position: 1 }),
      validStep({ slug: 'b', position: 3, chip_source: null }),
    ];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/position/i);
  });

  it('rejects duplicate positions', () => {
    const steps = [
      validStep({ slug: 'a', position: 1 }),
      validStep({ slug: 'b', position: 1, chip_source: null }),
    ];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/position/i);
  });

  it('rejects positions starting at 0 or negative', () => {
    const steps = [validStep({ position: 0 })];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
  });

  it('rejects chip_source=inline with null inline_chips_json', () => {
    const steps = [validStep({ chip_source: 'inline', inline_chips_json: null })];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/inline_chips_json/i);
  });

  it('rejects chip_source=inline with malformed JSON', () => {
    const steps = [validStep({ chip_source: 'inline', inline_chips_json: 'not json' })];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/inline_chips_json/i);
  });

  it('rejects chip_source=inline with JSON that is not an array of {label,slug}', () => {
    const steps = [validStep({ chip_source: 'inline', inline_chips_json: '{"label":"x"}' })];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
  });

  it('rejects step that is not free-text-accepting AND has no chip_source', () => {
    // Such a step would be unanswerable.
    const steps = [validStep({ chip_source: null, accepts_free_text: false })];
    const result = validateSopStepStructure(steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unanswerable|accepts_free_text|chip_source/i);
  });
});

describe('validateThreshold', () => {
  it('accepts threshold == eligible step count', () => {
    const steps = [
      validStep({ slug: 'a', position: 1, counts_toward_threshold: true }),
      validStep({ slug: 'b', position: 2, counts_toward_threshold: true, chip_source: null }),
    ];
    expect(validateThreshold(2, steps).ok).toBe(true);
  });

  it('accepts threshold < eligible step count', () => {
    const steps = [
      validStep({ slug: 'a', position: 1, counts_toward_threshold: true }),
      validStep({ slug: 'b', position: 2, counts_toward_threshold: true, chip_source: null }),
      validStep({ slug: 'c', position: 3, counts_toward_threshold: true, chip_source: null }),
    ];
    expect(validateThreshold(2, steps).ok).toBe(true);
  });

  it('rejects threshold > eligible step count', () => {
    const steps = [
      validStep({ slug: 'a', position: 1, counts_toward_threshold: true }),
      validStep({ slug: 'b', position: 2, counts_toward_threshold: false, chip_source: null }),
    ];
    const result = validateThreshold(2, steps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/threshold/i);
  });

  it('rejects threshold of 0 or less', () => {
    const steps = [validStep()];
    expect(validateThreshold(0, steps).ok).toBe(false);
    expect(validateThreshold(-1, steps).ok).toBe(false);
  });

  it('counts only counts_toward_threshold=true', () => {
    const steps = [
      validStep({ slug: 'a', position: 1, counts_toward_threshold: false }),
      validStep({ slug: 'b', position: 2, counts_toward_threshold: false, chip_source: null }),
      validStep({ slug: 'c', position: 3, counts_toward_threshold: true, chip_source: null }),
    ];
    expect(validateThreshold(1, steps).ok).toBe(true);
    expect(validateThreshold(2, steps).ok).toBe(false);
  });
});
