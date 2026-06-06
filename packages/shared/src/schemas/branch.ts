/**
 * Zod schemas for the spec 016 multi-branch SOP workflow.
 *
 * A Branch is a per-(case_type_slug, sub_type_slug) configurable
 * workflow that fires AFTER the default SOP's Step 6 (contact)
 * satisfies. At most one active Branch may exist per pair
 * (FR-009). Pre-existing spec 015 scoring configurations are
 * subsumed by this model (FR-029); the seeded
 * `(personal_injury, car_accident)` pair is migrated forward
 * (FR-016).
 *
 * See also:
 *  - specs/016-multi-branch-sop/data-model.md (entities)
 *  - specs/016-multi-branch-sop/contracts/branch-runtime-contract.md
 *  - packages/shared/src/schemas/sop.ts (`chipSchema`,
 *    `scoringConfigSchema` — re-used for thresholds/toggles)
 */

import { z } from 'zod';
import {
  chipSchema,
  hardOverridesEnabledSchema,
  thresholdsFamilyFriendSchema,
  thresholdsSelfSchema,
} from './sop.js';

// ---------------------------------------------------------------------------
// Slug primitive (matches the constitution-mandated chip-slug regex; per
// data-model.md and contracts/branches-admin-api.md validation rules)
// ---------------------------------------------------------------------------

/**
 * Lowercase ASCII slug used by Branch chips and questions. Stored on
 * the wire, in JSON snapshots, and emitted in structured logs (Constitution
 * V — chip slugs are PII-free machine identifiers).
 */
export const branchSlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_-]+$/u, {
    message: 'Branch slug must be lowercase alphanumeric with - or _ only',
  });
export type BranchSlug = z.infer<typeof branchSlugSchema>;

// ---------------------------------------------------------------------------
// Branch Chip — a single selectable option within a Branch Question
// ---------------------------------------------------------------------------

/**
 * A chip rendered for a branch question. Reuses the existing
 * `chipSchema` (which already carries an optional `score_weight`
 * from spec 015) but tightens two rules for branch use:
 *  - `score_weight` is REQUIRED (FR-015 — branches are scoring
 *    workflows, every chip must declare its contribution).
 *  - The label/slug rules from the existing chip schema apply
 *    unchanged.
 *
 * `weight` semantics per FR-015:
 *  - May be negative (penalty) or zero.
 *  - Single-select: contribution = the selected chip's weight.
 *  - Multi-select: contribution = sum of selected chips' weights.
 */
export const branchChipSchema = chipSchema.extend({
  score_weight: z.number().int().min(-50).max(50),
});
export type BranchChip = z.infer<typeof branchChipSchema>;

// ---------------------------------------------------------------------------
// Branch Question — an ordered question within a Branch
// ---------------------------------------------------------------------------

export const branchQuestionSchema = z
  .object({
    /** Stable across versions when admins edit without delete-recreate. */
    id: z.string().min(1),
    /** Order within the branch (0-indexed). */
    position: z.number().int().min(0),
    /** Prompt text the assistant emits. */
    text: z.string().min(1).max(500),
    /** Optional lead-in text rendered before the question. */
    preface: z.string().min(1).max(500).nullable(),
    /** Chips the visitor can tap. May be empty only if free text is allowed. */
    chips: z.array(branchChipSchema),
    /** Whether free-text input is accepted in addition to chips. */
    free_text_allowed: z.boolean(),
    /** Single- vs multi-select chip behaviour (matches spec 015 questions). */
    multi_select: z.boolean(),
  })
  .superRefine((q, ctx) => {
    // FR-014: chips may only be empty when free text is allowed.
    if (q.chips.length === 0 && !q.free_text_allowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'A branch question with no chips must allow free-text input',
        path: ['chips'],
      });
    }

    // Chip slugs must be unique within a question (data-model.md).
    const slugs = q.chips.map((c) => c.slug);
    const dup = slugs.find((s, i) => slugs.indexOf(s) !== i);
    if (dup !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate chip slug "${dup}" within question "${q.id}"`,
        path: ['chips'],
      });
    }
  });
export type BranchQuestion = z.infer<typeof branchQuestionSchema>;

// ---------------------------------------------------------------------------
// BranchVersion — an immutable snapshot of a Branch's configuration
// ---------------------------------------------------------------------------

/**
 * Each Save creates a new BranchVersion. Publish updates the parent
 * Branch's `current_version_id` to point at this row (FR-017).
 * In-flight conversations pin to the version row in effect when the
 * branch first activated (FR-031, research.md R7).
 */
export const branchVersionSchema = z.object({
  id: z.string().min(1),
  branch_id: z.string().min(1),
  version_number: z.number().int().positive(),
  is_published: z.boolean(),
  questions: z.array(branchQuestionSchema),
  classification_thresholds: z.object({
    self: thresholdsSelfSchema,
    family_friend: thresholdsFamilyFriendSchema,
  }),
  hard_override_toggles: hardOverridesEnabledSchema,
  published_at: z.number().int().nullable(),
  created_at: z.number().int(),
  created_by_user_id: z.string().min(1),
});
export type BranchVersion = z.infer<typeof branchVersionSchema>;

// ---------------------------------------------------------------------------
// Branch — the parent record per (account_id, case_type_slug, sub_type_slug)
// ---------------------------------------------------------------------------

export const branchSchema = z.object({
  id: z.string().min(1),
  account_id: z.string().min(1),
  case_type_slug: branchSlugSchema,
  sub_type_slug: branchSlugSchema,
  is_active: z.boolean(),
  current_version_id: z.string().min(1).nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
});
export type Branch = z.infer<typeof branchSchema>;

// ---------------------------------------------------------------------------
// BranchSnapshot — frozen on the lead row at finalization (FR-018)
// ---------------------------------------------------------------------------

/**
 * Per-question chip selections captured at finalization (or at
 * mid-flow abandonment per FR-011a). May be an empty array for
 * partial-branch leads where the visitor abandoned before tapping
 * any chip.
 */
export const capturedChipSchema = z.object({
  question_id: z.string().min(1),
  chip_slugs: z.array(branchSlugSchema),
});
export type CapturedChip = z.infer<typeof capturedChipSchema>;

export const capturedFreeTextSchema = z.object({
  question_id: z.string().min(1),
  text: z.string(),
});
export type CapturedFreeText = z.infer<typeof capturedFreeTextSchema>;

/**
 * Frozen branch payload + captured visitor inputs + scorer result.
 * Materialized into `leads.branch_snapshot_json` and survives branch
 * deletion (FR-018). Denormalized fields (`case_type_slug`,
 * `sub_type_slug`, `version_number`) enable historical filtering and
 * human-readable rendering without a live join.
 */
export const branchSnapshotSchema = z.object({
  branch_id: z.string().min(1),
  branch_version_id: z.string().min(1),
  version_number: z.number().int().positive(),
  case_type_slug: branchSlugSchema,
  sub_type_slug: branchSlugSchema,
  questions_snapshot: z.array(branchQuestionSchema),
  captured_chips: z.array(capturedChipSchema),
  captured_free_text: z.array(capturedFreeTextSchema),
  score: z.number().int().min(0).max(100),
  classification: z.enum(['HOT', 'WARM', 'COLD', 'SPAM']),
  reasons: z.array(z.string()),
  branch_incomplete: z.boolean(),
  finalized_at: z.number().int(),
});
export type BranchSnapshot = z.infer<typeof branchSnapshotSchema>;

