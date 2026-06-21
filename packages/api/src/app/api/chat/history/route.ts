import { verifyApiKey } from '../../../../lib/auth';
import { getSessionForSOP } from '../../../../lib/session';
import { getCaseTypes } from '../../../../lib/sop-config';
import { buildSOPStateHeader } from '../../../../lib/sop/build-sop-state-header';
import { corsHeaders } from '../cors';

const historyCorsHeaders = {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: historyCorsHeaders });
}

/**
 * GET /api/chat/history
 *
 * Returns the stored message history and compact SOP state for an
 * existing session. The widget calls this on mount when it finds a
 * session ID in sessionStorage, so the conversation is restored without
 * requiring the visitor to re-send their last message.
 *
 * Headers:
 *   x-api-key     — required (same key used for /api/chat)
 *   x-session-id  — required
 *
 * Response 200:
 *   { messages: Message[], sopState: SOPStateHeaderPayload | null }
 *
 * Response 404: session not found or expired — widget should start fresh.
 */
export async function GET(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json(
      { error: 'unauthorized', message: 'Missing API key' },
      { status: 401, headers: historyCorsHeaders },
    );
  }

  const auth = await verifyApiKey(apiKey);
  if (!auth) {
    return Response.json(
      { error: 'unauthorized', message: 'Invalid API key' },
      { status: 401, headers: historyCorsHeaders },
    );
  }

  const sessionId = req.headers.get('x-session-id');
  if (!sessionId) {
    return Response.json(
      { error: 'bad_request', message: 'x-session-id header required' },
      { status: 400, headers: historyCorsHeaders },
    );
  }

  const [session, caseTypes] = await Promise.all([
    getSessionForSOP(sessionId),
    getCaseTypes(auth.accountId),
  ]);

  if (!session) {
    return Response.json(
      { error: 'not_found', message: 'Session not found' },
      { status: 404, headers: historyCorsHeaders },
    );
  }

  const sopState = buildSOPStateHeader(session.sopState, caseTypes);

  return Response.json(
    { messages: session.messages, sopState },
    { headers: historyCorsHeaders },
  );
}
