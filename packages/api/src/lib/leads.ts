import { nanoid } from 'nanoid';
import { db } from '../db';
import { leads, notifications } from '../db/schema';

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
}

export async function captureLead(input: CaptureLeadInput): Promise<{ leadId: string; classification: string }> {
  const leadId = nanoid();
  const now = new Date().toISOString();

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
