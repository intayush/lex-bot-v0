/**
 * Tests for the system-prompt SOP block composer (010-sop-workflow T023).
 *
 * Pure-functional. No DB, no LLM.
 *
 * Source of truth: contracts/system-prompt-extension-contract.md "Block
 * Layout" + "Variations by State" + "Token Budget" + "Tests" sections.
 */
import { describe, it, expect } from 'vitest';
import type { SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { composeSopBlock } from './system-prompt-extension';
import { initSOPState, advanceSOP } from './state-machine';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ANCHOR = '2026-05-23T10:00:00.000Z';
const T1 = '2026-05-23T10:01:00.000Z';

function buildSOPConfig(numSteps = 5): SOPConfiguration {
  const slugs = ['case_type', 'sub_type', 'where', 'what', 'when'];
  const questions = [
    'What kind of legal matter can we help you with?',
    'What kind of {case_type} matter is this?',
    'Where did this happen?',
    'Can you briefly tell us what happened?',
    'When did this happen?',
  ];
  return {
    id: 'cfg_test',
    account_id: 'acct_test',
    version: 1,
    qualified_lead_threshold: numSteps,
    is_published: true,
    derived_from_legacy: false,
    created_at: ANCHOR,
    steps: Array.from({ length: numSteps }, (_, i) => ({
      id: `step_${i + 1}`,
      sop_configuration_id: 'cfg_test',
      position: i + 1,
      slug: slugs[i] ?? `custom_${i + 1}`,
      question_text: questions[i] ?? `Custom question ${i + 1}?`,
      chip_source: null,
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
      is_default: i < 5,
      skip_condition_json: null,
    })),
  };
}

const DEFAULT_GOODBYES = ['bye', 'goodbye', 'thanks', 'thank you', 'good night'];

// ---------------------------------------------------------------------------
// All-pending variation
// ---------------------------------------------------------------------------

describe('composeSopBlock — all steps pending', () => {
  it('lists every step with [ ] checkbox', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // Should mention every slug with a pending marker.
    for (const step of sopConfig.steps) {
      expect(block).toContain(step.slug);
    }
    expect(block).toMatch(/\[\s\]/); // pending checkbox
    expect(block).not.toMatch(/\[✓\]/);
  });

  it('names the current pending step explicitly', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // The earliest step's question text should be quoted in "Ask the visitor:"
    expect(block).toContain(sopConfig.steps[0]!.question_text);
  });

  it('includes the SOP State header (block discoverability)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('## SOP State');
  });

  it('embeds the goodbye phrase list verbatim in the goodbye rule', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, ['adios', 'see ya']);
    expect(block).toContain('adios');
    expect(block).toContain('see ya');
  });
});

// ---------------------------------------------------------------------------
// Mid-flow variation
// ---------------------------------------------------------------------------

describe('composeSopBlock — mid-flow', () => {
  it('shows [✓] for completed steps with their captured value', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'DUI', capturedAt: T1 },
      sopConfig,
    );
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toMatch(/\[✓\][^\n]*case_type/);
    expect(block).toContain('DUI');
  });

  it('truncates captured values to 30 characters', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    const longValue = 'A very long captured value that should be truncated for the system prompt to stay within token budget';
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_3', value: longValue, capturedAt: T1 },
      sopConfig,
    );
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // The full long value MUST NOT appear; the first 30 chars should.
    expect(block).not.toContain(longValue);
    expect(block).toContain(longValue.slice(0, 30));
  });

  it('redacts email patterns from displayed captured values', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_3', value: 'I emailed jane@example.com', capturedAt: T1 },
      sopConfig,
    );
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).not.toContain('jane@example.com');
    expect(block).toContain('[email]');
  });

  it('redacts phone-number patterns from displayed captured values', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_3', value: 'call me 555-867-5309', capturedAt: T1 },
      sopConfig,
    );
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).not.toContain('555-867-5309');
    expect(block).toContain('[phone]');
  });

  it('points the agent at the next pending step', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'DUI', capturedAt: T1 },
      sopConfig,
    );
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // sub_type's question text should appear under the current pending step section
    expect(block).toContain(sopConfig.steps[1]!.question_text);
  });
});

// ---------------------------------------------------------------------------
// All-complete (not finalized) variation
// ---------------------------------------------------------------------------

describe('composeSopBlock — all steps complete, not yet finalized', () => {
  it('instructs the agent to call the analyzeAndFollowUp tool', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    for (const step of state.steps) {
      state = advanceSOP(
        state,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('analyzeAndFollowUp');
  });
});

// ---------------------------------------------------------------------------
// Finalized variation
// ---------------------------------------------------------------------------

describe('composeSopBlock — finalized', () => {
  it('omits the step list and instructs continuation', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    for (const step of state.steps) {
      state = advanceSOP(
        state,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    state = advanceSOP(state, { type: 'finalize' }, sopConfig);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // No step list; no [✓] / [ ] markers.
    expect(block).not.toMatch(/\[✓\]/);
    expect(block).not.toMatch(/\[\s\]/);
    expect(block).toContain('SOP complete');
  });

  it('out_of_scope_termination instructs the deflection + open re-prompt', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'estate_planning', capturedAt: T1 },
      sopConfig,
    );
    state = advanceSOP(state, { type: 'finalize_out_of_scope' }, sopConfig);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('out-of-scope');
    expect(block).toContain('open re-prompt');
  });
});

// ---------------------------------------------------------------------------
// Token budget regression test
// ---------------------------------------------------------------------------

describe('composeSopBlock — token budget', () => {
  it('20-step SOP block stays under ~1100 tokens (~4400 chars)', () => {
    // The contract budget is 1100 tokens for a 20-step SOP. We approximate
    // 1 token ≈ 4 chars, so 1100 tokens ≈ 4400 chars. Vitest doesn't need
    // exact tokenization to catch regressions.
    const sopConfig = buildSOPConfig(20);
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block.length).toBeLessThanOrEqual(4400);
  });
});

// ---------------------------------------------------------------------------
// Determinism (contract: byte-identical for identical inputs)
// ---------------------------------------------------------------------------

describe('composeSopBlock — determinism', () => {
  it('produces byte-identical output for identical inputs', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const a = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    const b = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(a).toBe(b);
  });
});
