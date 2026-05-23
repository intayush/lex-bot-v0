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
 *   - When-step date inference: if the pending step's slug is 'when',
 *     route the captured text through `inferDate` (R3) so the stored
 *     value is an ISO 8601 date rather than the verbatim phrase
 *     ("yesterday" → "2026-05-22"). Inference confidence < 0.6
 *     (per R3 threshold) leaves the step pending and lets the agent
 *     ask a clarifying question (FR-014).
 *   - Otherwise: state unchanged. The agent will ask the pending step's
 *     question; the visitor can chip-select on a future turn.
 *
 * Does NOT do:
 *   - Multi-step skip detection (covered by Phase 4 skip-detector).
 *   - LLM disambiguation for ambiguous case-type free text.
 *
 * The function is async because of date inference. Pure besides that —
 * no DB writes; only an LLM call inside `inferDate` when the when step
 * is pending.
 */
import type { CaseType, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { advanceSOP, nextPendingStep } from './state-machine';
import { inferDate } from './date-inferer';

/** Slug convention for the date-bearing SOP step. */
const WHEN_STEP_SLUG = 'when';

export interface AdvanceForVisitorMessageInput {
  state: SOPState;
  sopConfig: SOPConfiguration;
  caseTypes: CaseType[];
  /** The visitor's latest message text. */
  message: string;
  /** Captured-at timestamp (defaults to now). */
  capturedAt?: string;
  /**
   * Optional date-inferer injection for tests. Production callers omit
   * this and the real Gemini-backed inferDate is used.
   */
  inferDateImpl?: typeof inferDate;
}

export async function advanceForVisitorMessage(
  input: AdvanceForVisitorMessageInput,
): Promise<SOPState> {
  const { state, sopConfig, caseTypes, message } = input;
  const capturedAt = input.capturedAt ?? new Date().toISOString();
  const inferDateFn = input.inferDateImpl ?? inferDate;

  if (state.is_finalized) return state;

  const pendingStep = nextPendingStep(state, sopConfig);
  if (!pendingStep) return state;

  const trimmed = message.trim();
  if (trimmed.length === 0) return state;

  const lower = trimmed.toLowerCase();

  // Try chip slug / label matching first. Even when the slug is 'when',
  // chip selection should resolve through the chip's slug (e.g. "yesterday")
  // BEFORE date inference — the chip slug IS the date expression we feed
  // into inferDate.
  const chipMatch = matchChip(lower, pendingStep, caseTypes, state);
  if (chipMatch) {
    // Out-of-scope case_type chip → finalize_out_of_scope after capture.
    let captured: string = chipMatch.value;

    // When-step chip selection: convert chip slug ("yesterday", "today",
    // "this_week", ...) to an ISO date via inferDate.
    if (pendingStep.slug === WHEN_STEP_SLUG) {
      const result = await inferDateFn({
        userText: chipMatch.value,
        conversationAnchorIso: state.conversation_anchor_iso,
      });
      if (result.iso_date === null) {
        // Inference failed for a chip we ourselves provided — that's a
        // real Gemini failure. Fall back to capturing the verbatim slug
        // rather than leaving the step pending; the lead-capture LLM can
        // still surface the slug ("yesterday") as the incidentDate.
        captured = chipMatch.value;
      } else {
        captured = result.iso_date;
      }
    }

    let next = advanceSOP(
      state,
      { type: 'capture_step', step_id: pendingStep.id, value: captured, capturedAt },
      sopConfig,
    );
    if (chipMatch.outOfScope) {
      next = advanceSOP(next, { type: 'finalize_out_of_scope' }, sopConfig);
    }
    return next;
  }

  // Free-text fallback: only if the step accepts free text.
  if (pendingStep.accepts_free_text && !pendingStep.chip_source) {
    let captured = trimmed;

    // When-step free-text: route through date inference. If confidence is
    // below R3's 0.6 threshold, inferDate returns iso_date=null and we
    // leave the step pending so the agent asks a clarifying question
    // (FR-014).
    if (pendingStep.slug === WHEN_STEP_SLUG) {
      const result = await inferDateFn({
        userText: trimmed,
        conversationAnchorIso: state.conversation_anchor_iso,
      });
      if (result.iso_date === null) {
        return state; // pending; agent asks clarifying
      }
      captured = result.iso_date;
    }

    return advanceSOP(
      state,
      { type: 'capture_step', step_id: pendingStep.id, value: captured, capturedAt },
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
