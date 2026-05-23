/**
 * Walk-mode E2E spec for User Story 3: off-SOP detour (T047).
 *
 * Source of truth: specs/010-sop-workflow/spec.md US3 + quickstart.md US3 +
 * lib/sop/off-sop-detour.ts.
 *
 * Mid-SOP, the visitor asks an off-topic question. The agent should:
 *   1. Answer the off-topic question (we don't assert exact prose).
 *   2. Re-prompt the pending SOP step (no new step should be captured).
 *   3. Leave SOP state's `current` unchanged across the detour turn.
 *
 * Structural assertion: progress doesn't advance on the detour turn.
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

test('@walk US3 — off-SOP question does not advance SOP progress', async ({ page }) => {
  test.setTimeout(120_000);
  await resetWidgetSession(page);

  const sopLog: SopStateHeaderPayload[] = [];
  await openWidget(page, sopLog);

  // Capture case_type via free-text (chips don't render until after
  // the first /api/chat response populates sopState).
  await sendMessage(page, 'I need help with a DUI case');
  await expect.poll(() => sopLog.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
  const stateAfterDui = lastSopState(sopLog);
  const progressBeforeDetour = stateAfterDui.current;
  expect(progressBeforeDetour, 'DUI message should capture case_type').toBeGreaterThanOrEqual(1);

  // Now ask an off-topic question that the agent should answer
  // without advancing the SOP.
  await sendMessage(page, 'What are your office hours?');

  // Wait for the response.
  await expect.poll(() => sopLog.length, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);

  const stateAfterDetour = lastSopState(sopLog);
  expect(
    stateAfterDetour.current,
    `off-topic question must NOT advance progress; was ${progressBeforeDetour}, now ${stateAfterDetour.current}`,
  ).toBe(progressBeforeDetour);
  expect(stateAfterDetour.is_finalized, 'off-topic must not finalize').toBe(false);
});
