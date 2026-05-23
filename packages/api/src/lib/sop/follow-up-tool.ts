/**
 * SOP Step 6: AI follow-up analysis (010-sop-workflow T029).
 *
 * Two surfaces:
 *
 * 1. `analyzeAndFollowUp(...)` — the underlying async function. Pure
 *    business logic; the chat route imports the AI SDK tool() wrapper
 *    below, but unit tests can call this directly with a mocked model.
 *
 * 2. `analyzeAndFollowUpTool` — the AI SDK tool() definition the agent
 *    invokes. Wraps the function above; the agent passes the SOP
 *    captures via the tool's `parameters` schema.
 *
 * Source of truth: research.md R6, spec.md FR-024 to FR-028.
 *
 * Failure modes (FR-028): on LLM provider error, malformed output, or
 * out-of-spec output (e.g. <2 questions in follow_up mode), the function
 * returns a generic finalize result. The agent then naturally finalizes
 * without spamming the visitor with "an error occurred" messaging.
 */
import { generateObject, tool } from 'ai';
import type { LanguageModelV1 } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

const MAX_QUESTIONS = 5;
const MIN_QUESTIONS = 2;

const responseSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('follow_up'),
    questions: z.array(z.string()),
  }),
  z.object({
    mode: z.literal('finalize'),
    finalization_message: z.string(),
  }),
]);

const GENERIC_FINALIZE_MESSAGE =
  'Thanks for sharing that information. ' +
  'I have enough to connect you with the right person at the firm — ' +
  'someone will reach out shortly.';

export type AnalyzeAndFollowUpResult =
  | { mode: 'follow_up'; questions: string[] }
  | { mode: 'finalize'; finalization_message: string };

export interface AnalyzeAndFollowUpInput {
  /** Map of SOP step slug → captured value. */
  sop_captures: Record<string, string>;
  /** Optional model injection for tests. Defaults to gemini-2.5-flash. */
  model?: LanguageModelV1;
}

export async function analyzeAndFollowUp(
  input: AnalyzeAndFollowUpInput,
): Promise<AnalyzeAndFollowUpResult> {
  const { sop_captures } = input;
  const model = input.model ?? google('gemini-2.5-flash');

  const captureLines = Object.entries(sop_captures)
    .map(([slug, value]) => `- ${slug}: ${value}`)
    .join('\n');

  const prompt =
    'You are reviewing the answers a visitor has given to an intake SOP. ' +
    'Decide ONE of two outcomes:\n\n' +
    '(a) follow_up: the matter would benefit from 2-5 tailored follow-up ' +
    'questions before connecting them with the firm. Provide the questions.\n' +
    '(b) finalize: the captured information is sufficient — the firm has ' +
    'enough to act. Provide a short finalization message for the visitor.\n\n' +
    'Captured answers so far:\n' +
    captureLines +
    '\n\nReturn JSON matching one of:\n' +
    '  { "mode": "follow_up", "questions": ["...", "..."] }\n' +
    '  { "mode": "finalize", "finalization_message": "..." }\n\n' +
    'Maximum 5 follow-up questions; aim for 2-5. ' +
    'Finalization messages should be brief (1-2 sentences) and warm.';

  let result;
  try {
    result = await generateObject({ model, schema: responseSchema, prompt });
  } catch {
    return { mode: 'finalize', finalization_message: GENERIC_FINALIZE_MESSAGE };
  }

  const obj = result.object;

  if (obj.mode === 'follow_up') {
    // Apply MIN/MAX guardrails per FR-024 + FR-026.
    const trimmed = obj.questions.slice(0, MAX_QUESTIONS);
    if (trimmed.length < MIN_QUESTIONS) {
      // Below minimum → fall through to finalize.
      return { mode: 'finalize', finalization_message: GENERIC_FINALIZE_MESSAGE };
    }
    return { mode: 'follow_up', questions: trimmed };
  }

  return obj;
}

// ---------------------------------------------------------------------------
// AI SDK tool wrapper
// ---------------------------------------------------------------------------

/**
 * The AI SDK tool definition the chat route registers. The agent invokes
 * this when the SOP is fully captured (per the system-prompt block).
 *
 * The wrapper is a thin layer over `analyzeAndFollowUp`; the heavy
 * lifting + tests live on the function above.
 */
export const analyzeAndFollowUpTool = tool({
  description:
    'Run after all SOP steps have been captured. Either generate 2-5 ' +
    'tailored follow-up questions for the matter, OR signal that the ' +
    'captured information is sufficient and provide a finalization message.',
  parameters: z.object({
    sop_captures: z.record(z.string(), z.string()).describe(
      'Map of SOP step slug to the captured value (free text or chip slug).',
    ),
  }),
  execute: async ({ sop_captures }) => analyzeAndFollowUp({ sop_captures }),
});
