import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { leads, notifications } from '../db/schema';
import type { SOPState } from '@legal-chatbot/shared';

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
 * Returns the (existing or newly-created) leadId either way.
 */
export async function captureLead(input: CaptureLeadInput): Promise<{ leadId: string; classification: string }> {
  const now = new Date().toISOString();

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
        incident_date: input.incidentDate,
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
    incident_date: input.incidentDate,
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
