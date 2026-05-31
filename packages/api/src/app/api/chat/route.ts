import { streamText, tool } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { verifyApiKey } from '../../../lib/auth';
import { getPublishedConfig, getLatestConfig } from '../../../lib/config';
import { getSOPBundle } from '../../../lib/sop-config';
import { composeSystemPrompt } from '../../../lib/system-prompt';
import {
  createSession,
  getSessionForSOP,
  appendMessagesAndSOPState,
  sessionExists,
} from '../../../lib/session';
import { searchContext, fetchManifest } from '../../../lib/context-search';
import { captureLead, updateLeadSOPState } from '../../../lib/leads';
import { extractPartialLeadData, savePartialLead } from '../../../lib/partial-lead';
import { checkRateLimit } from '../../../lib/rate-limit';
import { initSOPState } from '../../../lib/sop/state-machine';
import { advanceForVisitorMessage } from '../../../lib/sop/advancer';
import { isOffTopic } from '../../../lib/sop/off-sop-detour';
import { analyzeAndFollowUpTool } from '../../../lib/sop/follow-up-tool';
import { corsHeaders } from './cors';
import type { Manifest, SOPState, SOPStateHeaderPayload } from '@legal-chatbot/shared';

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

/**
 * Compact SOP state payload sent to the widget via the x-sop-state
 * response header (per contracts/sop-state-contract.md "Wire Shape").
 * Returns null when the account has no published SOP.
 */
function buildSOPStateHeader(sopState: SOPState | null): SOPStateHeaderPayload | null {
  if (!sopState) return null;
  const pending = sopState.steps.find((s) => s.status === 'pending');
  const caseTypeStep = sopState.steps.find((s) => s.slug === 'case_type');
  return {
    current: sopState.current_progress,
    total: sopState.qualified_lead_threshold,
    pending_step_id: pending?.step_id ?? null,
    pending_step_slug: pending?.slug ?? null,
    is_finalized: sopState.is_finalized,
    captured_case_type_slug:
      caseTypeStep?.status === 'complete' ? caseTypeStep.captured_value : null,
    // 014-fix-sop-case-subtypes: captured_case_type_label is populated
    // by T020 (which has the caseTypes catalog in scope). For now this
    // helper has only the SOP state to work with so it can't resolve
    // the label by itself; T020 replaces this field with a proper
    // caseTypes lookup at the call site.
    captured_case_type_label: null,
  };
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

  // 010-sop-workflow T031 + T069: load SOP, case types, and goodbye phrases
  // for the account. Any of these may be empty (account hasn't migrated to
  // SOP yet); we treat that as the legacy intake-question path. In Preview
  // & Test mode (`x-preview: true`) the loader returns the latest SOP
  // regardless of its is_published flag, so the lawyer can chat against
  // an unpublished draft before publishing it.
  const sopBundle = await getSOPBundle(auth.accountId, { isPreview });

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

  // Load history + existing SOP state in a single query.
  const sessionData = await getSessionForSOP(sessionId);
  const history = sessionData?.messages ?? [];
  const conversationAnchorIso = sessionData?.conversationAnchorIso ?? new Date().toISOString();
  const newUserMessage = messages[messages.length - 1];
  const fullMessages = [...history, newUserMessage];

  // Initialize or load SOP state. If the account has no published SOP we
  // skip SOP runtime entirely and fall back to the legacy intake flow.
  let sopState: SOPState | null = sessionData?.sopState ?? null;
  if (sopBundle.sop && !sopState) {
    sopState = initSOPState(sopBundle.sop, conversationAnchorIso);
  }

  // Advance state for the latest visitor message (Phase 4 skip-detector).
  // Capture detector matches + pre-advance pending step so the off-SOP
  // detour detector can decide whether to add a directive to the system
  // prompt this turn (Phase 5 / US3).
  let isOffTopicNow = false;
  if (sopState && sopBundle.sop) {
    const userText = typeof newUserMessage?.content === 'string'
      ? newUserMessage.content
      : '';
    if (userText) {
      const advanced = await advanceForVisitorMessage({
        state: sopState,
        sopConfig: sopBundle.sop,
        caseTypes: sopBundle.caseTypes,
        message: userText,
      });
      sopState = advanced.state;
      // Off-SOP detour signal: skip-detector found nothing AND a pending
      // step exists AND the message has minimal keyword overlap with the
      // pending question.
      isOffTopicNow = isOffTopic({
        message: userText,
        pendingStep: advanced.pendingStepBefore,
        skipDetectorMatches: advanced.matches,
      });
    }
  }

  const systemPrompt = composeSystemPrompt(
    config,
    undefined, // guardrailsMarkdown (unused today)
    sopState ?? undefined,
    sopBundle.sop ?? undefined,
    sopBundle.goodbyePhrases.length > 0 ? sopBundle.goodbyePhrases : undefined,
    isOffTopicNow,
    sopBundle.caseTypes.length > 0 ? sopBundle.caseTypes : undefined,
  );
  const contextStoreUrl = auth.contextStoreUrl;

  // Build the tools map. analyzeAndFollowUp is registered ONLY when SOP
  // is in use (no point exposing it to legacy accounts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {
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
          // 010-sop-workflow: snapshot SOP state at capture time.
          sopState,
        });
        return { success: true, leadId: result.leadId, classification: result.classification };
      },
    }),
  };

  if (sopState && sopBundle.sop) {
    tools.analyzeAndFollowUp = analyzeAndFollowUpTool;
  }

  const result = streamText({
    model: google('gemini-2.5-flash'),
    system: systemPrompt,
    messages: fullMessages,
    tools,
    maxSteps: 5,
    onError: (event) => {
      console.error('[chat] Stream error:', event.error);
    },
    onFinish: async ({ text }) => {
      // Persist the assistant turn alongside the latest SOP state in a
      // single update so message history and SOP state stay in sync.
      await appendMessagesAndSOPState(
        sessionId!,
        [
          newUserMessage,
          { role: 'assistant', content: text },
        ],
        sopState,
      );

      // 010-sop-workflow: backfill the lead row's sop_state_snapshot and
      // (if eligible) incident_date with the latest SOP runtime state.
      // Handles the case where captureLead fired earlier in the
      // conversation before the when-step ISO date was captured. No-ops
      // when no lead exists for the session yet.
      await updateLeadSOPState(sessionId!, sopState);

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
  const sopHeaderPayload = buildSOPStateHeader(sopState);
  if (sopHeaderPayload) {
    headers.set('x-sop-state', JSON.stringify(sopHeaderPayload));
  }
  Object.entries(corsHeaders).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
