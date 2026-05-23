/**
 * Tests for the SOP analyzeAndFollowUp tool (010-sop-workflow T024).
 *
 * Tests the underlying `analyzeAndFollowUp` function (the implementation
 * the AI SDK tool() wrapper invokes). The function uses generateObject
 * with a Zod schema; tests inject a MockLanguageModelV1.
 *
 * Source of truth: research.md R6 + spec.md FR-024 to FR-028.
 */
import { describe, it, expect } from 'vitest';
import { MockLanguageModelV1 } from 'ai/test';
import { analyzeAndFollowUp } from './follow-up-tool';

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

const SAMPLE_CAPTURES = {
  case_type: 'DUI',
  sub_type: 'first_offense',
  where: '5th and Main',
  what: 'Pulled over and arrested for DUI',
  when: '2026-05-22',
};

// ---------------------------------------------------------------------------
// follow_up mode
// ---------------------------------------------------------------------------

describe('analyzeAndFollowUp', () => {
  it('returns 2-5 follow-up questions in follow_up mode', async () => {
    const model = mockModel({
      mode: 'follow_up',
      questions: [
        'Have you taken a breathalyzer test?',
        'Have you had any prior arrests?',
        'Was anyone injured in the incident?',
      ],
    });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('follow_up');
    if (result.mode === 'follow_up') {
      expect(result.questions.length).toBeGreaterThanOrEqual(2);
      expect(result.questions.length).toBeLessThanOrEqual(5);
    }
  });

  it('truncates output to 5 questions max (FR-026)', async () => {
    const model = mockModel({
      mode: 'follow_up',
      questions: [
        'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8',
      ],
    });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('follow_up');
    if (result.mode === 'follow_up') {
      expect(result.questions.length).toBe(5);
      expect(result.questions).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    }
  });
});

// ---------------------------------------------------------------------------
// finalize mode
// ---------------------------------------------------------------------------

describe('analyzeAndFollowUp finalize', () => {
  it('returns finalize mode with a finalization_message when model decides info is sufficient', async () => {
    const model = mockModel({
      mode: 'finalize',
      finalization_message: 'Thanks — we have enough information to connect you with an attorney.',
    });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('finalize');
    if (result.mode === 'finalize') {
      expect(result.finalization_message).toContain('attorney');
    }
  });
});

// ---------------------------------------------------------------------------
// Failure modes (FR-028 — fallback to finalize on LLM error)
// ---------------------------------------------------------------------------

describe('analyzeAndFollowUp failure modes', () => {
  it('falls back to finalize mode with a generic message on LLM provider error', async () => {
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      doGenerate: async () => {
        throw new Error('mock provider failure');
      },
    });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('finalize');
    if (result.mode === 'finalize') {
      // Generic message should be non-empty and not contain "error" details
      // that would leak to the visitor.
      expect(result.finalization_message.length).toBeGreaterThan(0);
      expect(result.finalization_message.toLowerCase()).not.toContain('error');
      expect(result.finalization_message.toLowerCase()).not.toContain('failure');
    }
  });

  it('falls back to finalize mode on malformed JSON output', async () => {
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      doGenerate: async () => ({
        rawCall: { rawPrompt: null, rawSettings: {} },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10 },
        text: 'not valid json',
      }),
    });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('finalize');
  });

  it('falls back to finalize when follow_up mode returns 0 questions', async () => {
    // Defensive: model says follow_up but provides empty array. We treat
    // this as "nothing more to ask" and finalize.
    const model = mockModel({ mode: 'follow_up', questions: [] });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('finalize');
  });

  it('falls back to finalize when follow_up mode returns only 1 question (below FR-024 minimum)', async () => {
    // FR-024 says 2-5 questions. A single question is too few.
    const model = mockModel({ mode: 'follow_up', questions: ['Just one question?'] });
    const result = await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(result.mode).toBe('finalize');
  });
});

// ---------------------------------------------------------------------------
// Captures embedded in prompt (so the model can tailor questions)
// ---------------------------------------------------------------------------

describe('analyzeAndFollowUp prompt construction', () => {
  it('embeds the captured slug=value pairs in the prompt', async () => {
    let capturedPrompt = '';
    const model = new MockLanguageModelV1({
      defaultObjectGenerationMode: 'json',
      doGenerate: async (options) => {
        capturedPrompt = JSON.stringify(options.prompt);
        return {
          rawCall: { rawPrompt: null, rawSettings: {} },
          finishReason: 'stop',
          usage: { promptTokens: 10, completionTokens: 10 },
          text: JSON.stringify({ mode: 'finalize', finalization_message: 'ok' }),
        };
      },
    });
    await analyzeAndFollowUp({ sop_captures: SAMPLE_CAPTURES, model });
    expect(capturedPrompt).toContain('case_type');
    expect(capturedPrompt).toContain('DUI');
    expect(capturedPrompt).toContain('first_offense');
  });
});
