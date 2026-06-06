import { describe, expect, it } from 'vitest';

import type { LeadClassification, ScoringConfig } from '@legal-chatbot/shared';

import {
  legacyClassificationToNew,
  scoreToClassification,
} from './classification-mapper.js';

const carAccidentDefaultConfig: ScoringConfig = {
  schema_version: 1,
  thresholds_self: {
    hot: [76, 100],
    warm: [51, 75],
    cold: [26, 50],
    spam: [0, 25],
  },
  thresholds_family_friend: {
    hot: [76, 100],
    warm: [26, 75],
    spam: [0, 25],
  },
  hard_overrides_enabled: {
    missing_contact: true,
    out_of_scope: true,
    no_injury_no_treatment: true,
    fake_info: true,
  },
};

describe('scoreToClassification — Self table boundaries (FR-038)', () => {
  it.each<[number, LeadClassification]>([
    [0, 'SPAM'],
    [25, 'SPAM'],
    [26, 'COLD'],
    [50, 'COLD'],
    [51, 'WARM'],
    [75, 'WARM'],
    [76, 'HOT'],
    [100, 'HOT'],
  ])('Self: score %i → %s', (score, expected) => {
    expect(
      scoreToClassification(score, 'SELF', carAccidentDefaultConfig),
    ).toBe(expected);
  });
});

describe('scoreToClassification — Family/Friend table boundaries (FR-039)', () => {
  it.each<[number, LeadClassification]>([
    [0, 'SPAM'],
    [25, 'SPAM'],
    [26, 'WARM'], // No COLD bucket; jumps from SPAM → WARM
    [50, 'WARM'],
    [75, 'WARM'],
    [76, 'HOT'],
    [100, 'HOT'],
  ])('Family/Friend: score %i → %s', (score, expected) => {
    expect(
      scoreToClassification(
        score,
        'FRIEND_FAMILY',
        carAccidentDefaultConfig,
      ),
    ).toBe(expected);
  });
});

describe('scoreToClassification — defaults to Self table when requestType is null', () => {
  it('null requestType, score 35 → COLD (Self table)', () => {
    expect(
      scoreToClassification(35, null, carAccidentDefaultConfig),
    ).toBe('COLD');
  });

  it('null requestType, score 80 → HOT (Self table)', () => {
    expect(
      scoreToClassification(80, null, carAccidentDefaultConfig),
    ).toBe('HOT');
  });
});

describe('scoreToClassification — boundary inclusivity (FR-040)', () => {
  it('Self: score equal to upper bound stays in lower classification', () => {
    // SPAM bucket is [0,25]; 25 is SPAM (inclusive upper bound).
    expect(
      scoreToClassification(25, 'SELF', carAccidentDefaultConfig),
    ).toBe('SPAM');
    // COLD bucket is [26,50]; 26 is COLD.
    expect(
      scoreToClassification(26, 'SELF', carAccidentDefaultConfig),
    ).toBe('COLD');
  });
});

describe('scoreToClassification — non-default thresholds', () => {
  it('honors a custom Self HOT lower bound (US3 acceptance scenario)', () => {
    // Admin moves HOT lower bound to 80; score 78 lands in WARM.
    const customConfig: ScoringConfig = {
      ...carAccidentDefaultConfig,
      thresholds_self: {
        hot: [80, 100],
        warm: [51, 79],
        cold: [26, 50],
        spam: [0, 25],
      },
    };
    expect(scoreToClassification(78, 'SELF', customConfig)).toBe('WARM');
    expect(scoreToClassification(80, 'SELF', customConfig)).toBe('HOT');
  });
});

describe('legacyClassificationToNew — migration mapping (FR-031)', () => {
  it.each<[string, LeadClassification]>([
    ['urgent', 'HOT'],
    ['normal', 'WARM'],
    ['unqualified', 'SPAM'],
  ])('%s → %s', (legacy, expected) => {
    expect(legacyClassificationToNew(legacy)).toBe(expected);
  });

  it('returns null for unknown legacy values (defensive)', () => {
    expect(legacyClassificationToNew('something_else')).toBeNull();
    expect(legacyClassificationToNew('')).toBeNull();
  });

  it('passes through new-vocabulary values unchanged', () => {
    // Migration helper should be safe to call on a row that's already
    // been migrated (idempotent).
    expect(legacyClassificationToNew('HOT')).toBe('HOT');
    expect(legacyClassificationToNew('WARM')).toBe('WARM');
    expect(legacyClassificationToNew('COLD')).toBe('COLD');
    expect(legacyClassificationToNew('SPAM')).toBe('SPAM');
  });
});
