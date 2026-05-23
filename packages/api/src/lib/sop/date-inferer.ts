/**
 * SOP date inferer (010-sop-workflow T028).
 *
 * Converts a natural-language date expression (e.g. "yesterday", "last
 * Tuesday", "three weeks ago") to an ISO 8601 date string, resolved
 * relative to the conversation's anchor timestamp (NOT `Date.now()` —
 * R3 ensures resumed-session date inference is deterministic).
 *
 * Returns `{ iso_date: null, confidence: 0 }` on:
 *   - LLM provider error
 *   - malformed model output
 *   - confidence < 0.6 (R3 threshold)
 *
 * The function accepts an optional `model` parameter for testability.
 * Production callers pass nothing; the default Gemini provider is used.
 *
 * Source of truth: research.md R3.
 */
import { generateObject } from 'ai';
import type { LanguageModelV1 } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

const CONFIDENCE_THRESHOLD = 0.6;

const responseSchema = z.object({
  iso_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  confidence: z.number().min(0).max(1),
});

export interface InferDateInput {
  userText: string;
  conversationAnchorIso: string;
  /** Defaults to gemini-2.5-flash. Override in tests. */
  model?: LanguageModelV1;
}

export interface InferDateOutput {
  iso_date: string | null;
  confidence: number;
}

export async function inferDate(input: InferDateInput): Promise<InferDateOutput> {
  const { userText, conversationAnchorIso } = input;
  const model = input.model ?? google('gemini-2.5-flash');

  // Anchor is ISO with time; the model only needs the date portion.
  const anchorDate = conversationAnchorIso.slice(0, 10);

  try {
    const result = await generateObject({
      model,
      schema: responseSchema,
      prompt:
        'Convert the following natural-language date expression to an ISO 8601 ' +
        'date (YYYY-MM-DD), resolved relative to the conversation anchor date.\n\n' +
        `Conversation anchor (today's reference): ${anchorDate}\n` +
        `User expression: "${userText}"\n\n` +
        'If you cannot confidently parse the expression, return iso_date=null with low confidence. ' +
        'Confidence is a number from 0 (no idea) to 1 (certain). ' +
        'Return JSON: { "iso_date": "YYYY-MM-DD" | null, "confidence": 0..1 }.',
    });

    const { iso_date, confidence } = result.object;
    if (iso_date && confidence >= CONFIDENCE_THRESHOLD) {
      return { iso_date, confidence };
    }
    return { iso_date: null, confidence };
  } catch (err) {
    // Provider failure or schema parse error — gracefully degrade.
    // The route handler will leave the SOP step pending and the agent
    // will ask a clarifying question (FR-014).
    return { iso_date: null, confidence: 0 };
  }
}
