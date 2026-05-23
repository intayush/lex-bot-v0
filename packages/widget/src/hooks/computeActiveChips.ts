/**
 * Compute the active chip list for the visitor's currently pending SOP
 * step (010-sop-workflow T035 helper).
 *
 * Pure function. Runs in the widget after every response so the chip
 * row matches whatever the server's SOP state header indicates is
 * pending.
 *
 * Returns an empty array when:
 *   - SOP isn't active (no SOP state, or no published SOP)
 *   - SOP is finalized (no more chips to offer)
 *   - The pending step has chip_source=null (it's a free-text step)
 *   - The chip source resolves to an empty list
 */
import type { Chip } from '@legal-chatbot/shared';

export interface WidgetSOPStep {
  id: string;
  slug: string;
  position: number;
  question_text: string;
  chip_source: 'case_types' | 'sub_types' | 'inline' | 'contact_form' | null;
  inline_chips_json: string | null;
  accepts_free_text: boolean;
  is_required: boolean;
}

export interface WidgetSOP {
  id: string;
  version: number;
  qualified_lead_threshold: number;
  steps: WidgetSOPStep[];
}

export interface WidgetSubType {
  id: string;
  slug: string;
  label: string;
  position: number;
}

export interface WidgetCaseType {
  id: string;
  slug: string;
  label: string;
  position: number;
  is_in_scope: boolean;
  sub_types: WidgetSubType[];
}

export interface ComputeChipsInput {
  sop: WidgetSOP | null;
  caseTypes: WidgetCaseType[];
  /** Captured value of the case_type SOP step, if any. */
  capturedCaseTypeSlug: string | null;
  /** SOP state header payload from the latest chat response. */
  pendingStepSlug: string | null;
  isFinalized: boolean;
}

export function computeActiveChips(input: ComputeChipsInput): Chip[] {
  const { sop, caseTypes, capturedCaseTypeSlug, pendingStepSlug, isFinalized } = input;

  if (!sop || isFinalized || !pendingStepSlug) return [];

  const step = sop.steps.find((s) => s.slug === pendingStepSlug);
  if (!step || step.chip_source === null) return [];
  // contact_form steps render an input form (not chips). Return empty;
  // ChatPanel renders <ContactForm> instead.
  if (step.chip_source === 'contact_form') return [];

  if (step.chip_source === 'case_types') {
    return caseTypes
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((ct) => ({ label: ct.label, slug: ct.slug }));
  }

  if (step.chip_source === 'sub_types') {
    if (!capturedCaseTypeSlug) return [];
    const ct = caseTypes.find((c) => c.slug === capturedCaseTypeSlug);
    if (!ct) return [];
    return ct.sub_types
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((st) => ({ label: st.label, slug: st.slug }));
  }

  if (step.chip_source === 'inline' && step.inline_chips_json) {
    try {
      const parsed = JSON.parse(step.inline_chips_json) as Chip[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Malformed inline chip JSON — treat as no chips.
    }
    return [];
  }

  return [];
}