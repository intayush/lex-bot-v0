/**
 * Contact-form capture helper.
 *
 * Spec 010 origin: the widget renders an input form for the contact
 * step. On submit, it dispatches a human-readable message ("My name
 * is Jane Doe, my email is jane@example.com") via the existing
 * useChat flow. The advancer detects the contact-form pending step
 * and uses these patterns to extract a structured ContactFormPayload.
 *
 * Spec 016 Q1 (FR-002 / T027): partial-gate satisfaction. Name is
 * OPTIONAL; the predicate is satisfied as long as at least one of
 * (contact_email, contact_phone) is present. Refusal of BOTH email
 * AND phone returns null so the SOP runtime can engage the FR-002a
 * retry flow.
 *
 * Reuses the same regex patterns as `lib/partial-lead.ts` so the form
 * input format and free-text "I'm Jane, jane@x.com" both work.
 *
 * Pure-functional. No I/O.
 */
import type { ContactFormPayload } from '@legal-chatbot/shared';
import { contactFormPayloadSchema } from '@legal-chatbot/shared';

const EMAIL_RE = /[\w.-]+@[\w.-]+\.\w+/;
const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const NAME_RE = /(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

/**
 * Try to extract a contact-form payload from the visitor's message.
 *
 * Returns null when extraction yields neither email nor phone — at
 * least one of those is the FR-002 partial-gate. When null, the
 * advancer leaves the contact step pending so the form re-renders
 * (or, after FR-002a's two retries, transitions to
 * `terminated_no_contact`).
 *
 * Name is now OPTIONAL per FR-002: the visitor can satisfy Step 6
 * with just an email or phone number. The schema field is still
 * `string().min(1)` when present, so empty-string-name extractions
 * are coerced to null.
 */
export function extractContactPayload(message: string): ContactFormPayload | null {
  const emailMatch = message.match(EMAIL_RE);
  const phoneMatch = message.match(PHONE_RE);
  const nameMatch = message.match(NAME_RE);

  const name = nameMatch ? nameMatch[1]!.trim() || null : null;
  const contact_email = emailMatch ? emailMatch[0]! : null;
  const contact_phone = phoneMatch ? phoneMatch[0]! : null;

  // Partial-gate (FR-002): require ≥ 1 reachable channel.
  if (!contact_email && !contact_phone) return null;

  const parsed = contactFormPayloadSchema.safeParse({
    name,
    contact_email,
    contact_phone,
  });
  if (!parsed.success) return null;
  return parsed.data;
}
