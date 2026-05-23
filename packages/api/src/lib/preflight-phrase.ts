/**
 * Preflight phrase generator (011-preflight-phrase T011).
 *
 * Single-shot `generateObject` call to gemini-2.5-flash-lite that produces
 * a 3-7 word loading status phrase tailored to the visitor's latest
 * message ("Looking into your DUI matter…"). Runs in parallel with the
 * main `/api/chat` agent stream; its result is consumed by the widget's
 * `usePreflightPhrase` hook to swap the typing-indicator content.
 *
 * Failure semantics:
 *   - LLM provider error / malformed structured output → `PreflightLLMError`
 *   - Phrase fails the post-filter (length, PII regex)  → `PreflightValidationError`
 *   - AbortSignal fired (server-side 800ms timeout)     → AbortError propagates
 *
 * The route handler maps each error subclass to a specific 503 response
 * outcome (`preflight_failed` / `preflight_validation` / `preflight_timeout`).
 *
 * Source of truth: contracts/preflight-route-contract.md +
 * data-model.md `PreflightResponse` rules + research.md R7 (the prompt).
 */

import { generateObject } from 'ai';
import type { LanguageModelV1 } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Error classes (named so the route handler can `instanceof` switch on them)
// ---------------------------------------------------------------------------

export class PreflightLLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightLLMError';
  }
}

export class PreflightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreflightValidationError';
  }
}

// ---------------------------------------------------------------------------
// Internal: response schema + prompt
// ---------------------------------------------------------------------------

/**
 * What the LLM is constrained to return. The post-filter additionally
 * trims/strips trailing punctuation and rejects PII patterns; the SDK's
 * generateObject only enforces the JSON shape.
 */
const responseSchema = z.object({
  phrase: z.string(),
});

/** Length bounds for the post-filter (mirror data-model.md). */
const MIN_PHRASE_LENGTH = 3;
const MAX_PHRASE_LENGTH = 60;

/** Email-like pattern: `\S+@\S+\.\S+` (per data-model.md FR-007). */
const EMAIL_REGEX = /\S+@\S+\.\S+/;

/**
 * Phone-like pattern: a sequence of 7+ digits/separators. Catches both
 * `(555) 867-5309` and bare `5558675309`. Conservative — may flag some
 * benign 7-digit strings but in our controlled-prompt setting that's
 * acceptable defense-in-depth.
 */
const PHONE_REGEX = /(?:\d[\s().-]*){7,}/;

/**
 * The system prompt. 5-shot, ~300 tokens. Verbatim per research.md R7.
 * Examples are the dominant content; explicit rules reinforce the
 * post-filter.
 */
const SYSTEM_PROMPT = [
  'You are a UX assistant for a legal-firm chat widget. Given a visitor\'s',
  'message, produce a 3-7 word loading status phrase describing what the',
  'bot is about to do, in present continuous tense.',
  '',
  'Examples:',
  '  message: "I had a DUI"           → phrase: "Looking into your DUI matter"',
  '  message: "What are office hours?" → phrase: "Checking office hours"',
  '  message: "5th and Main"          → phrase: "Noting the location"',
  '  message: "thanks"                → phrase: "Wrapping up"',
  '  message: "First Offense"         → phrase: "Selecting first offense"',
  '',
  'Rules:',
  '- Never restate the visitor\'s message verbatim.',
  '- Never make legal claims or promises.',
  '- Never include PII (names, emails, phone numbers, addresses) in the phrase.',
  '- No trailing punctuation; the widget adds an ellipsis.',
  '',
  'Return JSON: { "phrase": "..." }',
].join('\n');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GeneratePreflightPhraseInput {
  message: string;
  pendingStepSlug: string | null;
  abortSignal: AbortSignal;
  /**
   * Optional model injection for tests. Defaults to `gemini-2.5-flash-lite`
   * — a deliberately different model from the main agent's `gemini-2.5-flash`
   * because the preflight task is bounded (3-7 word phrase) and benefits
   * from the lite tier's lower latency + lower cost. See research.md R1.
   */
  model?: LanguageModelV1;
}

export interface GeneratePreflightPhraseResult {
  phrase: string;
}

/**
 * Generate a tailored loading status phrase. Throws on any failure path
 * so the route handler can map subclass → 503 outcome string.
 */
export async function generatePreflightPhrase(
  input: GeneratePreflightPhraseInput,
): Promise<GeneratePreflightPhraseResult> {
  const { message, pendingStepSlug, abortSignal } = input;
  const model = input.model ?? google('gemini-2.5-flash-lite');

  // Honor an already-aborted signal up-front — saves an LLM round-trip.
  if (abortSignal.aborted) {
    const err = new Error('preflight aborted before LLM call');
    err.name = 'AbortError';
    throw err;
  }

  // Build the user-message portion of the prompt. Includes the
  // pendingStepSlug as light context the model can use to bias toward
  // SOP-relevant phrasing without ever echoing it back.
  const userPrompt = pendingStepSlug
    ? `pending SOP step: ${pendingStepSlug}\nvisitor message: ${message}`
    : `visitor message: ${message}`;

  let result;
  try {
    result = await generateObject({
      model,
      schema: responseSchema,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      abortSignal,
      temperature: 0.3,
    });
  } catch (err) {
    // Propagate AbortError untouched so the route can map to `preflight_timeout`.
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    // Everything else (provider error, malformed JSON, schema failure) is
    // a generic LLM failure.
    throw new PreflightLLMError(
      err instanceof Error ? err.message : 'preflight LLM call failed',
    );
  }

  const rawPhrase = result.object.phrase;

  // Post-filter: trim, strip trailing punctuation/ellipsis.
  let phrase = rawPhrase.trim();
  phrase = phrase.replace(/[.…!?]+$/u, '').trim();

  // Length bounds.
  if (phrase.length < MIN_PHRASE_LENGTH) {
    throw new PreflightValidationError(
      `phrase too short after trim: ${phrase.length} < ${MIN_PHRASE_LENGTH}`,
    );
  }
  if (phrase.length > MAX_PHRASE_LENGTH) {
    throw new PreflightValidationError(
      `phrase too long: ${phrase.length} > ${MAX_PHRASE_LENGTH}`,
    );
  }

  // PII regex (defense in depth — the prompt also forbids).
  if (EMAIL_REGEX.test(phrase)) {
    throw new PreflightValidationError('phrase contains email-like pattern');
  }
  if (PHONE_REGEX.test(phrase)) {
    throw new PreflightValidationError('phrase contains phone-like pattern');
  }

  return { phrase };
}
