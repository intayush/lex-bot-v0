import { z } from 'zod';

export const leadClassificationSchema = z.enum(['HOT', 'WARM', 'COLD', 'SPAM']);

export const leadStatusSchema = z.enum(['new', 'contacted', 'dismissed']);

/**
 * Whether the visitor is asking about their own matter (`SELF`) or
 * someone else's (`FRIEND_FAMILY`). Captured by the new metadata SOP
 * step in spec 015; selects which classification-threshold table
 * applies in the scoring engine. Per spec 015 FR-014.
 */
export const leadRequestTypeSchema = z.enum(['SELF', 'FRIEND_FAMILY']);

/**
 * Whether the captured incident took place inside the firm's service
 * area. When `OUTSIDE_SERVICE_AREA`, the visitor is asked for city +
 * state via free-text follow-ups (persisted to
 * `geographic_qualification_details_json`). Per spec 015 FR-015.
 */
export const leadGeographicQualificationSchema = z.enum([
  'IN_SERVICE_AREA',
  'OUTSIDE_SERVICE_AREA',
]);

export const leadSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  session_id: z.string(),
  name: z.string().nullable(),
  contact_email: z.string().email().nullable(),
  contact_phone: z.string().nullable(),
  case_type: z.string().nullable(),
  incident_date: z.string().nullable(),
  brief_description: z.string().nullable(),
  classification: leadClassificationSchema,
  classification_rationale: z.string().nullable(),
  urgency_factors_json: z.string().nullable(),
  /**
   * Numeric lead score in `[0, 100]` inclusive when set. NULL for
   * leads scored by the LLM fallback path, partial-lead heuristic, or
   * legacy migration. Per spec 015 FR-001 / FR-005.
   */
  lead_score: z.number().int().min(0).max(100).nullable(),
  /**
   * JSON-encoded array of human-readable phrase strings explaining
   * why a lead landed in its classification. Empty/null for unscored
   * leads. The special sentinel `'["scoring_error"]'` flags a
   * scorer-failure capture per FR-010b.
   */
  score_reasons_json: z.string().nullable(),
  request_type: leadRequestTypeSchema.nullable(),
  geographic_qualification: leadGeographicQualificationSchema.nullable(),
  /**
   * JSON-encoded `{ city, state }` only when
   * `geographic_qualification = 'OUTSIDE_SERVICE_AREA'`.
   */
  geographic_qualification_details_json: z.string().nullable(),
  sop_state_snapshot: z.string().nullable(),
  status: leadStatusSchema,
  follow_up_action: z.string().nullable(),
  follow_up_action_changed_at: z.string().nullable(),
  created_at: z.string(),
});

export type LeadClassification = z.infer<typeof leadClassificationSchema>;
export type LeadStatus = z.infer<typeof leadStatusSchema>;
export type LeadRequestType = z.infer<typeof leadRequestTypeSchema>;
export type LeadGeographicQualification = z.infer<
  typeof leadGeographicQualificationSchema
>;
export type Lead = z.infer<typeof leadSchema>;
