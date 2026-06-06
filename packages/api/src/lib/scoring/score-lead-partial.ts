/**
 * Spec 016 US2 T038 — Branch scorer + partial-branch wrapper.
 *
 * Two PURE functions:
 *
 * 1. `scoreBranch(args)` — operates on the spec 016 Branch model
 *    directly. Sums chip weights, applies optional contact bonus,
 *    clamps to [0, 100], picks the threshold table by requestType,
 *    returns `{ score, classification, reasons, raw_score }`.
 *
 * 2. `scoreLeadPartial(args)` — thin wrapper around `scoreBranch`
 *    that always sets `branch_incomplete: true`. Used by the
 *    session-end finalizer (T040) to score abandoned-mid-branch
 *    captures per FR-011a.
 *
 * Both functions are stateless and have no I/O; the caller is
 * responsible for fetching the BranchVersion + assembling
 * CapturedChip[] before invoking.
 *
 * Reason inclusion: chips with `|score_weight| ≥ 5` are included in
 * the reasons array (mirrors spec 015 FR-010a). Reasons are the chip
 * LABELS (human-readable) — chip slugs go to logs but labels go to
 * the lead row + dashboard.
 */

import type {
  BranchChip,
  BranchVersion,
  CapturedChip,
  LeadClassification,
  LeadRequestType,
} from '@legal-chatbot/shared';

const REASONS_INCLUSION_THRESHOLD = 5;

export interface ScoreBranchArgs {
  branchVersion: BranchVersion;
  capturedChips: CapturedChip[];
  /** Selects which threshold table to apply. `null` defaults to SELF. */
  requestType: LeadRequestType | null;
  /** Bonus added to the raw sum before clamping (e.g., contact-form +15). */
  contactBonus?: number;
}

export interface ScoreBranchResult {
  /** Numeric score in [0, 100] (clamped). */
  score: number;
  /** Raw signed sum BEFORE clamping (useful for tests + logging). */
  raw_score: number;
  classification: LeadClassification;
  /** Human-readable chip labels eligible for the reasons array. */
  reasons: string[];
}

export interface ScoreLeadPartialResult extends ScoreBranchResult {
  branch_incomplete: true;
}

// ---------------------------------------------------------------------------
// scoreBranch
// ---------------------------------------------------------------------------

export function scoreBranch(args: ScoreBranchArgs): ScoreBranchResult {
  const { branchVersion, capturedChips, requestType, contactBonus = 0 } = args;

  // Build a chip lookup keyed by slug across every question.
  const chipBySlug = new Map<string, BranchChip>();
  for (const q of branchVersion.questions) {
    for (const chip of q.chips) chipBySlug.set(chip.slug, chip);
  }

  // Sum weights for every selected chip across every captured question.
  let rawScore = contactBonus;
  const reasonChips: BranchChip[] = [];
  for (const captured of capturedChips) {
    for (const slug of captured.chip_slugs) {
      const chip = chipBySlug.get(slug);
      if (!chip) continue;
      rawScore += chip.score_weight;
      if (Math.abs(chip.score_weight) >= REASONS_INCLUSION_THRESHOLD) {
        reasonChips.push(chip);
      }
    }
  }

  const clamped = Math.max(0, Math.min(100, rawScore));

  // Pick the threshold table.
  const tables = branchVersion.classification_thresholds;
  const isFamily = requestType === 'FRIEND_FAMILY';
  const classification: LeadClassification = isFamily
    ? classifyFamily(clamped, tables.family_friend)
    : classifySelf(clamped, tables.self);

  return {
    score: clamped,
    raw_score: rawScore,
    classification,
    reasons: reasonChips.map((c) => c.label),
  };
}

function classifySelf(
  score: number,
  table: BranchVersion['classification_thresholds']['self'],
): LeadClassification {
  if (score >= table.hot[0] && score <= table.hot[1]) return 'HOT';
  if (score >= table.warm[0] && score <= table.warm[1]) return 'WARM';
  if (score >= table.cold[0] && score <= table.cold[1]) return 'COLD';
  return 'SPAM';
}

function classifyFamily(
  score: number,
  table: BranchVersion['classification_thresholds']['family_friend'],
): LeadClassification {
  if (score >= table.hot[0] && score <= table.hot[1]) return 'HOT';
  if (score >= table.warm[0] && score <= table.warm[1]) return 'WARM';
  return 'SPAM';
}

// ---------------------------------------------------------------------------
// scoreLeadPartial
// ---------------------------------------------------------------------------

export function scoreLeadPartial(args: ScoreBranchArgs): ScoreLeadPartialResult {
  const result = scoreBranch(args);
  return { ...result, branch_incomplete: true };
}
