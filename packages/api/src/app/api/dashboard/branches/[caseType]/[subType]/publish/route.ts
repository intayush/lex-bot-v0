/**
 * Spec 016 — `/api/dashboard/branches/[caseType]/[subType]/publish`.
 *
 * POST: publish the latest draft version. Thin shell over
 * `handlePublishBranch`.
 */

import { handlePublishBranch, PRODUCTION_DEPS } from '../../../handler';

interface RouteContext {
  params: Promise<{ caseType: string; subType: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
  const params = await ctx.params;
  return handlePublishBranch(req, params, PRODUCTION_DEPS);
}
