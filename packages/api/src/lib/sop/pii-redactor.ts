/**
 * PII redaction for SOP captured values displayed in the system prompt
 * and in log payloads (010-sop-workflow Constitution V).
 *
 * Strips:
 *  - Email addresses    → `[email]`
 *  - Phone numbers      → `[phone]`
 *  - Capitalised name patterns (`Jane Doe` style) → `[name]`
 *
 * Pure-functional. No I/O.
 *
 * NOTE: This is a defence-in-depth helper. It is NOT a replacement for the
 * Foundation logger redaction (which operates on whole payload fields).
 * The redactor here protects values that are about to be embedded into
 * the system prompt sent to the LLM — keeping captured PII out of the
 * model context so a misbehaving model can't echo it back.
 */

const EMAIL_REGEX = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Phone-number patterns. Targets common North American formats:
 *   - 555-867-5309
 *   - (555) 867-5309
 *   - 555 867 5309
 *   - 555.867.5309
 *   - +1 555 867 5309
 * Skips ISO dates (YYYY-MM-DD) by requiring a 3-3-4 digit shape.
 */
const PHONE_REGEX = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

/**
 * Capitalised "First Last" name pattern. Conservative: requires both
 * capitalised tokens, both ≥3 chars, separated by a single space. Misses
 * many real names by design; the value is in not over-redacting common
 * English words.
 */
const NAME_REGEX = /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/g;

export function redactPII(input: string): string {
  return input
    .replace(EMAIL_REGEX, '[email]')
    .replace(PHONE_REGEX, '[phone]')
    .replace(NAME_REGEX, '[name]');
}
