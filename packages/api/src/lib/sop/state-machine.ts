/**
 * SOP state machine (010-sop-workflow T027).
 *
 * Pure-functional, immutable updates. No DB, no LLM, no I/O.
 *
 * Source of truth: contracts/sop-state-contract.md and
 * data-model.md "State Transitions".
 *
 * Public surface:
 * - initSOPState(sopConfig, conversationAnchorIso): build a fresh SOPState
 *   with all steps pending.
 * - advanceSOP(state, action): apply a single transition; throws on
 *   invalid actions.
 * - nextPendingStep(state, sopConfig): the earliest pending step in
 *   position order, or null if none remain.
 */
import type {
  SOPConfiguration,
  SOPState,
  SOPStateStep,
  SOPStep,
} from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Action surface
// ---------------------------------------------------------------------------

export type SOPAction =
  | {
      type: 'capture_step';
      step_id: string;
      value: string;
      /** ISO 8601 timestamp from the route handler. */
      capturedAt: string;
      /** True if captured via the skip-detector (R4). */
      inferred?: boolean;
    }
  | {
      type: 'skip_step';
      step_id: string;
    }
  | {
      /**
       * Reset a previously-captured step back to `pending`. Used when a
       * later capture invalidates an earlier one — e.g., the case_type
       * changes via correction, so the sub_type that was scoped to the
       * old case_type must be re-asked. current_progress decrements by
       * 1 if the reset step's `counts_toward_threshold` was true.
       */
      type: 'reset_step';
      step_id: string;
    }
  | {
      /** Mark the SOP complete normally (Step 6 finalize OR threshold met). */
      type: 'finalize';
    }
  | {
      /** Visitor selected an out-of-scope chip; finalize + flag. */
      type: 'finalize_out_of_scope';
    };

// ---------------------------------------------------------------------------
// initSOPState
// ---------------------------------------------------------------------------

export function initSOPState(
  sopConfig: SOPConfiguration,
  conversationAnchorIso: string,
): SOPState {
  // Sort by position so consumers can iterate in display order.
  const orderedSteps = [...sopConfig.steps].sort((a, b) => a.position - b.position);

  const stateSteps: SOPStateStep[] = orderedSteps.map((s) => ({
    step_id: s.id,
    slug: s.slug,
    status: 'pending',
    captured_value: null,
    captured_at: null,
    inferred: false,
  }));

  return {
    sop_configuration_id: sopConfig.id,
    sop_version: sopConfig.version,
    conversation_anchor_iso: conversationAnchorIso,
    steps: stateSteps,
    qualified_lead_threshold: sopConfig.qualified_lead_threshold,
    current_progress: 0,
    is_finalized: false,
    out_of_scope_termination: false,
  };
}

// ---------------------------------------------------------------------------
// advanceSOP
// ---------------------------------------------------------------------------

/**
 * Apply a single SOP transition. Pure-functional; returns a new SOPState.
 *
 * `sopConfig` is consumed only for `capture_step` (to read each step's
 * `counts_toward_threshold` flag) and `finalize` (to inspect `is_required`
 * before allowing finalization). Pass it always so callers don't need to
 * reason about which actions need it.
 */
export function advanceSOP(
  state: SOPState,
  action: SOPAction,
  sopConfig: SOPConfiguration,
): SOPState {
  switch (action.type) {
    case 'capture_step':
      return applyCapture(state, action, sopConfig);
    case 'skip_step':
      return applySkip(state, action.step_id);
    case 'reset_step':
      return applyReset(state, action.step_id, sopConfig);
    case 'finalize':
      return applyFinalize(state, false, sopConfig);
    case 'finalize_out_of_scope':
      return applyFinalize(state, true, sopConfig);
    default: {
      // exhaustiveness check
      const _never: never = action;
      throw new Error(`unknown action: ${JSON.stringify(_never)}`);
    }
  }
}

function applyCapture(
  state: SOPState,
  action: Extract<SOPAction, { type: 'capture_step' }>,
  sopConfig: SOPConfiguration,
): SOPState {
  const idx = state.steps.findIndex((s) => s.step_id === action.step_id);
  if (idx === -1) {
    throw new Error(`unknown step id: ${action.step_id}`);
  }
  const cfgStep = sopConfig.steps.find((s) => s.id === action.step_id);
  if (!cfgStep) {
    throw new Error(`unknown step id: ${action.step_id} (not in config)`);
  }
  const previousStatus = state.steps[idx]!.status;

  const updatedStep: SOPStateStep = {
    ...state.steps[idx]!,
    status: 'complete',
    captured_value: action.value,
    captured_at: action.capturedAt,
    inferred: action.inferred ?? false,
  };

  const newSteps = [
    ...state.steps.slice(0, idx),
    updatedStep,
    ...state.steps.slice(idx + 1),
  ];

  // current_progress increments only when:
  //   (a) cfgStep.counts_toward_threshold is true, AND
  //   (b) previous status was NOT already 'complete' (no double-count).
  let progressDelta = 0;
  if (cfgStep.counts_toward_threshold && previousStatus !== 'complete') {
    progressDelta = 1;
  }

  return {
    ...state,
    steps: newSteps,
    current_progress: state.current_progress + progressDelta,
  };
}

function applySkip(state: SOPState, stepId: string): SOPState {
  const idx = state.steps.findIndex((s) => s.step_id === stepId);
  if (idx === -1) {
    throw new Error(`unknown step id: ${stepId}`);
  }

  const updatedStep: SOPStateStep = {
    ...state.steps[idx]!,
    status: 'skipped',
    captured_value: null,
    captured_at: null,
    inferred: false,
  };

  const newSteps = [
    ...state.steps.slice(0, idx),
    updatedStep,
    ...state.steps.slice(idx + 1),
  ];

  return { ...state, steps: newSteps };
}

function applyReset(
  state: SOPState,
  stepId: string,
  sopConfig: SOPConfiguration,
): SOPState {
  const idx = state.steps.findIndex((s) => s.step_id === stepId);
  if (idx === -1) {
    throw new Error(`unknown step id: ${stepId}`);
  }
  const cfgStep = sopConfig.steps.find((s) => s.id === stepId);
  if (!cfgStep) {
    throw new Error(`unknown step id: ${stepId} (not in config)`);
  }
  const previousStatus = state.steps[idx]!.status;

  // Reset is a no-op for already-pending steps.
  if (previousStatus === 'pending') return state;

  const updatedStep: SOPStateStep = {
    ...state.steps[idx]!,
    status: 'pending',
    captured_value: null,
    captured_at: null,
    inferred: false,
  };

  const newSteps = [
    ...state.steps.slice(0, idx),
    updatedStep,
    ...state.steps.slice(idx + 1),
  ];

  // Decrement progress only if the reset step had been counted.
  let progressDelta = 0;
  if (previousStatus === 'complete' && cfgStep.counts_toward_threshold) {
    progressDelta = -1;
  }

  return {
    ...state,
    steps: newSteps,
    current_progress: Math.max(0, state.current_progress + progressDelta),
  };
}

function applyFinalize(
  state: SOPState,
  outOfScope: boolean,
  sopConfig: SOPConfiguration,
): SOPState {
  if (!outOfScope) {
    // Required steps must be complete OR skipped (latter only legitimate
    // for non-required steps; we use the config flag to decide).
    const requiredPending = state.steps.filter((stateStep) => {
      if (stateStep.status !== 'pending') return false;
      const cfgStep = sopConfig.steps.find((cs) => cs.id === stateStep.step_id);
      return cfgStep?.is_required ?? true;
    });
    if (requiredPending.length > 0) {
      throw new Error(
        `cannot finalize: ${requiredPending.length} required step(s) still pending ` +
        `(${requiredPending.map((s) => s.slug).join(', ')}). ` +
        `Either capture/skip them first, or use finalize_out_of_scope.`,
      );
    }
  }
  return {
    ...state,
    is_finalized: true,
    out_of_scope_termination: outOfScope,
  };
}

// ---------------------------------------------------------------------------
// nextPendingStep
// ---------------------------------------------------------------------------

export function nextPendingStep(
  state: SOPState,
  sopConfig: SOPConfiguration,
): SOPStep | null {
  // Steps in state are already in position order from initSOPState,
  // but advanceSOP preserves order so we iterate state.steps directly.
  for (const stateStep of state.steps) {
    if (stateStep.status === 'pending') {
      const cfgStep = sopConfig.steps.find((cs) => cs.id === stateStep.step_id);
      return cfgStep ?? null;
    }
  }
  return null;
}
