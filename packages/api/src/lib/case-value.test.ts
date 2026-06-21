/**
 * Tests for case-value.ts — 025-case-value-estimator T009.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveCaseValueBadge,
  formatCaseValueBadge,
  formatCaseValueAmount,
} from './case-value.js';
import type { CaseValueConfig } from '@legal-chatbot/shared';

const THREE_BAND_CONFIG: CaseValueConfig = {
  bands: [
    { score_min: 76, score_max: 100, value_min_usd: 75000,  value_max_usd: 250000, position: 0 },
    { score_min: 51, score_max: 75,  value_min_usd: 15000,  value_max_usd: 75000,  position: 1 },
    { score_min: 26, score_max: 50,  value_min_usd: 3000,   value_max_usd: 15000,  position: 2 },
  ],
};

// ---------------------------------------------------------------------------
// formatCaseValueAmount
// ---------------------------------------------------------------------------

describe('formatCaseValueAmount', () => {
  it('formats millions', () => expect(formatCaseValueAmount(1_000_000)).toBe('$1M'));
  it('formats millions with decimal', () => expect(formatCaseValueAmount(1_500_000)).toBe('$1.5M'));
  it('formats thousands', () => expect(formatCaseValueAmount(75_000)).toBe('$75K'));
  it('formats thousands with decimal', () => expect(formatCaseValueAmount(1_500)).toBe('$1.5K'));
  it('formats sub-thousand', () => expect(formatCaseValueAmount(500)).toBe('$500'));
  it('formats zero', () => expect(formatCaseValueAmount(0)).toBe('$0'));
});

// ---------------------------------------------------------------------------
// formatCaseValueBadge
// ---------------------------------------------------------------------------

describe('formatCaseValueBadge', () => {
  it('formats a range', () => expect(formatCaseValueBadge(75000, 250000)).toBe('$75K – $250K'));
  it('formats single value when min === max', () => expect(formatCaseValueBadge(50000, 50000)).toBe('$50K'));
  it('formats M range', () => expect(formatCaseValueBadge(200000, 1000000)).toBe('$200K – $1M'));
  it('formats $1.5K–$8K', () => expect(formatCaseValueBadge(1500, 8000)).toBe('$1.5K – $8K'));
});

// ---------------------------------------------------------------------------
// resolveCaseValueBadge
// ---------------------------------------------------------------------------

describe('resolveCaseValueBadge', () => {
  it('returns null when enabled = false', () => {
    expect(resolveCaseValueBadge(80, THREE_BAND_CONFIG, false)).toBeNull();
  });

  it('returns null when config = null', () => {
    expect(resolveCaseValueBadge(80, null, true)).toBeNull();
  });

  it('returns null when leadScore = null', () => {
    expect(resolveCaseValueBadge(null, THREE_BAND_CONFIG, true)).toBeNull();
  });

  it('returns correct band for HOT score (80)', () => {
    expect(resolveCaseValueBadge(80, THREE_BAND_CONFIG, true)).toBe('$75K – $250K');
  });

  it('returns correct band for WARM score (60)', () => {
    expect(resolveCaseValueBadge(60, THREE_BAND_CONFIG, true)).toBe('$15K – $75K');
  });

  it('returns correct band for COLD score (40)', () => {
    expect(resolveCaseValueBadge(40, THREE_BAND_CONFIG, true)).toBe('$3K – $15K');
  });

  it('returns null when score is below all bands (e.g. SPAM score 10)', () => {
    expect(resolveCaseValueBadge(10, THREE_BAND_CONFIG, true)).toBeNull();
  });

  it('returns null when score is above all bands', () => {
    const config: CaseValueConfig = {
      bands: [{ score_min: 26, score_max: 75, value_min_usd: 5000, value_max_usd: 10000, position: 0 }],
    };
    expect(resolveCaseValueBadge(80, config, true)).toBeNull();
  });

  it('uses first matching band when bands are ordered by position', () => {
    const config: CaseValueConfig = {
      bands: [
        { score_min: 50, score_max: 100, value_min_usd: 100, value_max_usd: 200, position: 1 },
        { score_min: 76, score_max: 100, value_min_usd: 999, value_max_usd: 999, position: 0 },
      ],
    };
    // position 0 band covers 76-100, so score 80 → $999 (single value)
    expect(resolveCaseValueBadge(80, config, true)).toBe('$999');
  });

  it('returns null for empty bands array', () => {
    expect(resolveCaseValueBadge(80, { bands: [] }, true)).toBeNull();
  });

  it('handles boundary scores (score_min inclusive)', () => {
    expect(resolveCaseValueBadge(76, THREE_BAND_CONFIG, true)).toBe('$75K – $250K');
  });

  it('handles boundary scores (score_max inclusive)', () => {
    expect(resolveCaseValueBadge(100, THREE_BAND_CONFIG, true)).toBe('$75K – $250K');
  });

  it('SPAM exclusion: caller passes enabled=false for SPAM leads', () => {
    // The caller is responsible for passing enabled=false when classification === 'SPAM'
    expect(resolveCaseValueBadge(10, THREE_BAND_CONFIG, false)).toBeNull();
  });
});
