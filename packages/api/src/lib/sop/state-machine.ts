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
      /**
       * Human-readable label snapshot at capture time (e.g. "DUI").
       * Forwarded from `SkipDetectorMatch.captured_label`. Persisted on
       * the resulting state step so leads remain meaningful even if
       * the firm later renames or removes the chip
       * (014-fix-sop-case-subtypes FR-022). Optional/null for
       * non-chip captures.
       */
      capturedLabel?: string | null;
    }
  | {
      type: 'skip_step';
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
    captured_label: null,
    reask_count: 0,
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
    // 014-fix-sop-case-subtypes T018 / FR-022: snapshot the chip's
    // human-readable label at capture time so leads remain meaningful
    // after later edits. `null` when the action didn't supply one
    // (free-text captures, date inference results, contact form).
    captured_label: action.capturedLabel ?? null,
    // 018-forward-only-sop: reset re-ask counter on completion.
    reask_count: 0,
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
  // Per spec 015 research.md §R2: steps with `applies_when_sub_type_slug`
  // set only fire when the captured sub_type's slug matches. NULL on the
  // step means "always fires" (the existing 6 default steps).
  //
  // Read the captured sub_type once here; defensive — empty when the
  // SOP hasn't reached the sub_type step yet.
  const capturedSubTypeSlug =
    state.steps.find((s) => s.slug === 'sub_type')?.captured_value ?? null;

  // Steps in state are already in position order from initSOPState,
  // but advanceSOP preserves order so we iterate state.steps directly.
  for (const stateStep of state.steps) {
    if (stateStep.status !== 'pending') continue;

    const cfgStep = sopConfig.steps.find((cs) => cs.id === stateStep.step_id);
    if (!cfgStep) continue;

    // Filter: skip steps whose `applies_when_sub_type_slug` doesn't match.
    // null/undefined on the field means "always fires".
    const requiredSubType = cfgStep.applies_when_sub_type_slug;
    if (requiredSubType !== null && requiredSubType !== undefined) {
      if (capturedSubTypeSlug !== requiredSubType) continue;
    }

    return cfgStep;
  }
  return null;
}
