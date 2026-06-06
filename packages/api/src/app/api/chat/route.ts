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
import { detectPendingContact } from '../../../lib/sop/pending-contact-detector';
import {
  runBranchOrchestrator,
  type BranchOrchestratorDeps,
} from '../../../lib/sop/branch-orchestrator';
import { lookupBranch } from '../../../lib/sop/branch-lookup';
import { db, schema } from '../../../db';
import { eq } from 'drizzle-orm';
import { captureLeadToolParams } from './tool-params';
import { buildSOPStateHeader } from '../../../lib/sop/build-sop-state-header';
import { corsHeaders } from './cors';
import type { Manifest, SOPState } from '@legal-chatbot/shared';

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** Read a captured value from SOP state by step slug. Returns null when unset. */
function captureSlugFromState(state: SOPState, slug: string): string | null {
  const step = state.steps.find((s) => s.slug === slug);
  return step?.captured_value ?? null;
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

/* buildSOPStateHeader was inlined here; 014-fix-sop-case-subtypes T020
   extracted it into ../../../lib/sop/build-sop-state-header.ts so it
   can be unit-tested with a caseTypes catalog and so the
   captured_case_type_label field is populated correctly per FR-006. */

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

      // Spec 016 US3 — sequence-safe contact stash (FR-005a).
      // Scan every visitor message for volunteered email/phone/name
      // and stash into sopState.pending_contact. The progress bar
      // does NOT advance on stash; the contact step is satisfied
      // ONLY when the runtime reaches it in sequence (the
      // contact-form short-circuit in advancer.ts handles the
      // hand-off — when Step 6 is the pending step AND
      // pending_contact has a usable payload, the form submit can
      // pre-fill from the stash).
      const pendingContact = detectPendingContact(userText);
      if (pendingContact) {
        // Merge with any existing stash (later messages can fill in
        // a missing field).
        const existing = sopState.pending_contact ?? null;
        sopState = {
          ...sopState,
          pending_contact: {
            name: pendingContact.name ?? existing?.name ?? null,
            contact_email: pendingContact.contact_email ?? existing?.contact_email ?? null,
            contact_phone: pendingContact.contact_phone ?? existing?.contact_phone ?? null,
          },
        };
      }
    }
  }

  // Spec 016 US2 — Branch orchestrator dispatch (T039).
  // After the default 6-step SOP finalizes, route to the configured
  // Branch (FR-008) when one exists for the captured (case_type,
  // sub_type) pair. The orchestrator is idempotent — it noops when
  // the SOP isn't yet finalized or no active branch is configured
  // (FR-007 default-only path).
  let branchPromptDirective: string | null = null;
  let branchFinalizationPayload: {
    snapshot: import('@legal-chatbot/shared').BranchSnapshot;
    score: number | null;
    classification: import('@legal-chatbot/shared').LeadClassification;
    reasons: string[];
  } | null = null;
  if (sopState) {
    const branchDeps: BranchOrchestratorDeps = {
      lookupBranch: ({ accountId, caseTypeSlug, subTypeSlug }) =>
        lookupBranch({ accountId, caseTypeSlug, subTypeSlug }),
      getVersionById: async (versionId) => {
        const rows = await db
          .select()
          .from(schema.branchVersions)
          .where(eq(schema.branchVersions.id, versionId))
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        return {
          id: row.id,
          branch_id: row.branch_id,
          version_number: row.version_number,
          is_published: row.is_published,
          questions: JSON.parse(row.questions_json),
          classification_thresholds: JSON.parse(row.classification_thresholds_json),
          hard_override_toggles: JSON.parse(row.hard_override_toggles_json),
          published_at: row.published_at === null ? null : Number(new Date(row.published_at)),
          created_at: Number(new Date(row.created_at)),
          created_by_user_id: row.created_by_user_id,
        };
      },
      now: () => Date.now(),
    };
    const userText =
      typeof newUserMessage?.content === 'string' ? newUserMessage.content : '';
    const orchestrated = await runBranchOrchestrator({
      accountId: auth.accountId,
      sopState,
      userMessage: userText,
      deps: branchDeps,
    });
    if (orchestrated.action === 'present_question') {
      sopState = orchestrated.updatedSopState;
      const q = orchestrated.question;
      branchPromptDirective =
        `### Branch in flight\n\nThe visitor has completed the default SOP and is now answering ` +
        `a configured branch question for (${captureSlugFromState(sopState, 'case_type')}, ` +
        `${captureSlugFromState(sopState, 'sub_type')}). Ask: "${q.text}"\n\n` +
        (q.chips.length > 0
          ? `Chips will be rendered by the widget; ${q.free_text_allowed ? 'free-text is also accepted' : 'this question accepts chip selection only'}.\n`
          : `This question accepts free-text only.\n`);
    } else if (orchestrated.action === 'awaiting_clarification') {
      sopState = orchestrated.updatedSopState;
      branchPromptDirective =
        `### Branch clarification\n\n${orchestrated.clarificationText}\n` +
        `Re-ask the same branch question politely.\n`;
    } else if (orchestrated.action === 'finalize_with_branch') {
      sopState = orchestrated.updatedSopState;
      branchFinalizationPayload = {
        snapshot: orchestrated.snapshot,
        score: orchestrated.score.score,
        classification: orchestrated.score.classification,
        reasons: orchestrated.score.reasons,
      };
      branchPromptDirective =
        `### Branch finalized\n\nThe configured branch has finished. The lead has been ` +
        `scored and classified as ${orchestrated.score.classification} (score ${orchestrated.score.score}). ` +
        `Thank the visitor briefly and confirm someone from the firm will reach out. ` +
        `Do NOT ask any further intake questions.\n`;
    }
  }

  const systemPrompt =
    composeSystemPrompt(
      config,
      undefined, // guardrailsMarkdown (unused today)
      sopState ?? undefined,
      sopBundle.sop ?? undefined,
      sopBundle.goodbyePhrases.length > 0 ? sopBundle.goodbyePhrases : undefined,
      isOffTopicNow,
      sopBundle.caseTypes.length > 0 ? sopBundle.caseTypes : undefined,
    ) +
    (branchPromptDirective ? `\n\n${branchPromptDirective}` : '');
  const contextStoreUrl = auth.contextStoreUrl;

  // Build the tools map. Per spec 016 FR-035 the agent has exactly two
  // tools in MVP: searchContext and captureLead. The previously
  // conditionally-registered AI follow-up tool was the root-cause of
  // the regression captured in negative-sop-flow.json (it was
  // generating car-accident-specific follow-up questions for arbitrary
  // case types). The branch model in spec 016 supersedes its
  // dynamic-question behaviour with deterministic per-branch dispatch
  // driven by the SOP advancer.
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
      description: 'Capture a qualified lead after gathering sufficient information from the visitor. Call this once you have collected their name, contact info, and understand their legal matter. Classify HOT for time-sensitive factors (statute of limitations, active danger, ongoing medical treatment, court deadlines). Classify SPAM for matters outside the firm practice areas, missing contact info, or obvious test submissions.',
      parameters: captureLeadToolParams,
      execute: async ({ name, contactEmail, contactPhone, caseType, incidentDate, briefDescription, classification, classificationRationale, urgencyFactors }) => {
        // Fallback: when the LLM didn't pass contact fields (because
        // PII redaction stripped them from the system prompt), read
        // them from the SOP state's contact step. Spec 016 FR-002b
        // requires every captured lead to carry at least one of
        // {email, phone}; this fallback ensures we honour that
        // contract even when the agent's tool call is missing fields.
        let resolvedName = name ?? null;
        let resolvedEmail = contactEmail ?? null;
        let resolvedPhone = contactPhone ?? null;
        if (sopState && (resolvedName === null || resolvedEmail === null || resolvedPhone === null)) {
          const contactStep = sopState.steps.find((s) => s.slug === 'contact');
          if (contactStep?.captured_value) {
            try {
              const payload = JSON.parse(contactStep.captured_value) as {
                name?: string | null;
                contact_email?: string | null;
                contact_phone?: string | null;
              };
              resolvedName ??= payload.name ?? null;
              resolvedEmail ??= payload.contact_email ?? null;
              resolvedPhone ??= payload.contact_phone ?? null;
            } catch {
              // Captured value isn't JSON (free-text contact); leave unresolved.
            }
          }
        }
        const result = await captureLead({
          accountId: auth.accountId,
          sessionId: sessionId!,
          name: resolvedName,
          contactEmail: resolvedEmail,
          contactPhone: resolvedPhone,
          caseType: caseType ?? null,
          incidentDate: incidentDate ?? null,
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

      // Spec 016 US2 — When the branch orchestrator finalized the
      // configured-branch flow this turn, write the snapshot + score
      // onto the existing lead row (the agent's earlier captureLead
      // call already created the row; we update it with branch data).
      // No-op when this turn didn't finalize a branch.
      if (branchFinalizationPayload) {
        const reasonsJson = JSON.stringify(branchFinalizationPayload.reasons);
        await db
          .update(schema.leads)
          .set({
            branch_snapshot_json: JSON.stringify(branchFinalizationPayload.snapshot),
            branch_incomplete: false,
            lead_score: branchFinalizationPayload.score,
            classification: branchFinalizationPayload.classification,
            score_reasons_json: reasonsJson,
          })
          .where(eq(schema.leads.session_id, sessionId!));
      }

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
  const sopHeaderPayload = buildSOPStateHeader(sopState, sopBundle.caseTypes);
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
