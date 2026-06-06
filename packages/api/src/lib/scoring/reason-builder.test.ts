import { describe, expect, it } from 'vitest';

import {
  buildReasons,
  type HardOverrideName,
} from './reason-builder.js';
import type { CapturedScoringChip } from './score-lead.js';

const chip = (
  step_slug: string,
  chip_slug: string,
  chip_label: string,
  score_weight: number,
): CapturedScoringChip => ({ step_slug, chip_slug, chip_label, score_weight });

describe('buildReasons — chip inclusion (FR-010a |w| ≥ 5 rule)', () => {
  it('includes a chip with positive weight ≥ 5', () => {
    const reasons = buildReasons([chip('accident_timing', 'today', 'Today', 20)], []);
    expect(reasons).toEqual(['Today']);
  });

  it('includes a chip with negative weight ≤ −5', () => {
    const reasons = buildReasons([chip('injury', 'injury_no', 'No', -20)], []);
    expect(reasons).toEqual(['No']);
  });

  it('includes a chip with exactly weight 5', () => {
    const reasons = buildReasons(
      [chip('accident_timing', 'within_last_6_months', 'Within Last 6 Months', 5)],
      [],
    );
    expect(reasons).toEqual(['Within Last 6 Months']);
  });

  it('includes a chip with exactly weight −5', () => {
    const reasons = buildReasons(
      [chip('something', 'mild_negative', 'Mild Negative', -5)],
      [],
    );
    expect(reasons).toEqual(['Mild Negative']);
  });

  it('excludes a chip with weight 4 (just below threshold)', () => {
    const reasons = buildReasons([chip('something', 'minor', 'Minor', 4)], []);
    expect(reasons).toEqual([]);
  });

  it('excludes a chip with weight −4', () => {
    const reasons = buildReasons([chip('something', 'minor_neg', 'Minor Negative', -4)], []);
    expect(reasons).toEqual([]);
  });

  it('excludes a 0-weight "I Don\'t Know" chip', () => {
    const reasons = buildReasons(
      [chip('accident_timing', 'i_dont_know', "I Don't Know", 0)],
      [],
    );
    expect(reasons).toEqual([]);
  });
});

describe('buildReasons — chip ordering follows scored_chips order (FR-010a)', () => {
  it('preserves the order of input chips', () => {
    const reasons = buildReasons(
      [
        chip('accident_timing', 'today', 'Today', 20),
        chip('injury', 'injury_yes', 'Yes', 15),
        chip('medical_treatment', 'er_visit', 'Emergency Room Visit', 15),
      ],
      [],
    );
    expect(reasons).toEqual(['Today', 'Yes', 'Emergency Room Visit']);
  });
});

describe('buildReasons — hard-override appending (FR-010a, FR-008)', () => {
  it('appends a single hard-override after chip phrases', () => {
    const reasons = buildReasons(
      [chip('accident_timing', 'today', 'Today', 20)],
      ['missing_contact'],
    );
    expect(reasons).toEqual(['Today', 'missing_contact']);
  });

  it('appends overrides in fixed order regardless of input ordering', () => {
    const reasons = buildReasons(
      [],
      [
        // Input ordering deliberately reversed
        'fake_info',
        'no_injury_no_treatment',
        'out_of_scope',
        'missing_contact',
      ] as HardOverrideName[],
    );
    expect(reasons).toEqual([
      'missing_contact',
      'out_of_scope',
      'no_injury_no_treatment',
      'fake_info',
    ]);
  });

  it('appends only the overrides that fired, not all four', () => {
    const reasons = buildReasons([], ['missing_contact', 'fake_info']);
    expect(reasons).toEqual(['missing_contact', 'fake_info']);
  });

  it('combines chips + multiple overrides in correct order', () => {
    const reasons = buildReasons(
      [
        chip('accident_timing', 'today', 'Today', 20),
        chip('injury', 'injury_no', 'No', -20),
      ],
      ['no_injury_no_treatment', 'missing_contact'],
    );
    // Chips first (in input order), then overrides in fixed order:
    // missing_contact > out_of_scope > no_injury_no_treatment > fake_info
    expect(reasons).toEqual([
      'Today',
      'No',
      'missing_contact',
      'no_injury_no_treatment',
    ]);
  });
});

describe('buildReasons — empty inputs', () => {
  it('returns [] for no chips and no overrides', () => {
    expect(buildReasons([], [])).toEqual([]);
  });

  it('returns ["scoring_error"] only when caller passes that as the override', () => {
    // FR-010b sentinel — caller decides; reason-builder is a pure
    // phrase-renderer, it doesn't synthesize the sentinel itself.
    const reasons = buildReasons(
      [],
      ['scoring_error'] as unknown as HardOverrideName[],
    );
    expect(reasons).toEqual(['scoring_error']);
  });
});
