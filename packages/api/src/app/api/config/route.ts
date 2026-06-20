import { verifyApiKey } from '../../../lib/auth';
import { getPublishedConfig } from '../../../lib/config';
import { getPublishedSOP, getCaseTypes } from '../../../lib/sop-config';
import { corsHeaders } from '../chat/cors';

const configCorsHeaders = {
  ...corsHeaders,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: configCorsHeaders });
}

export async function GET(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json(
      { error: 'unauthorized', message: 'Missing API key' },
      { status: 401, headers: configCorsHeaders }
    );
  }

  const auth = await verifyApiKey(apiKey);
  if (!auth) {
    return Response.json(
      { error: 'unauthorized', message: 'Invalid API key' },
      { status: 401, headers: configCorsHeaders }
    );
  }

  const config = await getPublishedConfig(auth.accountId);
  if (!config) {
    return Response.json(
      { error: 'internal', message: 'No published configuration found' },
      { status: 500, headers: configCorsHeaders }
    );
  }

  // 010-sop-workflow T033: include SOP + chip catalogs so the widget
  // can render chips for whichever SOP step is currently pending. The
  // widget computes the active chip list locally from these payloads
  // plus the per-turn `x-sop-state` header. Both fields are null when
  // an account has no published SOP (legacy / pre-migration state).
  const [sop, caseTypes] = await Promise.all([
    getPublishedSOP(auth.accountId),
    getCaseTypes(auth.accountId),
  ]);

  return Response.json(
    {
      chatbot_name: config.persona.chatbot_name,
      greeting_message: config.persona.greeting_message,
      in_scope_case_types: caseTypes
        .filter((ct) => ct.is_in_scope)
        .sort((a, b) => a.position - b.position)
        .map((ct) => ct.label),
      phone: config.contact.phone,
      // Optional widget theme (per-firm branding). When absent the
      // widget keeps the indigo defaults from panel.css. When present
      // the widget applies the values as inline CSS variables on the
      // ChatPanel wrapper, mirroring the dashboard PreviewChat path.
      theme: config.theme ?? null,
      // SOP fields — null when an account has no published SOP.
      sop: sop
        ? {
            id: sop.id,
            version: sop.version,
            qualified_lead_threshold: sop.qualified_lead_threshold,
            steps: sop.steps.map((s) => ({
              id: s.id,
              position: s.position,
              slug: s.slug,
              question_text: s.question_text,
              chip_source: s.chip_source,
              inline_chips_json: s.inline_chips_json,
              accepts_free_text: s.accepts_free_text,
              is_required: s.is_required,
            })),
          }
        : null,
      case_types: caseTypes.map((ct) => ({
        id: ct.id,
        slug: ct.slug,
        label: ct.label,
        position: ct.position,
        is_in_scope: ct.is_in_scope,
        sub_types: ct.sub_types.map((st) => ({
          id: st.id,
          slug: st.slug,
          label: st.label,
          position: st.position,
        })),
      })),
    },
    { headers: configCorsHeaders }
  );
}
