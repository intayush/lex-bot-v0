/**
 * SOP skip-detector — Phase A pattern matcher (010-sop-workflow T040).
 *
 * Inspects a visitor message and returns the SOP steps it answers. Handles
 * the multi-step capture case (US2 / FR-016): a single message like
 * "I had a DUI yesterday" yields matches for both `case_type` and `when`.
 *
 * Phase A — pattern matching (this module):
 *   - case_type: scan for any case-type slug or label substring
 *   - sub_type:  same, but only when case_type is already captured
 *   - inline-chip steps (e.g. when): scan for chip slug or label substrings;
 *     for the `when` step specifically, also run inferDate for free-text
 *     date phrases the chips don't cover
 *   - free-text steps (where, what): captured ONLY when the step is the
 *     current pending step AND no other matches were found in this turn
 *
 * Phase B — LLM disambiguation (NOT in this module):
 *   Research R4 proposed a gated LLM call when Phase A produces 0 matches
 *   AND ≥ 2 steps are pending. Deferred until production conversations
 *   show real cases Phase A misses. Adding it later is straightforward.
 *
 * Pure-functional except for the optional date-inferer call (which is
 * itself injection-friendly for tests). No DB writes, no other I/O.
 */
import type { CaseType, SOPConfiguration, SOPState } from '@legal-chatbot/shared';
import { inferDate } from './date-inferer';

const WHEN_STEP_SLUG = 'when';
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Words/phrases that signal the visitor is correcting an earlier answer.
 * Word-boundary matched, case-insensitive. Conservative list: matches
 * are explicit-intent only ("actually it's...", "wait, no...", "i meant
 * personal injury"), avoiding false positives on incidental case_type
 * mentions ("my friend had a DUI too").
 */
const CORRECTION_SIGNAL_REGEX = /\b(actually|wait|never\s*mind|nevermind|instead|i\s*meant|i\s*mean|sorry\s+(?:no|i)|change\s+(?:that|to)|correct\s+(?:that|me)|let\s*me\s*correct|scratch\s+that|no\s*,)/i;

export interface SkipDetectorMatch {
  step_id: string;
  slug: string;
  /** Captured value: chip slug for chip steps, ISO date for when, free text for free-text steps. */
  captured_value: string;
  /** True iff this is a case_type chip whose case-type is_in_scope=false. */
  out_of_scope: boolean;
  /** Source of the match (informational; useful for logging). */
  source: 'chip' | 'date_inference' | 'free_text' | 'correction';
}

export interface DetectSkippedStepsInput {
  message: string;
  state: SOPState;
  sopConfig: SOPConfiguration;
  caseTypes: CaseType[];
  /** Optional date-inferer injection for tests. Defaults to real Gemini-backed inferDate. */
  inferDateImpl?: typeof inferDate;
}

export async function detectSkippedSteps(
  input: DetectSkippedStepsInput,
): Promise<SkipDetectorMatch[]> {
  const { state, sopConfig, caseTypes, message } = input;
  const inferDateFn = input.inferDateImpl ?? inferDate;

  if (state.is_finalized) return [];

  const trimmed = message.trim();
  if (trimmed.length === 0) return [];

  const lower = trimmed.toLowerCase();
  const hasCorrectionSignal = CORRECTION_SIGNAL_REGEX.test(lower);

  const pendingSteps = sopConfig.steps
    .filter((s) => isStepPending(state, s.id))
    .sort((a, b) => a.position - b.position);

  // No pending steps AND no correction signal → nothing to do. With a
  // correction signal we still scan completed case_type/sub_type steps
  // for a possible re-capture.
  if (pendingSteps.length === 0 && !hasCorrectionSignal) return [];

  const matches: SkipDetectorMatch[] = [];
  const matchedStepIds = new Set<string>();

  // --- chip-based matches ---

  for (const step of pendingSteps) {
    if (matchedStepIds.has(step.id)) continue;

    if (step.chip_source === 'case_types') {
      const m = matchCaseTypeChip(lower, step, caseTypes);
      if (m) {
        matches.push(m);
        matchedStepIds.add(step.id);
      }
      continue;
    }

    if (step.chip_source === 'sub_types') {
      // Resolve the parent case_type:
      //   - already captured in state, OR
      //   - matched in this same turn (above), OR
      //   - inferred from a sub_type label appearing in the message
      let capturedCaseType =
        state.steps.find((s) => s.slug === 'case_type')?.captured_value
        ?? matches.find((m) => m.slug === 'case_type')?.captured_value
        ?? null;

      if (!capturedCaseType) {
        // Try to infer from a sub_type label. If found, we'll also emit
        // a case_type match below.
        const inferred = inferCaseTypeFromSubType(lower, caseTypes);
        if (inferred) {
          capturedCaseType = inferred.case_type_slug;

          // Emit the case_type match if its step is also pending.
          const caseTypeStep = pendingSteps.find((s) => s.chip_source === 'case_types');
          if (caseTypeStep && !matchedStepIds.has(caseTypeStep.id)) {
            matches.push({
              step_id: caseTypeStep.id,
              slug: caseTypeStep.slug,
              captured_value: inferred.case_type_slug,
              out_of_scope: !inferred.is_in_scope,
              source: 'chip',
            });
            matchedStepIds.add(caseTypeStep.id);
          }
        }
      }

      if (!capturedCaseType) continue;
      const m = matchSubTypeChip(lower, step, caseTypes, capturedCaseType);
      if (m) {
        matches.push(m);
        matchedStepIds.add(step.id);
      }
      continue;
    }

    if (step.chip_source === 'inline' && step.inline_chips_json) {
      const m = matchInlineChip(lower, step);
      if (m) {
        matches.push(m);
        matchedStepIds.add(step.id);
        continue;
      }
    }
  }

  // --- correction-signal pass: re-capture COMPLETE case_type / sub_type
  //     steps when the visitor explicitly says they want to change. ---
  //
  // Only fires if hasCorrectionSignal === true. Without an explicit
  // correction phrase ("actually...", "I meant...", etc.) we never
  // overwrite an existing capture.

  if (hasCorrectionSignal) {
    for (const step of sopConfig.steps) {
      if (matchedStepIds.has(step.id)) continue; // already matched in pending pass
      const stateStep = state.steps.find((s) => s.step_id === step.id);
      if (stateStep?.status !== 'complete') continue;

      if (step.chip_source === 'case_types') {
        const m = matchCaseTypeChip(lower, step, caseTypes);
        if (m && m.captured_value !== stateStep.captured_value) {
          matches.push({ ...m, source: 'correction' });
          matchedStepIds.add(step.id);
        }
        continue;
      }

      if (step.chip_source === 'sub_types') {
        // Resolve parent case_type from current state (may have been
        // corrected above in this same pass).
        const newCaseTypeMatch = matches.find((m) => m.slug === 'case_type');
        const capturedCaseType =
          newCaseTypeMatch?.captured_value
          ?? state.steps.find((s) => s.slug === 'case_type')?.captured_value
          ?? null;
        if (!capturedCaseType) continue;
        const m = matchSubTypeChip(lower, step, caseTypes, capturedCaseType);
        if (m && m.captured_value !== stateStep.captured_value) {
          matches.push({ ...m, source: 'correction' });
          matchedStepIds.add(step.id);
        }
        continue;
      }
    }
  }

  // --- when-step date inference (also for inline-chip when step) ---

  const whenStep = pendingSteps.find((s) => s.slug === WHEN_STEP_SLUG);
  let whenInferenceAttempted = false;
  if (whenStep && !matchedStepIds.has(whenStep.id)) {
    const inferenceText = computeInferenceText(trimmed, matches, caseTypes);
    if (inferenceText) {
      whenInferenceAttempted = true;
      const result = await inferDateFn({
        userText: inferenceText,
        conversationAnchorIso: state.conversation_anchor_iso,
      });
      if (result.iso_date && ISO_DATE_REGEX.test(result.iso_date)) {
        matches.push({
          step_id: whenStep.id,
          slug: whenStep.slug,
          captured_value: result.iso_date,
          out_of_scope: false,
          source: 'date_inference',
        });
        matchedStepIds.add(whenStep.id);
      }
    }
  }

  // --- inline-chip path: if matchInlineChip captured a slug for the when
  //     step, run that slug through date inference so we store an ISO. ---

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    if (m.slug === WHEN_STEP_SLUG && m.source === 'chip') {
      const result = await inferDateFn({
        userText: m.captured_value,
        conversationAnchorIso: state.conversation_anchor_iso,
      });
      if (result.iso_date && ISO_DATE_REGEX.test(result.iso_date)) {
        matches[i] = { ...m, captured_value: result.iso_date, source: 'date_inference' };
      }
      // If inference fails, leave the chip slug as-is (defensive — we
      // provided the chip ourselves; better than dropping the capture).
    }
  }

  // --- free-text fallback for the currently-pending free-text step ---
  //
  // Only when:
  //   - the current pending step (earliest pending) is a free-text step
  //   - no other matches were found this turn (don't infer "where" from
  //     "I had a DUI yesterday")
  //   - the pending step is NOT the when step (FR-014: an unparseable
  //     date-step answer leaves the step pending so the agent asks a
  //     clarifying question — better than storing garbage)

  if (matches.length === 0) {
    const earliestPending = pendingSteps[0]!;
    const isWhenWithFailedInference =
      earliestPending.slug === WHEN_STEP_SLUG && whenInferenceAttempted;
    if (
      earliestPending.accepts_free_text
      && !earliestPending.chip_source
      && !isWhenWithFailedInference
    ) {
      matches.push({
        step_id: earliestPending.id,
        slug: earliestPending.slug,
        captured_value: trimmed,
        out_of_scope: false,
        source: 'free_text',
      });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStepPending(state: SOPState, stepId: string): boolean {
  const stateStep = state.steps.find((s) => s.step_id === stepId);
  return stateStep?.status === 'pending';
}

function matchCaseTypeChip(
  lowerMessage: string,
  step: SOPConfiguration['steps'][number],
  caseTypes: CaseType[],
): SkipDetectorMatch | null {
  // Exact match first (chip-tap case).
  for (const ct of caseTypes) {
    if (lowerMessage === ct.slug || lowerMessage === ct.label.toLowerCase()) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: ct.slug,
        out_of_scope: !ct.is_in_scope,
        source: 'chip',
      };
    }
  }
  // Substring match (multi-step message case).
  for (const ct of caseTypes) {
    if (containsWord(lowerMessage, ct.slug.replace(/_/g, ' '))
      || containsWord(lowerMessage, ct.label.toLowerCase())) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: ct.slug,
        out_of_scope: !ct.is_in_scope,
        source: 'chip',
      };
    }
  }
  return null;
}

function matchSubTypeChip(
  lowerMessage: string,
  step: SOPConfiguration['steps'][number],
  caseTypes: CaseType[],
  capturedCaseTypeSlug: string,
): SkipDetectorMatch | null {
  const ct = caseTypes.find((c) => c.slug === capturedCaseTypeSlug);
  if (!ct) return null;
  // Exact match first.
  for (const st of ct.sub_types) {
    if (lowerMessage === st.slug || lowerMessage === st.label.toLowerCase()) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: st.slug,
        out_of_scope: false,
        source: 'chip',
      };
    }
  }
  // Substring.
  for (const st of ct.sub_types) {
    if (containsWord(lowerMessage, st.slug.replace(/_/g, ' '))
      || containsWord(lowerMessage, st.label.toLowerCase())) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: st.slug,
        out_of_scope: false,
        source: 'chip',
      };
    }
  }
  return null;
}

function matchInlineChip(
  lowerMessage: string,
  step: SOPConfiguration['steps'][number],
): SkipDetectorMatch | null {
  if (!step.inline_chips_json) return null;
  let chips: Array<{ label: string; slug: string }>;
  try {
    chips = JSON.parse(step.inline_chips_json);
  } catch {
    return null;
  }
  // Exact match first.
  for (const chip of chips) {
    if (lowerMessage === chip.slug || lowerMessage === chip.label.toLowerCase()) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: chip.slug,
        out_of_scope: false,
        source: 'chip',
      };
    }
  }
  // Substring.
  for (const chip of chips) {
    if (containsWord(lowerMessage, chip.slug.replace(/_/g, ' '))
      || containsWord(lowerMessage, chip.label.toLowerCase())) {
      return {
        step_id: step.id,
        slug: step.slug,
        captured_value: chip.slug,
        out_of_scope: false,
        source: 'chip',
      };
    }
  }
  return null;
}

/**
 * Pick the substring of the message most likely to be a date phrase, for
 * passing to inferDate. We don't have a smart phrase extractor; the whole
 * message works fine for short visitor turns. Long messages get the full
 * text — Gemini handles it.
 */
function computeInferenceText(
  trimmed: string,
  _existingMatches: SkipDetectorMatch[],
  _caseTypes: CaseType[],
): string {
  return trimmed;
}

/**
 * If a sub_type label/slug appears in the message and uniquely identifies
 * a single case_type, return the parent case_type. Returns null when
 * ambiguous (e.g., the same label appears under multiple case_types) or
 * not found.
 */
function inferCaseTypeFromSubType(
  lowerMessage: string,
  caseTypes: CaseType[],
): { case_type_slug: string; is_in_scope: boolean } | null {
  const candidates: Array<{ case_type_slug: string; is_in_scope: boolean }> = [];
  for (const ct of caseTypes) {
    for (const st of ct.sub_types) {
      if (containsWord(lowerMessage, st.slug.replace(/_/g, ' '))
        || containsWord(lowerMessage, st.label.toLowerCase())) {
        candidates.push({ case_type_slug: ct.slug, is_in_scope: ct.is_in_scope });
        break; // one sub_type match per case_type is enough
      }
    }
  }
  // Unique mapping only — ambiguous matches are dropped (FR-018).
  if (candidates.length === 1) return candidates[0]!;
  return null;
}

/**
 * Word-boundary substring check. Avoids matching "due" inside "due to" as
 * a hit for "dui", and "estate" inside "estates" as a hit for "estate
 * planning". Keeps exact-phrase semantics for chip labels with multiple
 * words ("personal injury", "first offense").
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // Escape regex specials in the needle, then build a word-boundary regex.
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(haystack);
}
