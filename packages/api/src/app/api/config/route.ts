import { verifyApiKey } from '../../../lib/auth';
import { getPublishedConfig } from '../../../lib/config';
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

  return Response.json(
    {
      chatbot_name: config.persona.chatbot_name,
      greeting_message: config.persona.greeting_message,
      practice_areas: [...config.practice_areas.active, ...config.practice_areas.custom.filter(Boolean)],
      phone: config.contact.phone,
    },
    { headers: configCorsHeaders }
  );
}
