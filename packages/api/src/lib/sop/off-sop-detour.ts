/**
 * Off-SOP detour detector (010-sop-workflow T044).
 *
 * Pure-functional. Decides whether the visitor's current message is
 * off-topic relative to the SOP's currently-pending step. The route
 * handler uses this signal to add a stronger directive to the system
 * prompt: "answer the visitor's question, then re-prompt the pending
 * step's question".
 *
 * Heuristic (research.md R5):
 *   1. If skip-detector found ANY captures for this turn → on-topic.
 *      The visitor IS answering an SOP step (possibly multiple).
 *   2. If there's no pending step (SOP finalized or all complete) →
 *      not off-topic; no detour needed.
 *   3. Otherwise count keyword overlap between the message and the
 *      pending step's question text, ignoring stop words. If > 1 real
 *      overlap → on-topic (visitor likely answering in a way the
 *      detector didn't catch). Otherwise → off-topic.
 *
 * Phase 4's skip-detector handles overcapture (false-positive matches
 * for ambiguous messages); off-SOP detour deals only with the case
 * where skip-detector returns 0 matches.
 */
import type { SOPConfiguration } from '@legal-chatbot/shared';
import type { SkipDetectorMatch } from './skip-detector';

export interface IsOffTopicInput {
  message: string;
  pendingStep: SOPConfiguration['steps'][number] | null;
  skipDetectorMatches: SkipDetectorMatch[];
}

/** Threshold: > this many real keyword overlaps → on-topic. */
const KEYWORD_OVERLAP_THRESHOLD = 1;

/**
 * Stop words filtered out before keyword overlap counting. These are too
 * common to count as "answering the pending step". Lowercase only.
 */
const STOP_WORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can',
  'did', 'do', 'does', 'for', 'from', 'has', 'have', 'how',
  'i', 'in', 'is', 'it', 'its', 'me', 'my', 'of', 'on', 'or',
  'our', 'so', 'than', 'that', 'the', 'this', 'to', 'us',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who',
  'whom', 'why', 'will', 'with', 'you', 'your',
]);

export function isOffTopic(input: IsOffTopicInput): boolean {
  const { message, pendingStep, skipDetectorMatches } = input;

  if (!pendingStep) return false;
  if (skipDetectorMatches.length > 0) return false;

  const trimmed = message.trim();
  if (trimmed.length === 0) return false;

  const messageTokens = tokenize(trimmed);
  const questionTokens = tokenize(pendingStep.question_text);

  // Real (non-stop-word) overlap. Uses a 4-char-prefix match so
  // "happened" matches "happen" without a full stemmer.
  const messageReal = messageTokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 4);
  const questionReal = questionTokens.filter((t) => !STOP_WORDS.has(t) && t.length >= 4);

  let overlap = 0;
  for (const m of messageReal) {
    for (const q of questionReal) {
      if (sharesPrefix(m, q, 4)) {
        overlap += 1;
        break; // each message token counts at most once
      }
    }
  }

  return overlap <= KEYWORD_OVERLAP_THRESHOLD;
}

/** True if a and b share at least `minLen` characters of common prefix. */
function sharesPrefix(a: string, b: string, minLen: number): boolean {
  const limit = Math.min(a.length, b.length);
  if (limit < minLen) return false;
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}
