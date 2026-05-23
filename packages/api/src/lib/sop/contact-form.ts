/**
 * Contact-form capture helper (010-sop-workflow contact step).
 *
 * The widget renders an input form for the contact step. On submit, it
 * dispatches a human-readable message ("My name is Jane Doe, my email
 * is jane@example.com") via the existing useChat flow. The advancer
 * detects the contact-form pending step and uses these patterns to
 * extract a structured ContactFormPayload. If extraction yields a
 * valid payload (name + at least one of email/phone), the step is
 * captured with the JSON-stringified payload as its value.
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
 * Returns null if extraction yields incomplete data (no name, OR no
 * email AND no phone). When null, the advancer leaves the contact
 * step pending so the form re-renders and the visitor can fix.
 */
export function extractContactPayload(message: string): ContactFormPayload | null {
  const emailMatch = message.match(EMAIL_RE);
  const phoneMatch = message.match(PHONE_RE);
  const nameMatch = message.match(NAME_RE);

  const name = nameMatch ? nameMatch[1]!.trim() : null;
  const contact_email = emailMatch ? emailMatch[0]! : null;
  const contact_phone = phoneMatch ? phoneMatch[0]! : null;

  // Validation: name AND (email OR phone)
  if (!name) return null;
  if (!contact_email && !contact_phone) return null;

  // Use the schema's safeParse to defend against bad regex captures
  // (e.g., a name-pattern that captured something invalid).
  const parsed = contactFormPayloadSchema.safeParse({
    name,
    contact_email,
    contact_phone,
  });
  if (!parsed.success) return null;
  return parsed.data;
}
