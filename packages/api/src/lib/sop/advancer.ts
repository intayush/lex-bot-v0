/**
 * SOP advancer (018-forward-only-sop).
 *
 * Forward-only model: processes only the current pending step each turn.
 * No multi-step skip detection; no correction-signal back-fill.
 *
 * When the pending step receives no usable answer, the re-ask counter for
 * that step increments. After SOP_REASK_LIMIT consecutive unanswered turns
 * the step is skipped and the SOP advances to the next pending step.
 */
import type { CaseType, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { SOP_REASK_LIMIT } from '@legal-chatbot/shared';
import { advanceSOP, nextPendingStep } from './state-machine';
import { detectSkippedSteps, type SkipDetectorMatch } from './skip-detector';
import { inferDate } from './date-inferer';
import { extractContactPayload } from './contact-form';

export interface AdvanceForVisitorMessageInput {
  state: SOPState;
  sopConfig: SOPConfiguration;
  caseTypes: CaseType[];
  message: string;
  capturedAt?: string;
  /** Optional date-inferer injection for tests. */
  inferDateImpl?: typeof inferDate;
}

export interface AdvanceForVisitorMessageResult {
  /** New SOP state after applying detected captures. */
  state: SOPState;
  /** The single match applied this turn, or empty when no capture. */
  matches: SkipDetectorMatch[];
  /**
   * The pending step BEFORE this turn's advancement, captured for
   * downstream off-topic detection. Null when no step was pending
   * (SOP already complete or finalized).
   */
  pendingStepBefore: SOPConfiguration['steps'][number] | null;
}

export async function advanceForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): Promise<AdvanceForVisitorMessageResult> {
  const { sopConfig, caseTypes, message } = input;
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  const pendingStepBefore = nextPendingStep(input.state, sopConfig);

  if (input.state.is_finalized) {
    return { state: input.state, matches: [], pendingStepBefore };
  }

  if (!pendingStepBefore) {
    return { state: input.state, matches: [], pendingStepBefore };
  }

  // Empty or whitespace-only messages do not count as unanswered turns.
  if (message.trim().length === 0) {
    return { state: input.state, matches: [], pendingStepBefore };
  }

  // Contact-form short-circuit: when the pending step is a contact_form step,
  // try to extract a structured contact payload from the visitor's message.
  // On success: capture the step and skip the skip-detector pass.
  if (pendingStepBefore.chip_source === 'contact_form') {
    const payload = extractContactPayload(message);
    if (payload) {
      let next = advanceSOP(
        input.state,
        {
          type: 'capture_step',
          step_id: pendingStepBefore.id,
          value: JSON.stringify(payload),
          capturedAt,
          inferred: false,
        },
        sopConfig,
      );
      next = autoFinalizeIfReady(next, sopConfig);
      return {
        state: next,
        matches: [{
          step_id: pendingStepBefore.id,
          slug: pendingStepBefore.slug,
          captured_value: JSON.stringify(payload),
          captured_label: null,
          out_of_scope: false,
          source: 'free_text',
        }],
        pendingStepBefore,
      };
    }
    // Extraction failed: increment re-ask counter and leave step pending.
    return {
      state: incrementReaskCount(input.state, pendingStepBefore.id, sopConfig),
      matches: [],
      pendingStepBefore,
    };
  }

  // Run the detector for ALL pending steps so chip/date matching works
  // correctly (it needs the full pending context to resolve case_type →
  // sub_type relationships). Then filter to the single current pending step.
  const allMatches = await detectSkippedSteps({
    message,
    state: input.state,
    sopConfig,
    caseTypes,
    inferDateImpl: input.inferDateImpl,
  });

  const currentMatch = allMatches.find((m) => m.step_id === pendingStepBefore.id) ?? null;

  if (currentMatch === null) {
    // No capture for the current pending step — increment re-ask counter.
    return {
      state: incrementReaskCount(input.state, pendingStepBefore.id, sopConfig),
      matches: [],
      pendingStepBefore,
    };
  }

  let next = advanceSOP(
    input.state,
    {
      type: 'capture_step',
      step_id: currentMatch.step_id,
      value: currentMatch.captured_value,
      capturedAt,
      inferred: currentMatch.source !== 'free_text',
      capturedLabel: currentMatch.captured_label,
    },
    sopConfig,
  );

  if (currentMatch.out_of_scope) {
    next = advanceSOP(next, { type: 'finalize_out_of_scope' }, sopConfig);
  } else {
    next = autoFinalizeIfReady(next, sopConfig);
  }

  return { state: next, matches: [currentMatch], pendingStepBefore };
}

// ---------------------------------------------------------------------------
// Re-ask counter
// ---------------------------------------------------------------------------

/**
 * Increment the re-ask counter for the given step. When the counter reaches
 * SOP_REASK_LIMIT the step is skipped and the SOP advances to the next
 * pending step (018-forward-only-sop FR-006 to FR-009).
 */
function incrementReaskCount(
  state: SOPState,
  stepId: string,
  sopConfig: SOPConfiguration,
): SOPState {
  const idx = state.steps.findIndex((s) => s.step_id === stepId);
  if (idx === -1) return state;

  const currentCount = state.steps[idx]!.reask_count ?? 0;
  const newCount = currentCount + 1;

  const updatedSteps = state.steps.map((s, i) =>
    i === idx ? { ...s, reask_count: newCount } : s,
  );
  const stateWithCount: SOPState = { ...state, steps: updatedSteps };

  if (newCount >= SOP_REASK_LIMIT) {
    return advanceSOP(stateWithCount, { type: 'skip_step', step_id: stepId }, sopConfig);
  }

  return stateWithCount;
}

// ---------------------------------------------------------------------------
// Auto-finalize
// ---------------------------------------------------------------------------

/**
 * Auto-finalize the SOP state when current_progress reaches
 * qualified_lead_threshold and no required step is still pending.
 */
function autoFinalizeIfReady(state: SOPState, sopConfig: SOPConfiguration): SOPState {
  if (state.is_finalized) return state;
  if (state.current_progress < state.qualified_lead_threshold) return state;
  const requiredPending = state.steps.some((s) => {
    if (s.status !== 'pending') return false;
    const cfgStep = sopConfig.steps.find((cs) => cs.id === s.step_id);
    return cfgStep?.is_required ?? true;
  });
  if (requiredPending) return state;
  return advanceSOP(state, { type: 'finalize' }, sopConfig);
}

/**
 * Convenience wrapper that returns just the new SOPState. Used by tests
 * that don't need matches or pendingStepBefore.
 */
export async function advanceStateForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): Promise<SOPState> {
  const result = await advanceForVisitorMessage(input);
  return result.state;
}
