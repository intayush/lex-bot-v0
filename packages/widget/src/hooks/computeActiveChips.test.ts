/**
 * Tests for computeActiveChips (014-fix-sop-case-subtypes T013).
 *
 * Validates the sub-type chip path: pending=`sub_type` + valid
 * captured_case_type slug returns the parent's sub_types in
 * position order; missing/invalid slug returns []; empty
 * sub_types list returns [].
 */
import { describe, it, expect } from 'vitest';
import {
  computeActiveChips,
  type WidgetSOP,
  type WidgetCaseType,
} from './computeActiveChips';

const SOP: WidgetSOP = {
  id: 'cfg_1',
  version: 1,
  qualified_lead_threshold: 6,
  steps: [
    {
      id: 'step_1', slug: 'case_type', position: 1,
      question_text: 'What kind of legal matter can we help you with?',
      chip_source: 'case_types', inline_chips_json: null,
      accepts_free_text: true, is_required: true,
    },
    {
      id: 'step_2', slug: 'sub_type', position: 2,
      question_text: 'What kind of {case_type} matter is this?',
      chip_source: 'sub_types', inline_chips_json: null,
      accepts_free_text: true, is_required: true,
    },
  ],
};

const CASE_TYPES: WidgetCaseType[] = [
  {
    id: 'ct_1', slug: 'dui', label: 'DUI', position: 1, is_in_scope: true,
    sub_types: [
      { id: 'st_1', slug: 'first_offense', label: 'First Offense', position: 1 },
      { id: 'st_2', slug: 'repeat_offense', label: 'Repeat Offense', position: 2 },
      { id: 'st_3', slug: 'dui_with_injury', label: 'DUI with Injury', position: 3 },
    ],
  },
  {
    id: 'ct_2', slug: 'personal_injury', label: 'Personal Injury', position: 2,
    is_in_scope: true,
    sub_types: [
      { id: 'st_4', slug: 'car_accident', label: 'Car Accident', position: 1 },
      { id: 'st_5', slug: 'slip_and_fall', label: 'Slip and Fall', position: 2 },
    ],
  },
  // A case type with NO sub_types — exercises the empty-list path.
  {
    id: 'ct_3', slug: 'estate_planning', label: 'Estate Planning', position: 3,
    is_in_scope: true,
    sub_types: [],
  },
];

describe('computeActiveChips — sub_type path (014 FR-001/FR-002)', () => {
  it('returns DUI sub_types in position order when capturedCaseTypeSlug=dui', () => {
    const chips = computeActiveChips({
      sop: SOP, caseTypes: CASE_TYPES,
      capturedCaseTypeSlug: 'dui',
      pendingStepSlug: 'sub_type',
      isFinalized: false,
    });
    expect(chips).toEqual([
      { label: 'First Offense', slug: 'first_offense' },
      { label: 'Repeat Offense', slug: 'repeat_offense' },
      { label: 'DUI with Injury', slug: 'dui_with_injury' },
    ]);
  });

  it('returns Personal Injury sub_types when capturedCaseTypeSlug=personal_injury', () => {
    const chips = computeActiveChips({
      sop: SOP, caseTypes: CASE_TYPES,
      capturedCaseTypeSlug: 'personal_injury',
      pendingStepSlug: 'sub_type',
      isFinalized: false,
    });
    expect(chips.map((c) => c.slug)).toEqual(['car_accident', 'slip_and_fall']);
  });

  it('returns [] when capturedCaseTypeSlug is null at sub_type step', () => {
    // FR-004: sub-type chips never render before Step 1 is captured.
    const chips = computeActiveChips({
      sop: SOP, caseTypes: CASE_TYPES,
      capturedCaseTypeSlug: null,
      pendingStepSlug: 'sub_type',
      isFinalized: false,
    });
    expect(chips).toEqual([]);
  });

  it('returns [] when capturedCaseTypeSlug points at a deleted case type', () => {
    // FR-002: must NOT fall back to case-type chips. Empty is correct.
    const chips = computeActiveChips({
      sop: SOP, caseTypes: CASE_TYPES,
      capturedCaseTypeSlug: 'drug_crime', // not in CASE_TYPES
      pendingStepSlug: 'sub_type',
      isFinalized: false,
    });
    expect(chips).toEqual([]);
  });

  it('returns [] when the captured case type has zero sub_types (FR-003)', () => {
    // Estate Planning has sub_types: []. The runtime is expected to
    // auto-skip Step 2; this test guards the hook's contribution to
    // that — it must not show a stale chip row.
    const chips = computeActiveChips({
      sop: SOP, caseTypes: CASE_TYPES,
      capturedCaseTypeSlug: 'estate_planning',
      pendingStepSlug: 'sub_type',
      isFinalized: false,
    });
    expect(chips).toEqual([]);
  });

  it('NEVER returns case-type labels at the sub_type step (regression for the user-reported bug)', () => {
    // The visible bug per the spec: "the next chip row never re-shows
    // the original case-type list". Run sub_type rendering with every
    // case_type slug and assert no case-type label leaks into the chips.
    const caseTypeLabels = CASE_TYPES.map((ct) => ct.label);
    for (const ct of CASE_TYPES) {
      const chips = computeActiveChips({
        sop: SOP, caseTypes: CASE_TYPES,
        capturedCaseTypeSlug: ct.slug,
        pendingStepSlug: 'sub_type',
        isFinalized: false,
      });
      for (const chip of chips) {
        expect(caseTypeLabels).not.toContain(chip.label);
      }
    }
  });
});
