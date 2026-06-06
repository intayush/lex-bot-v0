/**
 * Spec 016 — `/api/dashboard/branches` (list).
 *
 * Thin Next.js Route Handler shell that wires production deps to the
 * testable `handleListBranches` from `./handler.ts`.
 *
 * Constitution IV: Route Handlers only — no Server Actions. The
 * dashboard page's server component fetches this endpoint via SSR or
 * client-side fetch.
 */

import { handleListBranches, PRODUCTION_DEPS } from './handler';

export async function GET(req: Request) {
  return handleListBranches(req, PRODUCTION_DEPS);
}
