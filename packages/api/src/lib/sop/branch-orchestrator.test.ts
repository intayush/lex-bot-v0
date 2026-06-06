/**
 * Spec 016 US2 T039 — Branch orchestrator unit tests.
 *
 * `runBranchOrchestrator` is the thin server-side coordinator that:
 *
 *   1. Inspects an `is_finalized=true` SOP state.
 *   2. If `branch_state` is null, looks up an active branch for the
 *      captured (case_type, sub_type) pair. If found, initializes
 *      `branch_state` with `current_question_index: 0`. If not,
 *      no-op (default-only finalization is the responsibility of the
 *      existing chat-route captureLead path).
 *   3. If `branch_state` is non-null and the visitor's latest
 *      message advances it past the last question, freezes the
 *      branch snapshot + scores it.
 *   4. Otherwise, advances `branch_state` and returns the next
 *      question to ask (the chat-route system-prompt extension
 *      surfaces this back to the agent).
 *
 * The orchestrator is PURE w.r.t. the lead row write: it returns a
 * `WriteIntent` describing what to persist; the caller (chat route)
 * applies the intent against the production DB. This keeps the
 * orchestrator testable without DB stubs.
 */

import { describe, expect, it, vi } from 'vitest';

import { runBranchOrchestrator } from './branch-orchestrator';
import type { Branch, BranchVersion, SOPState } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCOUNT_ID = 'acct_test';

function makeFinalizedSopState(overrides: Partial<SOPState> = {}): SOPState {
  return {
    sop_configuration_id: 'cfg_test',
    sop_version: 1,
    conversation_anchor_iso: '2026-06-06T00:00:00Z',
    qualified_lead_threshold: 6,
    current_progress: 6,
    is_finalized: true,
    out_of_scope_termination: false,
    steps: [
      {
        step_id: 'step_case_type',
        slug: 'case_type',
        status: 'complete',
        captured_value: 'personal_injury',
        captured_label: 'Personal Injury',
        captured_at: '2026-06-06T00:01:00Z',
        inferred: false,
      },
      {
        step_id: 'step_sub_type',
        slug: 'sub_type',
        status: 'complete',
        captured_value: 'car_accident',
        captured_label: 'Car Accident',
        captured_at: '2026-06-06T00:02:00Z',
        inferred: false,
      },
    ],
    branch_state: null,
    ...overrides,
  };
}

const SAMPLE_BRANCH: Branch = {
  id: 'br_test',
  account_id: ACCOUNT_ID,
  case_type_slug: 'personal_injury',
  sub_type_slug: 'car_accident',
  is_active: true,
  current_version_id: 'bv_v1',
  created_at: 0,
  updated_at: 0,
};

const SAMPLE_VERSION: BranchVersion = {
  id: 'bv_v1',
  branch_id: 'br_test',
  version_number: 1,
  is_published: true,
  questions: [
    {
      id: 'q_role',
      position: 0,
      text: 'Driver or passenger?',
      preface: null,
      chips: [
        { slug: 'driver', label: 'Driver', score_weight: 10 },
        { slug: 'passenger', label: 'Passenger', score_weight: 8 },
      ],
      free_text_allowed: false,
      multi_select: false,
    },
    {
      id: 'q_injury',
      position: 1,
      text: 'Injuries?',
      preface: null,
      chips: [
        { slug: 'yes', label: 'Yes', score_weight: 15 },
        { slug: 'no', label: 'No', score_weight: -10 },
      ],
      free_text_allowed: false,
      multi_select: false,
    },
  ],
  classification_thresholds: {
    self: { hot: [76, 100], warm: [51, 75], cold: [26, 50], spam: [0, 25] },
    family_friend: { hot: [71, 100], warm: [46, 70], spam: [0, 45] },
  },
  hard_override_toggles: {
    missing_contact: true,
    out_of_scope: true,
    no_injury_no_treatment: true,
    fake_info: true,
  },
  published_at: 0,
  created_at: 0,
  created_by_user_id: 'sys',
};

function makeDeps(opts: {
  branchLookup: { branch: Branch; version: BranchVersion } | { branch: null };
} = { branchLookup: { branch: null } }) {
  return {
    lookupBranch: vi.fn().mockResolvedValue(opts.branchLookup),
    getVersionById: vi.fn().mockResolvedValue(SAMPLE_VERSION),
    now: () => 1717689600000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runBranchOrchestrator — SOP not yet finalized', () => {
  it('returns no-op when is_finalized is false', async () => {
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeFinalizedSopState({ is_finalized: false }),
      userMessage: '',
      deps: makeDeps(),
    });
    expect(result.action).toBe('noop');
  });
});

describe('runBranchOrchestrator — finalized + no branch configured', () => {
  it('returns no-op when lookupBranch returns null (default-only path)', async () => {
    const deps = makeDeps({ branchLookup: { branch: null } });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeFinalizedSopState(),
      userMessage: '',
      deps,
    });
    expect(result.action).toBe('noop');
    expect(deps.lookupBranch).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      caseTypeSlug: 'personal_injury',
      subTypeSlug: 'car_accident',
    });
  });
});

describe('runBranchOrchestrator — finalized + branch configured + branch_state null', () => {
  it('initializes branch_state and returns the first question', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeFinalizedSopState(),
      userMessage: '',
      deps,
    });
    expect(result.action).toBe('present_question');
    if (result.action !== 'present_question') return;
    expect(result.question.id).toBe('q_role');
    expect(result.updatedSopState.branch_state).toMatchObject({
      branch_id: 'br_test',
      branch_version_id: 'bv_v1',
      current_question_index: 0,
      captured_chips: [],
    });
  });
});

describe('runBranchOrchestrator — branch in flight, advances on visitor message', () => {
  it('captures the visitor reply and presents the next question', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const stateMidBranch = makeFinalizedSopState({
      branch_state: {
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 0,
        captured_chips: [],
        captured_free_text: [],
      },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: stateMidBranch,
      userMessage: 'Driver',
      deps,
    });
    expect(result.action).toBe('present_question');
    if (result.action !== 'present_question') return;
    expect(result.question.id).toBe('q_injury');
    expect(result.updatedSopState.branch_state?.captured_chips).toEqual([
      { question_id: 'q_role', chip_slugs: ['driver'] },
    ]);
  });
});

describe('runBranchOrchestrator — last question answered', () => {
  it('returns finalize_with_branch carrying the snapshot + score', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const stateAtLastQ = makeFinalizedSopState({
      branch_state: {
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 1,
        captured_chips: [{ question_id: 'q_role', chip_slugs: ['driver'] }],
        captured_free_text: [],
      },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: stateAtLastQ,
      userMessage: 'Yes',
      deps,
    });
    expect(result.action).toBe('finalize_with_branch');
    if (result.action !== 'finalize_with_branch') return;
    expect(result.snapshot.captured_chips).toHaveLength(2);
    expect(result.snapshot.branch_incomplete).toBe(false);
    expect(result.score.score).toBe(25); // driver(10) + yes(15)
    expect(result.score.classification).toBe('SPAM'); // 25 ∈ [0,25]
    expect(result.updatedSopState.branch_state).toBeNull();
  });
});

describe('runBranchOrchestrator — clarification path', () => {
  it('returns awaiting_clarification when no chip matches and free-text is disallowed', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const stateMidBranch = makeFinalizedSopState({
      branch_state: {
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 0,
        captured_chips: [],
        captured_free_text: [],
      },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: stateMidBranch,
      userMessage: 'just gibberish',
      deps,
    });
    expect(result.action).toBe('awaiting_clarification');
  });
});

// ---------------------------------------------------------------------------
// Q9 contact-information bonus (lead-classification-revamp.md)
// ---------------------------------------------------------------------------

describe('runBranchOrchestrator — contact bonus on finalize', () => {
  function makeStateWithContact(payload: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  }): SOPState {
    const contactValue = JSON.stringify({
      name: payload.name ?? null,
      contact_email: payload.email ?? null,
      contact_phone: payload.phone ?? null,
    });
    const base = makeFinalizedSopState({
      branch_state: {
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 1,
        captured_chips: [{ question_id: 'q_role', chip_slugs: ['driver'] }],
        captured_free_text: [],
      },
    });
    return {
      ...base,
      steps: [
        ...base.steps,
        {
          step_id: 'step_contact',
          slug: 'contact',
          status: 'complete',
          captured_value: contactValue,
          captured_label: null,
          captured_at: '2026-06-06T00:06:00Z',
          inferred: false,
        },
      ],
    };
  }

  it('adds +10 (5+5) when both phone and email are valid', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeStateWithContact({
        email: 'pat@example.com',
        phone: '+15551234567',
      }),
      userMessage: 'Yes',
      deps,
    });
    expect(result.action).toBe('finalize_with_branch');
    if (result.action !== 'finalize_with_branch') return;
    // driver(10) + yes(15) + contact(10) = 35
    expect(result.score.score).toBe(35);
  });

  it('adds +5 when only the email is valid (phone missing)', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeStateWithContact({ email: 'pat@example.com', phone: null }),
      userMessage: 'Yes',
      deps,
    });
    if (result.action !== 'finalize_with_branch') throw new Error('not finalized');
    // driver(10) + yes(15) + email(5) = 30
    expect(result.score.score).toBe(30);
  });

  it('adds +5 when only the phone is valid (email missing)', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeStateWithContact({ email: null, phone: '+15551234567' }),
      userMessage: 'Yes',
      deps,
    });
    if (result.action !== 'finalize_with_branch') throw new Error('not finalized');
    // driver(10) + yes(15) + phone(5) = 30
    expect(result.score.score).toBe(30);
  });

  it('adds 0 when contact step is absent', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const stateAtLastQ = makeFinalizedSopState({
      branch_state: {
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 1,
        captured_chips: [{ question_id: 'q_role', chip_slugs: ['driver'] }],
        captured_free_text: [],
      },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: stateAtLastQ,
      userMessage: 'Yes',
      deps,
    });
    if (result.action !== 'finalize_with_branch') throw new Error('not finalized');
    // driver(10) + yes(15) = 25 (no contact bonus)
    expect(result.score.score).toBe(25);
  });

  it('does NOT credit invalid email or short phone', async () => {
    const deps = makeDeps({
      branchLookup: { branch: SAMPLE_BRANCH, version: SAMPLE_VERSION },
    });
    const result = await runBranchOrchestrator({
      accountId: ACCOUNT_ID,
      sopState: makeStateWithContact({
        email: 'not-an-email',
        phone: '12345', // < 7 digits
      }),
      userMessage: 'Yes',
      deps,
    });
    if (result.action !== 'finalize_with_branch') throw new Error('not finalized');
    // driver(10) + yes(15) + 0 = 25
    expect(result.score.score).toBe(25);
  });
});
