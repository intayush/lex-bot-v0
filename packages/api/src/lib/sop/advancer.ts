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
import { advanceSOP } from './state-machine';
import { detectSkippedSteps } from './skip-detector';
import { inferDate } from './date-inferer';

export interface AdvanceForVisitorMessageInput {
  state: SOPState;
  sopConfig: SOPConfiguration;
  caseTypes: CaseType[];
  message: string;
  capturedAt?: string;
  /** Optional date-inferer injection for tests. */
  inferDateImpl?: typeof inferDate;
}

export async function advanceForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): Promise<SOPState> {
  const { sopConfig, caseTypes, message } = input;
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  if (input.state.is_finalized) return input.state;

  const matches = await detectSkippedSteps({
    message,
    state: input.state,
    sopConfig,
    caseTypes,
    inferDateImpl: input.inferDateImpl,
  });

  if (matches.length === 0) return input.state;

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

  if (anyOutOfScope) {
    next = advanceSOP(next, { type: 'finalize_out_of_scope' }, sopConfig);
  }

  return next;
}
