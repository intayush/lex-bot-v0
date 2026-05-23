/**
 * SOP advancer (010-sop-workflow T041 — Phase 4 US2 wiring).
 *
 * Thin layer that calls the skip-detector to find which SOP steps the
 * visitor's message answers, then applies each match as a `capture_step`
 * action via the state machine. Handles out-of-scope termination as a
 * special case after all captures land.
 *
 * Was the v0 advancer (Phase 3 T031) that had its own chip-matching
 * logic; that logic now lives in skip-detector.ts and supports
 * multi-step matches per FR-016.
 */
import type { CaseType, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
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
  /** Skip-detector matches found for this message (empty if none). */
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

  // Contact-form short-circuit: when the pending step is a contact_form
  // step (e.g., the default SOP's 'contact' step at position 6), try to
  // extract a structured contact payload from the visitor's message.
  // The widget normally dispatches a well-formed sentence ('My name is
  // Jane, my email is jane@example.com') after the visitor fills the
  // form, so extraction succeeds reliably. Free-text "I'm Jane,
  // jane@x.com" also works (same regex patterns).
  //
  // On success: capture the step with the JSON-stringified payload and
  // skip the regular skip-detector pass — the contact step is the
  // explicit answer to the pending question and shouldn't be diluted
  // with case_type/sub_type/when re-detection.
  if (pendingStepBefore?.chip_source === 'contact_form') {
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
          out_of_scope: false,
          source: 'free_text',
        }],
        pendingStepBefore,
      };
    }
    // Extraction failed: leave step pending. The widget keeps the
    // form rendered; the visitor can re-submit. We DON'T fall through
    // to skip-detector because that would risk capturing the message
    // into some other step incorrectly.
    return { state: input.state, matches: [], pendingStepBefore };
  }

  const matches = await detectSkippedSteps({
    message,
    state: input.state,
    sopConfig,
    caseTypes,
    inferDateImpl: input.inferDateImpl,
  });

  if (matches.length === 0) {
    return { state: input.state, matches, pendingStepBefore };
  }

  // Detect change-of-mind on case_type. If the visitor corrected the
  // case_type (matches contains a 'correction' match for case_type)
  // AND a sub_type was previously captured, that sub_type is scoped
  // to the OLD case_type and is now stale — reset it to pending so
  // the agent re-asks on the next turn.
  const caseTypeCorrection = matches.find(
    (m) => m.slug === 'case_type' && m.source === 'correction',
  );
  const subTypeAlsoCorrected = matches.some(
    (m) => m.slug === 'sub_type' && m.source === 'correction',
  );

  // Apply each match as a capture_step action. Skip-detector already
  // de-duplicates per step; applying in match order is safe.
  let next = input.state;
  let anyOutOfScope = false;
  for (const m of matches) {
    next = advanceSOP(
      next,
      {
        type: 'capture_step',
        step_id: m.step_id,
        value: m.captured_value,
        capturedAt,
        // Multi-step / pattern-derived captures are "inferred" from the
        // user's perspective. Single-step explicit chip taps are also
        // marked inferred=true here for simplicity; consumers (logging,
        // dashboard) treat all skip-detector captures uniformly.
        inferred: m.source !== 'free_text',
      },
      sopConfig,
    );
    if (m.out_of_scope) anyOutOfScope = true;
  }

  // After captures land: if case_type was just corrected AND no new
  // sub_type was captured in the same turn, reset the (now-stale)
  // sub_type step so the agent re-asks it.
  if (caseTypeCorrection && !subTypeAlsoCorrected) {
    const subTypeStep = sopConfig.steps.find((s) => s.slug === 'sub_type');
    if (subTypeStep) {
      const subTypeState = next.steps.find((s) => s.step_id === subTypeStep.id);
      if (subTypeState?.status === 'complete') {
        next = advanceSOP(next, { type: 'reset_step', step_id: subTypeStep.id }, sopConfig);
      }
    }
  }

  if (anyOutOfScope) {
    next = advanceSOP(next, { type: 'finalize_out_of_scope' }, sopConfig);
  } else {
    next = autoFinalizeIfReady(next, sopConfig);
  }

  return { state: next, matches, pendingStepBefore };
}

/**
 * Auto-finalize the SOP state when:
 *   (a) `current_progress` has reached `qualified_lead_threshold`, AND
 *   (b) no required step is still pending.
 *
 * This is the missing link from the spec's "set is_finalized=true on
 * Step 6 finalize" rule (data-model.md). Without it, the runtime would
 * stay forever at `current=N, total=N, is_finalized=false`, which
 * confuses the widget (contact form keeps showing) and breaks the
 * captureLead flow.
 *
 * No-op when already finalized OR when conditions aren't met.
 */
function autoFinalizeIfReady(state: SOPState, sopConfig: SOPConfiguration): SOPState {
  if (state.is_finalized) return state;
  if (state.current_progress < state.qualified_lead_threshold) return state;
  // Confirm no required step is still pending.
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
 * (which don't care about matches / pendingStepBefore). Production
 * callers should use advanceForVisitorMessage to retain the full result.
 */
export async function advanceStateForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): Promise<SOPState> {
  const result = await advanceForVisitorMessage(input);
  return result.state;
}
