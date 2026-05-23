/**
 * SOP advancer v0 — minimal, conservative state advancement (010-sop-workflow T031).
 *
 * Phase 4 (US2) replaces this with the full skip-detector that handles
 * pattern-matching across multiple pending steps in a single message + LLM
 * disambiguation. Until then, this v0 is enough to make the US1 happy
 * path work end-to-end:
 *
 *   - Chip selection: the visitor's message exactly matches a chip slug
 *     OR chip label of the *currently pending* step → capture that step.
 *   - Free-text fallback: the pending step has chip_source=null AND
 *     accepts_free_text=true → capture the verbatim message as the value.
 *   - Otherwise: state unchanged. The agent will ask the pending step's
 *     question; the visitor can chip-select on a future turn.
 *
 * Does NOT do:
 *   - Multi-step skip detection (covered by Phase 4 skip-detector).
 *   - Date inference for "when" steps (covered by Phase 4 wiring of
 *     date-inferer; this v0 just captures the verbatim text).
 *   - LLM disambiguation.
 *
 * The function is pure — no DB, no LLM, no I/O.
 */
import type { CaseType, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { advanceSOP, nextPendingStep } from './state-machine';

export interface AdvanceForVisitorMessageInput {
  state: SOPState;
  sopConfig: SOPConfiguration;
  caseTypes: CaseType[];
  /** The visitor's latest message text. */
  message: string;
  /** Captured-at timestamp (defaults to now). */
  capturedAt?: string;
}

export function advanceForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): SOPState {
  const { state, sopConfig, caseTypes, message } = input;
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  if (state.is_finalized) return state;

  const pendingStep = nextPendingStep(state, sopConfig);
  if (!pendingStep) return state;

  const trimmed = message.trim();
  if (trimmed.length === 0) return state;

  const lower = trimmed.toLowerCase();

  // Try chip slug / label matching first.
  const chipMatch = matchChip(lower, pendingStep, caseTypes, state);
  if (chipMatch) {
    // Out-of-scope case_type chip → finalize_out_of_scope after capture.
    let next = advanceSOP(
      state,
      { type: 'capture_step', step_id: pendingStep.id, value: chipMatch.value, capturedAt },
      sopConfig,
    );
    if (chipMatch.outOfScope) {
      next = advanceSOP(next, { type: 'finalize_out_of_scope' }, sopConfig);
    }
    return next;
  }

  // Free-text fallback: only if the step accepts free text. Avoid capturing
  // when chip_source is set (chip-only steps shouldn't accept arbitrary
  // text as a successful capture).
  if (pendingStep.accepts_free_text && !pendingStep.chip_source) {
    return advanceSOP(
      state,
      { type: 'capture_step', step_id: pendingStep.id, value: trimmed, capturedAt },
      sopConfig,
    );
  }

  // Pending step has chips but the message didn't match any → leave
  // pending. The agent will ask the question; the visitor can chip-select
  // next turn. Phase 4 skip-detector will improve free-text handling for
  // chip-bearing steps.
  return state;
}

// ---------------------------------------------------------------------------
// Chip matching
// ---------------------------------------------------------------------------

interface ChipMatch {
  /** Captured value (chip slug). */
  value: string;
  /** True if the chip's case-type is marked is_in_scope=false. */
  outOfScope: boolean;
}

function matchChip(
  lowerMessage: string,
  pendingStep: SOPConfiguration['steps'][number],
  caseTypes: CaseType[],
  state: SOPState,
): ChipMatch | null {
  if (pendingStep.chip_source === 'case_types') {
    // Match against the account's case type slugs and labels.
    for (const ct of caseTypes) {
      if (lowerMessage === ct.slug || lowerMessage === ct.label.toLowerCase()) {
        return { value: ct.slug, outOfScope: !ct.is_in_scope };
      }
    }
    return null;
  }

  if (pendingStep.chip_source === 'sub_types') {
    // Sub-types are scoped to whichever case_type was captured earlier.
    const caseTypeStep = state.steps.find((s) => s.slug === 'case_type');
    const captured = caseTypeStep?.captured_value;
    if (!captured) return null;
    const ct = caseTypes.find((c) => c.slug === captured);
    if (!ct) return null;
    for (const st of ct.sub_types) {
      if (lowerMessage === st.slug || lowerMessage === st.label.toLowerCase()) {
        return { value: st.slug, outOfScope: false };
      }
    }
    return null;
  }

  if (pendingStep.chip_source === 'inline' && pendingStep.inline_chips_json) {
    let chips: Array<{ label: string; slug: string }>;
    try {
      chips = JSON.parse(pendingStep.inline_chips_json);
    } catch {
      return null;
    }
    for (const chip of chips) {
      if (lowerMessage === chip.slug || lowerMessage === chip.label.toLowerCase()) {
        return { value: chip.slug, outOfScope: false };
      }
    }
    return null;
  }

  return null;
}
