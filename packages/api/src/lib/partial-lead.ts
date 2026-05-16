import { nanoid } from 'nanoid';
import { db } from '../db';
import { leads } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface PartialLeadData {
  name: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  briefDescription: string | null;
}

/**
 * Extract partial lead data from conversation messages using simple heuristics.
 * Scans user messages for email, phone, name patterns and uses the first
 * substantive message as a brief description.
 */
export function extractPartialLeadData(
  messages: Array<{ role: string; content: string }>,
): PartialLeadData {
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ');

  // Extract email
  const emailMatch = userText.match(/[\w.-]+@[\w.-]+\.\w+/);
  const contactEmail = emailMatch ? emailMatch[0] : null;

  // Extract phone (US-style: optional parens around area code, separators)
  const phoneMatch = userText.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  const contactPhone = phoneMatch ? phoneMatch[0] : null;

  // Extract name from common patterns
  const nameMatch = userText.match(
    /(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
  );
  const name = nameMatch ? nameMatch[1] : null;

  // Brief description: first user message longer than 20 chars
  const firstSubstantiveMessage =
    messages
      .filter((m) => m.role === 'user' && m.content.length > 20)
      .map((m) => m.content)[0] || null;

  return {
    name,
    contactEmail,
    contactPhone,
    briefDescription: firstSubstantiveMessage,
  };
}

/**
 * Classify a partial lead based on conversation content heuristics.
 * Returns 'urgent' if the conversation contains urgency signals,
 * 'normal' if it describes a legal matter, 'unqualified' otherwise.
 */
export function classifyPartialLead(
  messages: Array<{ role: string; content: string }>,
): { classification: 'urgent' | 'normal' | 'unqualified'; rationale: string } {
  const userText = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join(' ')
    .toLowerCase();

  // Urgency signals
  const urgencyPatterns = [
    /\b(today|yesterday|just|this morning|last night|right now|currently)\b/,
    /\b(arrested|detained|custody|jail|locked up|booked)\b/,
    /\b(emergency|immediate|urgent|asap|right away)\b/,
    /\b(court date|hearing|arraignment|deadline)\b/,
    /\b(human|representative|real person|speak to someone|talk to a lawyer)\b/,
    /\b(danger|threatened|violence|restraining)\b/,
  ];

  const urgencyHits = urgencyPatterns.filter((p) => p.test(userText));

  // Legal matter signals
  const legalPatterns = [
    /\b(charged|arrested|caught|accused|cited|ticket)\b/,
    /\b(dui|dwi|drunk driving|cocaine|marijuana|drugs|possession)\b/,
    /\b(assault|theft|robbery|fraud|gun|weapon)\b/,
    /\b(divorce|custody|injury|accident|malpractice)\b/,
    /\b(lawyer|attorney|legal help|representation)\b/,
  ];

  const legalHits = legalPatterns.filter((p) => p.test(userText));

  if (urgencyHits.length >= 1 && legalHits.length >= 1) {
    return {
      classification: 'urgent',
      rationale: `Partial lead with urgency signals: ${urgencyHits.map((p) => userText.match(p)?.[0]).join(', ')}`,
    };
  }

  if (legalHits.length >= 1) {
    return {
      classification: 'normal',
      rationale: `Partial lead describing a legal matter`,
    };
  }

  return {
    classification: 'unqualified',
    rationale: 'Partial data from abandoned session — no clear legal matter identified',
  };
}

/**
 * Save partial lead data to the database for abandoned session recovery.
 * Skips if a full lead already exists for this session or if there is
 * no useful data to save. Classifies based on conversation content.
 */
export async function savePartialLead(
  accountId: string,
  sessionId: string,
  partial: PartialLeadData,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  // Check if a full lead already exists for this session
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.session_id, sessionId));

  if (rows[0]) return; // Full lead already captured

  // Only save if we have at least some useful data
  if (
    !partial.contactEmail &&
    !partial.contactPhone &&
    !partial.briefDescription
  ) {
    return;
  }

  const { classification, rationale } = classifyPartialLead(messages);

  await db.insert(leads)
    .values({
      id: nanoid(),
      account_id: accountId,
      session_id: sessionId,
      name: partial.name,
      contact_email: partial.contactEmail,
      contact_phone: partial.contactPhone,
      case_type: null,
      incident_date: null,
      brief_description: partial.briefDescription,
      classification,
      classification_rationale: rationale,
      urgency_factors_json: '[]',
      status: 'new',
      created_at: new Date().toISOString(),
    });
}
