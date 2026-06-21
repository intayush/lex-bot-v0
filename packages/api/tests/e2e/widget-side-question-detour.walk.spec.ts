/**
 * Walk-mode E2E spec for 021-chat-api-latency User Story 2 (T027).
 *
 * Verifies that the removal of the dynamic "### Detour required NOW" block
 * does NOT regress side-question handling. The static "### Off-SOP detour
 * rule" in the system prompt continues to govern the behavior.
 *
 * Scenario: greeting → case_type → side question ("what are your hours?")
 * mid-SOP → assert assistant answers the side question AND re-asks the
 * pending step without losing SOP progress.
 *
 * The test only asserts structural SOP-state behavior (the `current` counter
 * does not advance on the side-question turn and the pending_step_slug
 * stays the same). It does NOT assert exact agent prose because that would
 * be brittle against model output variation.
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

async function waitForSopProgress(
  log: SopStateHeaderPayload[],
  minCurrent: number,
  message: string,
) {
  await expect
    .poll(() => log[log.length - 1]?.current ?? -1, { timeout: 60_000, message })
    .toBeGreaterThanOrEqual(minCurrent);
}

test(
  '@walk US2 — side question mid-SOP does not advance progress and is answered (021)',
  async ({ page }) => {
    test.setTimeout(300_000);
    await resetWidgetSession(page);

    const sopLog: SopStateHeaderPayload[] = [];
    await openWidget(page, sopLog);

    // Turn 1: establish case_type so SOP advances to sub_type.
    await sendMessage(page, 'I need help with a DUI case');
    await waitForSopProgress(sopLog, 1, 'case_type should be captured (current ≥ 1)');

    const stateAfterTurn1 = lastSopState(sopLog);
    const progressAfterTurn1 = stateAfterTurn1.current;
    const pendingSlugAfterTurn1 = stateAfterTurn1.pending_step_slug;
    // SOP should have advanced past case_type.
    expect(progressAfterTurn1).toBeGreaterThanOrEqual(1);

    // Turn 2: inject a side question (off-SOP). This should NOT advance the
    // SOP progress counter — the static "Off-SOP detour rule" tells the LLM
    // to answer and then re-ask the pending step.
    // Capture prevLength BEFORE sendMessage so the poll sees the delta correctly.
    // (sendMessage awaits the /api/chat response, so the sopLog entry is already
    // pushed by the time sendMessage resolves — prevLength must be pre-request.)
    const prevLength = sopLog.length;
    await sendMessage(page, 'What are your office hours?');
    // sendMessage already awaited the response; the poll resolves immediately
    // if the listener fired, or retries if it's still in-flight.
    await expect
      .poll(() => sopLog.length, { timeout: 60_000, message: 'side-question response received' })
      .toBeGreaterThan(prevLength);

    const stateAfterSideQ = lastSopState(sopLog);
    // SOP progress must NOT have advanced — the side question should not
    // satisfy a pending step.
    expect(stateAfterSideQ.current).toBe(progressAfterTurn1);
    // The pending step slug must still match what it was after turn 1.
    expect(stateAfterSideQ.pending_step_slug).toBe(pendingSlugAfterTurn1);

    // Turn 3: answer the pending step to confirm the SOP can still advance
    // after a side-question detour. This acts as a regression guard: if the
    // SOP state got corrupted on the side-question turn, this assertion fails.
    await sendMessage(page, 'First Offense');
    await waitForSopProgress(
      sopLog,
      progressAfterTurn1 + 1,
      'SOP should advance after answering the pending step post-detour',
    );
  },
);
