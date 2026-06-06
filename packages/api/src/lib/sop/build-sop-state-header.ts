/**
 * Build the compact SOP state payload for the `x-sop-state` response
 * header (per `specs/010-sop-workflow/contracts/sop-state-contract.md`
 * "Wire Shape").
 *
 * Returns null when the account has no published SOP. The
 * `captured_case_type_label` field (014-fix-sop-case-subtypes T020 /
 * FR-006) is populated by looking up the captured case-type slug in the
 * `caseTypes` catalog so the widget can interpolate it into the
 * sub-type question text without needing to round-trip the catalog.
 *
 * Spec 016 — when the runtime is presenting a branch question this
 * turn (orchestrator returned `present_question`), the active question
 * is passed in so its chips reach the widget through the same header.
 * Without this, the widget renders the agent's text version of the
 * question with no chip UI (the chips don't live on `sop_steps`).
 *
 * Pure function, no I/O.
 */
import type {
  BranchQuestion,
  CaseType,
  SOPState,
  SOPStateHeaderPayload,
} from '@legal-chatbot/shared';
import { resolveCaseTypeLabel } from './case-type-label';

export function buildSOPStateHeader(
  sopState: SOPState | null,
  caseTypes: CaseType[],
  branchActiveQuestion: BranchQuestion | null = null,
): SOPStateHeaderPayload | null {
  if (!sopState) return null;
  const pending = sopState.steps.find((s) => s.status === 'pending');
  const caseTypeStep = sopState.steps.find((s) => s.slug === 'case_type');
  const captured_case_type_slug =
    caseTypeStep?.status === 'complete' ? caseTypeStep.captured_value : null;

  let branch_active_chips: SOPStateHeaderPayload['branch_active_chips'] = null;
  let branch_free_text_allowed = false;
  if (branchActiveQuestion && branchActiveQuestion.chips.length > 0) {
    branch_active_chips = branchActiveQuestion.chips.map((c) => ({
      slug: c.slug,
      label: c.label,
      // The score_weight is admin-visible context; the widget can
      // ignore it. Constitution V allows this because chip slugs +
      // weights are admin-defined controlled vocabulary, not PII.
      score_weight: c.score_weight,
    }));
    branch_free_text_allowed = branchActiveQuestion.free_text_allowed;
  }

  return {
    current: sopState.current_progress,
    total: sopState.qualified_lead_threshold,
    pending_step_id: pending?.step_id ?? null,
    pending_step_slug: pending?.slug ?? null,
    is_finalized: sopState.is_finalized,
    captured_case_type_slug,
    captured_case_type_label: resolveCaseTypeLabel(captured_case_type_slug, caseTypes),
    branch_active_chips,
    branch_free_text_allowed,
  };
}
