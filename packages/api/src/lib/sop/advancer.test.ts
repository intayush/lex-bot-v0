/**
 * Tests for the SOP advancer v0 (010-sop-workflow T031 sidecar).
 *
 * Async to accommodate the date-inferer call when the pending step's
 * slug is 'when'. Uses an injected mock inferDate so tests don't hit
 * the real Gemini provider.
 *
 * Phase 4 (US2) replaces this with the full skip-detector, but until
 * then v0 must work for the US1 happy path including ISO-date capture
 * for the when step.
 */
import { describe, it, expect } from 'vitest';
import type { CaseType, SOPConfiguration } from '@legal-chatbot/shared';
import { initSOPState } from './state-machine';
import { advanceForVisitorMessage } from './advancer';

const ANCHOR = '2026-05-23T10:00:00.000Z';
const T1 = '2026-05-23T10:01:00.000Z';

/** Mock date-inferer that returns a fixed ISO for any non-empty input. */
const ALWAYS_YESTERDAY = async () => ({ iso_date: '2026-05-22', confidence: 0.95 });
/** Mock that always fails inference (returns null). */
const ALWAYS_NULL = async () => ({ iso_date: null as string | null, confidence: 0 });

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
  it('matches case_type chip by slug (lowercase)', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL, // not exercised; case_type step doesn't infer
    });
    expect(next.steps[0]!.status).toBe('complete');
    expect(next.steps[0]!.captured_value).toBe('dui');
    expect(next.current_progress).toBe(1);
  });

  it('matches case_type chip by label (case-insensitive)', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(next.steps[0]!.captured_value).toBe('dui');
  });

  it('out-of-scope case_type triggers finalize_out_of_scope after capture', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'estate planning', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(next.steps[0]!.captured_value).toBe('estate_planning');
    expect(next.is_finalized).toBe(true);
    expect(next.out_of_scope_termination).toBe(true);
  });

  it('matches sub_type only after case_type was captured', async () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'first offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.steps[1]!.captured_value).toBe('first_offense');
  });
});

// ---------------------------------------------------------------------------
// When-step date inference (010-sop-workflow R3)
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — when step (date inference)', () => {
  /** Walks the SOP forward to the point where step_5 (when) is pending. */
  async function walkToWhenPending(sopConfig: SOPConfiguration): Promise<ReturnType<typeof initSOPState>> {
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'dui',           capturedAt: T1, inferDateImpl: ALWAYS_NULL });
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'first offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL });
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: '5th and Main',  capturedAt: T1, inferDateImpl: ALWAYS_NULL });
    return s;
  }

  it('inline chip ("yesterday") is converted to ISO date via inferDate', async () => {
    const sopConfig = buildSOPConfig();
    const before = await walkToWhenPending(sopConfig);
    const after = await advanceForVisitorMessage({
      state: before, sopConfig, caseTypes: CASE_TYPES,
      message: 'yesterday', capturedAt: T1,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    const whenStep = after.steps.find((st) => st.slug === 'when')!;
    expect(whenStep.status).toBe('complete');
    expect(whenStep.captured_value).toBe('2026-05-22');
  });

  it('free-text "yesterday" is converted to ISO date when free-text matches no chip', async () => {
    // Inject a SOP where the when step has chip_source=null so we exercise
    // the free-text branch.
    const sopConfig = buildSOPConfig();
    sopConfig.steps[3]!.chip_source = null;
    sopConfig.steps[3]!.inline_chips_json = null;
    const before = await walkToWhenPending(sopConfig);
    const after = await advanceForVisitorMessage({
      state: before, sopConfig, caseTypes: CASE_TYPES,
      message: 'yesterday afternoon', capturedAt: T1,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    const whenStep = after.steps.find((st) => st.slug === 'when')!;
    expect(whenStep.status).toBe('complete');
    expect(whenStep.captured_value).toBe('2026-05-22');
  });

  it('low-confidence free-text inference leaves the step pending (FR-014)', async () => {
    // Free-text branch with inferDate returning null (below threshold).
    const sopConfig = buildSOPConfig();
    sopConfig.steps[3]!.chip_source = null;
    sopConfig.steps[3]!.inline_chips_json = null;
    const before = await walkToWhenPending(sopConfig);
    const after = await advanceForVisitorMessage({
      state: before, sopConfig, caseTypes: CASE_TYPES,
      message: 'a couple weekends ago maybe', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    const whenStep = after.steps.find((st) => st.slug === 'when')!;
    expect(whenStep.status).toBe('pending');
    expect(whenStep.captured_value).toBeNull();
    // Same reference returned — no work done so the route handler can
    // detect "no advancement".
    expect(after).toBe(before);
  });

  it('inline-chip path falls back to chip slug if inference fails (defensive)', async () => {
    // We provided the chip slug ourselves, so even if Gemini fails we
    // still capture the slug rather than leaving the step pending.
    const sopConfig = buildSOPConfig();
    const before = await walkToWhenPending(sopConfig);
    const after = await advanceForVisitorMessage({
      state: before, sopConfig, caseTypes: CASE_TYPES,
      message: 'yesterday', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    const whenStep = after.steps.find((st) => st.slug === 'when')!;
    expect(whenStep.status).toBe('complete');
    expect(whenStep.captured_value).toBe('yesterday'); // chip slug preserved
  });
});

// ---------------------------------------------------------------------------
// Free-text fallback
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — free-text fallback', () => {
  it('captures free text for a chip_source=null step', async () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'dui',           capturedAt: T1, inferDateImpl: ALWAYS_NULL });
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'first offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL });
    // Step 3 (where) has chip_source=null and accepts_free_text=true.
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: '5th and Main, downtown', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    const whereStep = s.steps.find((st) => st.slug === 'where')!;
    expect(whereStep.captured_value).toBe('5th and Main, downtown');
  });

  it('does NOT capture when pending step has chip_source set and message does not match a chip', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'hello world', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(next.steps[0]!.status).toBe('pending');
    expect(next.current_progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive cases
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — defensive', () => {
  it('returns state unchanged when SOP is finalized', async () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'estate planning', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(s.is_finalized).toBe(true);
    const next = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'dui', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(next).toBe(s); // same reference; no work done
  });

  it('returns state unchanged on empty message', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const next = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: '   ', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(next).toBe(initial);
  });
});

// ---------------------------------------------------------------------------
// Multi-step capture (Phase 4 US2 — exercises the full skip-detector +
// advancer path)
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — multi-step capture (US2)', () => {
  it('"I had a DUI yesterday" advances both case_type and when in one turn', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const after = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'I had a DUI yesterday', capturedAt: T1,
      inferDateImpl: ALWAYS_YESTERDAY,
    });

    const caseTypeStep = after.steps.find((s) => s.slug === 'case_type')!;
    expect(caseTypeStep.status).toBe('complete');
    expect(caseTypeStep.captured_value).toBe('dui');
    expect(caseTypeStep.inferred).toBe(true);

    const whenStep = after.steps.find((s) => s.slug === 'when')!;
    expect(whenStep.status).toBe('complete');
    expect(whenStep.captured_value).toBe('2026-05-22');

    // current_progress should reflect both captures.
    expect(after.current_progress).toBeGreaterThanOrEqual(2);
  });

  it('out-of-scope case_type in a multi-step message still triggers finalize_out_of_scope', async () => {
    const sopConfig = buildSOPConfig();
    const initial = initSOPState(sopConfig, ANCHOR);
    const after = await advanceForVisitorMessage({
      state: initial, sopConfig, caseTypes: CASE_TYPES,
      message: 'I need help with estate planning', capturedAt: T1,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(after.is_finalized).toBe(true);
    expect(after.out_of_scope_termination).toBe(true);
  });
});