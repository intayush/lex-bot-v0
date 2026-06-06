/**
 * Spec 016 US2 T034 — score-lead-partial unit tests.
 *
 * `scoreBranch` is a pure scorer that operates on the spec 016 Branch
 * model (arbitrary question ids, per-chip score_weight on
 * BranchChip). It replaces spec 015's SOP-step-aware `scoreLead` for
 * branch flows.
 *
 * `scoreLeadPartial` is a thin wrapper that always sets
 * `branch_incomplete: true` on the result and accepts an empty
 * captured_chips array (visitor abandoned without tapping any chip).
 *
 * Contract: contracts/branch-runtime-contract.md §score-lead-partial.ts.
 */

import { describe, expect, it } from 'vitest';

import { scoreBranch, scoreLeadPartial } from './score-lead-partial';
import type { BranchVersion, CapturedChip } from '@legal-chatbot/shared';

function makeVersion(): BranchVersion {
  return {
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
          { slug: 'b', label: 'B', score_weight: 10 },
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
          { slug: 'y', label: 'Y', score_weight: -10 },
        ],
        free_text_allowed: false,
        multi_select: false,
      },
      {
        id: 'q3',
        position: 2,
        text: 'Q3',
        preface: null,
        chips: [
          { slug: 'p', label: 'P', score_weight: 15 },
          { slug: 'q', label: 'Q', score_weight: 0 },
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

// ---------------------------------------------------------------------------
// scoreBranch — completed-branch happy paths
// ---------------------------------------------------------------------------

describe('scoreBranch — score arithmetic', () => {
  it('sums chip weights and clamps at 100', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] }, // +20
      { question_id: 'q2', chip_slugs: ['x'] }, // +25
      { question_id: 'q3', chip_slugs: ['p'] }, // +15
    ];
    const result = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.score).toBe(60);
    expect(result.classification).toBe('WARM');
  });

  it('floors a negative raw score at 0 and lands in SPAM', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q2', chip_slugs: ['y'] }, // -10
    ];
    const result = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.score).toBe(0);
    expect(result.classification).toBe('SPAM');
  });

  it('caps a raw score over 100 at 100', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] }, // +20
      { question_id: 'q2', chip_slugs: ['x'] }, // +25
      { question_id: 'q3', chip_slugs: ['p'] }, // +15
    ];
    const result = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
      contactBonus: 50, // would push to 110, clamps to 100
    });
    expect(result.score).toBe(100);
    expect(result.classification).toBe('HOT');
  });

  it('applies the family_friend threshold table when requestType=FRIEND_FAMILY', () => {
    // Score 47:
    //   Self table → COLD (26-50)
    //   Family/Friend → WARM (46-70)
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] }, // +20
      { question_id: 'q2', chip_slugs: ['x'] }, // +25
    ];
    const self = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
      contactBonus: 2,
    });
    const family = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'FRIEND_FAMILY',
      contactBonus: 2,
    });
    expect(self.score).toBe(47);
    expect(family.score).toBe(47);
    expect(self.classification).toBe('COLD');
    expect(family.classification).toBe('WARM');
  });

  it('handles multi-select questions by summing every selected chip', () => {
    const v = makeVersion();
    v.questions[0].multi_select = true;
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a', 'b'] }, // +20 +10 = +30
    ];
    const result = scoreBranch({
      branchVersion: v,
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.score).toBe(30);
  });
});

describe('scoreBranch — reasons array', () => {
  it('includes chip labels with |weight| ≥ 5 in reasons (FR-010a inclusion rule)', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] }, // weight 20 → included
      { question_id: 'q2', chip_slugs: ['y'] }, // weight -10 → included (|w|≥5)
      { question_id: 'q3', chip_slugs: ['q'] }, // weight 0 → excluded
    ];
    const result = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.reasons).toEqual(expect.arrayContaining(['A', 'Y']));
    expect(result.reasons).not.toContain('Q');
  });
});

// ---------------------------------------------------------------------------
// scoreLeadPartial — wrapper for FR-011a
// ---------------------------------------------------------------------------

describe('scoreLeadPartial — partial-branch wrapper', () => {
  it('returns score 0 + lowest-band classification when capturedChips is empty', () => {
    const result = scoreLeadPartial({
      branchVersion: makeVersion(),
      capturedChips: [],
      requestType: 'SELF',
    });
    expect(result.score).toBe(0);
    expect(result.classification).toBe('SPAM');
    expect(result.branch_incomplete).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('scores partial chips deterministically and flags branch_incomplete', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] }, // +20
      { question_id: 'q2', chip_slugs: ['x'] }, // +25 — total 45
    ];
    const result = scoreLeadPartial({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.score).toBe(45);
    expect(result.classification).toBe('COLD');
    expect(result.branch_incomplete).toBe(true);
  });

  it('does NOT modify the underlying scoreBranch threshold logic', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q1', chip_slugs: ['a'] },
      { question_id: 'q2', chip_slugs: ['x'] },
      { question_id: 'q3', chip_slugs: ['p'] },
    ];
    const completed = scoreBranch({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    const partial = scoreLeadPartial({
      branchVersion: makeVersion(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(partial.score).toBe(completed.score);
    expect(partial.classification).toBe(completed.classification);
    expect(partial.branch_incomplete).toBe(true);
  });
});
