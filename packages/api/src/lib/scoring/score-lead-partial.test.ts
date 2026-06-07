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

// ---------------------------------------------------------------------------
// scoreBranch — slug-collision regression
//
// Real seeded branches reuse slugs across questions (e.g. `unknown`,
// `none`, `i_dont_know`). The previous flat slug-keyed lookup
// silently overwrote collisions, picking up the LAST occurrence's
// weight regardless of which question captured the chip. Audit
// against DEFAULT_BRANCH_SEEDS counted 13 weight-differing collisions
// across the 15 seeded branches, so this affected real leads.
//
// The fix keys the chip lookup by (question_id, slug). This test
// pins that contract.
// ---------------------------------------------------------------------------

describe('scoreBranch — duplicate slug across questions', () => {
  function versionWithDuplicateSlug(): BranchVersion {
    return {
      id: 'bv_dup',
      branch_id: 'br_dup',
      version_number: 1,
      is_published: true,
      questions: [
        {
          id: 'q_a',
          position: 0,
          text: 'Q A',
          preface: null,
          chips: [
            // Same slug `unknown`, different weight from q_b's `unknown`.
            { slug: 'unknown', label: 'Unknown', score_weight: 25 },
            { slug: 'a_other', label: 'Other', score_weight: 5 },
          ],
          free_text_allowed: false,
          multi_select: false,
        },
        {
          id: 'q_b',
          position: 1,
          text: 'Q B',
          preface: null,
          chips: [
            { slug: 'unknown', label: 'Unknown', score_weight: 0 },
            { slug: 'b_other', label: 'Other', score_weight: 5 },
          ],
          free_text_allowed: false,
          multi_select: false,
        },
      ],
      classification_thresholds: {
        self: { hot: [76, 100], warm: [51, 75], cold: [26, 50], spam: [0, 25] },
        family_friend: { hot: [76, 100], warm: [26, 75], spam: [0, 25] },
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

  it('uses the chip from the captured question, not the LAST chip with that slug', () => {
    // q_a captured `unknown` — that chip carries weight 25 in q_a.
    // The pre-fix scorer's flat Map would resolve `unknown` to q_b's
    // chip (weight 0) because q_b is registered later in iteration
    // order. The fixed scorer keys by (question_id, slug) and
    // returns 25 as expected.
    const captured: CapturedChip[] = [
      { question_id: 'q_a', chip_slugs: ['unknown'] },
    ];
    const result = scoreBranch({
      branchVersion: versionWithDuplicateSlug(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.raw_score).toBe(25);
    expect(result.score).toBe(25);
  });

  it('captures the q_b version of the slug independently', () => {
    const captured: CapturedChip[] = [
      { question_id: 'q_b', chip_slugs: ['unknown'] },
    ];
    const result = scoreBranch({
      branchVersion: versionWithDuplicateSlug(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    // q_b's `unknown` is 0; total raw score is 0.
    expect(result.raw_score).toBe(0);
    expect(result.score).toBe(0);
  });

  it('combines collisions from BOTH questions correctly', () => {
    // Both `unknown` chips selected — q_a contributes 25, q_b
    // contributes 0. Pre-fix: 0+0=0 (both lookups returned q_b's
    // chip). Post-fix: 25+0=25.
    const captured: CapturedChip[] = [
      { question_id: 'q_a', chip_slugs: ['unknown'] },
      { question_id: 'q_b', chip_slugs: ['unknown'] },
    ];
    const result = scoreBranch({
      branchVersion: versionWithDuplicateSlug(),
      capturedChips: captured,
      requestType: 'SELF',
    });
    expect(result.raw_score).toBe(25);
  });
});
