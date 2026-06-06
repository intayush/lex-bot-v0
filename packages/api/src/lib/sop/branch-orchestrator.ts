/**
 * Spec 016 US2 T039 — Branch orchestrator.
 *
 * Server-side coordinator that dispatches the runtime through a
 * configured Branch after the default 6-step SOP finalizes (FR-008).
 *
 * Architecture: a thin glue layer that composes three pure helpers
 * already implemented in T036/T037/T038 plus a single DB read
 * (lookupBranch). The orchestrator does NOT write the lead row — it
 * returns a typed `OrchestratorResult` describing the action; the
 * caller (chat route) applies side effects.
 *
 * Design: pure-ish (only `lookupBranch` and `getVersionById` are
 * external). All decisions (init / advance / finalize / clarify) are
 * derived from the input shape, so the function is deterministic per
 * `(sopState, userMessage)` pair.
 */

import { advanceBranch } from './branch-advancer';
import { freezeBranchSnapshot } from './branch-snapshot';
import { scoreBranch, type ScoreBranchResult } from '../scoring/score-lead-partial';
import { emitBranchEvent } from './branch-events';
import type {
  Branch,
  BranchQuestion,
  BranchSnapshot,
  BranchVersion,
  LeadRequestType,
  SOPState,
} from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Public DI seam
// ---------------------------------------------------------------------------

export interface BranchOrchestratorDeps {
  /** Resolve a (case_type, sub_type) pair to its active branch + version. */
  lookupBranch: (input: {
    accountId: string;
    caseTypeSlug: string;
    subTypeSlug: string;
  }) => Promise<{ branch: Branch; version: BranchVersion } | { branch: null }>;
  /**
   * Fetch a specific branch_versions row by id. Used when a session
   * has a `branch_state.branch_version_id` pinned (FR-031): even if
   * the live branch's `current_version_id` has been republished, the
   * in-flight conversation MUST keep the version it started with.
   */
  getVersionById: (versionId: string) => Promise<BranchVersion | null>;
  /** Injectable clock (epoch ms). */
  now: () => number;
  /**
   * Caller-supplied context for structured-log events (Constitution V).
   * The orchestrator emits branch_started / branch_question_answered /
   * branch_completed / branch_skipped as side effects; tests pass a
   * stub session_id (e.g., 'test_session') to make assertions
   * deterministic. Production deps pass the live session id.
   */
  sessionId?: string;
}

export interface BranchOrchestratorInput {
  accountId: string;
  sopState: SOPState;
  /** Latest visitor message. Empty = "introduce next question" turn. */
  userMessage: string;
  deps: BranchOrchestratorDeps;
}

export type OrchestratorResult =
  | { action: 'noop' }
  | {
      action: 'present_question';
      question: BranchQuestion;
      updatedSopState: SOPState;
    }
  | {
      action: 'awaiting_clarification';
      clarificationText: string;
      updatedSopState: SOPState;
    }
  | {
      action: 'finalize_with_branch';
      snapshot: BranchSnapshot;
      score: ScoreBranchResult;
      updatedSopState: SOPState;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureSlugByStep(state: SOPState, slug: string): string | null {
  const step = state.steps.find((s) => s.slug === slug);
  if (!step) return null;
  return step.captured_value;
}

function captureRequestType(state: SOPState): LeadRequestType | null {
  // The default 6-step SOP doesn't capture a request_type chip; spec
  // 015 had a separate metadata step, but that step was relocated
  // into the branch as its first question (see seed-defaults/sop.ts
  // `_RAW_CAR_ACCIDENT_BRANCH_QUESTIONS`). For US2 the orchestrator
  // reads it from the branch_state's captured_chips when present;
  // otherwise defaults to SELF (matches spec 015's default-classifier
  // behaviour).
  const captured = state.branch_state?.captured_chips ?? [];
  for (const c of captured) {
    if (c.question_id === 'request_type') {
      const slug = c.chip_slugs[0];
      if (slug === 'friend_family') return 'FRIEND_FAMILY';
      if (slug === 'myself') return 'SELF';
    }
  }
  return 'SELF';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runBranchOrchestrator(
  input: BranchOrchestratorInput,
): Promise<OrchestratorResult> {
  const { accountId, sopState, userMessage, deps } = input;

  // Gate 1: SOP must be finalized (Step 6 contact captured).
  if (!sopState.is_finalized) return { action: 'noop' };

  const caseTypeSlug = captureSlugByStep(sopState, 'case_type');
  const subTypeSlug = captureSlugByStep(sopState, 'sub_type');
  if (!caseTypeSlug || !subTypeSlug) return { action: 'noop' };

  // Gate 2: branch_state already null AND no branch configured →
  // default-only flow (the chat route's existing captureLead path
  // handles this).
  if (sopState.branch_state == null) {
    const lookup = await deps.lookupBranch({
      accountId,
      caseTypeSlug,
      subTypeSlug,
    });
    if (lookup.branch === null) {
      // FR-033: emit branch_skipped event when lookup returns null
      // for a finalized SOP (default-only path is about to fire).
      emitBranchEvent({
        event: 'branch_skipped',
        account_id: accountId,
        session_id: deps.sessionId ?? 'unknown',
        case_type_slug: caseTypeSlug,
        sub_type_slug: subTypeSlug,
        reason: 'no_branch_configured',
      });
      return { action: 'noop' };
    }

    // Initialize branch_state and present Q1.
    const updatedSopState: SOPState = {
      ...sopState,
      branch_state: {
        branch_id: lookup.branch.id,
        branch_version_id: lookup.version.id,
        current_question_index: 0,
        captured_chips: [],
        captured_free_text: [],
      },
    };
    const advanceResult = advanceBranch({
      branchState: updatedSopState.branch_state!,
      branchVersion: lookup.version,
      userMessage: '',
    });
    if (advanceResult.type !== 'next_question') {
      // Defensive: branch with zero questions returns finalize
      // immediately. Re-route as default-only by clearing branch_state.
      emitBranchEvent({
        event: 'branch_skipped',
        account_id: accountId,
        session_id: deps.sessionId ?? 'unknown',
        case_type_slug: caseTypeSlug,
        sub_type_slug: subTypeSlug,
        reason: 'branch_zero_questions',
      });
      return { action: 'noop' };
    }
    // FR-033: branch_started fires on the first question presentation.
    emitBranchEvent({
      event: 'branch_started',
      account_id: accountId,
      session_id: deps.sessionId ?? 'unknown',
      case_type_slug: caseTypeSlug,
      sub_type_slug: subTypeSlug,
      branch_id: lookup.branch.id,
      branch_version_id: lookup.version.id,
    });
    return {
      action: 'present_question',
      question: advanceResult.question,
      updatedSopState,
    };
  }

  // Branch in flight. Pin to the version stored in branch_state.
  const pinnedVersion = await deps.getVersionById(
    sopState.branch_state.branch_version_id,
  );
  if (!pinnedVersion) {
    // The pinned version row vanished (admin deleted the branch
    // mid-conversation, perhaps). Clear branch_state and fall through
    // to default-only finalize.
    const updatedSopState: SOPState = { ...sopState, branch_state: null };
    return { action: 'noop' /* but caller sees cleared branch_state — needs re-emit */ };
  }
  // We need the parent Branch to build the snapshot's denormalized
  // case_type/sub_type slugs. Re-resolve the lookup (caller already
  // ensured this in init).
  const lookup = await deps.lookupBranch({
    accountId,
    caseTypeSlug,
    subTypeSlug,
  });
  if (lookup.branch === null) {
    // Branch deleted mid-conversation — bail out of branch flow.
    return { action: 'noop' };
  }

  const advanceResult = advanceBranch({
    branchState: sopState.branch_state,
    branchVersion: pinnedVersion,
    userMessage,
  });

  if (advanceResult.type === 'awaiting_clarification') {
    return {
      action: 'awaiting_clarification',
      clarificationText: advanceResult.clarificationText,
      updatedSopState: { ...sopState, branch_state: advanceResult.updatedState },
    };
  }

  if (advanceResult.type === 'next_question') {
    // FR-033: branch_question_answered fires when a visitor's input
    // captures an answer. The just-answered question is the one at
    // the index BEFORE advanceBranch incremented; the captured chip
    // entry sits at the tail of advanceResult.updatedState.captured_chips.
    const justAnswered =
      advanceResult.updatedState.captured_chips[
        advanceResult.updatedState.captured_chips.length - 1
      ];
    if (justAnswered) {
      emitBranchEvent({
        event: 'branch_question_answered',
        account_id: accountId,
        session_id: deps.sessionId ?? 'unknown',
        case_type_slug: caseTypeSlug,
        sub_type_slug: subTypeSlug,
        branch_id: lookup.branch.id,
        branch_version_id: pinnedVersion.id,
        question_id: justAnswered.question_id,
        chip_slugs: justAnswered.chip_slugs,
        is_free_text: justAnswered.chip_slugs.length === 0,
      });
    }
    return {
      action: 'present_question',
      question: advanceResult.question,
      updatedSopState: { ...sopState, branch_state: advanceResult.updatedState },
    };
  }

  // type === 'finalize'
  // First emit branch_question_answered for the final question.
  const lastAnswered =
    advanceResult.capturedChips[advanceResult.capturedChips.length - 1];
  if (lastAnswered) {
    emitBranchEvent({
      event: 'branch_question_answered',
      account_id: accountId,
      session_id: deps.sessionId ?? 'unknown',
      case_type_slug: caseTypeSlug,
      sub_type_slug: subTypeSlug,
      branch_id: lookup.branch.id,
      branch_version_id: pinnedVersion.id,
      question_id: lastAnswered.question_id,
      chip_slugs: lastAnswered.chip_slugs,
      is_free_text: lastAnswered.chip_slugs.length === 0,
    });
  }

  const score = scoreBranch({
    branchVersion: pinnedVersion,
    capturedChips: advanceResult.capturedChips,
    requestType: captureRequestType({
      ...sopState,
      branch_state: advanceResult.updatedState,
    }),
  });
  const snapshot = freezeBranchSnapshot({
    branch: lookup.branch,
    branchVersion: pinnedVersion,
    capturedChips: advanceResult.capturedChips,
    capturedFreeText: advanceResult.capturedFreeText,
    score: score.score,
    classification: score.classification,
    reasons: score.reasons,
    branchIncomplete: false,
    finalizedAt: deps.now(),
  });

  // FR-033: branch_completed fires once the branch finalizes.
  emitBranchEvent({
    event: 'branch_completed',
    account_id: accountId,
    session_id: deps.sessionId ?? 'unknown',
    case_type_slug: caseTypeSlug,
    sub_type_slug: subTypeSlug,
    branch_id: lookup.branch.id,
    branch_version_id: pinnedVersion.id,
    lead_score: score.score,
    classification: score.classification,
    reasons: score.reasons,
  });

  return {
    action: 'finalize_with_branch',
    snapshot,
    score,
    updatedSopState: { ...sopState, branch_state: null },
  };
}
