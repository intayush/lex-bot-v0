/**
 * Tests for spec 016 Branches admin API request/response schemas.
 *
 * Covers task T004. Maps each schema to the contract in
 * `contracts/branches-admin-api.md`.
 */

import { describe, expect, it } from 'vitest';
import {
  branchDetailResponseSchema,
  branchPublishResponseSchema,
  branchSaveRequestSchema,
  branchSaveResponseSchema,
  branchesListResponseSchema,
} from './branch-api.js';

const validQuestion = {
  id: 'q1',
  position: 0,
  text: 'Question text',
  preface: null,
  chips: [
    { label: 'A', slug: 'a', score_weight: 10 },
    { label: 'B', slug: 'b', score_weight: 5 },
  ],
  free_text_allowed: false,
  multi_select: false,
};

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

// ---------------------------------------------------------------------------
// branchesListResponseSchema
// ---------------------------------------------------------------------------

describe('branchesListResponseSchema', () => {
  it('accepts an empty pair list', () => {
    expect(branchesListResponseSchema.safeParse({ pairs: [] }).success).toBe(true);
  });

  it('accepts pairs with and without configured branches', () => {
    const valid = {
      pairs: [
        {
          case_type_slug: 'personal_injury',
          case_type_label: 'Personal Injury',
          sub_type_slug: 'car_accident',
          sub_type_label: 'Car Accident',
          branch: {
            id: 'br_abc',
            is_active: true,
            current_version_id: 'bv_xyz',
            version_number: 3,
            questions_count: 8,
            is_published: true,
            updated_at: 1717689600000,
          },
        },
        {
          case_type_slug: 'criminal_defense',
          case_type_label: 'Criminal Defense',
          sub_type_slug: 'assault_charges',
          sub_type_label: 'Assault Charges',
          branch: null,
        },
      ],
    };
    expect(branchesListResponseSchema.safeParse(valid).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// branchDetailResponseSchema
// ---------------------------------------------------------------------------

describe('branchDetailResponseSchema', () => {
  const validVersion = {
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

  it('accepts a published-only payload (no draft)', () => {
    const valid = {
      branch: {
        id: 'br_abc',
        case_type_slug: 'personal_injury',
        sub_type_slug: 'car_accident',
        is_active: true,
      },
      current_version: validVersion,
      draft_version: null,
    };
    expect(branchDetailResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts both current and draft versions', () => {
    const valid = {
      branch: {
        id: 'br_abc',
        case_type_slug: 'personal_injury',
        sub_type_slug: 'car_accident',
        is_active: true,
      },
      current_version: validVersion,
      draft_version: { ...validVersion, id: 'bv_draft', version_number: 2, is_published: false, published_at: null },
    };
    expect(branchDetailResponseSchema.safeParse(valid).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// branchSaveRequestSchema
// ---------------------------------------------------------------------------

describe('branchSaveRequestSchema', () => {
  const valid = {
    is_active: true,
    questions: [validQuestion],
    classification_thresholds: {
      self: validThresholdsSelf,
      family_friend: validThresholdsFamily,
    },
    hard_override_toggles: validHardOverrides,
  };

  it('accepts a valid save payload', () => {
    expect(branchSaveRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects gappy question positions (FR-014)', () => {
    const broken = {
      ...valid,
      questions: [
        { ...validQuestion, id: 'q0', position: 0 },
        { ...validQuestion, id: 'q1', position: 2 }, // gap at 1
      ],
    };
    expect(branchSaveRequestSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts empty questions array (admin saves an empty branch first)', () => {
    expect(
      branchSaveRequestSchema.safeParse({ ...valid, questions: [] }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// branchSaveResponseSchema and branchPublishResponseSchema
// ---------------------------------------------------------------------------

describe('branchSaveResponseSchema', () => {
  it('accepts a save response with warnings', () => {
    const valid = {
      branch_id: 'br_abc',
      draft_version_id: 'bv_new',
      version_number: 4,
      warnings: [
        { code: 'negative_total_max' as const, message: 'Max is below 0' },
      ],
    };
    expect(branchSaveResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a save response with empty warnings array', () => {
    expect(
      branchSaveResponseSchema.safeParse({
        branch_id: 'br_abc',
        draft_version_id: 'bv_new',
        version_number: 4,
        warnings: [],
      }).success,
    ).toBe(true);
  });

  it('rejects unknown warning codes', () => {
    const bad = {
      branch_id: 'br_abc',
      draft_version_id: 'bv_new',
      version_number: 4,
      warnings: [{ code: 'made_up_code', message: 'x' }],
    };
    expect(branchSaveResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('branchPublishResponseSchema', () => {
  it('accepts a valid publish response', () => {
    const valid = {
      branch_id: 'br_abc',
      published_version_id: 'bv_xyz',
      version_number: 4,
      published_at: 1717689600000,
    };
    expect(branchPublishResponseSchema.safeParse(valid).success).toBe(true);
  });
});
