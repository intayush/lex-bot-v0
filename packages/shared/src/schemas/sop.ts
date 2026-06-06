import { z } from 'zod';

/**
 * SOP Workflow shared schemas (010-sop-workflow).
 *
 * These types describe the SOP runtime state, persistent SOP configuration,
 * case-type and sub-type chip data, goodbye phrases, and the compact wire
 * shape sent to the chat widget via the `x-sop-state` response header.
 *
 * Source of truth: `specs/010-sop-workflow/data-model.md` and
 * `specs/010-sop-workflow/contracts/sop-state-contract.md`.
 */

// ---------------------------------------------------------------------------
// Slug / position primitives
// ---------------------------------------------------------------------------

/** Lowercase machine identifier: `[a-z][a-z0-9_]*`. */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be lowercase snake_case starting with a letter');

/** 1-based ordinal used to display ordered lists in the UI. */
export const positionSchema = z.number().int().positive();

// ---------------------------------------------------------------------------
// Chip primitives (rendered in the widget, dispatched as user message text)
// ---------------------------------------------------------------------------

export const chipSchema = z.object({
  label: z.string().min(1).max(100),
  slug: slugSchema,
  /**
   * Optional integer score weight for chips on scoring SOP steps
   * (spec 015). When set, the chip contributes its weight to the
   * lead score on selection. Bounded `[-50, +50]` per
   * `contracts/chip-with-score.md`. Three semantically distinct
   * states:
   * - field absent → chip does not contribute (e.g., chips on the
   *   existing 6 default steps such as `when` / `case_type`).
   * - `0` → chip is a scoring chip but contributes nothing AND is
   *   excluded from the reasons array (per FR-010a's `|w| ≥ 5`
   *   inclusion rule); used by every "I Don't Know" chip.
   * - non-zero → chip contributes its weight; reasons-eligible iff
   *   `|score_weight| ≥ 5`.
   */
  score_weight: z.number().int().min(-50).max(50).optional(),
});
export type Chip = z.infer<typeof chipSchema>;

/**
 * Source for a step's chip list (or input form):
 * - `case_types`   → live `case_types` rows for the account
 * - `sub_types`    → live `sub_types` rows scoped to the prior step's captured case_type
 * - `inline`       → static array stored in the step row itself (`inline_chips_json`)
 * - `contact_form` → renders a contact-input form in the widget (name +
 *                    phone/email). Captured value is a JSON-stringified
 *                    `{ name, contact_email, contact_phone }` blob. Step
 *                    typically marks the SOP as fully complete (default
 *                    SOP threshold is 6 with the contact step at position 6).
 * - `null`         → no chips/form; step expects free text only
 */
export const chipSourceSchema = z.enum(['case_types', 'sub_types', 'inline', 'contact_form']).nullable();
export type ChipSource = z.infer<typeof chipSourceSchema>;

// ---------------------------------------------------------------------------
// Contact-form submission shape (chip_source='contact_form' steps)
// ---------------------------------------------------------------------------

/**
 * Payload submitted when the visitor fills in the contact-info form
 * inside the chat widget. Validated when the advancer captures it; the
 * stringified JSON form is stored as the step's captured_value.
 *
 * Required: name AND at least one of (contact_email, contact_phone).
 * Validation enforced via the schema's `.refine` clause below.
 */
export const contactFormPayloadSchema = z
  .object({
    name: z.string().min(1).max(120),
    contact_email: z.string().email().nullable(),
    contact_phone: z.string().min(3).max(40).nullable(),
  })
  .refine(
    (p) => p.contact_email !== null || p.contact_phone !== null,
    { message: 'At least one of contact_email or contact_phone is required.' },
  );
export type ContactFormPayload = z.infer<typeof contactFormPayloadSchema>;

// ---------------------------------------------------------------------------
// SOP Step (a single ordered question in an SOP)
// ---------------------------------------------------------------------------

export const sopStepSchema = z.object({
  id: z.string(),
  sop_configuration_id: z.string(),
  position: positionSchema,
  slug: slugSchema,
  question_text: z.string().min(1).max(500),
  chip_source: chipSourceSchema,
  /**
   * When `chip_source === 'inline'`, a JSON-stringified array of `Chip`s.
   * Otherwise null. Validated separately at boundary parse time.
   */
  inline_chips_json: z.string().nullable(),
  accepts_free_text: z.boolean(),
  is_required: z.boolean(),
  counts_toward_threshold: z.boolean(),
  is_default: z.boolean(),
  /** Reserved for advanced skip rules (post-MVP). MVP stores `null`. */
  skip_condition_json: z.string().nullable(),
  /**
   * Spec 015 — when set, this step only fires for visitors whose
   * captured `sub_type` slug matches this value. NULL means "always
   * fires" (the default for the existing 6 default steps). Used by
   * the 9 new car-accident scoring steps to limit their scope.
   * Filtered at runtime in `nextPendingStep` per research.md §R2.
   */
  applies_when_sub_type_slug: z.string().nullable().optional().default(null),
});
export type SOPStep = z.infer<typeof sopStepSchema>;

/** Shape used when authoring a new step from the dashboard or seed (no DB ids yet). */
export const sopStepInputSchema = sopStepSchema.omit({
  id: true,
  sop_configuration_id: true,
});
export type SOPStepInput = z.infer<typeof sopStepInputSchema>;

// ---------------------------------------------------------------------------
// SOP Configuration (per-account, versioned)
// ---------------------------------------------------------------------------

export const sopConfigurationSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  version: z.number().int().positive(),
  qualified_lead_threshold: z.number().int().positive(),
  is_published: z.boolean(),
  derived_from_legacy: z.boolean(),
  created_at: z.string(),
  steps: z.array(sopStepSchema),
});
export type SOPConfiguration = z.infer<typeof sopConfigurationSchema>;

// ---------------------------------------------------------------------------
// Case Type + Sub-Type (per-account configurable chip libraries)
// ---------------------------------------------------------------------------

export const subTypeSchema = z.object({
  id: z.string(),
  case_type_id: z.string(),
  slug: slugSchema,
  label: z.string().min(1).max(100),
  position: positionSchema,
  /**
   * Spec 015 — per-sub_type lead-classification scoring configuration.
   * JSON-encoded `ScoringConfig` (see `scoringConfigSchema` below and
   * `specs/015-lead-classification-revamp/contracts/scoring-config.md`).
   * NULL means "no scoring configuration; fall through to the LLM
   * classifier" (FR-022). Stored as a string here; callers decode +
   * validate via `scoringConfigSchema` at boundary parse time so this
   * schema doesn't impose a JSON parse on every read.
   */
  scoring_config_json: z.string().nullable().optional().default(null),
  created_at: z.string(),
});
export type SubType = z.infer<typeof subTypeSchema>;

export const subTypeInputSchema = subTypeSchema.omit({
  id: true,
  case_type_id: true,
  created_at: true,
});
export type SubTypeInput = z.infer<typeof subTypeInputSchema>;

export const caseTypeSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  slug: slugSchema,
  label: z.string().min(1).max(100),
  position: positionSchema,
  is_in_scope: z.boolean(),
  created_at: z.string(),
  sub_types: z.array(subTypeSchema),
});
export type CaseType = z.infer<typeof caseTypeSchema>;

export const caseTypeInputSchema = caseTypeSchema
  .omit({ id: true, account_id: true, created_at: true, sub_types: true })
  .extend({ sub_types: z.array(subTypeInputSchema) });
export type CaseTypeInput = z.infer<typeof caseTypeInputSchema>;

// ---------------------------------------------------------------------------
// Goodbye Phrase (per-account configurable closing trigger)
// ---------------------------------------------------------------------------

export const goodbyePhraseSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  phrase: z.string().min(1).max(50),
  created_at: z.string(),
});
export type GoodbyePhrase = z.infer<typeof goodbyePhraseSchema>;

// ---------------------------------------------------------------------------
// SOP State (runtime, per-session)
// ---------------------------------------------------------------------------

export const sopStepStatusSchema = z.enum(['pending', 'complete', 'skipped']);
export type SOPStepStatus = z.infer<typeof sopStepStatusSchema>;

export const sopStateStepSchema = z.object({
  step_id: z.string(),
  slug: slugSchema,
  status: sopStepStatusSchema,
  captured_value: z.string().nullable(),
  captured_at: z.string().nullable(),
  inferred: z.boolean(),
  /**
   * Human-readable snapshot of the captured chip's label at the moment
   * of capture (e.g. "DUI" for case_type=dui, "First Offense" for
   * sub_type=first_offense). Stays stable even if the firm later
   * renames or removes the chip — historical leads remain meaningful
   * (014-fix-sop-case-subtypes FR-022). Optional + nullable for
   * backward compatibility with sessions persisted before this field
   * existed; older states deserialize cleanly with `captured_label = null`.
   */
  captured_label: z.string().nullable().optional().default(null),
});
export type SOPStateStep = z.infer<typeof sopStateStepSchema>;

/**
 * Full SOP runtime state. Persisted in `sessions.sop_state_json` and copied
 * to `leads.sop_state_snapshot` at finalization.
 */
export const sopStateSchema = z.object({
  sop_configuration_id: z.string(),
  sop_version: z.number().int().positive(),
  /** ISO 8601 timestamp; basis for date-inference (R3, FR-042). */
  conversation_anchor_iso: z.string(),
  steps: z.array(sopStateStepSchema),
  qualified_lead_threshold: z.number().int().positive(),
  current_progress: z.number().int().nonnegative(),
  is_finalized: z.boolean(),
  out_of_scope_termination: z.boolean(),
});
export type SOPState = z.infer<typeof sopStateSchema>;

// ---------------------------------------------------------------------------
// SOP State header payload (compact form sent to the widget)
// ---------------------------------------------------------------------------

export const sopStateHeaderPayloadSchema = z.object({
  current: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  pending_step_id: z.string().nullable(),
  pending_step_slug: slugSchema.nullable(),
  is_finalized: z.boolean(),
  /**
   * Slug captured at the `case_type` SOP step, or null if not yet
   * captured. Exposed in the wire payload (and only this slug) so the
   * widget can compute `sub_type` chips locally without needing the
   * full SOPState. Non-PII by design — case_type slugs are controlled
   * vocabulary defined by the lawyer in the dashboard.
   */
  captured_case_type_slug: slugSchema.nullable().optional(),
  /**
   * Human-readable label of the captured case type (e.g. "DUI",
   * "Personal Injury"). Optional companion to `captured_case_type_slug`
   * so the system prompt and the widget can interpolate the case-type
   * into questions like "What kind of {case_type} matter is this?"
   * without re-fetching the case_types catalog
   * (014-fix-sop-case-subtypes FR-006). Null when the case_type step
   * is not yet complete OR when the captured slug refers to a deleted
   * case type that can no longer be resolved.
   */
  captured_case_type_label: z.string().nullable().optional().default(null),
});
export type SOPStateHeaderPayload = z.infer<typeof sopStateHeaderPayloadSchema>;

// ---------------------------------------------------------------------------
// Scoring configuration (spec 015) — `sub_types.scoring_config_json` shape
// ---------------------------------------------------------------------------
// Validated by Zod at every boundary read or write. See
// `contracts/scoring-config.md` for full semantics. The schema_version
// literal forward-compats the deferred Case Value / Urgency Score
// decomposition (post-MVP); MVP runtime rejects unknown versions.
//
// Stable `params.code` values surface on validation failures so the
// dashboard can render actionable inline errors per FR-021:
//   - SCHEMA_VERSION_UNSUPPORTED — schema_version is not 1
//   - THRESHOLDS_GAP            — buckets do not cover [0,100] contiguously
//   - THRESHOLDS_OVERLAP        — two or more buckets share at least one point

const classificationBoundsSchema = z
  .tuple([
    z.number().int().min(0).max(100),
    z.number().int().min(0).max(100),
  ])
  .refine(([lo, hi]) => lo <= hi, {
    message: 'Lower bound must be ≤ upper bound',
    params: { code: 'THRESHOLDS_INVALID_BOUND' },
  });

type Bounds = readonly [number, number];

/**
 * Asserts the supplied buckets form a contiguous partition of `[0, 100]`
 * with no gaps and no overlaps. Returns one of:
 *   - { ok: true } — coverage is correct
 *   - { ok: false, code: 'THRESHOLDS_OVERLAP', message }
 *   - { ok: false, code: 'THRESHOLDS_GAP', message }
 */
function checkCoverage(
  buckets: Record<string, Bounds>,
): { ok: true } | { ok: false; code: 'THRESHOLDS_OVERLAP' | 'THRESHOLDS_GAP'; message: string } {
  const sorted = Object.entries(buckets)
    .map(([name, range]) => ({ name, lo: range[0], hi: range[1] }))
    .sort((a, b) => a.lo - b.lo);

  if (sorted.length === 0) {
    return {
      ok: false,
      code: 'THRESHOLDS_GAP',
      message: 'No threshold buckets defined',
    };
  }

  // Must start at 0
  if (sorted[0].lo !== 0) {
    return {
      ok: false,
      code: 'THRESHOLDS_GAP',
      message: `Threshold coverage must start at 0; first bucket starts at ${sorted[0].lo}`,
    };
  }

  // Must end at 100
  if (sorted[sorted.length - 1].hi !== 100) {
    return {
      ok: false,
      code: 'THRESHOLDS_GAP',
      message: `Threshold coverage must end at 100; last bucket ends at ${sorted[sorted.length - 1].hi}`,
    };
  }

  // Check overlap and contiguity between adjacent buckets
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.lo <= prev.hi) {
      return {
        ok: false,
        code: 'THRESHOLDS_OVERLAP',
        message: `Bucket "${curr.name}" [${curr.lo},${curr.hi}] overlaps "${prev.name}" [${prev.lo},${prev.hi}]`,
      };
    }
    if (curr.lo !== prev.hi + 1) {
      return {
        ok: false,
        code: 'THRESHOLDS_GAP',
        message: `Gap between "${prev.name}" ending at ${prev.hi} and "${curr.name}" starting at ${curr.lo}`,
      };
    }
  }

  return { ok: true };
}

export const thresholdsSelfSchema = z
  .object({
    hot: classificationBoundsSchema,
    warm: classificationBoundsSchema,
    cold: classificationBoundsSchema,
    spam: classificationBoundsSchema,
  })
  .superRefine((value, ctx) => {
    const result = checkCoverage({
      hot: value.hot,
      warm: value.warm,
      cold: value.cold,
      spam: value.spam,
    });
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
        params: { code: result.code },
      });
    }
  });

export const thresholdsFamilyFriendSchema = z
  .object({
    hot: classificationBoundsSchema,
    warm: classificationBoundsSchema,
    spam: classificationBoundsSchema,
  })
  .superRefine((value, ctx) => {
    const result = checkCoverage({
      hot: value.hot,
      warm: value.warm,
      spam: value.spam,
    });
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.message,
        params: { code: result.code },
      });
    }
  });

export const hardOverridesEnabledSchema = z.object({
  missing_contact: z.boolean(),
  out_of_scope: z.boolean(),
  no_injury_no_treatment: z.boolean(),
  fake_info: z.boolean(),
});

/**
 * @deprecated Spec 016 multi-branch SOP supersedes spec 015's
 * per-sub-type scoring config. New code MUST read scoring data from
 * the `Branch` / `BranchVersion` model in
 * `packages/shared/src/schemas/branch.ts`. The
 * `sub_types.scoring_config_json` column is preserved at the schema
 * level for backwards compatibility of historical lead rendering, but
 * the runtime MUST NOT read from it. Drop is a follow-up cleanup
 * migration (research.md R2). See spec 016 FR-029.
 */
export const scoringConfigSchema = z.object({
  schema_version: z.literal(1, {
    errorMap: () => ({
      message: 'Unsupported scoring_config schema_version (MVP supports 1)',
      params: { code: 'SCHEMA_VERSION_UNSUPPORTED' },
    }),
  }),
  thresholds_self: thresholdsSelfSchema,
  thresholds_family_friend: thresholdsFamilyFriendSchema,
  hard_overrides_enabled: hardOverridesEnabledSchema,
});

export type ClassificationBounds = z.infer<typeof classificationBoundsSchema>;
export type ThresholdsSelf = z.infer<typeof thresholdsSelfSchema>;
export type ThresholdsFamilyFriend = z.infer<typeof thresholdsFamilyFriendSchema>;
export type HardOverridesEnabled = z.infer<typeof hardOverridesEnabledSchema>;
export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
