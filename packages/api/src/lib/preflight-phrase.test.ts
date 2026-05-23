/**
 * Tests for `generatePreflightPhrase` (011-preflight-phrase T007).
 *
 * The helper wraps a single `generateObject` call to gemini-2.5-flash-lite
 * with a structured response schema, applies a post-filter (length +
 * PII regex), and throws typed subclass errors so the route handler
 * can map them to specific 503 outcomes.
 *
 * Tests inject a `MockLanguageModelV1` from `ai/test` to avoid live
 * Gemini calls — same pattern as `lib/sop/follow-up-tool.test.ts`.
 *
 * Source of truth: contracts/preflight-route-contract.md +
 * data-model.md `PreflightResponse` validation rules + research.md R7.
 */
import { describe, it, expect } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import {
  generatePreflightPhrase,
  PreflightLLMError,
  PreflightValidationError,
} from './preflight-phrase';

function mockModel(response: unknown): MockLanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop',
      usage: { promptTokens: 200, completionTokens: 12 },
      text: JSON.stringify(response),
    }),
  });
}

function rejectingModel(error: Error): MockLanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => {
      throw error;
    },
  });
}

const ABORTED = new AbortController();
ABORTED.abort();

const SAMPLE_INPUT = {
  message: 'I had a DUI',
  pendingStepSlug: 'case_type',
  abortSignal: new AbortController().signal,
};

describe('generatePreflightPhrase — happy path', () => {
  it('returns the LLM phrase verbatim when it passes the post-filter', async () => {
    const model = mockModel({ phrase: 'Looking into your DUI matter' });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe('Looking into your DUI matter');
  });

  it('strips trailing ellipsis or period (the widget adds its own)', async () => {
    const model = mockModel({ phrase: 'Looking into your case…' });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe('Looking into your case');
  });

  it('strips trailing whitespace', async () => {
    const model = mockModel({ phrase: '  Looking into things  ' });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe('Looking into things');
  });

  it('accepts a phrase exactly at the 60-char ceiling', async () => {
    const sixty = 'a'.repeat(60);
    const model = mockModel({ phrase: sixty });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe(sixty);
  });

  it('accepts a phrase exactly at the 3-char floor', async () => {
    const model = mockModel({ phrase: 'Hmm' });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe('Hmm');
  });
});

describe('generatePreflightPhrase — LLM failures', () => {
  it('throws PreflightLLMError when the SDK rejects', async () => {
    const model = rejectingModel(new Error('provider-side network error'));
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightLLMError);
  });

  it('propagates AbortError when the abort signal is already fired', async () => {
    const model = mockModel({ phrase: 'never reached' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      generatePreflightPhrase({
        message: 'hi',
        pendingStepSlug: null,
        abortSignal: aborted.signal,
        model,
      }),
    ).rejects.toThrow();
  });
});

describe('generatePreflightPhrase — post-filter (length)', () => {
  it('throws PreflightValidationError when phrase >60 chars after trim', async () => {
    const oversize = 'a'.repeat(61);
    const model = mockModel({ phrase: oversize });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });

  it('throws PreflightValidationError when phrase <3 chars after trim', async () => {
    const model = mockModel({ phrase: 'hi' });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });

  it('throws PreflightValidationError when phrase is empty after trim', async () => {
    const model = mockModel({ phrase: '   ' });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });
});

describe('generatePreflightPhrase — post-filter (PII regex)', () => {
  it('rejects phrase containing email-like pattern', async () => {
    const model = mockModel({ phrase: 'Emailing jane@example.com' });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });

  it('rejects phrase containing phone-like pattern (US format)', async () => {
    const model = mockModel({ phrase: 'Calling (555) 867-5309' });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });

  it('rejects phrase containing 7+ consecutive digits (bare phone)', async () => {
    const model = mockModel({ phrase: 'Dialing 5558675309' });
    await expect(
      generatePreflightPhrase({ ...SAMPLE_INPUT, model }),
    ).rejects.toBeInstanceOf(PreflightValidationError);
  });

  it('does NOT reject benign short numbers (e.g., a year)', async () => {
    const model = mockModel({ phrase: 'Reviewing your 2024 case' });
    const result = await generatePreflightPhrase({ ...SAMPLE_INPUT, model });
    expect(result.phrase).toBe('Reviewing your 2024 case');
  });
});
