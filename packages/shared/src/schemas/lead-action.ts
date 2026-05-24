/**
 * Lead follow-up action schemas (013-lead-action-tracking).
 *
 * Defines the enum of valid action slugs the lawyer can record for a
 * lead, the request-body shape for the `/api/dashboard/leads/[id]/action`
 * route, and the slug → display-label map the dashboard UI uses.
 *
 * Source of truth: `specs/013-lead-action-tracking/data-model.md` and
 * `specs/013-lead-action-tracking/contracts/lead-action-route-contract.md`.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Action slugs (storage form)
// ---------------------------------------------------------------------------

/**
 * The vocabulary of follow-up actions a lawyer can record per lead.
 *
 * Slugs (snake_case) are the canonical wire/DB form so that:
 *   - Display labels can be tuned in the widget without a migration.
 *   - The repo convention from 010-sop-workflow's `case_types.slug`
 *     and `sub_types.slug` is preserved.
 *
 * v1 fixes the vocabulary at these three values; configurable
 * per-firm vocabulary is explicitly out of scope (see spec.md).
 */
export const leadActionEnum = z.enum([
  'contacted',
  'call_no_answer',
  'meeting_fixed',
]);
export type LeadAction = z.infer<typeof leadActionEnum>;

/**
 * Display labels used by the dashboard UI. The picker renders these;
 * the wire/DB only ever sees the slug. Changing a label is a
 * widget-only edit (no migration).
 */
export const LEAD_ACTION_LABELS: Record<LeadAction, string> = {
  contacted: 'Contacted',
  call_no_answer: "Call didn't answer",
  meeting_fixed: 'Client meeting fixed',
};

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/**
 * Request body for `POST /api/dashboard/leads/[id]/action`.
 *
 * `action: null` clears the lead's recorded action (returns the lead
 * to the "no action yet" state). The route also clears the
 * `follow_up_action_changed_at` timestamp in this case.
 */
export const leadActionUpdateSchema = z.object({
  action: leadActionEnum.nullable(),
});
export type LeadActionUpdate = z.infer<typeof leadActionUpdateSchema>;

/**
 * Successful response body. The server returns the updated values so
 * the client can render the new state without a follow-up read.
 *
 * When `action` was null in the request, both fields are null in the
 * response.
 */
export const leadActionResponseSchema = z.object({
  success: z.literal(true),
  follow_up_action: leadActionEnum.nullable(),
  /** ISO 8601 timestamp; null when the action is cleared. */
  follow_up_action_changed_at: z.string().nullable(),
});
export type LeadActionResponse = z.infer<typeof leadActionResponseSchema>;
