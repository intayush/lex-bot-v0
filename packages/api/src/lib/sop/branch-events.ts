/**
 * Spec 016 US Phase 8 T059 — Structured branch-event logger.
 *
 * Five new event types emitted at branch lifecycle transitions (FR-033):
 *
 *   - branch_started               — branch's first question presented
 *   - branch_question_answered     — visitor input captured for a branch question
 *   - branch_completed             — last question answered; lead finalized
 *   - branch_skipped               — lookup found no active branch; default-only path
 *   - branch_incomplete_finalized  — session-end finalizer scored partial captures
 *
 * **PII boundary (Constitution V)**: only chip *slugs* (machine
 * identifiers — admin-defined controlled vocabulary) appear in
 * payloads. Chip *labels* MAY contain visitor PII context ("I have
 * herniated discs") and are excluded. Free-text answers, contact
 * fields, and message bodies are NEVER logged.
 *
 * Routes to `console.info` (queryable via the existing log pipeline).
 * Pure I/O wrapper — no DB writes, no network calls.
 */

import type { LeadClassification } from '@legal-chatbot/shared';

interface BaseFields {
  account_id: string;
  session_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  branch_id: string;
  branch_version_id: string;
}

export interface BranchStartedEvent extends BaseFields {
  event: 'branch_started';
}

export interface BranchQuestionAnsweredEvent extends BaseFields {
  event: 'branch_question_answered';
  question_id: string;
  /** Chip slugs the visitor selected (PII-free). Empty array on free-text answers. */
  chip_slugs: string[];
  /** True when the answer was a free-text (no chip match). */
  is_free_text: boolean;
}

export interface BranchCompletedEvent extends BaseFields {
  event: 'branch_completed';
  lead_score: number;
  classification: LeadClassification;
  /** Reason rule names ONLY (no labels). */
  reasons: string[];
}

export interface BranchSkippedEvent {
  event: 'branch_skipped';
  account_id: string;
  session_id: string;
  case_type_slug: string;
  sub_type_slug: string;
  reason: 'no_branch_configured' | 'branch_inactive' | 'branch_zero_questions';
}

export interface BranchIncompleteFinalizedEvent extends BaseFields {
  event: 'branch_incomplete_finalized';
  lead_score: number;
  classification: LeadClassification;
  reasons: string[];
  chips_captured_count: number;
  chips_total_count: number;
}

type BranchEvent =
  | BranchStartedEvent
  | BranchQuestionAnsweredEvent
  | BranchCompletedEvent
  | BranchSkippedEvent
  | BranchIncompleteFinalizedEvent;

/**
 * Emit a branch lifecycle event to the structured-log stream.
 *
 * Implementation injects `ts` (ISO timestamp) and stringifies as
 * single-line JSON for the existing log pipeline. The caller
 * supplies all PII-safe fields explicitly.
 */
export function emitBranchEvent(event: BranchEvent): void {
  const payload = { ...event, ts: new Date().toISOString() };
  console.info(JSON.stringify(payload));
}
