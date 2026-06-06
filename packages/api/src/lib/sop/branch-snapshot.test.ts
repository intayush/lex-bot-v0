/**
 * Spec 016 US2 T033 — branch-snapshot unit tests.
 *
 * Maps to contracts/branch-runtime-contract.md §branch-snapshot.ts.
 *
 * `freezeBranchSnapshot` is a PURE function. Given a hydrated Branch
 * + Version + the captured chip selections + the scorer's output, it
 * builds the JSON-serialisable BranchSnapshot that gets written to
 * `leads.branch_snapshot_json` at finalization (or at session-end
 * abandonment per FR-011a).
 *
 * Snapshot rules:
 *   - questions_snapshot equals the version's questions[] verbatim.
 *   - captured_chips order matches question position order, even if
 *     the visitor answered them in a different order (defensive sort).
 *   - branch_incomplete is true iff fewer answers than total questions.
 *   - All fields JSON-serialise round-trip identically.
 */

import { describe, expect, it } from 'vitest';

import { freezeBranchSnapshot } from './branch-snapshot';
import type { Branch, BranchVersion } from '@legal-chatbot/shared';

function makeBranch(): Branch {
  return {
    id: 'br_test',
    account_id: 'acct_test',
    case_type_slug: 'personal_injury',
    sub_type_slug: 'car_accident',
    is_active: true,
    current_version_id: 'bv_v1',
    created_at: 0,
    updated_at: 0,
  };
}

function makeVersion(): BranchVersion {
  return {
    id: 'bv_v1',
    branch_id: 'br_test',
    version_number: 1,
    is_published: true,
    questions: [
      {
        id: 'q_role',
        position: 0,
        text: 'Role?',
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
        text: 'Injury?',
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
}

describe('freezeBranchSnapshot — completed branch', () => {
  it('returns a snapshot with questions_snapshot matching the version verbatim', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [
        { question_id: 'q_role', chip_slugs: ['driver'] },
        { question_id: 'q_injury', chip_slugs: ['yes'] },
      ],
      capturedFreeText: [],
      score: 90,
      classification: 'HOT',
      reasons: ['Driver', 'Yes'],
      branchIncomplete: false,
      finalizedAt: 1717689600000,
    });
    expect(snap.questions_snapshot).toEqual(makeVersion().questions);
  });

  it('preserves denormalized slugs and version metadata', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [],
      capturedFreeText: [],
      score: 0,
      classification: 'SPAM',
      reasons: [],
      branchIncomplete: true,
      finalizedAt: 0,
    });
    expect(snap.branch_id).toBe('br_test');
    expect(snap.branch_version_id).toBe('bv_v1');
    expect(snap.version_number).toBe(1);
    expect(snap.case_type_slug).toBe('personal_injury');
    expect(snap.sub_type_slug).toBe('car_accident');
  });

  it('sorts captured_chips into question position order (defensive)', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [
        // Visitor answered q_injury first, then q_role (out of order)
        { question_id: 'q_injury', chip_slugs: ['yes'] },
        { question_id: 'q_role', chip_slugs: ['driver'] },
      ],
      capturedFreeText: [],
      score: 90,
      classification: 'HOT',
      reasons: [],
      branchIncomplete: false,
      finalizedAt: 0,
    });
    expect(snap.captured_chips.map((c) => c.question_id)).toEqual([
      'q_role',
      'q_injury',
    ]);
  });

  it('sets branch_incomplete=false on completed branches', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [
        { question_id: 'q_role', chip_slugs: ['driver'] },
        { question_id: 'q_injury', chip_slugs: ['yes'] },
      ],
      capturedFreeText: [],
      score: 90,
      classification: 'HOT',
      reasons: [],
      branchIncomplete: false,
      finalizedAt: 0,
    });
    expect(snap.branch_incomplete).toBe(false);
  });
});

describe('freezeBranchSnapshot — partial branch (FR-011a)', () => {
  it('flags branch_incomplete=true when caller passes branchIncomplete', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [{ question_id: 'q_role', chip_slugs: ['driver'] }],
      capturedFreeText: [],
      score: 50,
      classification: 'WARM',
      reasons: ['Driver'],
      branchIncomplete: true,
      finalizedAt: 0,
    });
    expect(snap.branch_incomplete).toBe(true);
    expect(snap.captured_chips).toHaveLength(1);
  });

  it('accepts an empty captured_chips array (visitor abandoned at Q1)', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [],
      capturedFreeText: [],
      score: 0,
      classification: 'SPAM',
      reasons: [],
      branchIncomplete: true,
      finalizedAt: 0,
    });
    expect(snap.captured_chips).toEqual([]);
    expect(snap.branch_incomplete).toBe(true);
  });
});

describe('freezeBranchSnapshot — JSON round-trip', () => {
  it('survives JSON.stringify → JSON.parse identically', () => {
    const snap = freezeBranchSnapshot({
      branch: makeBranch(),
      branchVersion: makeVersion(),
      capturedChips: [
        { question_id: 'q_role', chip_slugs: ['driver'] },
        { question_id: 'q_injury', chip_slugs: ['yes'] },
      ],
      capturedFreeText: [{ question_id: 'q_role', text: 'free text answer' }],
      score: 90,
      classification: 'HOT',
      reasons: ['Driver', 'Yes'],
      branchIncomplete: false,
      finalizedAt: 1717689600000,
    });
    const roundTripped = JSON.parse(JSON.stringify(snap));
    expect(roundTripped).toEqual(snap);
  });
});
