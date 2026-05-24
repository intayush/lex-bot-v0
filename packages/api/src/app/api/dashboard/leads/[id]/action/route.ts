/**
 * Lead action update — Next.js Route Handler shell (013-lead-action-tracking T013).
 *
 * Endpoint: POST /api/dashboard/leads/[id]/action
 *
 * Next.js's route-file compilation pass rejects exports other than
 * the recognized HTTP-verb functions (GET/POST/etc.). The full handler
 * logic + DI seam + tests live in `./handler`; this file is the thin
 * shell that wires production deps into the testable handler.
 *
 * Source of truth: contracts/lead-action-route-contract.md.
 */

import { handleLeadActionUpdate, PRODUCTION_DEPS } from './handler';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await ctx.params;
  return handleLeadActionUpdate(req, params, PRODUCTION_DEPS);
}
