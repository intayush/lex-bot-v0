/**
 * Tests for the SOP skip-detector (010-sop-workflow T039).
 *
 * Pure-functional except for an injected mock date-inferer. No real
 * Gemini calls in tests.
 *
 * Source of truth: research.md R4 + spec.md FR-016 to FR-019.
 *
 * Phase A only — Phase B (LLM disambiguation) is intentionally deferred.
 * Phase A handles the common case (chip-slug match across pending steps,
 * date-phrase match for the when step). Phase B was speculative; we'll
 * add it if production conversations show Phase A misses real cases.
 */
import { describe, it, expect } from 'vitest';
import type { CaseType, SOPConfiguration } from '@legal-chatbot/shared';
import { initSOPState, advanceSOP } from './state-machine';
import { detectSkippedSteps } from './skip-detector';

const ANCHOR = '2026-05-23T10:00:00.000Z';
const T1 = '2026-05-23T10:01:00.000Z';

const ALWAYS_YESTERDAY = async () => ({ iso_date: '2026-05-22', confidence: 0.95 });
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
        id: 'step_1', sop_configuration_id: 'cfg_test', position: 1,
        slug: 'case_type', question_text: 'What kind of legal matter?',
        chip_source: 'case_types', inline_chips_json: null,
        accepts_free_text: true, is_required: true,
        counts_toward_threshold: true, is_default: true, skip_condition_json: null,
      },
      {
        id: 'step_2', sop_configuration_id: 'cfg_test', position: 2,
        slug: 'sub_type', question_text: 'What kind?',
        chip_source: 'sub_types', inline_chips_json: null,
        accepts_free_text: true, is_required: true,
        counts_toward_threshold: true, is_default: true, skip_condition_json: null,
      },
      {
        id: 'step_3', sop_configuration_id: 'cfg_test', position: 3,
        slug: 'where', question_text: 'Where did this happen?',
        chip_source: null, inline_chips_json: null,
        accepts_free_text: true, is_required: true,
        counts_toward_threshold: true, is_default: true, skip_condition_json: null,
      },
      {
        id: 'step_4', sop_configuration_id: 'cfg_test', position: 4,
        slug: 'what', question_text: 'What happened?',
        chip_source: null, inline_chips_json: null,
        accepts_free_text: true, is_required: true,
        counts_toward_threshold: true, is_default: true, skip_condition_json: null,
      },
      {
        id: 'step_5', sop_configuration_id: 'cfg_test', position: 5,
        slug: 'when', question_text: 'When?',
        chip_source: 'inline',
        inline_chips_json: JSON.stringify([
          { label: 'Today', slug: 'today' },
          { label: 'Yesterday', slug: 'yesterday' },
          { label: 'Last week', slug: 'last_week' },
        ]),
        accepts_free_text: true, is_required: true,
        counts_toward_threshold: true, is_default: true, skip_condition_json: null,
      },
    ],
  };
}

const CASE_TYPES: CaseType[] = [
  {
    id: 'ct_1', account_id: 'acct_test', slug: 'dui', label: 'DUI',
    position: 1, is_in_scope: true, created_at: ANCHOR,
    sub_types: [
      { id: 'st_1', case_type_id: 'ct_1', slug: 'first_offense', label: 'First Offense', position: 1, created_at: ANCHOR },
      { id: 'st_2', case_type_id: 'ct_1', slug: 'repeat_offense', label: 'Repeat Offense', position: 2, created_at: ANCHOR },
    ],
  },
  {
    id: 'ct_2', account_id: 'acct_test', slug: 'personal_injury', label: 'Personal Injury',
    position: 2, is_in_scope: true, created_at: ANCHOR,
    sub_types: [
      { id: 'st_3', case_type_id: 'ct_2', slug: 'car_accident', label: 'Car Accident', position: 1, created_at: ANCHOR },
      { id: 'st_4', case_type_id: 'ct_2', slug: 'slip_and_fall', label: 'Slip and Fall', position: 2, created_at: ANCHOR },
    ],
  },
  {
    id: 'ct_3', account_id: 'acct_test', slug: 'estate_planning', label: 'Estate Planning',
    position: 3, is_in_scope: false, created_at: ANCHOR, sub_types: [],
  },
];

// ---------------------------------------------------------------------------
// Single-step matches (compatibility with v0 advancer behavior)
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — single-step matches', () => {
  it('matches case_type chip slug', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'dui', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('case_type');
    expect(matches[0]!.captured_value).toBe('dui');
    expect(matches[0]!.source).toBe('chip');
  });

  it('matches case_type chip label (case-insensitive)', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'DUI', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches[0]!.captured_value).toBe('dui');
  });

  it('flags out-of-scope case_type', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'estate planning', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.captured_value).toBe('estate_planning');
    expect(matches[0]!.out_of_scope).toBe(true);
  });

  it('matches sub_type and infers parent case_type when message contains a unique sub_type label', async () => {
    // Skip-detector improves on the v0 advancer's strict behavior: a
    // sub_type label that uniquely identifies a single case_type also
    // emits the case_type match. "first offense" only appears under DUI.
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);

    const matches = await detectSkippedSteps({
      message: 'first offense', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches.some((m) => m.slug === 'case_type' && m.captured_value === 'dui')).toBe(true);
    expect(matches.some((m) => m.slug === 'sub_type' && m.captured_value === 'first_offense')).toBe(true);
  });

  it('matches sub_type after case_type was already captured', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    const matches = await detectSkippedSteps({
      message: 'first offense', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('sub_type');
    expect(matches[0]!.captured_value).toBe('first_offense');
  });

  it('matches inline when chip slug', async () => {
    const sopConfig = buildSOPConfig();
    // Walk to when pending.
    let state = initSOPState(sopConfig, ANCHOR);
    for (const [stepId, val] of [['step_1','dui'],['step_2','first_offense'],['step_3','wherever'],['step_4','whatever']] as const) {
      state = advanceSOP(state, { type: 'capture_step', step_id: stepId, value: val, capturedAt: T1 }, sopConfig);
    }
    const matches = await detectSkippedSteps({
      message: 'yesterday', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('when');
    expect(matches[0]!.captured_value).toBe('2026-05-22');
    expect(matches[0]!.source).toBe('date_inference');
  });

  it('captures free text for the currently-pending free-text step', async () => {
    const sopConfig = buildSOPConfig();
    // Walk to where pending.
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 }, sopConfig);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_2', value: 'first_offense', capturedAt: T1 }, sopConfig);

    const matches = await detectSkippedSteps({
      message: '5th and Main, downtown',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('where');
    expect(matches[0]!.captured_value).toBe('5th and Main, downtown');
    expect(matches[0]!.source).toBe('free_text');
  });

  it('returns empty array when message matches no chip and pending step has chips only', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'hello world', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(0);
  });

  it('returns empty array on empty message', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: '   ', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-step matches (the core US2 behavior, FR-016)
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — multi-step matches (US2 core)', () => {
  it('captures case_type + when from a single message', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'I had a DUI yesterday',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_YESTERDAY,
    });

    const slugs = matches.map((m) => m.slug).sort();
    expect(slugs).toContain('case_type');
    expect(slugs).toContain('when');

    const caseMatch = matches.find((m) => m.slug === 'case_type')!;
    expect(caseMatch.captured_value).toBe('dui');

    const whenMatch = matches.find((m) => m.slug === 'when')!;
    expect(whenMatch.captured_value).toBe('2026-05-22');
  });

  it('captures case_type + sub_type when case_type label appears with sub_type label', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    // "first offense DUI" — both labels present
    const matches = await detectSkippedSteps({
      message: 'first offense DUI',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const slugs = matches.map((m) => m.slug).sort();
    expect(slugs).toEqual(['case_type', 'sub_type']);
    expect(matches.find((m) => m.slug === 'case_type')!.captured_value).toBe('dui');
    expect(matches.find((m) => m.slug === 'sub_type')!.captured_value).toBe('first_offense');
  });

  it('captures personal_injury + car_accident from "I was in a car accident"', async () => {
    // Sub-type label "car accident" is unambiguous to personal_injury.
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'I was in a car accident last week',
      state, sopConfig, caseTypes: CASE_TYPES,
      // The stub still gets passed through for the free-text path,
      // but the message also matches the `last_week` inline chip
      // exactly, so the inline-chip path engages and uses the
      // deterministic chip→ISO mapper (no LLM call). The mapper
      // resolves `last_week` to anchor minus 10 days =
      // ANCHOR(2026-05-23) - 10 = 2026-05-13.
      inferDateImpl: async () => ({ iso_date: '2026-05-16', confidence: 0.9 }),
    });
    const slugs = matches.map((m) => m.slug).sort();
    expect(slugs).toContain('case_type');
    expect(slugs).toContain('sub_type');
    expect(slugs).toContain('when');
    expect(matches.find((m) => m.slug === 'case_type')!.captured_value).toBe('personal_injury');
    expect(matches.find((m) => m.slug === 'sub_type')!.captured_value).toBe('car_accident');
    expect(matches.find((m) => m.slug === 'when')!.captured_value).toBe('2026-05-13');
  });

  it('does NOT re-capture already-complete steps', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 }, sopConfig);

    // case_type already complete; mentioning DUI shouldn't re-emit it.
    const matches = await detectSkippedSteps({
      message: 'first offense DUI yesterday',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    const slugs = matches.map((m) => m.slug).sort();
    expect(slugs).not.toContain('case_type');
    expect(slugs).toContain('sub_type');
    expect(slugs).toContain('when');
  });
});

// ---------------------------------------------------------------------------
// Free-text behavior in multi-step contexts
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — free-text behavior', () => {
  it('does NOT capture free-text into "where" when the message clearly answers chip steps', async () => {
    // Message "I had a DUI yesterday" — no clear "where" answer.
    // The detector should NOT speculate.
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'I had a DUI yesterday',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    expect(matches.find((m) => m.slug === 'where')).toBeUndefined();
    expect(matches.find((m) => m.slug === 'what')).toBeUndefined();
  });

  it('captures free-text answer to currently-pending step ONLY when no other matches found', async () => {
    // "5th and Main downtown" — message is a location, where step is pending.
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 }, sopConfig);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_2', value: 'first_offense', capturedAt: T1 }, sopConfig);

    const matches = await detectSkippedSteps({
      message: '5th and Main downtown',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('where');
    expect(matches[0]!.source).toBe('free_text');
  });

  it('does NOT use free-text fallback when a non-pending free-text step is current', async () => {
    // case_type pending. "5th and Main downtown" doesn't match case_type chips.
    // Should NOT fall through to capture as where (a non-pending step).
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: '5th and Main downtown',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Defensive cases
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — defensive', () => {
  it('returns empty when SOP is finalized', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'estate_planning', capturedAt: T1 }, sopConfig);
    state = advanceSOP(state, { type: 'finalize_out_of_scope' }, sopConfig);

    const matches = await detectSkippedSteps({
      message: 'dui yesterday', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_YESTERDAY,
    });
    expect(matches).toHaveLength(0);
  });

  it('handles when-step inference failure gracefully (no when match, others still emit)', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'I had a DUI ages ago',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL, // inference fails
    });
    // case_type still captured; when not.
    expect(matches.some((m) => m.slug === 'case_type')).toBe(true);
    expect(matches.some((m) => m.slug === 'when')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Change-of-mind: explicit correction signal re-captures complete steps
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — correction signal (change-of-mind)', () => {
  function captureCaseType(state: ReturnType<typeof initSOPState>, sopConfig: SOPConfiguration, slug: string) {
    return advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: slug, capturedAt: T1 },
      sopConfig,
    );
  }

  it('"actually personal injury" overrides previously-captured case_type=dui', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = captureCaseType(state, sopConfig, 'dui');

    const matches = await detectSkippedSteps({
      message: 'actually personal injury',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const ct = matches.find((m) => m.slug === 'case_type');
    expect(ct).toBeDefined();
    expect(ct!.captured_value).toBe('personal_injury');
    expect(ct!.source).toBe('correction');
  });

  it('"i meant DUI" overrides personal_injury \u2192 dui', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = captureCaseType(state, sopConfig, 'personal_injury');

    const matches = await detectSkippedSteps({
      message: 'i meant DUI',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches.find((m) => m.slug === 'case_type')?.captured_value).toBe('dui');
    expect(matches.find((m) => m.slug === 'case_type')?.source).toBe('correction');
  });

  it('"wait no, scratch that, drug crime" recognizes scratch-that signal', async () => {
    // CASE_TYPES fixture has personal_injury but not drug_crime; use the
    // personal_injury slug to test the signal independently of fixture.
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = captureCaseType(state, sopConfig, 'dui');

    const matches = await detectSkippedSteps({
      message: 'wait no, scratch that, personal injury',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches.find((m) => m.slug === 'case_type')?.captured_value).toBe('personal_injury');
  });

  it('does NOT re-capture without an explicit correction signal', async () => {
    // "personal injury" alone (no signal) should NOT overwrite an
    // existing dui capture. This is the conservative safety check.
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = captureCaseType(state, sopConfig, 'dui');

    const matches = await detectSkippedSteps({
      message: 'personal injury',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    // case_type already complete; no correction signal; no match emitted.
    expect(matches.find((m) => m.slug === 'case_type')).toBeUndefined();
  });

  it('"actually" with the same case_type value does NOT emit a redundant match', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = captureCaseType(state, sopConfig, 'dui');

    const matches = await detectSkippedSteps({
      message: 'actually DUI',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    // Same value as already captured → no-op (avoid spurious updates).
    expect(matches.find((m) => m.slug === 'case_type')).toBeUndefined();
  });

  it('correction signal can change sub_type within the same case_type', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 }, sopConfig);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_2', value: 'first_offense', capturedAt: T1 }, sopConfig);

    const matches = await detectSkippedSteps({
      message: 'actually it was a repeat offense',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches.find((m) => m.slug === 'sub_type')?.captured_value).toBe('repeat_offense');
    expect(matches.find((m) => m.slug === 'sub_type')?.source).toBe('correction');
  });

  it('correction "actually personal injury" emits case_type but NOT a sub_type match by itself', async () => {
    // After capturing case_type=dui + sub_type=first_offense, "actually
    // personal injury" changes the case_type. The sub_type (first_offense)
    // is now stale (it was a DUI sub-type). Skip-detector emits the
    // case_type match; the advancer is responsible for resetting the
    // stale sub_type to pending afterwards.
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 }, sopConfig);
    state = advanceSOP(state, { type: 'capture_step', step_id: 'step_2', value: 'first_offense', capturedAt: T1 }, sopConfig);

    const matches = await detectSkippedSteps({
      message: 'actually personal injury',
      state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    expect(matches.find((m) => m.slug === 'case_type')?.captured_value).toBe('personal_injury');
    // No sub_type match in THIS pass — the message didn't mention a
    // personal-injury sub_type. Advancer's job to reset the stale one.
    expect(matches.find((m) => m.slug === 'sub_type')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 014-fix-sop-case-subtypes T008/T009/T010 — captured_label snapshot.
// Every chip match emitted by the skip-detector must include the chip's
// human-readable label so leads carry a stable display value even after
// the firm renames or removes the chip (FR-022).
// ---------------------------------------------------------------------------

describe('detectSkippedSteps — captured_label snapshot (014)', () => {
  it('matchCaseTypeChip exact-slug emits ct.label as captured_label', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'dui', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const m = matches.find((x) => x.slug === 'case_type');
    expect(m).toBeDefined();
    expect(m!.captured_label).toBe('DUI');
  });

  it('matchCaseTypeChip exact-label emits ct.label as captured_label', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'Personal Injury', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const m = matches.find((x) => x.slug === 'case_type');
    expect(m).toBeDefined();
    expect(m!.captured_label).toBe('Personal Injury');
  });

  it('matchCaseTypeChip substring match emits ct.label as captured_label', async () => {
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'I have a DUI matter to discuss', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const m = matches.find((x) => x.slug === 'case_type');
    expect(m).toBeDefined();
    expect(m!.captured_label).toBe('DUI');
  });

  it('matchSubTypeChip exact-slug emits st.label as captured_label', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'dui', capturedAt: T1 },
      sopConfig,
    );
    const matches = await detectSkippedSteps({
      message: 'first_offense', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const m = matches.find((x) => x.slug === 'sub_type');
    expect(m).toBeDefined();
    expect(m!.captured_label).toBe('First Offense');
  });

  it('matchSubTypeChip exact-label emits st.label as captured_label', async () => {
    const sopConfig = buildSOPConfig();
    let state = initSOPState(sopConfig, ANCHOR);
    state = advanceSOP(
      state,
      { type: 'capture_step', step_id: 'step_1', value: 'personal_injury', capturedAt: T1 },
      sopConfig,
    );
    const matches = await detectSkippedSteps({
      message: 'Slip and Fall', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const m = matches.find((x) => x.slug === 'sub_type');
    expect(m).toBeDefined();
    expect(m!.captured_label).toBe('Slip and Fall');
  });

  it('inferCaseTypeFromSubType emits the parent case_type.label as captured_label', async () => {
    // "first offense" mentions a sub_type label that's unique to DUI.
    // Skip-detector emits BOTH a case_type=dui match (with label "DUI")
    // and a sub_type=first_offense match (with label "First Offense").
    const sopConfig = buildSOPConfig();
    const state = initSOPState(sopConfig, ANCHOR);
    const matches = await detectSkippedSteps({
      message: 'first offense', state, sopConfig, caseTypes: CASE_TYPES,
      inferDateImpl: ALWAYS_NULL,
    });
    const caseTypeMatch = matches.find((x) => x.slug === 'case_type');
    expect(caseTypeMatch).toBeDefined();
    expect(caseTypeMatch!.captured_value).toBe('dui');
    expect(caseTypeMatch!.captured_label).toBe('DUI');

    const subTypeMatch = matches.find((x) => x.slug === 'sub_type');
    expect(subTypeMatch).toBeDefined();
    expect(subTypeMatch!.captured_label).toBe('First Offense');
  });
});
