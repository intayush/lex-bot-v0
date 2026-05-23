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
import { advanceStateForVisitorMessage as advanceForVisitorMessage } from './advancer';

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
        id: 'step_4',
        sop_configuration_id: 'cfg_test',
        position: 4,
        slug: 'what',
        question_text: 'What happened?',
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
      {
        id: 'step_6',
        sop_configuration_id: 'cfg_test',
        position: 6,
        slug: 'contact',
        question_text: 'Last step — please share your contact info so we can follow up.',
        chip_source: 'contact_form',
        inline_chips_json: null,
        accepts_free_text: false,
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
    slug: 'personal_injury',
    label: 'Personal Injury',
    position: 2,
    is_in_scope: true,
    created_at: ANCHOR,
    sub_types: [
      { id: 'st_3', case_type_id: 'ct_2', slug: 'car_accident', label: 'Car Accident', position: 1, created_at: ANCHOR },
    ],
  },
  {
    id: 'ct_3',
    account_id: 'acct_test',
    slug: 'estate_planning',
    label: 'Estate Planning',
    position: 3,
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
    s = await advanceForVisitorMessage({ state: s, sopConfig, caseTypes: CASE_TYPES, message: 'arrested',      capturedAt: T1, inferDateImpl: ALWAYS_NULL });
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
    const whenIdx = sopConfig.steps.findIndex((s) => s.slug === 'when');
    sopConfig.steps[whenIdx]!.chip_source = null;
    sopConfig.steps[whenIdx]!.inline_chips_json = null;
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
    const whenIdx = sopConfig.steps.findIndex((s) => s.slug === 'when');
    sopConfig.steps[whenIdx]!.chip_source = null;
    sopConfig.steps[whenIdx]!.inline_chips_json = null;
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

// ---------------------------------------------------------------------------
// Change-of-mind via correction signal (Phase 6 follow-up after live testing)
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — change-of-mind correction', () => {
  it('"actually personal injury" overrides previously-captured case_type=dui', async () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.steps[0]!.captured_value).toBe('dui');

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'actually personal injury', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.steps[0]!.captured_value).toBe('personal_injury');
    expect(s.steps[0]!.status).toBe('complete');
    // current_progress unchanged at 1 (re-capture, not new step).
    expect(s.current_progress).toBe(1);
  });

  it('case_type correction resets a stale sub_type back to pending', async () => {
    // Walk: DUI \u2192 first_offense (DUI sub-type). Then "actually personal
    // injury". The sub_type 'first_offense' is now stale (not a valid
    // sub_type of personal_injury). Advancer must reset sub_type to
    // pending so the agent re-asks.
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    // Use the smaller fixture's step layout: case_type, sub_type, where, when
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'first offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    // Both case_type and sub_type complete now.
    expect(s.steps[0]!.status).toBe('complete');
    expect(s.steps[1]!.status).toBe('complete');
    expect(s.current_progress).toBe(2);

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'actually personal injury', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });

    expect(s.steps[0]!.captured_value).toBe('personal_injury');
    expect(s.steps[0]!.status).toBe('complete');
    // sub_type was reset to pending — stale value cleared.
    expect(s.steps[1]!.status).toBe('pending');
    expect(s.steps[1]!.captured_value).toBeNull();
    // current_progress decremented from 2 to 1 (case_type still counted,
    // sub_type reset).
    expect(s.current_progress).toBe(1);
  });

  it('does NOT re-capture without an explicit correction signal', async () => {
    // Visitor mentions "personal injury" without a correction phrase.
    // The conservative rule: case_type stays as DUI.
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'personal injury', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.steps[0]!.captured_value).toBe('dui'); // unchanged
  });

  it('correction within same case_type changes only the sub_type', async () => {
    const sopConfig = buildSOPConfig();
    let s = initSOPState(sopConfig, ANCHOR);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'DUI', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'first offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'actually it was a repeat offense', capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.steps[0]!.captured_value).toBe('dui'); // unchanged
    expect(s.steps[1]!.captured_value).toBe('repeat_offense');
    expect(s.current_progress).toBe(2); // both still complete
  });
});

// ---------------------------------------------------------------------------
// Contact-form short-circuit (010-sop-workflow contact step)
// ---------------------------------------------------------------------------

describe('advanceForVisitorMessage — contact-form step', () => {
  /** Walk to contact step pending (capture all 5 prior steps). */
  async function walkToContactPending(sopConfig: SOPConfiguration) {
    let s = initSOPState(sopConfig, ANCHOR);
    for (const [stepId, val] of [
      ['step_1', 'dui'],
      ['step_2', 'first_offense'],
      ['step_3', 'wherever'],
      ['step_4', 'whatever'],
      ['step_5', 'today'],
    ] as const) {
      s = await advanceForVisitorMessage({
        state: s, sopConfig, caseTypes: CASE_TYPES,
        message: val, capturedAt: T1,
        // ALWAYS_NULL so free-text messages on where/what don't get
        // wrongly inferred into the when step. The "today" chip on
        // step_5 captures regardless (skip-detector's inline-chip
        // path falls through to the chip slug if inference fails).
        inferDateImpl: ALWAYS_NULL,
      });
    }
    return s;
  }

  it('captures the contact step from a well-formed form-submit message', async () => {
    const sopConfig = buildSOPConfig();
    let s = await walkToContactPending(sopConfig);
    expect(s.steps.find((st) => st.slug === 'contact')!.status).toBe('pending');

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: 'My name is Jane Doe, my email is jane@example.com, my phone is 555-867-5309',
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });

    const contactStep = s.steps.find((st) => st.slug === 'contact')!;
    expect(contactStep.status).toBe('complete');
    const payload = JSON.parse(contactStep.captured_value!);
    expect(payload.name).toBe('Jane Doe');
    expect(payload.contact_email).toBe('jane@example.com');
    expect(payload.contact_phone).toBe('555-867-5309');
  });

  it('captures with name + email (phone omitted)', async () => {
    const sopConfig = buildSOPConfig();
    let s = await walkToContactPending(sopConfig);
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: "I'm Jane Doe, my email is jane@example.com",
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });

    const contactStep = s.steps.find((st) => st.slug === 'contact')!;
    expect(contactStep.status).toBe('complete');
    const payload = JSON.parse(contactStep.captured_value!);
    expect(payload.name).toBe('Jane Doe');
    expect(payload.contact_email).toBe('jane@example.com');
    expect(payload.contact_phone).toBeNull();
  });

  it('does NOT capture when extraction fails (incomplete form-submit)', async () => {
    // Visitor's message lacks a name pattern. Form should re-render.
    const sopConfig = buildSOPConfig();
    const before = await walkToContactPending(sopConfig);
    const after = await advanceForVisitorMessage({
      state: before, sopConfig, caseTypes: CASE_TYPES,
      message: "jane@example.com",
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(after).toBe(before); // same reference; no-op
  });

  it('does NOT advance other steps when pending is contact_form (short-circuit)', async () => {
    // Even if the message contained a case_type slug, when contact is
    // pending we don't run the regular skip-detector pass — that would
    // risk re-capturing some other step.
    const sopConfig = buildSOPConfig();
    let s = await walkToContactPending(sopConfig);

    // Capture contact via well-formed message that ALSO mentions DUI.
    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: "My name is Jane DUI Doe, my email is jane@example.com",
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    // case_type stays as 'dui' (already captured); not re-detected.
    expect(s.steps.find((st) => st.slug === 'case_type')!.captured_value).toBe('dui');
    // contact step captured.
    expect(s.steps.find((st) => st.slug === 'contact')!.status).toBe('complete');
  });

  it('current_progress increments to 6 when contact captured (default 6-step SOP)', async () => {
    const sopConfig = buildSOPConfig();
    // Bump threshold to 6 to mirror the default seed.
    sopConfig.qualified_lead_threshold = 6;
    let s = await walkToContactPending(sopConfig);
    expect(s.current_progress).toBe(5);

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: "My name is Jane, my email is jane@x.com",
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.current_progress).toBe(6);
  });

  it('auto-finalizes when contact step capture meets threshold (caught by US1 E2E spec)', async () => {
    // Regression test for the bug surfaced by widget-us1-happy-path.walk.spec.ts:
    // when a visitor walked all 6 default-SOP steps including the contact form,
    // the runtime ended at current=6, total=6, is_finalized=FALSE — which
    // breaks the widget's contact-form rendering (it stayed visible after
    // submission) and the captureLead finalization signal.
    const sopConfig = buildSOPConfig();
    sopConfig.qualified_lead_threshold = 6;
    let s = await walkToContactPending(sopConfig);
    expect(s.is_finalized).toBe(false); // Pre-condition.

    s = await advanceForVisitorMessage({
      state: s, sopConfig, caseTypes: CASE_TYPES,
      message: "My name is Jane, my email is jane@x.com",
      capturedAt: T1, inferDateImpl: ALWAYS_NULL,
    });
    expect(s.current_progress).toBe(6);
    expect(s.is_finalized).toBe(true);
    expect(s.out_of_scope_termination).toBe(false);
  });

  it('does NOT auto-finalize when threshold is met but a required step is still pending', async () => {
    // Regression: auto-finalize must respect `is_required` — if a required
    // step is still pending, the runtime stays open (and the agent keeps
    // asking the question).
    const sopConfig = buildSOPConfig();
    sopConfig.qualified_lead_threshold = 5;
    const s = await walkToContactPending(sopConfig);
    // Threshold reached (5/5), but step_6 (contact, is_required=true) pending.
    expect(s.current_progress).toBe(5);
    expect(s.is_finalized).toBe(false);
  });
});