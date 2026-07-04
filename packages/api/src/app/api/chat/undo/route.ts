import { verifyApiKey } from '../../../../lib/auth';
import { revertLastTurn } from '../../../../lib/session';
import { getCaseTypes } from '../../../../lib/sop-config';
import { buildSOPStateHeader } from '../../../../lib/sop/build-sop-state-header';
import { corsHeaders } from '../cors';

const undoCorsHeaders = {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: undoCorsHeaders });
}

/**
 * POST /api/chat/undo
 *
 * Rewinds the session by exactly one exchange: pops the top undo-stack
 * snapshot, restores sop_state + messages, and soft-deletes any lead that
 * turn created. Idempotent no-op when the stack is empty.
 *
 * Headers: x-api-key (required), x-session-id (required). No body.
 * Response 200: { messages: Message[], sopState: SOPStateHeaderPayload | null }
 * (same shape as GET /api/chat/history) + x-session-id, x-sop-state headers.
 */
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json(
      { error: 'unauthorized', message: 'Missing API key' },
      { status: 401, headers: undoCorsHeaders },
    );
  }

  const auth = await verifyApiKey(apiKey);
  if (!auth) {
    return Response.json(
      { error: 'unauthorized', message: 'Invalid API key' },
      { status: 401, headers: undoCorsHeaders },
    );
  }

  const sessionId = req.headers.get('x-session-id');
  if (!sessionId) {
    return Response.json(
      { error: 'bad_request', message: 'x-session-id header required' },
      { status: 400, headers: undoCorsHeaders },
    );
  }

  const [result, caseTypes] = await Promise.all([
    revertLastTurn(sessionId),
    getCaseTypes(auth.accountId),
  ]);

  const sopState = buildSOPStateHeader(result.sopState, caseTypes);

  const headers = new Headers(undoCorsHeaders);
  headers.set('x-session-id', sessionId);
  if (sopState) {
    // Mirror chat/route.ts (~line 561): HTTP headers are ByteString, so
    // escape every non-ASCII char (chip labels use en-dashes, smart quotes,
    // currency symbols) to \uXXXX. The widget's useSOPState JSON.parses this
    // and restores the original characters transparently.
    const json = JSON.stringify(sopState);
    const ascii = json.replace(/[\u0080-\uffff]/g, (ch) =>
      '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    headers.set('x-sop-state', ascii);
  }

  return Response.json({ messages: result.messages, sopState }, { headers });
}
