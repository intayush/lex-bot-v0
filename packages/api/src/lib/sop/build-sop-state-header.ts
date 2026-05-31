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
 * Pure function, no I/O.
 */
import type { CaseType, SOPState, SOPStateHeaderPayload } from '@legal-chatbot/shared';
import { resolveCaseTypeLabel } from './case-type-label';

export function buildSOPStateHeader(
  sopState: SOPState | null,
  caseTypes: CaseType[],
): SOPStateHeaderPayload | null {
  if (!sopState) return null;
  const pending = sopState.steps.find((s) => s.status === 'pending');
  const caseTypeStep = sopState.steps.find((s) => s.slug === 'case_type');
  const captured_case_type_slug =
    caseTypeStep?.status === 'complete' ? caseTypeStep.captured_value : null;
  return {
    current: sopState.current_progress,
    total: sopState.qualified_lead_threshold,
    pending_step_id: pending?.step_id ?? null,
    pending_step_slug: pending?.slug ?? null,
    is_finalized: sopState.is_finalized,
    captured_case_type_slug,
    captured_case_type_label: resolveCaseTypeLabel(captured_case_type_slug, caseTypes),
  };
}
