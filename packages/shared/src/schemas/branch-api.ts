/**
 * Zod schemas for the spec 016 Branches admin API surface.
 *
 * Maps directly to `contracts/branches-admin-api.md`. Every endpoint's
 * request and response body MUST round-trip these schemas at the
 * route-handler boundary (Constitution II).
 */

import { z } from 'zod';
import {
  branchQuestionSchema,
  branchSlugSchema,
  branchVersionSchema,
} from './branch.js';
import {
  hardOverridesEnabledSchema,
  thresholdsFamilyFriendSchema,
  thresholdsSelfSchema,
} from './sop.js';

// ---------------------------------------------------------------------------
// GET /api/admin/branches — list pairs with branch status
// ---------------------------------------------------------------------------

/** Per-pair branch summary surfaced to the dashboard list view. */
export const branchSummarySchema = z.object({
  id: z.string().min(1),
  is_active: z.boolean(),
  current_version_id: z.string().min(1).nullable(),
  version_number: z.number().int().positive().nullable(),
  questions_count: z.number().int().min(0),
  is_published: z.boolean(),
  updated_at: z.number().int(),
});
export type BranchSummary = z.infer<typeof branchSummarySchema>;

export const branchPairSummarySchema = z.object({
  case_type_slug: branchSlugSchema,
  case_type_label: z.string().min(1),
  sub_type_slug: branchSlugSchema,
  sub_type_label: z.string().min(1),
  branch: branchSummarySchema.nullable(),
});
export type BranchPairSummary = z.infer<typeof branchPairSummarySchema>;

export const branchesListResponseSchema = z.object({
  pairs: z.array(branchPairSummarySchema),
});
export type BranchesListResponse = z.infer<typeof branchesListResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/admin/branches/:caseTypeSlug/:subTypeSlug — per-pair detail
// ---------------------------------------------------------------------------

export const branchDetailResponseSchema = z.object({
  branch: z.object({
    id: z.string().min(1),
    case_type_slug: branchSlugSchema,
    sub_type_slug: branchSlugSchema,
    is_active: z.boolean(),
  }),
  current_version: branchVersionSchema.nullable(),
  draft_version: branchVersionSchema.nullable(),
});
export type BranchDetailResponse = z.infer<typeof branchDetailResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/admin/branches/:caseTypeSlug/:subTypeSlug — save draft
// ---------------------------------------------------------------------------

export const branchSaveRequestSchema = z
  .object({
    is_active: z.boolean(),
    questions: z.array(branchQuestionSchema),
    classification_thresholds: z.object({
      self: thresholdsSelfSchema,
      family_friend: thresholdsFamilyFriendSchema,
    }),
    hard_override_toggles: hardOverridesEnabledSchema,
  })
  .superRefine((req, ctx) => {
    // Question positions must form a contiguous 0-indexed sequence.
    const positions = req.questions.map((q) => q.position).sort((a, b) => a - b);
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Question positions must be a contiguous 0-indexed sequence; got ${positions.join(',')}`,
          path: ['questions'],
        });
        return;
      }
    }
  });
export type BranchSaveRequest = z.infer<typeof branchSaveRequestSchema>;

export const branchSaveWarningSchema = z.object({
  code: z.enum([
    'negative_total_max',
    'positive_total_max_above_100',
    'zero_questions',
  ]),
  message: z.string().min(1),
});
export type BranchSaveWarning = z.infer<typeof branchSaveWarningSchema>;

export const branchSaveResponseSchema = z.object({
  branch_id: z.string().min(1),
  draft_version_id: z.string().min(1),
  version_number: z.number().int().positive(),
  warnings: z.array(branchSaveWarningSchema),
});
export type BranchSaveResponse = z.infer<typeof branchSaveResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/admin/branches/:caseTypeSlug/:subTypeSlug/publish
// ---------------------------------------------------------------------------

export const branchPublishResponseSchema = z.object({
  branch_id: z.string().min(1),
  published_version_id: z.string().min(1),
  version_number: z.number().int().positive(),
  published_at: z.number().int(),
});
export type BranchPublishResponse = z.infer<typeof branchPublishResponseSchema>;
