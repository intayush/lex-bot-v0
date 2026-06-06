/**
 * Spec 016 US2 T036 — Branch advancer.
 *
 * PURE function (no I/O). Drives the runtime through the configured
 * Branch one question at a time, accumulating chip selections and
 * (where allowed) free-text answers, then signals `finalize` when the
 * last question is answered.
 *
 * Called from the SOP advancer once `state-machine` has transitioned
 * into `branch_running` (T039). The caller persists `updatedState`
 * back into the SOP-state JSON before returning to the agent loop.
 *
 * Contract: contracts/branch-runtime-contract.md §branch-advancer.ts.
 *
 * Chip-matching rules mirror `skip-detector.ts` to keep the visitor
 * UX consistent across default-step chips and branch chips:
 *   - Exact lowercase compare on slug or label
 *   - Word-boundary substring match (lowercase) on slug or label
 * For multi-select questions every matching chip is captured;
 * single-select takes the first match.
 */

import type { BranchQuestion, BranchVersion, CapturedChip, CapturedFreeText } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// State shape (lives inside SOPState as `branch_state`)
// ---------------------------------------------------------------------------

export interface BranchState {
  branch_id: string;
  branch_version_id: string;
  current_question_index: number;
  captured_chips: CapturedChip[];
  captured_free_text: CapturedFreeText[];
}

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface BranchAdvanceInput {
  branchState: BranchState;
  branchVersion: BranchVersion;
  /** The latest visitor message. Empty string = "introduce next question". */
  userMessage: string;
}

export type BranchAdvanceResult =
  | {
      type: 'next_question';
      question: BranchQuestion;
      updatedState: BranchState;
    }
  | {
      type: 'finalize';
      capturedChips: CapturedChip[];
      capturedFreeText: CapturedFreeText[];
      updatedState: BranchState;
    }
  | {
      type: 'awaiting_clarification';
      clarificationText: string;
      updatedState: BranchState;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsWord(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(haystack);
}

/**
 * Match a visitor's free-text against a question's chips.
 * Single-select returns at most one slug; multi-select returns every match.
 */
function matchChips(message: string, question: BranchQuestion): string[] {
  const lowered = message.trim().toLowerCase();
  if (lowered.length === 0) return [];
  const matches: string[] = [];
  for (const chip of question.chips) {
    const slug = chip.slug.toLowerCase();
    const label = chip.label.toLowerCase();
    const matched =
      lowered === slug ||
      lowered === label ||
      containsWord(lowered, slug.replace(/_/g, ' ')) ||
      containsWord(lowered, label);
    if (matched) {
      matches.push(chip.slug);
      if (!question.multi_select) break;
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function advanceBranch(input: BranchAdvanceInput): BranchAdvanceResult {
  const { branchState, branchVersion, userMessage } = input;
  const sortedQuestions = [...branchVersion.questions].sort(
    (a, b) => a.position - b.position,
  );
  const total = sortedQuestions.length;
  const idx = branchState.current_question_index;

  // Defensive: zero questions OR already past the last one.
  if (total === 0 || idx >= total) {
    return {
      type: 'finalize',
      capturedChips: branchState.captured_chips,
      capturedFreeText: branchState.captured_free_text,
      updatedState: branchState,
    };
  }

  const question = sortedQuestions[idx];

  // Empty message = introduce the current question (the assistant turn
  // before the visitor responds). Keep the state untouched.
  if (userMessage.trim().length === 0) {
    return {
      type: 'next_question',
      question,
      updatedState: branchState,
    };
  }

  const matchedSlugs = matchChips(userMessage, question);
  const isFreeText = matchedSlugs.length === 0;

  if (isFreeText && !question.free_text_allowed) {
    return {
      type: 'awaiting_clarification',
      clarificationText:
        'I want to make sure I capture this correctly — please pick one of the options above.',
      updatedState: branchState,
    };
  }

  // Capture: chip selections OR free text (when allowed)
  const newChip: CapturedChip = {
    question_id: question.id,
    chip_slugs: matchedSlugs,
  };
  const updatedCapturedChips = [...branchState.captured_chips, newChip];
  const updatedFreeText = isFreeText
    ? [
        ...branchState.captured_free_text,
        { question_id: question.id, text: userMessage.trim() },
      ]
    : branchState.captured_free_text;

  const nextIdx = idx + 1;
  const updatedState: BranchState = {
    ...branchState,
    current_question_index: nextIdx,
    captured_chips: updatedCapturedChips,
    captured_free_text: updatedFreeText,
  };

  if (nextIdx >= total) {
    return {
      type: 'finalize',
      capturedChips: updatedCapturedChips,
      capturedFreeText: updatedFreeText,
      updatedState,
    };
  }

  return {
    type: 'next_question',
    question: sortedQuestions[nextIdx],
    updatedState,
  };
}
