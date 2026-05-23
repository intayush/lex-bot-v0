/**
 * Tests for the off-SOP detour detector (010-sop-workflow T043).
 *
 * Pure-functional. The detector decides whether the visitor's message is
 * off-topic relative to the SOP's currently-pending step, given the
 * skip-detector's matches and a small keyword-overlap heuristic.
 *
 * Source of truth: research.md R5 + spec.md FR-020 to FR-023.
 */
import { describe, it, expect } from 'vitest';
import type { SOPConfiguration } from '@legal-chatbot/shared';
import type { SkipDetectorMatch } from './skip-detector';
import { isOffTopic } from './off-sop-detour';

function buildPendingStep(slug: string, questionText: string): SOPConfiguration['steps'][number] {
  return {
    id: `step_${slug}`,
    sop_configuration_id: 'cfg_test',
    position: 1,
    slug,
    question_text: questionText,
    chip_source: null,
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
    is_default: true,
    skip_condition_json: null,
  };
}

// ---------------------------------------------------------------------------
// Off-topic positive cases
// ---------------------------------------------------------------------------

describe('isOffTopic — positive (off-topic)', () => {
  it('"what are your office hours?" while sub_type is pending → off-topic', () => {
    const result = isOffTopic({
      message: 'what are your office hours?',
      pendingStep: buildPendingStep('sub_type', 'What kind of DUI matter is this?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });

  it('"do you take credit cards?" while where is pending → off-topic', () => {
    const result = isOffTopic({
      message: 'do you take credit cards?',
      pendingStep: buildPendingStep('where', 'Where did this happen?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });

  it('"how much does this cost?" while case_type is pending → off-topic', () => {
    const result = isOffTopic({
      message: 'how much does this cost?',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter can we help you with?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });

  it('"tell me about your firm" while case_type is pending → off-topic', () => {
    const result = isOffTopic({
      message: 'tell me about your firm',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter can we help you with?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// On-topic negative cases (skip-detector found matches → on-topic)
// ---------------------------------------------------------------------------

describe('isOffTopic — negative (on-topic via skip-detector match)', () => {
  function chipMatch(slug: string, value: string): SkipDetectorMatch {
    return { step_id: `step_${slug}`, slug, captured_value: value, out_of_scope: false, source: 'chip' };
  }

  it('returns false when skip-detector found ANY match', () => {
    const result = isOffTopic({
      message: 'DUI',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter can we help you with?'),
      skipDetectorMatches: [chipMatch('case_type', 'dui')],
    });
    expect(result).toBe(false);
  });

  it('returns false when free-text answer matched the pending step', () => {
    const result = isOffTopic({
      message: '5th and Main downtown',
      pendingStep: buildPendingStep('where', 'Where did this happen?'),
      skipDetectorMatches: [{
        step_id: 'step_where', slug: 'where', captured_value: '5th and Main downtown',
        out_of_scope: false, source: 'free_text',
      }],
    });
    expect(result).toBe(false);
  });

  it('returns false on multi-step capture even with off-topic-looking phrasing', () => {
    // "I had a DUI yesterday" matches case_type + when. The message also
    // contains the question word 'I' which has no overlap; if skip-detector
    // matches anything, NOT off-topic regardless.
    const result = isOffTopic({
      message: 'I had a DUI yesterday',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter can we help you with?'),
      skipDetectorMatches: [
        chipMatch('case_type', 'dui'),
        { step_id: 'step_when', slug: 'when', captured_value: '2026-05-22', out_of_scope: false, source: 'date_inference' },
      ],
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Keyword-overlap edge: no skip-detector matches but message shares
// keywords with pending question → NOT off-topic (visitor probably
// answering, just in a way the detector didn't catch).
// ---------------------------------------------------------------------------

describe('isOffTopic — keyword overlap with pending step', () => {
  it('1 real keyword overlap → off-topic (R5 threshold: > 1 needed for on-topic)', () => {
    // Message has 1 real (non-stop-word) overlap with pending question
    // ("happened" prefix-matches "happen"). Single overlap is below the
    // R5 threshold; off-topic.
    const result = isOffTopic({
      message: 'this happened at the courthouse where I was arrested',
      pendingStep: buildPendingStep('where', 'Where did this happen?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });

  it('2+ real keyword overlap → on-topic', () => {
    // Pending question: "Where did this happen and when?"
    // Message: "it happened today downtown when I was driving"
    // Real overlap (post-stop-words): "happened"~"happen", "today"... no
    // not in question. "downtown"... no. Hmm — let me use a question with
    // multiple real keywords.
    const result = isOffTopic({
      message: 'the accident happened downtown at the courthouse',
      pendingStep: buildPendingStep('what', 'Tell me about the accident: what happened?'),
      skipDetectorMatches: [],
    });
    // "accident" appears in both. "happened" prefix-matches "happen".
    // 2+ overlap → on-topic.
    expect(result).toBe(false);
  });

  it('1 stop-word overlap does NOT count (treats "what" / "the" as noise)', () => {
    // "what time?" while case_type pending. "What" overlaps but is a
    // stop-word. Real overlap is 0 → off-topic.
    const result = isOffTopic({
      message: 'what time?',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter can we help you with?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defensive cases
// ---------------------------------------------------------------------------

describe('isOffTopic — defensive', () => {
  it('returns false when there is no pending step', () => {
    // SOP all complete or finalized — no detour applies.
    const result = isOffTopic({
      message: 'what are your office hours?',
      pendingStep: null,
      skipDetectorMatches: [],
    });
    expect(result).toBe(false);
  });

  it('returns false on empty message', () => {
    const result = isOffTopic({
      message: '   ',
      pendingStep: buildPendingStep('case_type', 'What kind of legal matter?'),
      skipDetectorMatches: [],
    });
    expect(result).toBe(false);
  });
});
