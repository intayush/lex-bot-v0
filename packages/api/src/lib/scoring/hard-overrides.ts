/**
 * Hard-override SPAM rules for spec 015 lead classification.
 *
 * Per FR-007 / FR-009 / FR-010c / FR-010d, four pure predicates check
 * whether a captured lead matches a fixed condition. When ANY rule
 * fires, the lead's classification is forced to SPAM (downgrade-only;
 * never upgrades a lower classification).
 *
 * The four predicates run AFTER the lead has been persisted (per
 * FR-010c) so lawyers retain visibility into spam attempts. The
 * combinator (`applyHardOverrides`) applies all enabled rules in the
 * fixed evaluation order from FR-008 and returns the SPAM downgrade
 * outcome with the list of rules that fired.
 *
 * Constitution V (Privilege, Privacy, Data-Boundary): the rules
 * inspect captured PII (name, email, phone) but the structured log
 * line emitted by the caller MUST NOT contain those values — only
 * the rule names. See `contracts/lead-finalization-log.md`.
 *
 * The heuristic regex set is fixed in MVP (not admin-configurable);
 * authoring new rules requires an engineering change per spec
 * §Assumptions.
 */
import type {
  CaseType,
  HardOverridesEnabled,
  Lead,
  LeadClassification,
  SOPState,
} from '@legal-chatbot/shared';

import type { HardOverrideName } from './reason-builder';

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * FR-010c: missing_contact. Both phone and email are null/empty.
 * Treated as a SPAM trigger because the firm has no way to follow up.
 */
export function checkMissingContact(lead: Lead): boolean {
  const phoneEmpty =
    lead.contact_phone === null || lead.contact_phone.trim() === '';
  const emailEmpty =
    lead.contact_email === null || lead.contact_email.trim() === '';
  return phoneEmpty && emailEmpty;
}

/**
 * FR-007: out_of_scope. The captured case_type's `is_in_scope` flag
 * is false. Returns false when no case_type was captured (defensive —
 * the lead is incomplete, not out-of-scope per se).
 */
export function checkOutOfScope(caseType: CaseType | null): boolean {
  if (caseType === null) return false;
  return caseType.is_in_scope === false;
}

/**
 * FR-007: no_injury_no_treatment. The visitor answered both:
 *   injury = injury_no
 *   medical_treatment = no_treatment
 *
 * Either alone is not a trigger (e.g., "Yes injured, no treatment yet"
 * is still a viable PI lead). Both together signals the matter doesn't
 * meet the firm's intake threshold for a personal injury case.
 *
 * In spec 015's data shape, `injury` and `medical_treatment` were
 * default SOP steps and the captures lived on `sopState.steps[]`. In
 * spec 016+ those questions live on the branch and the captures live
 * on `sopState.branch_state.captured_chips[]` keyed by question_id.
 * This predicate handles both shapes:
 *   1. Try the branch-state path first (current production shape).
 *   2. Fall back to the legacy steps[] path so spec-015-shaped leads
 *      and existing unit-test fixtures continue to work unchanged.
 */
export function checkNoInjuryNoTreatment(sopState: SOPState): boolean {
  // Branch-flow path (spec 016+): read from branch_state.captured_chips
  // where each entry is { question_id, chip_slugs: string[] }.
  const branchChips = sopState.branch_state?.captured_chips;
  if (branchChips && branchChips.length > 0) {
    const injuryCapture = branchChips.find((c) => c.question_id === 'injury');
    const treatmentCapture = branchChips.find(
      (c) => c.question_id === 'medical_treatment',
    );
    if (
      injuryCapture?.chip_slugs.includes('injury_no') &&
      treatmentCapture?.chip_slugs.includes('no_treatment')
    ) {
      return true;
    }
    // If the branch has captures but the specific chips aren't
    // present, the override doesn't fire (the visitor answered the
    // questions differently). Don't fall through to the legacy path
    // — the branch-state captures are authoritative when present.
    if (
      branchChips.some((c) => c.question_id === 'injury') ||
      branchChips.some((c) => c.question_id === 'medical_treatment')
    ) {
      return false;
    }
  }

  // Legacy spec-015 path (default-SOP-step shape): read from steps[].
  // Preserves existing unit-test fixtures and any pre-spec-016 leads.
  const injuryStep = sopState.steps.find((s) => s.slug === 'injury');
  const treatmentStep = sopState.steps.find(
    (s) => s.slug === 'medical_treatment',
  );
  return (
    injuryStep?.captured_value === 'injury_no' &&
    treatmentStep?.captured_value === 'no_treatment'
  );
}

/**
 * FR-010c: fake_info. Heuristic regex set pinned per
 * `contracts/scoring-config.md`. Returns true if ANY of the three
 * fields matches its pattern (OR logic):
 *   - phone < 7 digits when stripped of non-digits
 *   - email matches /^test@|@(test|example)\./i
 *   - name matches /^(test|asdf|fake|x{2,})/i (case-insensitive)
 *
 * Authoring new patterns requires an engineering change in MVP per
 * spec §Assumptions.
 */
export function checkFakeInfo(lead: Lead): boolean {
  // Phone: < 7 digits when non-digits stripped
  if (lead.contact_phone !== null && lead.contact_phone !== '') {
    const digitCount = lead.contact_phone.replace(/[^0-9]/g, '').length;
    if (digitCount < 7) return true;
  }

  // Email: pattern match
  if (lead.contact_email !== null && lead.contact_email !== '') {
    if (/^test@|@(test|example)\./i.test(lead.contact_email)) return true;
  }

  // Name: pattern match (case-insensitive prefix match for filler patterns)
  if (lead.name !== null && lead.name !== '') {
    if (/^(test|asdf|fake|x{2,})/i.test(lead.name)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Combinator
// ---------------------------------------------------------------------------

/**
 * Fixed evaluation order per FR-008. All enabled rules are evaluated;
 * fired rules are returned in this order.
 */
const FIXED_ORDER: readonly HardOverrideName[] = [
  'missing_contact',
  'out_of_scope',
  'no_injury_no_treatment',
  'fake_info',
] as const;

export interface ApplyHardOverridesInput {
  lead: Lead;
  sopState: SOPState;
  caseType: CaseType | null;
  enabled: HardOverridesEnabled;
}

export interface HardOverrideOutcome {
  classification: LeadClassification; // Always 'SPAM' per FR-009
  firedRules: HardOverrideName[]; // Ordered per FR-008
}

/**
 * Apply all enabled hard-override rules. Returns null if no rule
 * fires; otherwise returns `{ classification: 'SPAM', firedRules }`
 * with rules ordered per FR-008.
 *
 * Disabled rules (per `enabled` toggles) are skipped entirely — they
 * never appear in `firedRules` and never contribute to the
 * downgrade decision per FR-010.
 *
 * Per FR-009 the combinator is downgrade-only; the caller is
 * responsible for ensuring this output replaces a higher
 * classification only when applicable. See `packages/api/src/lib/leads.ts`
 * (T064) for the caller wiring.
 */
export function applyHardOverrides(
  input: ApplyHardOverridesInput,
): HardOverrideOutcome | null {
  const { lead, sopState, caseType, enabled } = input;

  const fired: HardOverrideName[] = [];

  for (const rule of FIXED_ORDER) {
    if (!enabled[rule]) continue;

    let matches = false;
    switch (rule) {
      case 'missing_contact':
        matches = checkMissingContact(lead);
        break;
      case 'out_of_scope':
        matches = checkOutOfScope(caseType);
        break;
      case 'no_injury_no_treatment':
        matches = checkNoInjuryNoTreatment(sopState);
        break;
      case 'fake_info':
        matches = checkFakeInfo(lead);
        break;
    }
    if (matches) fired.push(rule);
  }

  if (fired.length === 0) return null;
  return { classification: 'SPAM', firedRules: fired };
}

// ---------------------------------------------------------------------------
// Reasons-list merge helper
// ---------------------------------------------------------------------------

/**
 * Merge fired override rule names into an existing `score_reasons_json`
 * payload. Used by callers that have already persisted a lead row with
 * a reasons list and now need to append override-fired rule names per
 * FR-010a. Idempotent: if the same rule is already in the list it
 * isn't appended again.
 *
 * `prevReasonsJson` may be null (LLM-fallback path didn't persist a
 * reasons list), an empty JSON array, or a JSON array of strings. Any
 * malformed payload is treated as the empty case.
 */
export function appendOverrideReasons(
  prevReasonsJson: string | null,
  firedRules: HardOverrideName[],
): string {
  let prev: string[] = [];
  if (prevReasonsJson) {
    try {
      const parsed = JSON.parse(prevReasonsJson);
      if (Array.isArray(parsed)) {
        prev = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      // Malformed — start from empty.
    }
  }
  const seen = new Set(prev);
  const merged = [...prev];
  for (const rule of firedRules) {
    if (!seen.has(rule)) {
      merged.push(rule);
      seen.add(rule);
    }
  }
  return JSON.stringify(merged);
}
