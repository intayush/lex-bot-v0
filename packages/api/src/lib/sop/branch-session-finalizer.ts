/**
 * Spec 016 US2 T040 — Session-end partial-branch finalizer.
 *
 * Helper invoked by a future session-cleanup cron OR by an explicit
 * admin "close stale sessions" action. Per FR-011a: when a session
 * has SOP state with `branch_state != null` AND the conversation has
 * been idle past the session TTL, score whatever chips were captured
 * before the visitor abandoned and freeze the snapshot onto the lead
 * row with `branch_incomplete: true`.
 *
 * The function is PURE w.r.t. side effects: it reads the SOP state,
 * loads the pinned BranchVersion, scores the partial captures, and
 * returns a `PartialBranchFinalizationIntent` that the caller (cron
 * job, admin action) applies via a single `UPDATE leads`.
 *
 * Not yet wired to a scheduler in MVP — the helper is exported so a
 * future Phase 8 cron script can sweep stale sessions without
 * additional code paths.
 */

import { freezeBranchSnapshot } from './branch-snapshot';
import { scoreLeadPartial } from '../scoring/score-lead-partial';
import type {
  Branch,
  BranchSnapshot,
  BranchVersion,
  LeadClassification,
  LeadRequestType,
  SOPState,
} from '@legal-chatbot/shared';

export interface PartialBranchFinalizationIntent {
  leadId: string;
  branchSnapshotJson: string;
  branchIncomplete: true;
  leadScore: number;
  classification: LeadClassification;
  scoreReasonsJson: string;
}

export interface PartialBranchFinalizationInput {
  /** Lead row id to update — caller resolved this from the session. */
  leadId: string;
  /** SOP state read from the session (must have `branch_state != null`). */
  sopState: SOPState;
  branch: Branch;
  branchVersion: BranchVersion;
  /** Resolved request type for threshold-table selection (defaults to SELF). */
  requestType?: LeadRequestType | null;
  /** Injectable clock (epoch ms). */
  finalizedAt?: number;
}

export function buildPartialBranchFinalizationIntent(
  input: PartialBranchFinalizationInput,
): PartialBranchFinalizationIntent | null {
  const { sopState, branch, branchVersion, leadId } = input;
  if (!sopState.branch_state) return null;

  const score = scoreLeadPartial({
    branchVersion,
    capturedChips: sopState.branch_state.captured_chips,
    requestType: input.requestType ?? 'SELF',
  });
  const snapshot: BranchSnapshot = freezeBranchSnapshot({
    branch,
    branchVersion,
    capturedChips: sopState.branch_state.captured_chips,
    capturedFreeText: sopState.branch_state.captured_free_text,
    score: score.score,
    classification: score.classification,
    reasons: score.reasons,
    branchIncomplete: true,
    finalizedAt: input.finalizedAt ?? Date.now(),
  });

  return {
    leadId,
    branchSnapshotJson: JSON.stringify(snapshot),
    branchIncomplete: true,
    leadScore: score.score,
    classification: score.classification,
    scoreReasonsJson: JSON.stringify(score.reasons),
  };
}
