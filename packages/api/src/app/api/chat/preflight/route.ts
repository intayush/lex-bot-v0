/**
 * Preflight Next.js Route Handler shell (011-preflight-phrase T012).
 *
 * Endpoint: POST /api/chat/preflight
 *
 * Next.js's route-file compilation pass rejects exports other than
 * the recognized HTTP-verb functions. The full handler logic + DI
 * seam + tests live next door in `handler.ts`; this file just wires
 * the production deps into the testable handler.
 *
 * Source of truth: contracts/preflight-route-contract.md.
 */

import { handlePreflight, PRODUCTION_DEPS } from './handler';
import { corsHeaders } from '../cors';

export async function POST(req: Request): Promise<Response> {
  return handlePreflight(req, PRODUCTION_DEPS);
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: corsHeaders });
}
