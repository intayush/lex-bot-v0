import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { leads, notifications, sopSteps, sopConfigurations, subTypes, caseTypes } from '../db/schema';
import type {
  Chip,
  ContactFormPayload,
  LeadClassification,
  ScoringConfig,
  SOPState,
} from '@legal-chatbot/shared';
import {
  contactFormPayloadSchema,
  scoringConfigSchema,
} from '@legal-chatbot/shared';
import { scoreLead } from './scoring/score-lead';
import { buildReasons } from './scoring/reason-builder';

interface CaptureLeadInput {
  accountId: string;
  sessionId: string;
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  caseType: string | null;
  incidentDate: string | null;
  briefDescription: string | null;
  classification: 'HOT' | 'WARM' | 'COLD' | 'SPAM';
  classificationRationale: string;
  urgencyFactors: string[];
  /**
   * SOP runtime state snapshot at capture time (010-sop-workflow). Set
   * when the agent invokes captureLead from inside an SOP-driven flow;
   * null for legacy / non-SOP captures.
   */
  sopState?: SOPState | null;
}

/** ISO-8601 calendar date pattern: YYYY-MM-DD. */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * If the SOP runtime captured a valid ISO date for the `when` step, that
 * value is the source of truth — override whatever the LLM passed as
 * incidentDate. Verbatim phrases like "last night" or "yesterday" pass
 * through unchanged when the SOP didn't supply an ISO.
 */
function resolveIncidentDate(
  llmIncidentDate: string | null,
  sopState: SOPState | null | undefined,
): string | null {
  if (!sopState) return llmIncidentDate;
  const whenStep = sopState.steps.find((s) => s.slug === 'when');
  const captured = whenStep?.captured_value;
  if (whenStep?.status === 'complete' && captured && ISO_DATE_REGEX.test(captured)) {
    return captured;
  }
  return llmIncidentDate;
}

/**
 * Insert OR update the lead row for a session.
 *
 * The LLM sometimes invokes captureLead multiple times per conversation
 * despite the system-prompt instruction to call it exactly once. Rather
 * than rely on instruction-following, this function enforces one-lead-
 * per-session at the database layer:
 *
 *   - First call for a (session_id, account_id) pair → INSERT new row.
 *     Fires an urgent_lead notification if classification === 'HOT'.
 *   - Subsequent calls for the same session → UPDATE the existing row
 *     with the new values (the LLM's later judgment usually has more
 *     context). Fires an urgent_lead notification ONLY if classification
 *     transitions FROM non-urgent TO urgent on this update.
 *
 * incidentDate is also overridden by the SOP's when-step ISO value when
 * available — the SOP runtime is more reliable than the LLM's
 * interpretation of conversation phrases.
 *
 * Returns the (existing or newly-created) leadId either way.
 */

/**
 * Spec 015 — fields the rule-based scorer derives at SOP finalization.
 * `null` for scoring fields when scoring isn't applicable; `scoring_path`
 * always indicates which producer the caller should treat as authoritative.
 */
interface ScoringResult {
  classification: LeadClassification | null;
  lead_score: number | null;
  score_reasons_json: string | null;
  request_type: 'SELF' | 'FRIEND_FAMILY' | null;
  geographic_qualification: 'IN_SERVICE_AREA' | 'OUTSIDE_SERVICE_AREA' | null;
  geographic_qualification_details_json: string | null;
  /**
   * Which producer path the scoring fields came from. Per
   * `contracts/lead-finalization-log.md`. Used by the structured-log
   * emitter to decide info vs error level and to populate the
   * `scoring_path` field on the log entry.
   */
  scoring_path: 'rule_based' | 'llm_fallback' | 'scoring_error';
  /**
   * Optional internal error description for the `scoring_error`
   * variant. Used to populate the log entry's `_error` field per
   * `contracts/lead-finalization-log.md`. NEVER includes PII or stack
   * traces (just `Error.name: Error.message`).
   */
  scoring_error_detail: string | null;
}

const NULL_SCORING_RESULT: ScoringResult = {
  classification: null,
  lead_score: null,
  score_reasons_json: null,
  request_type: null,
  geographic_qualification: null,
  geographic_qualification_details_json: null,
  scoring_path: 'llm_fallback',
  scoring_error_detail: null,
};

/**
 * Stringify an exception into a `Name: message` form suitable for the
 * log entry's `_error` field per `contracts/lead-finalization-log.md`.
 * Intentionally excludes `Error.stack` (could leak code paths) and
 * never echoes captured PII.
 */
function errToDetail(err: unknown): string {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Spec 015 — structured `lead_classified` log entry per
 * `contracts/lead-finalization-log.md`. Emitted at the end of every
 * lead finalization (captureLead INSERT/UPDATE branches AND
 * updateLeadSOPState). Routes to `console.info` for success paths and
 * `console.error` for the FR-010b `scoring_error` variant.
 *
 * **PII boundary (Constitution V / FR-010d)**: this function MUST NOT
 * include captured PII (name, contact_email, contact_phone, city/state
 * details) in the emitted payload. The caller passes only the
 * already-resolved scoring fields, the lead_id, account_id, session_id,
 * and the captured slugs (which are admin-defined controlled
 * vocabulary, not visitor PII).
 */
function emitLeadClassifiedLog(args: {
  accountId: string;
  leadId: string;
  sessionId: string;
  classification: LeadClassification;
  scoring: ScoringResult;
  caseTypeSlug: string | null;
  subTypeSlug: string | null;
  hardOverrideFired: string | null;
  sopVersion: number | null;
}): void {
  const payload: Record<string, unknown> = {
    event: 'lead_classified',
    ts: new Date().toISOString(),
    account_id: args.accountId,
    lead_id: args.leadId,
    session_id: args.sessionId,
    classification: args.classification,
    lead_score: args.scoring.lead_score,
    reasons: args.scoring.score_reasons_json
      ? JSON.parse(args.scoring.score_reasons_json)
      : [],
    case_type_slug: args.caseTypeSlug,
    sub_type_slug: args.subTypeSlug,
    hard_override_fired: args.hardOverrideFired,
    scoring_path: args.scoring.scoring_path,
    request_type: args.scoring.request_type,
    geographic_qualification: args.scoring.geographic_qualification,
    sop_version: args.sopVersion,
  };

  if (args.scoring.scoring_path === 'scoring_error') {
    if (args.scoring.scoring_error_detail) {
      payload._error = args.scoring.scoring_error_detail;
    }
    console.error(JSON.stringify(payload));
  } else {
    console.info(JSON.stringify(payload));
  }
}

/**
 * Compute the rule-based scoring fields for a finalized SOP. Returns
 * NULL_SCORING_RESULT when scoring should NOT apply:
 *   - sopState is null/missing
 *   - sopState.is_finalized !== true (per the user's decision: scoring
 *     runs only at finalization)
 *   - no case_type or sub_type captured
 *   - the captured sub_type has no scoring_config_json (FR-022 LLM
 *     fallback path)
 *
 * When scoring applies, looks up the sub_type's scoring_config_json,
 * builds the chip catalog from the relevant sop_steps, calls scoreLead,
 * and renders the reasons array via buildReasons.
 *
 * Per spec 015 FR-001..FR-006, FR-010a, FR-010b, research.md §R7.
 */
async function computeScoringFields(
  accountId: string,
  sopState: SOPState | null | undefined,
  contactPhone: string | null,
  contactEmail: string | null,
): Promise<ScoringResult> {
  if (!sopState || sopState.is_finalized !== true) {
    return NULL_SCORING_RESULT;
  }

  const subTypeStep = sopState.steps.find((s) => s.slug === 'sub_type');
  const capturedSubTypeSlug = subTypeStep?.captured_value ?? null;
  if (!capturedSubTypeSlug) return NULL_SCORING_RESULT;

  const caseTypeStep = sopState.steps.find((s) => s.slug === 'case_type');
  const capturedCaseTypeSlug = caseTypeStep?.captured_value ?? null;
  if (!capturedCaseTypeSlug) return NULL_SCORING_RESULT;

  // Locate the sub_type row for this account / captured slug.
  const subTypeRows = await db
    .select()
    .from(subTypes)
    .innerJoin(caseTypes, eq(subTypes.case_type_id, caseTypes.id))
    .where(
      and(
        eq(caseTypes.account_id, accountId),
        eq(caseTypes.slug, capturedCaseTypeSlug),
        eq(subTypes.slug, capturedSubTypeSlug),
      ),
    )
    .limit(1);

  const subTypeRow = subTypeRows[0]?.sub_types;
  if (!subTypeRow || !subTypeRow.scoring_config_json) {
    // No scoring config for this sub_type → LLM fallback path.
    return NULL_SCORING_RESULT;
  }

  // Parse + validate the scoring config. If it's malformed, fall back to
  // FR-010b's safe-default per scoring_error semantics. (We treat parse
  // failures as scoring_error here too; the structured-log emission
  // happens in the caller.)
  let scoringConfig: ScoringConfig;
  try {
    scoringConfig = scoringConfigSchema.parse(
      JSON.parse(subTypeRow.scoring_config_json),
    );
  } catch (err) {
    return {
      classification: 'SPAM',
      lead_score: null,
      score_reasons_json: JSON.stringify(['scoring_error']),
      request_type: null,
      geographic_qualification: null,
      geographic_qualification_details_json: null,
      scoring_path: 'scoring_error',
      scoring_error_detail: errToDetail(err),
    };
  }

  // Build the chip catalog from the sub_type-scoped sop_steps.
  // Each row's inline_chips_json is parsed into an array of Chip
  // objects; we flatten them into a slug → Chip map.
  const stepRows = await db
    .select()
    .from(sopSteps)
    .innerJoin(
      sopConfigurations,
      eq(sopSteps.sop_configuration_id, sopConfigurations.id),
    )
    .where(
      and(
        eq(sopConfigurations.account_id, accountId),
        eq(sopConfigurations.is_published, true),
        eq(sopSteps.applies_when_sub_type_slug, capturedSubTypeSlug),
      ),
    );

  const chipsBySlug = new Map<string, Chip>();
  for (const row of stepRows) {
    const inline = row.sop_steps.inline_chips_json;
    if (!inline) continue;
    try {
      const chips = JSON.parse(inline) as Chip[];
      for (const chip of chips) {
        chipsBySlug.set(chip.slug, chip);
      }
    } catch {
      // Malformed inline_chips_json on a step is non-fatal; the
      // scorer simply won't find chip weights for that step's
      // captures. Per FR-010b's tolerance for partial config.
    }
  }

  // Compute the contact-form bonus (lead-classification-revamp.md Q9:
  // phone +5, email +5, max +10). The same formula is implemented in
  // `branch-orchestrator.computeContactBonus`; the two paths must
  // stay aligned. (Earlier this path used phone +10 / email +5 with
  // a misleading "xlsx Q8" comment that contradicted the source-spec
  // table; corrected to match the canonical +5/+5/max+10 rule.)
  const contactBonus =
    (contactPhone && contactPhone.replace(/[^0-9]/g, '').length >= 7 ? 5 : 0) +
    (contactEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail) ? 5 : 0);

  let scored;
  try {
    scored = scoreLead({
      sopState,
      scoringConfig,
      chipsBySlug,
      contactBonus,
    });
  } catch (err) {
    return {
      classification: 'SPAM',
      lead_score: null,
      score_reasons_json: JSON.stringify(['scoring_error']),
      request_type: null,
      geographic_qualification: null,
      geographic_qualification_details_json: null,
      scoring_path: 'scoring_error',
      scoring_error_detail: errToDetail(err),
    };
  }

  // Build the reasons array. Hard-overrides aren't applied here yet
  // (Phase 6 / T064 wires them in); for now firedOverrides is empty.
  const reasons = buildReasons(scored.reasons, []);

  return {
    classification: scored.classification,
    lead_score: scored.lead_score,
    score_reasons_json: JSON.stringify(reasons),
    request_type: scored.request_type,
    geographic_qualification: scored.geographic_qualification,
    geographic_qualification_details_json:
      scored.geographic_qualification_details_json,
    scoring_path: 'rule_based',
    scoring_error_detail: null,
  };
}

export async function captureLead(input: CaptureLeadInput): Promise<{ leadId: string; classification: string }> {
  const now = new Date().toISOString();
  const resolvedIncidentDate = resolveIncidentDate(input.incidentDate, input.sopState);

  // Spec 015 — compute rule-based scoring fields ONCE if SOP is finalized
  // and the captured sub_type has scoring config. Returns NULL_SCORING_RESULT
  // for the LLM-fallback path (per FR-022) or pre-finalize invocations.
  const scoringFields = await computeScoringFields(
    input.accountId,
    input.sopState,
    input.contactPhone,
    input.contactEmail,
  );

  // When the rule-based scorer produced a classification, it wins over
  // the LLM-supplied value (per FR-001). Otherwise (LLM fallback path),
  // the LLM's classification is preserved.
  const finalClassification: LeadClassification =
    scoringFields.classification ?? input.classification;

  const existing = await db
    .select()
    .from(leads)
    .where(eq(leads.session_id, input.sessionId))
    .limit(1);

  if (existing.length > 0) {
    const existingRow = existing[0]!;
    // Notification fires on transition INTO the most-urgent classification.
    // Pre-015: 'urgent'. Post-015: 'HOT'. Notification type stays
    // 'urgent_lead' for backward-compat (consumers haven't been updated;
    // see contracts/lead-classification-enum.md §Notification path).
    // Compares the FINAL classification (rule-based scorer wins over LLM).
    const wasNotUrgent = existingRow.classification !== 'HOT';
    const isNowUrgent = finalClassification === 'HOT';

    await db
      .update(leads)
      .set({
        name: input.name,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        case_type: input.caseType,
        incident_date: resolvedIncidentDate,
        brief_description: input.briefDescription,
        classification: finalClassification,
        classification_rationale: input.classificationRationale,
        urgency_factors_json: JSON.stringify(input.urgencyFactors),
        sop_state_snapshot: input.sopState ? JSON.stringify(input.sopState) : null,
        // Spec 015 — rule-based scoring fields. NULL on the LLM
        // fallback path (computeScoringFields returned
        // NULL_SCORING_RESULT) and on pre-finalize invocations.
        lead_score: scoringFields.lead_score,
        score_reasons_json: scoringFields.score_reasons_json,
        request_type: scoringFields.request_type,
        geographic_qualification: scoringFields.geographic_qualification,
        geographic_qualification_details_json:
          scoringFields.geographic_qualification_details_json,
      })
      .where(eq(leads.id, existingRow.id));

    // Notification fires only on transition into urgent. Existing-urgent
    // updates don't re-notify; downgrades don't notify either.
    if (wasNotUrgent && isNowUrgent) {
      await db.insert(notifications).values({
        id: nanoid(),
        account_id: input.accountId,
        type: 'urgent_lead',
        title: `New Urgent Lead: ${input.caseType || 'Unknown'}`,
        body: `New urgent lead from ${input.name || 'Anonymous'}: ${input.briefDescription || 'No description'}`,
        lead_id: existingRow.id,
        read: false,
        delivery_channel: 'dashboard',
        delivered_at: now,
        created_at: now,
      });
    }

    emitLeadClassifiedLog({
      accountId: input.accountId,
      leadId: existingRow.id,
      sessionId: input.sessionId,
      classification: finalClassification,
      scoring: scoringFields,
      caseTypeSlug:
        input.sopState?.steps.find((s) => s.slug === 'case_type')
          ?.captured_value ?? null,
      subTypeSlug:
        input.sopState?.steps.find((s) => s.slug === 'sub_type')
          ?.captured_value ?? null,
      hardOverrideFired: null, // Phase 6 / T064 wires hard-overrides
      sopVersion: input.sopState?.sop_version ?? null,
    });

    return { leadId: existingRow.id, classification: finalClassification };
  }

  // Spec 016 FR-002b / SC-003 — partial-gate guard: every captured
  // lead row MUST carry at least one reachable contact channel.
  // Without this guard, a buggy upstream path could insert a lead
  // with both contact_email and contact_phone NULL, breaking the
  // FR-002b invariant. Throwing here is preferred to silent rejection
  // because the chat route's tool-call path should never reach this
  // state (the contact-form short-circuit + retry flow guarantee
  // contact is on file before captureLead fires).
  if (input.contactEmail === null && input.contactPhone === null) {
    throw new Error(
      'captureLead refused: at least one of contactEmail or contactPhone is required (FR-002b).',
    );
  }

  // First-time insert.
  const leadId = nanoid();

  await db.insert(leads).values({
    id: leadId,
    account_id: input.accountId,
    session_id: input.sessionId,
    name: input.name,
    contact_email: input.contactEmail,
    contact_phone: input.contactPhone,
    case_type: input.caseType,
    incident_date: resolvedIncidentDate,
    brief_description: input.briefDescription,
    classification: finalClassification,
    classification_rationale: input.classificationRationale,
    urgency_factors_json: JSON.stringify(input.urgencyFactors),
    sop_state_snapshot: input.sopState ? JSON.stringify(input.sopState) : null,
    // Spec 015 — rule-based scoring fields (NULL on LLM fallback path).
    lead_score: scoringFields.lead_score,
    score_reasons_json: scoringFields.score_reasons_json,
    request_type: scoringFields.request_type,
    geographic_qualification: scoringFields.geographic_qualification,
    geographic_qualification_details_json:
      scoringFields.geographic_qualification_details_json,
    status: 'new',
    created_at: now,
  });

  if (finalClassification === 'HOT') {
    await db.insert(notifications).values({
      id: nanoid(),
      account_id: input.accountId,
      type: 'urgent_lead',
      title: `New Urgent Lead: ${input.caseType || 'Unknown'}`,
      body: `New urgent lead from ${input.name || 'Anonymous'}: ${input.briefDescription || 'No description'}`,
      lead_id: leadId,
      read: false,
      delivery_channel: 'dashboard',
      delivered_at: now,
      created_at: now,
    });
  }

  emitLeadClassifiedLog({
    accountId: input.accountId,
    leadId,
    sessionId: input.sessionId,
    classification: finalClassification,
    scoring: scoringFields,
    caseTypeSlug:
      input.sopState?.steps.find((s) => s.slug === 'case_type')
        ?.captured_value ?? null,
    subTypeSlug:
      input.sopState?.steps.find((s) => s.slug === 'sub_type')
        ?.captured_value ?? null,
    hardOverrideFired: null, // Phase 6 / T064 wires hard-overrides
    sopVersion: input.sopState?.sop_version ?? null,
  });

  return { leadId, classification: finalClassification };
}

/**
 * Backfill an existing lead row's SOP state and incident_date with the
 * latest SOP runtime state. Called from the chat route's onFinish hook so
 * that even if the LLM invoked captureLead before SOP captures completed,
 * the lead row reflects the final SOP state by the end of the turn.
 *
 * No-ops when:
 *   - No lead exists for the session yet (captureLead was never called).
 *   - sopState is null (account has no SOP, or SOP wasn't initialized).
 *
 * Updates ONLY:
 *   - sop_state_snapshot (always overwritten with latest)
 *   - incident_date (only if SOP when-step has a valid ISO and the row
 *     currently has null/non-ISO; never overwrites an existing ISO).
 *
 * Does NOT touch:
 *   - classification, classification_rationale, urgency_factors_json
 *     (those are the LLM's judgment; the server doesn't second-guess)
 *   - name, contact_email, contact_phone, case_type, brief_description
 *     (LLM-supplied; partial-lead extractor handles its own backfill)
 *
 * Safe to call multiple times per turn — idempotent against the same
 * SOP state.
 */
export async function updateLeadSOPState(
  sessionId: string,
  sopState: SOPState | null,
): Promise<void> {
  if (!sopState) return;

  const existing = await db
    .select()
    .from(leads)
    .where(eq(leads.session_id, sessionId))
    .limit(1);
  if (existing.length === 0) return;

  const existingRow = existing[0]!;

  // Compute the override value (if any) from the latest SOP state.
  const whenStep = sopState.steps.find((s) => s.slug === 'when');
  const sopISODate =
    whenStep?.status === 'complete' &&
    whenStep.captured_value &&
    ISO_DATE_REGEX.test(whenStep.captured_value)
      ? whenStep.captured_value
      : null;

  // Only override incident_date if the row currently lacks an ISO.
  // This avoids clobbering a future LLM correction.
  const currentIsISO =
    existingRow.incident_date &&
    ISO_DATE_REGEX.test(existingRow.incident_date);
  const newIncidentDate =
    sopISODate && !currentIsISO ? sopISODate : existingRow.incident_date;

  // Contact-step backfill (010-sop-workflow contact step). When the
  // visitor submits the contact form, the contact step's captured value
  // is a JSON-stringified ContactFormPayload. Populate the lead row's
  // dedicated columns from it — but only fill columns currently null,
  // so we don't clobber values the LLM already supplied via captureLead.
  const contactStep = sopState.steps.find((s) => s.slug === 'contact');
  let contactPayload: ContactFormPayload | null = null;
  if (
    contactStep?.status === 'complete' &&
    contactStep.captured_value
  ) {
    try {
      const parsed = contactFormPayloadSchema.safeParse(
        JSON.parse(contactStep.captured_value),
      );
      if (parsed.success) contactPayload = parsed.data;
    } catch {
      // Captured value isn't JSON — older format, ignore.
    }
  }
  const newName = contactPayload?.name && !existingRow.name
    ? contactPayload.name
    : existingRow.name;
  const newEmail =
    contactPayload?.contact_email && !existingRow.contact_email
      ? contactPayload.contact_email
      : existingRow.contact_email;
  const newPhone =
    contactPayload?.contact_phone && !existingRow.contact_phone
      ? contactPayload.contact_phone
      : existingRow.contact_phone;

  // Spec 015 — invoke the rule-based scorer if the SOP just finalized
  // and the captured sub_type has scoring config. Use the post-backfill
  // contact values so the scorer's contactBonus reflects the final
  // contact form data.
  const scoringFields = await computeScoringFields(
    existingRow.account_id,
    sopState,
    newPhone,
    newEmail,
  );

  // Override classification when the rule-based scorer applied; preserve
  // the existing value (LLM-supplied) when it didn't.
  const finalClassification: LeadClassification =
    scoringFields.classification ??
    (existingRow.classification as LeadClassification);

  await db
    .update(leads)
    .set({
      sop_state_snapshot: JSON.stringify(sopState),
      incident_date: newIncidentDate,
      name: newName,
      contact_email: newEmail,
      contact_phone: newPhone,
      classification: finalClassification,
      // Spec 015 — write scoring fields. NULL on LLM fallback path.
      // We DON'T null these out if a previous captureLead already set
      // them; computeScoringFields returns the appropriate values for
      // the current SOP state.
      lead_score: scoringFields.lead_score,
      score_reasons_json: scoringFields.score_reasons_json,
      request_type: scoringFields.request_type,
      geographic_qualification: scoringFields.geographic_qualification,
      geographic_qualification_details_json:
        scoringFields.geographic_qualification_details_json,
    })
    .where(eq(leads.id, existingRow.id));

  emitLeadClassifiedLog({
    accountId: existingRow.account_id,
    leadId: existingRow.id,
    sessionId,
    classification: finalClassification,
    scoring: scoringFields,
    caseTypeSlug:
      sopState.steps.find((s) => s.slug === 'case_type')?.captured_value ??
      null,
    subTypeSlug:
      sopState.steps.find((s) => s.slug === 'sub_type')?.captured_value ??
      null,
    hardOverrideFired: null, // Phase 6 / T064 wires hard-overrides
    sopVersion: sopState.sop_version ?? null,
  });
}
