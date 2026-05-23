/**
 * Walk-mode E2E spec for User Story 2: multi-detail skip detection (T042).
 *
 * Source of truth: specs/010-sop-workflow/spec.md US2 + quickstart.md US2 +
 * lib/sop/skip-detector.ts.
 *
 * Visitor's first message answers ≥2 SOP steps at once. The skip-detector
 * runs server-side BEFORE the LLM call; it should advance the SOP state
 * by ≥2 in a single turn (per FR-016 to FR-018).
 *
 * Structural assertion: after one turn the SOP state's `current` is ≥2,
 * proving multiple steps were captured from one message.
 *
 * @walk — runs in headed slow-mo via `pnpm e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import {
  openWidget,
  sendMessage,
  resetWidgetSession,
  lastSopState,
  type SopStateHeaderPayload,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

test('@walk US2 — skip detector captures ≥2 SOP steps from a rich first message', async ({ page }) => {
  test.setTimeout(120_000);
  await resetWidgetSession(page);

  const sopLog: SopStateHeaderPayload[] = [];
  await openWidget(page, sopLog);

  // A first message that names case_type (DUI), where (downtown
  // Pittsburgh), and when (last week). Three captures from one message.
  await sendMessage(
    page,
    "I had a DUI in downtown Pittsburgh last week. I'm looking for help with the case.",
  );

  // Wait for the agent to respond.
  await expect.poll(() => sopLog.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  const state = lastSopState(sopLog);
  // Skip-detector should have captured at least 2 steps. The exact number
  // depends on the LLM's confidence + the date-inferer's verdict on
  // "last week" — both case_type=DUI and when=YYYY-MM-DD should be
  // confidently detected; sub_type and where might or might not be
  // captured depending on the run.
  expect(
    state.current,
    `skip detection must capture ≥2 steps from the rich first message; got current=${state.current}`,
  ).toBeGreaterThanOrEqual(2);

  // The next pending step should NOT be one of the already-captured
  // ones (case_type or when). It should be the earliest remaining
  // un-captured step.
  expect(
    state.pending_step_slug,
    'pending step must advance past the already-captured ones',
  ).not.toBe('case_type');
  expect(state.pending_step_slug).not.toBe('when');
});
