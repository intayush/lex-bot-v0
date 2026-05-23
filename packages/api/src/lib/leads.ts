import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, notifications } from '../db/schema';
import type { ContactFormPayload, SOPState } from '@legal-chatbot/shared';
import { contactFormPayloadSchema } from '@legal-chatbot/shared';

interface CaptureLeadInput {
  accountId: string;
  sessionId: string;
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  caseType: string | null;
  incidentDate: string | null;
  briefDescription: string | null;
  classification: 'urgent' | 'normal' | 'unqualified';
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
 *     Fires an urgent_lead notification if classification === 'urgent'.
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
export async function captureLead(input: CaptureLeadInput): Promise<{ leadId: string; classification: string }> {
  const now = new Date().toISOString();
  const resolvedIncidentDate = resolveIncidentDate(input.incidentDate, input.sopState);

  const existing = await db
    .select()
    .from(leads)
    .where(eq(leads.session_id, input.sessionId))
    .limit(1);

  if (existing.length > 0) {
    const existingRow = existing[0]!;
    const wasNotUrgent = existingRow.classification !== 'urgent';
    const isNowUrgent = input.classification === 'urgent';

    await db
      .update(leads)
      .set({
        name: input.name,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        case_type: input.caseType,
        incident_date: resolvedIncidentDate,
        brief_description: input.briefDescription,
        classification: input.classification,
        classification_rationale: input.classificationRationale,
        urgency_factors_json: JSON.stringify(input.urgencyFactors),
        sop_state_snapshot: input.sopState ? JSON.stringify(input.sopState) : null,
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

    return { leadId: existingRow.id, classification: input.classification };
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
    classification: input.classification,
    classification_rationale: input.classificationRationale,
    urgency_factors_json: JSON.stringify(input.urgencyFactors),
    sop_state_snapshot: input.sopState ? JSON.stringify(input.sopState) : null,
    status: 'new',
    created_at: now,
  });

  if (input.classification === 'urgent') {
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

  return { leadId, classification: input.classification };
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

  await db
    .update(leads)
    .set({
      sop_state_snapshot: JSON.stringify(sopState),
      incident_date: newIncidentDate,
      name: newName,
      contact_email: newEmail,
      contact_phone: newPhone,
    })
    .where(eq(leads.id, existingRow.id));
}
