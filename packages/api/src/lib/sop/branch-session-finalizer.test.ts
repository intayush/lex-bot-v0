/**
 * Spec 016 US2 T040 — partial-branch session finalizer tests.
 *
 * Verifies that buildPartialBranchFinalizationIntent correctly
 * scores partial captures + freezes a snapshot with
 * branch_incomplete=true. The caller wraps the intent in a single
 * `UPDATE leads` — that's not tested here (DB is a side effect; the
 * intent is the contract).
 */

import { describe, expect, it } from 'vitest';

import { buildPartialBranchFinalizationIntent } from './branch-session-finalizer';
import type { Branch, BranchVersion, SOPState } from '@legal-chatbot/shared';

const BRANCH: Branch = {
  id: 'br_test',
  account_id: 'acct',
  case_type_slug: 'personal_injury',
  sub_type_slug: 'car_accident',
  is_active: true,
  current_version_id: 'bv_v1',
  created_at: 0,
  updated_at: 0,
};

const VERSION: BranchVersion = {
  id: 'bv_v1',
  branch_id: 'br_test',
  version_number: 1,
  is_published: true,
  questions: [
    {
      id: 'q1',
      position: 0,
      text: 'Q1',
      preface: null,
      chips: [
        { slug: 'a', label: 'A', score_weight: 20 },
        { slug: 'b', label: 'B', score_weight: 5 },
      ],
      free_text_allowed: false,
      multi_select: false,
    },
    {
      id: 'q2',
      position: 1,
      text: 'Q2',
      preface: null,
      chips: [
        { slug: 'x', label: 'X', score_weight: 25 },
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

function makeSopState(branchState: NonNullable<SOPState['branch_state']> | null): SOPState {
  return {
    sop_configuration_id: 'cfg',
    sop_version: 1,
    conversation_anchor_iso: '2026-06-06T00:00:00Z',
    qualified_lead_threshold: 6,
    current_progress: 6,
    is_finalized: true,
    out_of_scope_termination: false,
    steps: [],
    branch_state: branchState,
  };
}

describe('buildPartialBranchFinalizationIntent', () => {
  it('returns null when branch_state is absent', () => {
    const intent = buildPartialBranchFinalizationIntent({
      leadId: 'lead_1',
      sopState: makeSopState(null),
      branch: BRANCH,
      branchVersion: VERSION,
    });
    expect(intent).toBeNull();
  });

  it('scores zero captures as score 0 / SPAM / branch_incomplete=true', () => {
    const intent = buildPartialBranchFinalizationIntent({
      leadId: 'lead_1',
      sopState: makeSopState({
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 0,
        captured_chips: [],
        captured_free_text: [],
      }),
      branch: BRANCH,
      branchVersion: VERSION,
      finalizedAt: 1717689600000,
    });
    expect(intent).not.toBeNull();
    expect(intent!.leadScore).toBe(0);
    expect(intent!.classification).toBe('SPAM');
    expect(intent!.branchIncomplete).toBe(true);

    const snapshot = JSON.parse(intent!.branchSnapshotJson);
    expect(snapshot.branch_incomplete).toBe(true);
    expect(snapshot.captured_chips).toEqual([]);
    expect(snapshot.score).toBe(0);
  });

  it('scores 1-of-2 captures deterministically', () => {
    const intent = buildPartialBranchFinalizationIntent({
      leadId: 'lead_1',
      sopState: makeSopState({
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 1, // mid-branch (Q1 answered, Q2 not)
        captured_chips: [{ question_id: 'q1', chip_slugs: ['a'] }], // +20
        captured_free_text: [],
      }),
      branch: BRANCH,
      branchVersion: VERSION,
    });
    expect(intent!.leadScore).toBe(20);
    expect(intent!.classification).toBe('SPAM'); // 0–25
    expect(intent!.branchIncomplete).toBe(true);
    const reasons = JSON.parse(intent!.scoreReasonsJson) as string[];
    expect(reasons).toEqual(['A']);
  });

  it('emits a JSON-serialisable snapshot with denormalized slugs', () => {
    const intent = buildPartialBranchFinalizationIntent({
      leadId: 'lead_1',
      sopState: makeSopState({
        branch_id: 'br_test',
        branch_version_id: 'bv_v1',
        current_question_index: 1,
        captured_chips: [{ question_id: 'q1', chip_slugs: ['a'] }],
        captured_free_text: [],
      }),
      branch: BRANCH,
      branchVersion: VERSION,
    });
    const snap = JSON.parse(intent!.branchSnapshotJson);
    expect(snap.case_type_slug).toBe('personal_injury');
    expect(snap.sub_type_slug).toBe('car_accident');
    expect(snap.version_number).toBe(1);
  });
});
