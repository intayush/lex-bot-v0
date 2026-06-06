/**
 * Spec 016 US2 T037 — Branch snapshot freezer.
 *
 * PURE function (no I/O). Builds the JSON-serialisable
 * `BranchSnapshot` payload that gets written to
 * `leads.branch_snapshot_json` at finalization (FR-018) or at
 * session-end abandonment (FR-011a).
 *
 * The snapshot survives even if the live Branch is later edited or
 * deleted: lawyers can render a historical lead's intake details from
 * the frozen JSON without any cross-table join.
 *
 * Contract: contracts/branch-runtime-contract.md §branch-snapshot.ts.
 */

import type {
  Branch,
  BranchSnapshot,
  BranchVersion,
  CapturedChip,
  CapturedFreeText,
  LeadClassification,
} from '@legal-chatbot/shared';

export interface FreezeBranchSnapshotArgs {
  branch: Branch;
  branchVersion: BranchVersion;
  capturedChips: CapturedChip[];
  capturedFreeText: CapturedFreeText[];
  /** Final lead_score (0–100, clamped). Pass 0 for empty-chip partials. */
  score: number;
  classification: LeadClassification;
  /** Reason rule names — already filtered for log-redaction. */
  reasons: string[];
  /** True for partial-branch leads (FR-011a); false for completed branches. */
  branchIncomplete: boolean;
  /** Epoch ms; injectable so tests can pin the value. */
  finalizedAt: number;
}

export function freezeBranchSnapshot(
  args: FreezeBranchSnapshotArgs,
): BranchSnapshot {
  // Sort captured chips into question-position order so historical
  // rendering is deterministic regardless of skip-detection ordering.
  const positionByQuestionId = new Map(
    args.branchVersion.questions.map((q) => [q.id, q.position]),
  );
  const sortedCapturedChips = [...args.capturedChips].sort((a, b) => {
    const pa = positionByQuestionId.get(a.question_id) ?? 0;
    const pb = positionByQuestionId.get(b.question_id) ?? 0;
    return pa - pb;
  });
  const sortedFreeText = [...args.capturedFreeText].sort((a, b) => {
    const pa = positionByQuestionId.get(a.question_id) ?? 0;
    const pb = positionByQuestionId.get(b.question_id) ?? 0;
    return pa - pb;
  });

  return {
    branch_id: args.branch.id,
    branch_version_id: args.branchVersion.id,
    version_number: args.branchVersion.version_number,
    case_type_slug: args.branch.case_type_slug,
    sub_type_slug: args.branch.sub_type_slug,
    questions_snapshot: args.branchVersion.questions,
    captured_chips: sortedCapturedChips,
    captured_free_text: sortedFreeText,
    score: args.score,
    classification: args.classification,
    reasons: args.reasons,
    branch_incomplete: args.branchIncomplete,
    finalized_at: args.finalizedAt,
  };
}
