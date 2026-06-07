/**
 * Lightweight goodbye-phrase matcher.
 *
 * Matches a visitor message case-insensitively against a list of
 * configured goodbye phrases (default-shipped at
 * `seed-defaults/sop.ts:DEFAULT_GOODBYE_PHRASES`). Used by the chat
 * route's branch-orchestrator dispatch to short-circuit further
 * branch-question presentation when the visitor signals the
 * conversation is over — otherwise the orchestrator would
 * immediately surface the next branch question's chips even while
 * the assistant is bidding the visitor goodbye, which is jarring
 * UX (user-reported issue: chips for `Myself / Friend / Family
 * Member` appearing after a goodbye exchange).
 *
 * Match shape:
 *   - Whole-word match. The phrase must be bordered by either
 *     start/end of message OR a non-word character on both sides.
 *     This avoids false positives like "byelaw" matching "bye".
 *   - Case-insensitive.
 *   - Smart-apostrophe normalised to ASCII apostrophe so the
 *     seeded phrase `that\u2019s all` matches both straight-quote
 *     and curly-quote inputs.
 *
 * The function is intentionally cheap (regex per-phrase) so it can
 * run on every chat turn without measurable cost.
 */

const SMART_APOSTROPHE_RE = /[\u2018\u2019\u201A\u201B]/g;

function normaliseForMatch(s: string): string {
  return s.toLowerCase().replace(SMART_APOSTROPHE_RE, "'");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns true when `message` contains any of the `phrases` as a
 * standalone whole word (or word phrase). An empty `phrases` list
 * returns false (no detector configured).
 */
export function isGoodbyeMessage(
  message: string,
  phrases: readonly string[],
): boolean {
  if (!message || phrases.length === 0) return false;
  const normalisedMessage = normaliseForMatch(message);
  for (const phrase of phrases) {
    if (!phrase) continue;
    const normalisedPhrase = normaliseForMatch(phrase);
    // Whole-word match: lookbehind/lookahead boundary characters.
    // Word characters (\w = a-zA-Z0-9_) on either side disqualify.
    const re = new RegExp(`(^|\\W)${escapeRegex(normalisedPhrase)}(\\W|$)`);
    if (re.test(normalisedMessage)) return true;
  }
  return false;
}
