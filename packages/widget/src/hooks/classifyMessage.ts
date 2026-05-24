/**
 * Client-side message classifier (011-preflight-phrase rev2).
 *
 * Pure synchronous function that maps a visitor message + optional
 * pendingStepSlug to a tailored loading-status phrase.
 *
 * Replaces the previous LLM-driven preflight (gemini-2.5-flash-lite)
 * which was abandoned after production showed 5-10x the design latency
 * (1300-3500ms typical with frequent timeouts) — defeating the "phrase
 * appears within 500ms" goal.
 *
 * Returns:
 *   - A tailored phrase string when the message OR pendingStepSlug
 *     gives confident context.
 *   - null when neither signal yields anything specific. The widget
 *     falls back to the dots indicator. Pretending to tailor when we
 *     can't would feel worse than honest dots.
 *
 * Design notes:
 *   - Word-boundary regex (\b) prevents substring false positives
 *     ("thanksgiving" should NOT trigger the goodbye phrase).
 *   - SOP context (`pendingStepSlug`) takes precedence over keyword
 *     matching because most widget conversations are mid-SOP and the
 *     step slug is a stronger signal than keywords scraped from
 *     free text.
 */

type Phrase = string;

const STEP_PHRASES: Record<string, Phrase> = {
  case_type: 'Noting your case type',
  sub_type: 'Recording the type',
  where: 'Noting the location',
  what: 'Noting what happened',
  when: 'Noting the timing',
  contact: 'Recording your details',
};

interface KeywordRule {
  pattern: RegExp;
  phrase: Phrase;
}

/**
 * Order matters: more specific patterns first (DUI before generic
 * "criminal", goodbye before "thanks for…").
 */
const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /\b(dui|drunk\s+driv\w*|drunk\s+driver|drinking\s+and\s+driving)\b/i, phrase: 'Looking into your DUI matter' },
  { pattern: /\b(divorce|custody|adoption|family\s+law|child\s+support|alimony)\b/i, phrase: 'Looking into your family matter' },
  { pattern: /\b(injur\w*|accident|hurt|hit[- ]and[- ]run|slip[- ]and[- ]fall|car\s+crash)\b/i, phrase: 'Looking into your injury matter' },
  { pattern: /\b(theft|assault|fraud|burglary|robbery|criminal|arrested|charged\s+with)\b/i, phrase: 'Looking into your criminal matter' },
  { pattern: /\b(will|trust|probate|estate|inheritance)\b/i, phrase: 'Looking into your estate matter' },
  { pattern: /\b(office\s+hours|business\s+hours|when\s+(?:are|do)\s+you\s+open|opening\s+times|hours\s+of\s+operation|when\s+are\s+you\s+open)\b/i, phrase: 'Checking office hours' },
  { pattern: /\b(phone\s+number|contact\s+(?:info|details|number)|reach\s+you|how\s+do\s+I\s+(?:reach|contact|call))\b/i, phrase: 'Checking contact info' },
  { pattern: /\b(thanks|thank\s+you|good\s*bye|^bye$|see\s+you|that's\s+all|that\s+is\s+all)\b/i, phrase: 'Wrapping up' },
  { pattern: /\b(need\s+(?:a\s+)?lawyer|need\s+legal|looking\s+for\s+(?:a\s+)?(?:lawyer|attorney|legal)|need\s+help|need\s+representation)\b/i, phrase: 'Finding the right person' },
];

/** Minimum trimmed length to bother classifying. Avoids "ok" / "hmm". */
const MIN_LENGTH = 3;

export function classifyMessage(
  message: string,
  pendingStepSlug: string | null,
): Phrase | null {
  // SOP-step context wins.
  if (pendingStepSlug && STEP_PHRASES[pendingStepSlug]) {
    return STEP_PHRASES[pendingStepSlug];
  }

  const trimmed = message.trim();
  if (trimmed.length < MIN_LENGTH) {
    return null;
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.phrase;
    }
  }

  return null;
}
