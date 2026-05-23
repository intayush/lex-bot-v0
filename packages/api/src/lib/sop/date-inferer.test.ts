/**
 * Tests for the SOP date inferer (010-sop-workflow T025).
 *
 * Uses Vercel AI SDK's MockLanguageModelV1 from `ai/test` to simulate the
 * Gemini structured-output response. No real LLM calls.
 *
 * Source of truth: research.md R3 (date-inference contract).
 */
import { describe, it, expect } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import { inferDate } from './date-inferer';

const ANCHOR = '2026-05-23T10:00:00.000Z';

/** Build a mock model that returns a canned JSON object response. */
function mockModel(response: unknown): MockLanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      rawCall: { rawPrompt: null, rawSettings: {} },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10 },
      text: JSON.stringify(response),
    }),
  });
}

/** Build a mock model that throws to simulate provider failure. */
function failingModel(): MockLanguageModelV1 {
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => {
      throw new Error('mock provider failure');
    },
  });
}

// ---------------------------------------------------------------------------
// Happy-path: high-confidence date inference
// ---------------------------------------------------------------------------

describe('inferDate', () => {
  it('returns iso_date when confidence >= 0.6', async () => {
    const model = mockModel({ iso_date: '2026-05-22', confidence: 0.95 });
    const result = await inferDate({
      userText: 'yesterday',
      conversationAnchorIso: ANCHOR,
      model,
    });
    expect(result.iso_date).toBe('2026-05-22');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it('returns null when confidence is below 0.6 threshold', async () => {
    const model = mockModel({ iso_date: '2026-04-15', confidence: 0.3 });
    const result = await inferDate({
      userText: 'a couple weekends ago',
      conversationAnchorIso: ANCHOR,
      model,
    });
    expect(result.iso_date).toBeNull();
    expect(result.confidence).toBe(0.3);
  });

  it('returns null when iso_date is null even at high confidence', async () => {
    // Defensive: model says high confidence but null date — shouldn't happen
    // but we verify the implementation doesn't crash and just passes null
    // through.
    const model = mockModel({ iso_date: null, confidence: 0.9 });
    const result = await inferDate({
      userText: 'sometime',
      conversationAnchorIso: ANCHOR,
      model,
    });
    expect(result.iso_date).toBeNull();
  });

  it('returns null on LLM provider error (graceful degradation)', async () => {
    const result = await inferDate({
      userText: 'yesterday',
      conversationAnchorIso: ANCHOR,
      model: failingModel(),
    });
    expect(result.iso_date).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns null when model returns malformed JSON', async () => {
    // generateObject parses against a schema; malformed response yields
    // a NoObjectGeneratedError which our impl catches.
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10 },
        text: 'not valid json at all',
      }),
    });
    const result = await inferDate({
      userText: 'yesterday',
      conversationAnchorIso: ANCHOR,
      model,
    });
    expect(result.iso_date).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('passes the conversation_anchor_iso\'s date portion into the prompt for relative-date resolution', async () => {
    // R3 contract: dates are computed against conversationAnchorIso, NOT
    // Date.now(). The impl extracts the YYYY-MM-DD portion (the time is
    // irrelevant for date inference). We verify the date portion appears
    // in the prompt sent to the model.
    let capturedPrompt = '';
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      doGenerate: async (options) => {
        capturedPrompt = JSON.stringify(options.prompt);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 10 },
          text: JSON.stringify({ iso_date: '2026-05-22', confidence: 0.9 }),
        };
      },
    });
    await inferDate({
      userText: 'yesterday',
      conversationAnchorIso: ANCHOR,
      model,
    });
    // Date portion of the anchor (2026-05-23) should appear in the prompt.
    expect(capturedPrompt).toContain('2026-05-23');
    expect(capturedPrompt).toContain('yesterday');
  });
});
