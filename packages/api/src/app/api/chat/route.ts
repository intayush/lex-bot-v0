import { streamText, tool } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { verifyApiKey } from '../../../lib/auth';
import { getPublishedConfig, getLatestConfig } from '../../../lib/config';
import { composeSystemPrompt } from '../../../lib/system-prompt';
import { createSession, getSessionMessages, appendMessages, sessionExists } from '../../../lib/session';
import { searchContext, fetchManifest } from '../../../lib/context-search';
import { captureLead } from '../../../lib/leads';
import { extractPartialLeadData, savePartialLead } from '../../../lib/partial-lead';
import { checkRateLimit } from '../../../lib/rate-limit';
import { corsHeaders } from './cors';
import type { Manifest } from '@legal-chatbot/shared';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

const manifestCache = new Map<string, { manifest: Manifest; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedManifest(contextStoreUrl: string): Promise<Manifest> {
  const cached = manifestCache.get(contextStoreUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.manifest;
  }
  const manifest = await fetchManifest(contextStoreUrl);
  manifestCache.set(contextStoreUrl, { manifest, fetchedAt: Date.now() });
  return manifest;
}

export async function POST(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return Response.json({ error: 'unauthorized', message: 'Missing API key' }, { status: 401, headers: corsHeaders });
  }

  const auth = await verifyApiKey(apiKey);
  if (!auth) {
    return Response.json({ error: 'unauthorized', message: 'Invalid API key' }, { status: 401, headers: corsHeaders });
  }

  const rateLimit = checkRateLimit(auth.accountId);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: 'rate_limited', message: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { ...corsHeaders, 'Retry-After': String(Math.ceil(rateLimit.resetIn / 1000)) } }
    );
  }

  const isPreview = req.headers.get('x-preview') === 'true';

  let config;
  if (isPreview) {
    const latest = await getLatestConfig(auth.accountId);
    config = latest?.config ?? null;
  } else {
    config = await getPublishedConfig(auth.accountId);
  }
  if (!config) {
    return Response.json({ error: 'internal', message: 'No published configuration found' }, { status: 500, headers: corsHeaders });
  }

  const body = await req.json();
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'bad_request', message: 'Messages array required' }, { status: 400, headers: corsHeaders });
  }

  // Session management
  let sessionId = req.headers.get('x-session-id');
  if (sessionId && !(await sessionExists(sessionId))) {
    sessionId = null;
  }
  if (!sessionId) {
    sessionId = await createSession(auth.accountId, isPreview);
  }

  // Load history and append new user message
  const history = await getSessionMessages(sessionId);
  const newUserMessage = messages[messages.length - 1];
  const fullMessages = [...history, newUserMessage];

  const systemPrompt = composeSystemPrompt(config);
  const contextStoreUrl = auth.contextStoreUrl;

  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: systemPrompt,
    messages: fullMessages,
    tools: {
      searchContext: tool({
        description: 'Search the firm knowledge base for information relevant to the user query. Use this to answer questions about the firm, its services, attorneys, and policies.',
        parameters: z.object({
          query: z.string().describe('Search query derived from user message'),
          sectionTypes: z.array(z.string()).optional().describe('Filter by section type: practice-area, attorney-bio, faq, contact, about, general'),
        }),
        execute: async ({ query, sectionTypes }) => {
          const manifest = await getCachedManifest(contextStoreUrl);
          const results = await searchContext(contextStoreUrl, query, sectionTypes, manifest);
          if (results.length === 0) {
            return { found: false, message: 'No relevant context found for this query.' };
          }
          return {
            found: true,
            results: results.map((r) => ({
              title: r.file.title,
              type: r.file.section_type,
              score: r.score,
              content: r.content,
            })),
          };
        },
      }),
      captureLead: tool({
        description: 'Capture a qualified lead after gathering sufficient information from the visitor. Call this once you have collected their name, contact info, and understand their legal matter. Classify as urgent if there are time-sensitive factors (statute of limitations, active danger, ongoing medical treatment, court deadlines). Classify as unqualified if the matter is outside the firm practice areas.',
        parameters: z.object({
          name: z.string().nullable().describe('Visitor name or null if not provided'),
          contactEmail: z.string().nullable().describe('Email address or null'),
          contactPhone: z.string().nullable().describe('Phone number or null'),
          caseType: z.string().nullable().describe('Type of legal matter (e.g. Personal Injury, Family Law)'),
          incidentDate: z.string().nullable().describe('When the issue arose, ISO date format if possible'),
          briefDescription: z.string().describe('One-sentence summary of their legal matter'),
          classification: z.enum(['urgent', 'normal', 'unqualified']).describe('Lead classification based on urgency and qualification'),
          classificationRationale: z.string().describe('Brief explanation for why this classification was chosen'),
          urgencyFactors: z.array(z.string()).describe('List of urgency indicators found, empty array if none'),
        }),
        execute: async ({ name, contactEmail, contactPhone, caseType, incidentDate, briefDescription, classification, classificationRationale, urgencyFactors }) => {
          const result = await captureLead({
            accountId: auth.accountId,
            sessionId: sessionId!,
            name,
            contactEmail,
            contactPhone,
            caseType,
            incidentDate,
            briefDescription,
            classification,
            classificationRationale,
            urgencyFactors,
          });
          return { success: true, leadId: result.leadId, classification: result.classification };
        },
      }),
    },
    maxSteps: 5,
    onError: (event) => {
      console.error('[chat] Stream error:', event.error);
    },
    onFinish: async ({ text }) => {
      await appendMessages(sessionId!, [
        newUserMessage,
        { role: 'assistant', content: text },
      ]);

      // Extract and save partial lead data from the conversation so that
      // information shared before an abandoned session is not lost.
      const allMessages = [...fullMessages, { role: 'assistant', content: text }];
      const partial = extractPartialLeadData(allMessages);
      await savePartialLead(auth.accountId, sessionId!, partial, allMessages);
    },
  });

  const response = result.toDataStreamResponse();

  const headers = new Headers(response.headers);
  headers.set('x-session-id', sessionId);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
