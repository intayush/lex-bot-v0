/**
 * Spec 016 US2 T032 — branch-advancer unit tests.
 *
 * Maps to contracts/branch-runtime-contract.md §branch-advancer.ts.
 *
 * The advancer is a PURE function. Given:
 *   - A `BranchState` (current question index + accumulated captures)
 *   - The hydrated `BranchVersion` payload
 *   - The latest visitor message
 *
 * Returns either:
 *   - { type: 'next_question', question, updatedState }
 *   - { type: 'finalize',      capturedChips, capturedFreeText, updatedState }
 *   - { type: 'awaiting_clarification', clarificationText, updatedState }
 *
 * Each test below exercises one branch of that decision matrix.
 */

import { describe, expect, it } from 'vitest';

import { advanceBranch, type BranchState } from './branch-advancer';
import type { BranchQuestion, BranchVersion } from '@legal-chatbot/shared';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeQuestion(
  id: string,
  position: number,
  chips: BranchQuestion['chips'],
  overrides: Partial<BranchQuestion> = {},
): BranchQuestion {
  return {
    id,
    position,
    text: `Q ${id}`,
    preface: null,
    chips,
    free_text_allowed: false,
    multi_select: false,
    ...overrides,
  };
}

function makeVersion(questions: BranchQuestion[]): BranchVersion {
  return {
    id: 'bv_test',
    branch_id: 'br_test',
    version_number: 1,
    is_published: true,
    questions,
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

const FRESH_STATE: BranchState = {
  branch_id: 'br_test',
  branch_version_id: 'bv_test',
  current_question_index: 0,
  captured_chips: [],
  captured_free_text: [],
};

const TWO_Q_VERSION = makeVersion([
  makeQuestion('q1', 0, [
    { slug: 'a', label: 'Alpha', score_weight: 10 },
    { slug: 'b', label: 'Bravo', score_weight: 5 },
  ]),
  makeQuestion('q2', 1, [
    { slug: 'c', label: 'Charlie', score_weight: 15 },
    { slug: 'd', label: 'Delta', score_weight: 0 },
  ]),
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('advanceBranch — first call returns the first question', () => {
  it('returns next_question with question at index 0 when state is fresh', () => {
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: TWO_Q_VERSION,
      userMessage: '', // no input yet — assistant turn that introduces Q1
    });
    expect(result.type).toBe('next_question');
    if (result.type !== 'next_question') return;
    expect(result.question.id).toBe('q1');
    expect(result.updatedState.current_question_index).toBe(0);
    expect(result.updatedState.captured_chips).toEqual([]);
  });
});

describe('advanceBranch — chip selection advances to next question', () => {
  it('captures the matching chip slug and advances current_question_index', () => {
    const stateAtQ1: BranchState = {
      ...FRESH_STATE,
      current_question_index: 0,
    };
    const result = advanceBranch({
      branchState: stateAtQ1,
      branchVersion: TWO_Q_VERSION,
      userMessage: 'Alpha',
    });
    expect(result.type).toBe('next_question');
    if (result.type !== 'next_question') return;
    expect(result.question.id).toBe('q2');
    expect(result.updatedState.current_question_index).toBe(1);
    expect(result.updatedState.captured_chips).toEqual([
      { question_id: 'q1', chip_slugs: ['a'] },
    ]);
  });

  it('matches chip slugs (lowercase) in addition to labels', () => {
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: TWO_Q_VERSION,
      userMessage: 'b', // chip slug
    });
    expect(result.type).toBe('next_question');
    if (result.type !== 'next_question') return;
    expect(result.updatedState.captured_chips).toEqual([
      { question_id: 'q1', chip_slugs: ['b'] },
    ]);
  });
});

describe('advanceBranch — last-question answer returns finalize', () => {
  it('returns finalize with all captured chips when the last question is answered', () => {
    const stateAtQ2: BranchState = {
      ...FRESH_STATE,
      current_question_index: 1,
      captured_chips: [{ question_id: 'q1', chip_slugs: ['a'] }],
    };
    const result = advanceBranch({
      branchState: stateAtQ2,
      branchVersion: TWO_Q_VERSION,
      userMessage: 'Charlie',
    });
    expect(result.type).toBe('finalize');
    if (result.type !== 'finalize') return;
    expect(result.capturedChips).toEqual([
      { question_id: 'q1', chip_slugs: ['a'] },
      { question_id: 'q2', chip_slugs: ['c'] },
    ]);
  });
});

describe('advanceBranch — free-text on a chip-only question', () => {
  it('returns awaiting_clarification when free_text_allowed=false and no chip matches', () => {
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: TWO_Q_VERSION,
      userMessage: 'something completely unrelated',
    });
    expect(result.type).toBe('awaiting_clarification');
    if (result.type !== 'awaiting_clarification') return;
    expect(result.clarificationText).toMatch(/please/i);
    expect(result.updatedState.current_question_index).toBe(0);
    expect(result.updatedState.captured_chips).toEqual([]);
  });
});

describe('advanceBranch — free-text on a free-text-allowed question', () => {
  it('captures the free text and advances when the question allows it', () => {
    const versionWithFreeText = makeVersion([
      makeQuestion('q_free', 0, [], { free_text_allowed: true }),
      makeQuestion('q2', 1, [{ slug: 'a', label: 'A', score_weight: 5 }]),
    ]);
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: versionWithFreeText,
      userMessage: 'Some descriptive answer the visitor typed',
    });
    expect(result.type).toBe('next_question');
    if (result.type !== 'next_question') return;
    expect(result.question.id).toBe('q2');
    expect(result.updatedState.captured_chips).toEqual([
      { question_id: 'q_free', chip_slugs: [] },
    ]);
    expect(result.updatedState.captured_free_text).toEqual([
      { question_id: 'q_free', text: 'Some descriptive answer the visitor typed' },
    ]);
  });
});

describe('advanceBranch — multi-select question', () => {
  it('captures multiple chip slugs from a single visitor turn', () => {
    const multiVersion = makeVersion([
      makeQuestion(
        'q_multi',
        0,
        [
          { slug: 'red', label: 'Red', score_weight: 5 },
          { slug: 'blue', label: 'Blue', score_weight: 5 },
          { slug: 'green', label: 'Green', score_weight: 5 },
        ],
        { multi_select: true },
      ),
    ]);
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: multiVersion,
      userMessage: 'Red and Blue',
    });
    expect(result.type).toBe('finalize');
    if (result.type !== 'finalize') return;
    expect(result.capturedChips[0].chip_slugs.sort()).toEqual(['blue', 'red']);
  });
});

describe('advanceBranch — defensive paths', () => {
  it('returns finalize immediately when the version has zero questions (defensive)', () => {
    const empty = makeVersion([]);
    const result = advanceBranch({
      branchState: FRESH_STATE,
      branchVersion: empty,
      userMessage: 'anything',
    });
    expect(result.type).toBe('finalize');
    if (result.type !== 'finalize') return;
    expect(result.capturedChips).toEqual([]);
  });

  it('returns finalize when current_question_index is already past the last question', () => {
    const past: BranchState = {
      ...FRESH_STATE,
      current_question_index: 2,
      captured_chips: [
        { question_id: 'q1', chip_slugs: ['a'] },
        { question_id: 'q2', chip_slugs: ['c'] },
      ],
    };
    const result = advanceBranch({
      branchState: past,
      branchVersion: TWO_Q_VERSION,
      userMessage: 'extra',
    });
    expect(result.type).toBe('finalize');
  });
});
