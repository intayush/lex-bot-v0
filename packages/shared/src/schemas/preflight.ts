/**
 * Preflight phrase shared schemas (011-preflight-phrase).
 *
 * Wire shapes for the POST /api/chat/preflight route + its widget
 * consumer (`usePreflightPhrase` hook). The preflight route generates
 * a 3-7 word loading status phrase tailored to the visitor's latest
 * message ("Looking into your DUI matter…") via a cheap pre-call to
 * `gemini-2.5-flash-lite` running in parallel with the main agent.
 *
 * Source of truth: `specs/011-preflight-phrase/data-model.md` and
 * `specs/011-preflight-phrase/contracts/preflight-route-contract.md`.
 */

import { z } from 'zod';
import { slugSchema } from './sop.js';

// ---------------------------------------------------------------------------
// Request body (widget → route)
// ---------------------------------------------------------------------------

/**
 * `pendingStepSlug` is provided by the widget from its own client-side
 * SOP state — the route does NOT look it up server-side. It's optional
 * context the model uses to produce a more relevant phrase. Reuses the
 * same slug shape as 010-sop-workflow's SOP step slugs.
 */
export const preflightRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  pendingStepSlug: slugSchema.nullable(),
});
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;

// ---------------------------------------------------------------------------
// Response body (route → widget) — success
// ---------------------------------------------------------------------------

/**
 * The phrase is suitable for direct rendering in the widget. The widget
 * appends an ellipsis (`…`) when displaying. Length bounds (3-60 chars)
 * are enforced by the route's post-filter, which also strips trailing
 * punctuation and rejects PII patterns.
 */
export const preflightResponseSchema = z.object({
  phrase: z.string().min(3).max(60),
});
export type PreflightResponse = z.infer<typeof preflightResponseSchema>;

// ---------------------------------------------------------------------------
// Error body (route → widget) — failure
// ---------------------------------------------------------------------------

/**
 * The widget hook ignores all error responses silently — the visitor
 * sees no UI difference between success and failure (other than seeing
 * dots vs. phrase). This shape exists so that server-side observability
 * + future widget devmode can introspect outcomes if needed.
 */
export const preflightErrorSchema = z.object({
  error: z.enum([
    'preflight_timeout',
    'preflight_failed',
    'preflight_validation',
    'unauthorized',
    'rate_limited',
    'bad_request',
  ]),
  message: z.string().optional(),
});
export type PreflightError = z.infer<typeof preflightErrorSchema>;
