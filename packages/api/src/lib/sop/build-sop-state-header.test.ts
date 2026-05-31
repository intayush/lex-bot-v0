/**
 * Tests for buildSOPStateHeader (014-fix-sop-case-subtypes T012).
 *
 * Validates that the new captured_case_type_label field is populated
 * correctly from the caseTypes catalog (FR-006) under the three key
 * scenarios:
 *   - case_type complete + slug resolves: label is the live label.
 *   - case_type complete + slug refers to deleted case type: label is null.
 *   - case_type still pending: label is null.
 */
import { describe, it, expect } from 'vitest';
import type { CaseType, SOPState } from '@legal-chatbot/shared';
import { buildSOPStateHeader } from './build-sop-state-header';

const ANCHOR = '2026-05-25T10:00:00.000Z';
const T1 = '2026-05-25T10:01:00.000Z';

const SAMPLE_CASE_TYPES: CaseType[] = [
  {
    id: 'ct_1', account_id: 'acct_1', slug: 'dui', label: 'DUI',
    position: 1, is_in_scope: true, created_at: ANCHOR,
    sub_types: [],
  },
  {
    id: 'ct_2', account_id: 'acct_1', slug: 'personal_injury', label: 'Personal Injury',
    position: 2, is_in_scope: true, created_at: ANCHOR,
    sub_types: [],
  },
];

function buildState(overrides: Partial<SOPState> = {}): SOPState {
  return {
    sop_configuration_id: 'cfg_1',
    sop_version: 1,
    conversation_anchor_iso: ANCHOR,
    qualified_lead_threshold: 6,
    current_progress: 1,
    is_finalized: false,
    out_of_scope_termination: false,
    steps: [
      {
        step_id: 'step_1', slug: 'case_type', status: 'complete',
        captured_value: 'dui', captured_at: T1, inferred: false,
        captured_label: 'DUI',
      },
      {
        step_id: 'step_2', slug: 'sub_type', status: 'pending',
        captured_value: null, captured_at: null, inferred: false,
        captured_label: null,
      },
    ],
    ...overrides,
  };
}

describe('buildSOPStateHeader — captured_case_type_label (014)', () => {
  it('returns null when sopState is null', () => {
    expect(buildSOPStateHeader(null, SAMPLE_CASE_TYPES)).toBeNull();
  });

  it('captured_case_type_label is the live label when slug resolves', () => {
    const state = buildState();
    const header = buildSOPStateHeader(state, SAMPLE_CASE_TYPES);
    expect(header).not.toBeNull();
    expect(header!.captured_case_type_slug).toBe('dui');
    expect(header!.captured_case_type_label).toBe('DUI');
  });

  it('captured_case_type_label is null when the captured slug refers to a deleted case type', () => {
    // Visitor's session captured 'drug_crime' but the firm has since
    // deleted that case type.
    const state = buildState({
      steps: [
        {
          step_id: 'step_1', slug: 'case_type', status: 'complete',
          captured_value: 'drug_crime', captured_at: T1, inferred: false,
          captured_label: 'Drug Crime',
        },
      ],
    });
    const header = buildSOPStateHeader(state, SAMPLE_CASE_TYPES);
    expect(header!.captured_case_type_slug).toBe('drug_crime');
    // Slug doesn't resolve in caseTypes → label is null.
    expect(header!.captured_case_type_label).toBeNull();
  });

  it('captured_case_type_label is null when the case_type step is still pending', () => {
    const state = buildState({
      steps: [
        {
          step_id: 'step_1', slug: 'case_type', status: 'pending',
          captured_value: null, captured_at: null, inferred: false,
          captured_label: null,
        },
      ],
    });
    const header = buildSOPStateHeader(state, SAMPLE_CASE_TYPES);
    expect(header!.captured_case_type_slug).toBeNull();
    expect(header!.captured_case_type_label).toBeNull();
  });

  it('captured_case_type_label uses live label even if captured_label snapshot disagrees', () => {
    // The header's label MUST come from the live caseTypes catalog (so
    // visitors see the firm's current name for the case type), not from
    // the per-state captured_label snapshot. The snapshot is for lead
    // archival; the header drives runtime UI. Verify by setting a stale
    // snapshot label that differs from the catalog label.
    const state = buildState({
      steps: [
        {
          step_id: 'step_1', slug: 'case_type', status: 'complete',
          captured_value: 'dui', captured_at: T1, inferred: false,
          captured_label: 'OLD STALE LABEL',
        },
      ],
    });
    const header = buildSOPStateHeader(state, SAMPLE_CASE_TYPES);
    expect(header!.captured_case_type_label).toBe('DUI');
  });
});
