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
  it('instructs the agent to call captureLead directly (spec 016 FR-035)', () => {
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
    // Spec 016 FR-035: the analyzeAndFollowUp tool has been removed;
    // the prompt now points the agent at captureLead instead.
    expect(block).not.toContain('analyzeAndFollowUp');
    expect(block).toContain('captureLead');
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

// ---------------------------------------------------------------------------
// 010-sop-workflow T045: off-topic-now directive (US3 detour signal)
// ---------------------------------------------------------------------------

describe('composeSopBlock — off-topic-now directive (US3)', () => {
  it('does NOT include the directive when isOffTopicNow=false (default)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).not.toContain('### Detour required NOW');
  });

  it('includes the directive when isOffTopicNow=true', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES, true);
    expect(block).toContain('### Detour required NOW');
  });

  it('embeds the pending step\'s question verbatim in the directive', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES, true);
    // The directive should quote the pending step's question text exactly.
    expect(block).toMatch(/"What kind of legal matter can we help you with\?"/);
  });

  it('does NOT include the directive when SOP is finalized (no pending step to re-prompt)', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    // Capture all and finalize.
    for (const step of state.steps) {
      state = advanceSOP(
        state,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    state = advanceSOP(state, { type: 'finalize' }, sopConfig);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES, true);
    expect(block).not.toContain('### Detour required NOW');
  });
});

// ---------------------------------------------------------------------------
// 014-fix-sop-case-subtypes T011 — {case_type} interpolation in
// the rendered SOP block. When the case_type step has a captured_label,
// the sub_type's question text "What kind of {case_type} matter is this?"
// is interpolated to "What kind of DUI matter is this?" so the visitor
// never sees the raw template token (FR-006).
// ---------------------------------------------------------------------------

describe('composeSopBlock — {case_type} interpolation (014)', () => {
  it('interpolates {case_type} when case_type step has captured_label', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    // Capture case_type with the label snapshot.
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    // Manually set the captured_label as T015 will. Mutate the state
    // directly because the helper that wires this end-to-end (T018) is
    // not yet implemented; we're testing interpolation in isolation.
    const caseTypeStep = state.steps.find((s) => s.slug === 'case_type')!;
    state = {
      ...state,
      steps: state.steps.map((s) =>
        s === caseTypeStep ? { ...s, captured_label: 'DUI' } : s,
      ),
    };

    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);

    // The rendered question must contain the interpolated label.
    expect(block).toContain('What kind of DUI matter is this?');
    // And must NOT contain the raw placeholder.
    expect(block).not.toContain('{case_type}');
  });

  it('does not interpolate or corrupt question text when there is no {case_type} placeholder', () => {
    // Sanity: questions that don't reference {case_type} pass through
    // unchanged regardless of whether a label is present. Use the case_type
    // step itself as a current-pending example since its question text
    // ("What kind of legal matter can we help you with?") contains no
    // placeholder.
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('What kind of legal matter can we help you with?');
    // No literal placeholder appears in the output of a fresh state
    // (the sub_type step's text isn't rendered yet — only the current
    // pending step's question is).
    expect(block).not.toContain('{case_type}');
  });

  it('uses the captured_label even when the case_type step is not the most recently captured', () => {
    // After multiple captures, the case_type label still drives sub_type interpolation.
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'personal_injury', capturedAt: T1 },
      sopConfig,
    );
    // Inject the captured_label for case_type.
    state = {
      ...state,
      steps: state.steps.map((s) =>
        s.slug === 'case_type' ? { ...s, captured_label: 'Personal Injury' } : s,
      ),
    };

    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('What kind of Personal Injury matter is this?');
    expect(block).not.toContain('{case_type}');
  });
});

// ---------------------------------------------------------------------------
// Spec 016 US5 (T058) — open-ended continuation works for the default-only
// finalize path (branch_state stays null)
// ---------------------------------------------------------------------------

describe('composeSopBlock — spec 016 US5 default-only continuation', () => {
  function finalizedDefaultOnlyState() {
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
    // Per spec 016, default-only finalization leaves branch_state null.
    return { sopConfig, state: { ...state, branch_state: null } };
  }

  it('emits the SOP-complete continuation directive (open re-prompt)', () => {
    const { sopConfig, state } = finalizedDefaultOnlyState();
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('SOP complete');
    expect(block).toMatch(/Is there anything else I can help you with/);
  });

  it('does NOT emit the analyzeAndFollowUp directive (FR-035 superseded)', () => {
    const { sopConfig, state } = finalizedDefaultOnlyState();
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).not.toContain('analyzeAndFollowUp');
  });

  it('does NOT volunteer a goodbye unless the visitor uses one', () => {
    const { sopConfig, state } = finalizedDefaultOnlyState();
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    // The goodbye-rule section instructs the agent to wait for visitor
    // intent — it should NOT proactively close the conversation.
    expect(block).toMatch(/goodbye/i);
    // Spec 010 FR-029 / FR-031: open re-prompt every turn until the
    // visitor uses a goodbye phrase.
    expect(block).toMatch(/unless the visitor explicitly says goodbye/);
  });

  it('omits the SOP step checklist (visitor sees free-form continuation)', () => {
    const { sopConfig, state } = finalizedDefaultOnlyState();
    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).not.toMatch(/\[✓\]/);
    expect(block).not.toMatch(/\[\s\]/);
  });

  it('the branch-in-flight skip path does NOT trigger when branch_state is null', () => {
    // Sanity-check the spec 016 routing: branch_state=null means
    // composeSopBlock follows the spec-010 finalized branch (with
    // continuation). The branch-in-flight path is exercised separately
    // by the orchestrator + chat-route integration.
    const { sopConfig, state } = finalizedDefaultOnlyState();
    expect(state.is_finalized).toBe(true);
    expect(state.branch_state).toBeNull();

    const block = composeSopBlock(state, sopConfig, DEFAULT_GOODBYES);
    expect(block).toContain('SOP complete');
  });
});
