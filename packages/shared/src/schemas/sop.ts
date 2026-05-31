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
