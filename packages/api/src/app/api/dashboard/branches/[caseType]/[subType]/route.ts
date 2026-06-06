/**
 * Spec 016 — `/api/dashboard/branches/[caseType]/[subType]`.
 *
 * Thin shells that wire the testable handlers from `../../handler.ts`
 * to Next.js's GET / PUT / DELETE entry points.
 */

import {
  handleDeleteBranch,
  handleGetBranchDetail,
  handleSaveBranch,
  PRODUCTION_DEPS,
} from '../../handler';

interface RouteContext {
  params: Promise<{ caseType: string; subType: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const params = await ctx.params;
  return handleGetBranchDetail(req, params, PRODUCTION_DEPS);
}

export async function PUT(req: Request, ctx: RouteContext) {
  const params = await ctx.params;
  return handleSaveBranch(req, params, PRODUCTION_DEPS);
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const params = await ctx.params;
  return handleDeleteBranch(req, params, PRODUCTION_DEPS);
}
