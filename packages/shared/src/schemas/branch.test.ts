/**
 * Tests for spec 016 multi-branch SOP Zod schemas.
 *
 * Covers tasks T002 (chip + question) and T003 (branch + version +
 * snapshot). Each test corresponds to a validation rule called out
 * in the schema's JSDoc and in data-model.md.
 */

import { describe, expect, it } from 'vitest';
import {
  branchChipSchema,
  branchQuestionSchema,
  branchSchema,
  branchSlugSchema,
  branchSnapshotSchema,
  branchVersionSchema,
} from './branch.js';

// ---------------------------------------------------------------------------
// branchSlugSchema (T002)
// ---------------------------------------------------------------------------

describe('branchSlugSchema', () => {
  it('accepts lowercase alphanumeric with - and _', () => {
    expect(branchSlugSchema.safeParse('car_accident').success).toBe(true);
    expect(branchSlugSchema.safeParse('first-offense').success).toBe(true);
    expect(branchSlugSchema.safeParse('q1').success).toBe(true);
  });

  it('rejects uppercase, spaces, and other punctuation', () => {
    expect(branchSlugSchema.safeParse('Car_Accident').success).toBe(false);
    expect(branchSlugSchema.safeParse('car accident').success).toBe(false);
    expect(branchSlugSchema.safeParse('car.accident').success).toBe(false);
  });

  it('rejects empty and oversized strings', () => {
    expect(branchSlugSchema.safeParse('').success).toBe(false);
    expect(branchSlugSchema.safeParse('a'.repeat(81)).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// branchChipSchema (T002)
// ---------------------------------------------------------------------------

describe('branchChipSchema', () => {
  const valid = { label: 'Driver', slug: 'driver', score_weight: 10 };

  it('accepts a fully-specified chip', () => {
    expect(branchChipSchema.safeParse(valid).success).toBe(true);
  });

  it('requires score_weight (FR-015 — branches must declare contributions)', () => {
    const { score_weight: _omit, ...without } = valid;
    expect(branchChipSchema.safeParse(without).success).toBe(false);
  });

  it('accepts negative and zero weights (FR-015)', () => {
    expect(
      branchChipSchema.safeParse({ ...valid, score_weight: -25 }).success,
    ).toBe(true);
    expect(
      branchChipSchema.safeParse({ ...valid, score_weight: 0 }).success,
    ).toBe(true);
  });

  it('rejects non-integer weights', () => {
    expect(
      branchChipSchema.safeParse({ ...valid, score_weight: 5.5 }).success,
    ).toBe(false);
  });

  it('rejects oversized labels (>100 chars from chipSchema)', () => {
    expect(
      branchChipSchema.safeParse({ ...valid, label: 'a'.repeat(101) }).success,
    ).toBe(false);
  });

  it('rejects bad slugs', () => {
    expect(
      branchChipSchema.safeParse({ ...valid, slug: 'Driver' }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// branchQuestionSchema (T002)
// ---------------------------------------------------------------------------

describe('branchQuestionSchema', () => {
  const validChip = { label: 'Driver', slug: 'driver', score_weight: 10 };
  const validQuestion = {
    id: 'q_role',
    position: 0,
    text: 'Were you a driver or passenger?',
    preface: null,
    chips: [validChip, { label: 'Passenger', slug: 'passenger', score_weight: 8 }],
    free_text_allowed: false,
    multi_select: false,
  };

  it('accepts a valid question', () => {
    expect(branchQuestionSchema.safeParse(validQuestion).success).toBe(true);
  });

  it('rejects empty chip list when free text is not allowed (FR-014)', () => {
    expect(
      branchQuestionSchema.safeParse({
        ...validQuestion,
        chips: [],
        free_text_allowed: false,
      }).success,
    ).toBe(false);
  });

  it('accepts empty chip list when free text IS allowed', () => {
    expect(
      branchQuestionSchema.safeParse({
        ...validQuestion,
        chips: [],
        free_text_allowed: true,
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate chip slugs within a question', () => {
    expect(
      branchQuestionSchema.safeParse({
        ...validQuestion,
        chips: [validChip, validChip],
      }).success,
    ).toBe(false);
  });

  it('rejects negative position', () => {
    expect(
      branchQuestionSchema.safeParse({ ...validQuestion, position: -1 }).success,
    ).toBe(false);
  });

  it('accepts zero position (0-indexed)', () => {
    expect(
      branchQuestionSchema.safeParse({ ...validQuestion, position: 0 }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixtures shared across the T003 schema tests below
// ---------------------------------------------------------------------------

const validThresholdsSelf = {
  hot: [76, 100] as [number, number],
  warm: [51, 75] as [number, number],
  cold: [26, 50] as [number, number],
  spam: [0, 25] as [number, number],
};

const validThresholdsFamily = {
  hot: [71, 100] as [number, number],
  warm: [46, 70] as [number, number],
  spam: [0, 45] as [number, number],
};

const validHardOverrides = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

const validQuestion = {
  id: 'q_role',
  position: 0,
  text: 'Were you a driver or passenger?',
  preface: null,
  chips: [
    { label: 'Driver', slug: 'driver', score_weight: 10 },
    { label: 'Passenger', slug: 'passenger', score_weight: 8 },
  ],
  free_text_allowed: false,
  multi_select: false,
};

// ---------------------------------------------------------------------------
// branchVersionSchema (T003)
// ---------------------------------------------------------------------------

describe('branchVersionSchema', () => {
  const valid = {
    id: 'bv_xyz',
    branch_id: 'br_abc',
    version_number: 1,
    is_published: true,
    questions: [validQuestion],
    classification_thresholds: {
      self: validThresholdsSelf,
      family_friend: validThresholdsFamily,
    },
    hard_override_toggles: validHardOverrides,
    published_at: 1717689600000,
    created_at: 1717689500000,
    created_by_user_id: 'u_admin',
  };

  it('accepts a valid version', () => {
    expect(branchVersionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects non-positive version_number', () => {
    expect(
      branchVersionSchema.safeParse({ ...valid, version_number: 0 }).success,
    ).toBe(false);
    expect(
      branchVersionSchema.safeParse({ ...valid, version_number: -1 }).success,
    ).toBe(false);
  });

  it('allows published_at to be null on draft versions', () => {
    expect(
      branchVersionSchema.safeParse({ ...valid, published_at: null }).success,
    ).toBe(true);
  });

  it('rejects threshold tables with gaps', () => {
    const broken = {
      ...valid,
      classification_thresholds: {
        self: {
          hot: [76, 100] as [number, number],
          warm: [51, 70] as [number, number], // gap 71–75
          cold: [26, 50] as [number, number],
          spam: [0, 25] as [number, number],
        },
        family_friend: validThresholdsFamily,
      },
    };
    expect(branchVersionSchema.safeParse(broken).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// branchSchema (T003)
// ---------------------------------------------------------------------------

describe('branchSchema', () => {
  const valid = {
    id: 'br_abc',
    account_id: 'firm_001',
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    is_active: true,
    current_version_id: 'bv_xyz',
    created_at: 1717689500000,
    updated_at: 1717689600000,
  };

  it('accepts a valid branch', () => {
    expect(branchSchema.safeParse(valid).success).toBe(true);
  });

  it('allows current_version_id to be null (branch with only drafts)', () => {
    expect(
      branchSchema.safeParse({ ...valid, current_version_id: null }).success,
    ).toBe(true);
  });

  it('rejects malformed slugs', () => {
    expect(
      branchSchema.safeParse({ ...valid, case_type_slug: 'Personal Injury' }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// branchSnapshotSchema (T003)
// ---------------------------------------------------------------------------

describe('branchSnapshotSchema', () => {
  const valid = {
    branch_id: 'br_abc',
    branch_version_id: 'bv_xyz',
    version_number: 1,
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    questions_snapshot: [validQuestion],
    captured_chips: [{ question_id: 'q_role', chip_slugs: ['driver'] }],
    captured_free_text: [],
    score: 87,
    classification: 'HOT' as const,
    reasons: ['Driver', 'Today'],
    branch_incomplete: false,
    finalized_at: 1717689600000,
  };

  it('accepts a valid snapshot', () => {
    expect(branchSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a partial-branch snapshot (FR-011a)', () => {
    expect(
      branchSnapshotSchema.safeParse({
        ...valid,
        captured_chips: [],
        score: 0,
        classification: 'SPAM',
        reasons: [],
        branch_incomplete: true,
      }).success,
    ).toBe(true);
  });

  it('rejects score outside 0–100', () => {
    expect(branchSnapshotSchema.safeParse({ ...valid, score: -1 }).success).toBe(false);
    expect(branchSnapshotSchema.safeParse({ ...valid, score: 101 }).success).toBe(false);
  });

  it('rejects unknown classification value', () => {
    expect(
      branchSnapshotSchema.safeParse({ ...valid, classification: 'URGENT' }).success,
    ).toBe(false);
  });

  it('round-trips JSON-stringify identically', () => {
    const json = JSON.stringify(valid);
    const parsed = branchSnapshotSchema.safeParse(JSON.parse(json));
    expect(parsed.success).toBe(true);
  });
});

