/**
 * Tests for the SOP advancer v0 (010-sop-workflow T031 sidecar).
 *
 * Pure-functional. Phase 4 (US2) replaces this with the full skip-detector,
 * but until then v0 must work for the US1 happy path.
 */
import { describe, it, expect } from 'vitest';
import type { CaseType, SOPConfiguration } from '@legal-chatbot/shared';
import { initSOPState } from './state-machine';
import { advanceForVisitorMessage } from './advancer';

const ANCHOR = '2026-05-23T10:00:00.000Z';
const T1 = '2026-05-23T10:01:00.000Z';

function buildSOPConfig(): SOPConfiguration {
  return {
    id: 'cfg_test',
    account_id: 'acct_test',
    version: 1,
    qualified_lead_threshold: 5,
    is_published: true,
    derived_from_legacy: false,
    created_at: ANCHOR,
    steps: [
      {
        id: 'step_1',
        sop_configuration_id: 'cfg_test',
        position: 1,
        slug: 'case_type',
        question_text: 'What kind of legal matter?',
        chip_source: 'case_types',
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
      {
        id: 'step_2',
        sop_configuration_id: 'cfg_test',
        position: 2,
        slug: 'sub_type',
        question_text: 'What kind?',
        chip_source: 'sub_types',
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
      {
        id: 'step_3',
        sop_configuration_id: 'cfg_test',
        position: 3,
        slug: 'where',
        question_text: 'Where did this happen?',
        chip_source: null,
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
      {
        id: 'step_5',
        sop_configuration_id: 'cfg_test',
        position: 5,
        slug: 'when',
        question_text: 'When?',
        chip_source: 'inline',
        inline_chips_json: JSON.stringify([
          { label: 'Today', slug: 'today' },
          { label: 'Yesterday', slug: 'yesterday' },
        ]),
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
        is_default: true,
        skip_condition_json: null,
      },
    ],
  };
}

const CASE_TYPES: CaseType[] = [
  {
    id: 'ct_1',
    account_id: 'acct_test',
    slug: 'dui',
    label: 'DUI',
    position: 1,
    is_in_scope: true,
    created_at: ANCHOR,
    sub_types: [
      { id: 'st_1', case_type_id: 'ct_1', slug: 'first_offense', label: 'First Offense', position: 1, created_at: ANCHOR },
      { id: 'st_2', case_type_id: 'ct_1', slug: 'repeat_offense', label: 'Repeat Offense', position: 2, created_at: ANCHOR },
    ],
  },
  {
    id: 'ct_2',
    account_id: 'acct_test',
    slug: 'estate_planning',
    label: 'Estate Planning',
    position: 2,
    is_in_scope: false,
    created_at: ANCHOR,
    sub_types: [],
  },
];

// ---------------------------------------------------------------------------
// Chip matching
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — chip matching', () => {
  it('matches case_type chip by slug (lowercase)', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1,
    });
    expect(next.steps[0]!.status).toBe('complete');
    expect(next.steps[0]!.captured_value).toBe('dui');
    expect(next.current_progress).toBe(1);
  });

  it('matches case_type chip by label (case-insensitive)', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1,
    });
    expect(next.steps[0]!.captured_value).toBe('dui');
  });

  it('out-of-scope case_type triggers finalize_out_of_scope after capture', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'estate planning', capturedAt: T1,
    });
    expect(next.steps[0]!.captured_value).toBe('estate_planning');
    expect(next.is_finalized).toBe(true);
    expect(next.out_of_scope_termination).toBe(true);
  });

  it('matches sub_type only after case_type was captured', () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1,
    });
    s = advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'first offense', capturedAt: T1,
    });
    expect(s.steps[1]!.captured_value).toBe('first_offense');
  });

  it('matches inline chip slug for the "when" step', () => {
    const sopConfig = buildSOPConfig();
    // Pre-capture the first 3 steps so step_5 is pending.
    let s = initSOPState(sopConfig, ANCHOR);
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'dui', capturedAt: T1 });
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'first offense', capturedAt: T1 });
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: '5th and Main', capturedAt: T1 });
    // Now next pending is step_5 (when) — there's no step_4 in this fixture.
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'yesterday', capturedAt: T1 });
    const whenStep = s.steps.find((st) => st.slug === 'when')!;
    expect(whenStep.captured_value).toBe('yesterday');
  });
});

// ---------------------------------------------------------------------------
// Free-text fallback
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — free-text fallback', () => {
  it('captures free text for a chip_source=null step', () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'dui', capturedAt: T1 });
    s = advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'first offense', capturedAt: T1 });
    // Step 3 (where) has chip_source=null and accepts_free_text=true.
    s = advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: '5th and Main, downtown', capturedAt: T1,
    });
    const whereStep = s.steps.find((st) => st.slug === 'where')!;
    expect(whereStep.captured_value).toBe('5th and Main, downtown');
  });

  it('does NOT capture when pending step has chip_source set and message does not match a chip', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    // Pending = case_type with chip_source=case_types. "hello world" matches no chip.
    const next = advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'hello world', capturedAt: T1,
    });
    expect(next.steps[0]!.status).toBe('pending');
    expect(next.current_progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive cases
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — defensive', () => {
  it('returns state unchanged when SOP is finalized', () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'estate planning', capturedAt: T1,
    });
    expect(s.is_finalized).toBe(true);
    const next = advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1,
    });
    expect(next).toBe(s); // same reference; no work done
  });

  it('returns state unchanged on empty message', () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: '   ', capturedAt: T1,
    });
    expect(next).toBe(initial);
  });
});
