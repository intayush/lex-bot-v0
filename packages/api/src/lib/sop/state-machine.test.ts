/**
 * Tests for the SOP state machine (010-sop-workflow T022).
 *
 * The state machine is pure-functional: every operation returns a new
 * immutable SOPState. No DB calls, no LLM calls, no side effects.
 *
 * Source of truth: contracts/sop-state-contract.md "Persistent Shape" and
 * data-model.md "State Transitions (per SOP Step)" + "State Transitions
 * (per SOP Configuration)".
 */
import { describe, it, expect } from 'vitest';
import type { SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { sopStateSchema } from '@legal-chatbot/shared';
import {
  initSOPState,
  advanceSOP,
  nextPendingStep,
} from './state-machine';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANCHOR_ISO = '2026-05-23T10:00:00.000Z';
const T1 = '2026-05-23T10:01:00.000Z';
const T2 = '2026-05-23T10:02:00.000Z';

/** Build a minimal SOP configuration with N steps. */
function buildSOPConfig(opts: {
  numSteps?: number;
  threshold?: number;
  withOptionalStep?: boolean;
  withNonThresholdStep?: boolean;
} = {}): SOPConfiguration {
  const numSteps = opts.numSteps ?? 5;
  const threshold = opts.threshold ?? numSteps;

  const baseSteps = [
    { slug: 'case_type', text: 'What kind of legal matter?' },
    { slug: 'sub_type', text: 'What kind of {case_type}?' },
    { slug: 'where', text: 'Where did this happen?' },
    { slug: 'what', text: 'What happened?' },
    { slug: 'when', text: 'When did this happen?' },
  ].slice(0, numSteps);

  const steps = baseSteps.map((s, i) => ({
    id: `step_${i + 1}`,
    sop_configuration_id: 'cfg_test',
    position: i + 1,
    slug: s.slug,
    question_text: s.text,
    chip_source: null,
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: opts.withOptionalStep && i === numSteps - 1 ? false : true,
    counts_toward_threshold: opts.withNonThresholdStep && i === numSteps - 1 ? false : true,
    is_default: true,
    skip_condition_json: null,
  }));

  return {
    id: 'cfg_test',
    account_id: 'acct_test',
    version: 1,
    qualified_lead_threshold: threshold,
    is_published: true,
    derived_from_legacy: false,
    created_at: ANCHOR_ISO,
    steps,
  };
}

// ---------------------------------------------------------------------------
// initSOPState
// ---------------------------------------------------------------------------

describe('initSOPState', () => {
  it('produces a Zod-valid SOPState', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(() => sopStateSchema.parse(state)).not.toThrow();
  });

  it('marks all steps pending with no captured values', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(state.steps.length).toBe(5);
    for (const s of state.steps) {
      expect(s.status).toBe('pending');
      expect(s.captured_value).toBeNull();
      expect(s.captured_at).toBeNull();
      expect(s.inferred).toBe(false);
    }
  });

  it('preserves step order from the SOP configuration (by position)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(state.steps.map((s) => s.slug)).toEqual([
      'case_type', 'sub_type', 'where', 'what', 'when',
    ]);
  });

  it('mirrors the configuration\'s threshold and version', () => {
    const sopConfig = buildSOPConfig({ threshold: 3 });
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(state.qualified_lead_threshold).toBe(3);
    expect(state.sop_version).toBe(sopConfig.version);
    expect(state.sop_configuration_id).toBe(sopConfig.id);
  });

  it('starts current_progress at 0 with neither finalized flag set', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(state.current_progress).toBe(0);
    expect(state.is_finalized).toBe(false);
    expect(state.out_of_scope_termination).toBe(false);
  });

  it('captures the conversation anchor verbatim for date inference (R3)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(state.conversation_anchor_iso).toBe(ANCHOR_ISO);
  });
});

// ---------------------------------------------------------------------------
// advanceSOP — capture_step
// ---------------------------------------------------------------------------

describe('advanceSOP capture_step', () => {
  it('flips status to complete and sets captured_value + captured_at', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    const stepOne = next.steps.find((s) => s.step_id === 'step_1')!;
    expect(stepOne.status).toBe('complete');
    expect(stepOne.captured_value).toBe('dui');
    expect(stepOne.captured_at).toBe(T1);
  });

  it('returns a new state object (immutable update)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    expect(next).not.toBe(state);
    expect(next.steps).not.toBe(state.steps);
    expect(state.steps.find((s) => s.step_id === 'step_1')!.status).toBe('pending');
  });

  it('honours inferred:true for skip-detector captures', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1, inferred: true },
      sopConfig,
    );
    expect(next.steps.find((s) => s.step_id === 'step_1')!.inferred).toBe(true);
  });

  it('increments current_progress only when the step counts_toward_threshold', () => {
    const sopConfig = buildSOPConfig({ withNonThresholdStep: true, numSteps: 3 });
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    // step_3 has counts_toward_threshold=false in this config
    const after1 = advanceSOP(
      initial,
      { type: 'capture_step', step_id: 'step_1', value: 'a', capturedAt: T1 },
      sopConfig,
    );
    expect(after1.current_progress).toBe(1);
    const after3 = advanceSOP(
      after1,
      { type: 'capture_step', step_id: 'step_3', value: 'c', capturedAt: T2 },
      sopConfig,
    );
    expect(after3.current_progress).toBe(1);
  });

  it('refuses to capture an unknown step id', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(() => advanceSOP(
      state,
      { type: 'capture_step', step_id: 'nonexistent', value: 'x', capturedAt: T1 },
      sopConfig,
    )).toThrow(/unknown step/i);
  });

  it('overwrites a prior capture (re-capture is allowed)', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    const after1 = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'old', capturedAt: T1 },
      sopConfig,
    );
    const after2 = advanceSOP(
      after1,
      { type: 'capture_step', step_id: 'step_1', value: 'new', capturedAt: T2 },
      sopConfig,
    );
    const stepOne = after2.steps.find((s) => s.step_id === 'step_1')!;
    expect(stepOne.captured_value).toBe('new');
    // current_progress should NOT double-count the same step
    expect(after2.current_progress).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// advanceSOP — skip_step
// ---------------------------------------------------------------------------

describe('advanceSOP skip_step', () => {
  it('flips status to skipped and leaves captured_value null', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(initial, { type: 'skip_step', step_id: 'step_3' }, sopConfig);
    const step = next.steps.find((s) => s.step_id === 'step_3')!;
    expect(step.status).toBe('skipped');
    expect(step.captured_value).toBeNull();
    expect(step.captured_at).toBeNull();
  });

  it('does NOT increment current_progress (skipped \u2260 captured)', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(initial, { type: 'skip_step', step_id: 'step_3' }, sopConfig);
    expect(next.current_progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// advanceSOP — reset_step (010-sop-workflow change-of-mind support)
// ---------------------------------------------------------------------------

describe('advanceSOP reset_step', () => {
  it('flips a complete step back to pending and clears captured value', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR_ISO);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    expect(state.steps[0]!.status).toBe('complete');
    expect(state.current_progress).toBe(1);

    const next = advanceSOP(state, { type: 'reset_step', step_id: 'step_1' }, sopConfig);
    expect(next.steps[0]!.status).toBe('pending');
    expect(next.steps[0]!.captured_value).toBeNull();
    expect(next.steps[0]!.captured_at).toBeNull();
    expect(next.steps[0]!.inferred).toBe(false);
  });

  it('decrements current_progress when resetting a counts_toward_threshold step', () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR_ISO);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_2', value: 'first_offense', capturedAt: T1 },
      sopConfig,
    );
    expect(state.current_progress).toBe(2);

    const next = advanceSOP(state, { type: 'reset_step', step_id: 'step_2' }, sopConfig);
    expect(next.current_progress).toBe(1);
  });

  it('does NOT decrement progress for a non-threshold step', () => {
    const sopConfig = buildSOPConfig({ withNonThresholdStep: true, numSteps: 3 });
    let state = initSOPState(sopConfig, ANCHOR_ISO);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_3', value: 'foo', capturedAt: T1 },
      sopConfig,
    );
    // step_3 has counts_toward_threshold=false in this config.
    expect(state.current_progress).toBe(0);

    const next = advanceSOP(state, { type: 'reset_step', step_id: 'step_3' }, sopConfig);
    expect(next.current_progress).toBe(0);
    expect(next.steps[2]!.status).toBe('pending');
  });

  it('is a no-op when called on an already-pending step', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    const next = advanceSOP(state, { type: 'reset_step', step_id: 'step_1' }, sopConfig);
    expect(next).toBe(state); // same reference
  });

  it('refuses to reset an unknown step id', () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR_ISO);
    expect(() => advanceSOP(
      state,
      { type: 'reset_step', step_id: 'nonexistent' },
      sopConfig,
    )).toThrow(/unknown step/i);
  });
});

// ---------------------------------------------------------------------------
// advanceSOP — finalize / finalize_out_of_scope
// ---------------------------------------------------------------------------

describe('advanceSOP finalize', () => {
  function captureAll(state: SOPState, sopConfig: SOPConfiguration): SOPState {
    let s = state;
    for (const step of state.steps) {
      s = advanceSOP(
        s,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    return s;
  }

  it('sets is_finalized=true when all required steps are complete', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    const captured = captureAll(initial, sopConfig);
    const finalized = advanceSOP(captured, { type: 'finalize' }, sopConfig);
    expect(finalized.is_finalized).toBe(true);
    expect(finalized.out_of_scope_termination).toBe(false);
  });

  it('refuses to finalize when required steps are still pending', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    expect(() => advanceSOP(initial, { type: 'finalize' }, sopConfig)).toThrow(/required/i);
  });

  it('allows finalize with skipped non-required steps', () => {
    const sopConfig = buildSOPConfig({ withOptionalStep: true });
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    let s = initial;
    // Capture the 4 required steps, leave the 5th (optional) pending.
    for (const step of initial.steps.filter((st) => st.step_id !== 'step_5')) {
      s = advanceSOP(
        s,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    // Optional last step still pending — finalize must succeed because it's not required.
    const finalized = advanceSOP(s, { type: 'finalize' }, sopConfig);
    expect(finalized.is_finalized).toBe(true);
  });

  it('finalize_out_of_scope sets both is_finalized AND out_of_scope_termination', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    // Only Step 1 captured (the case_type)
    const after1 = advanceSOP(
      initial,
      { type: 'capture_step', step_id: 'step_1', value: 'estate_planning', capturedAt: T1 },
      sopConfig,
    );
    const finalized = advanceSOP(after1, { type: 'finalize_out_of_scope' }, sopConfig);
    expect(finalized.is_finalized).toBe(true);
    expect(finalized.out_of_scope_termination).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nextPendingStep
// ---------------------------------------------------------------------------

describe('nextPendingStep', () => {
  it('returns the earliest pending step (by position) on a fresh state', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    const next = nextPendingStep(initial, sopConfig);
    expect(next?.slug).toBe('case_type');
  });

  it('skips complete steps and returns the earliest remaining pending', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    const after1 = advanceSOP(
      initial,
      { type: 'capture_step', step_id: 'step_1', value: 'a', capturedAt: T1 },
      sopConfig,
    );
    const next = nextPendingStep(after1, sopConfig);
    expect(next?.slug).toBe('sub_type');
  });

  it('skips both complete AND skipped steps', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    let s = advanceSOP(
      initial,
      { type: 'capture_step', step_id: 'step_1', value: 'a', capturedAt: T1 },
      sopConfig,
    );
    s = advanceSOP(s, { type: 'skip_step', step_id: 'step_2' }, sopConfig);
    const next = nextPendingStep(s, sopConfig);
    expect(next?.slug).toBe('where');
  });

  it('returns null when no steps are pending', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR_ISO);
    let s = initial;
    for (const step of initial.steps) {
      s = advanceSOP(
        s,
        { type: 'capture_step', step_id: step.step_id, value: 'x', capturedAt: T1 },
        sopConfig,
      );
    }
    expect(nextPendingStep(s, sopConfig)).toBeNull();
  });
});
