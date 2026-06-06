/**
 * Spec 016 US3 T028 — pending-contact detector.
 *
 * Sequence-safe helper that scans a visitor's message for volunteered
 * contact fields (email, phone, optional name) and returns a stashable
 * payload. Used by the chat route (PRE-Step-6) to populate
 * `sopState.pending_contact` so when the runtime reaches Step 6 the
 * advancer can satisfy the step from the stash + a confirmation prompt
 * (FR-005a, research.md R5).
 *
 * Critically: this detector does NOT advance any SOP step on its own.
 * That preserves the spec 010 FR-019 sequence-safety contract — the
 * progress bar advances only when the runtime reaches Step 6 in
 * order, even if the visitor volunteered their contact in turn 1.
 *
 * Returns null when:
 *   - The message contains neither email nor phone (the partial-gate
 *     in FR-002 requires ≥ 1 of those).
 *   - The captured email or phone fails the existing
 *     contactFormPayloadSchema validation (e.g., malformed email).
 *
 * Pure-functional. No I/O.
 */

import type { ContactFormPayload } from '@legal-chatbot/shared';
import { contactFormPayloadSchema } from '@legal-chatbot/shared';

const EMAIL_RE = /[\w.-]+@[\w.-]+\.\w+/;
const PHONE_RE = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const NAME_RE = /(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

export function detectPendingContact(
  message: string,
): ContactFormPayload | null {
  if (!message || message.trim().length === 0) return null;

  const emailMatch = message.match(EMAIL_RE);
  const phoneMatch = message.match(PHONE_RE);
  const nameMatch = message.match(NAME_RE);

  const contact_email = emailMatch ? emailMatch[0]! : null;
  const contact_phone = phoneMatch ? phoneMatch[0]! : null;
  const name = nameMatch ? nameMatch[1]!.trim() || null : null;

  // FR-002 partial-gate: at least one reachable channel.
  if (!contact_email && !contact_phone) return null;

  const parsed = contactFormPayloadSchema.safeParse({
    name,
    contact_email,
    contact_phone,
  });
  if (!parsed.success) return null;
  return parsed.data;
}
