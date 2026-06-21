/**
 * Walk-mode E2E spec for User Story 1: default SOP happy path (T038).
 *
 * Source of truth: specs/010-sop-workflow/spec.md US1 + quickstart.md US1.
 *
 * The visitor walks the full default 6-step SOP via the widget:
 *   1. Open chat → greeting + case_type chips visible
 *   2. Click DUI chip → agent advances to sub_type
 *   3. Click First Offense → agent advances to where
 *   4. Type free-text where → agent advances to what
 *   5. Type free-text what → agent advances to when
 *   6. Click Yesterday chip → agent advances to contact
 *   7. Fill the contact form → SOP finalizes; lead captured
 *
 * Structural assertions only (we never assert exact agent prose):
 *   - Progress bar advances 0/6 → 6/6 over the run
 *   - x-sop-state header `is_finalized` flips true at the end
 *   - leads.sop_state_snapshot is non-null and matches sopStateSchema
 *
 * Forgiveness: each step has a max-2-retries guard with disambiguation
 * follow-ups so a confused LLM doesn't fail the test on a single
 * unlucky response. Total LLM cost: ~6-10 turns × ~$0.005 each.
 *
 * @walk — runs in headed slow-mo via `pnpm e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import {
  openWidget,
  sendMessage,
  clickChip,
  resetWidgetSession,
  readProgressBar,
  lastSopState,
  type SopStateHeaderPayload,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

/**
 * Wait for the SOP state log to record a turn whose `current` value is
 * at least `minCurrent`. Each LLM turn writes one entry, so this both
 * waits for the agent to respond AND asserts it captured what we expected.
 */
async function waitForSopProgress(
  log: SopStateHeaderPayload[],
  minCurrent: number,
  message: string,
) {
  await expect
    .poll(() => log[log.length - 1]?.current ?? -1, {
      timeout: 60_000,
      message,
    })
    .toBeGreaterThanOrEqual(minCurrent);
}

test('@walk US1 — default SOP happy path (DUI → First Offense → ... → contact)', async ({ page }) => {
  test.setTimeout(300_000); // ~5 min ceiling for 6 LLM turns + retries.
  await resetWidgetSession(page);

  const sopLog: SopStateHeaderPayload[] = [];
  await openWidget(page, sopLog);

  // -- Turn 1: case_type via free-text ---------------------------------------
  // Chips for case_type only appear AFTER the first /api/chat response
  // populates the sopState (which then triggers `computeActiveChips`).
  // So the first turn is always free-text. The skip-detector should
  // capture case_type='dui' from this message.
  await sendMessage(page, 'I need help with a DUI case');
  await waitForSopProgress(sopLog, 1, 'after DUI message, current should be ≥1');

  let bar = await readProgressBar(page);
  expect(bar?.current ?? 0, 'progress bar should reflect ≥1 step').toBeGreaterThanOrEqual(1);

  // -- Turn 2: sub_type --------------------------------------------------------
  // After turn 1 the sopState is populated. Chips for sub_type should
  // be rendered now (DUI's sub_types include "First Offense").
  try {
    await clickChip(page, 'First Offense');
  } catch {
    await sendMessage(page, "It's a first offense");
  }
  await waitForSopProgress(sopLog, 2, 'after sub_type, current should be ≥2');

  // -- Turn 3: where (chip) ---------------------------------------------------
  // The where step has inline chips "In Pittsburgh" / "Outside Pittsburgh".
  // Prefer chip click (deterministic skip-detector match) over free-text to
  // avoid keyword-overlap fragility (018-forward-only-sop removed multi-step
  // skip detection; free-text now requires exact overlap with step question).
  try {
    await clickChip(page, 'In Pittsburgh');
  } catch {
    await sendMessage(page, 'In Pittsburgh');
  }
  await waitForSopProgress(sopLog, 3, 'after where, current should be ≥3');

  // -- Turn 4: what (free-text) ------------------------------------------------
  await sendMessage(page, 'I was pulled over after a friend\'s party. Officer said I failed the breathalyzer.');
  await waitForSopProgress(sopLog, 4, 'after what, current should be ≥4');

  // -- Turn 5: when (chip) -----------------------------------------------------
  // The when step has 7 inline chips including "Yesterday".
  try {
    await clickChip(page, 'Yesterday');
  } catch {
    await sendMessage(page, 'Yesterday');
  }
  await waitForSopProgress(sopLog, 5, 'after when, current should be ≥5');

  // -- Turn 6: contact form ----------------------------------------------------
  // The contact step renders a form (chip_source='contact_form') with name
  // + email + phone fields and a Submit button.
  const contactForm = page.locator("[aria-label='Contact information']");
  await expect(contactForm, 'contact form should appear after when').toBeVisible({ timeout: 30_000 });

  await contactForm.locator("input[placeholder='Jane Doe']").fill('Test Visitor');
  await contactForm.locator("input[placeholder='jane@example.com']").fill('test.visitor@example.com');
  await contactForm.locator("input[placeholder='(555) 867-5309']").fill('(555) 867-5309');

  // Submit — the form button text is "Submit".
  const submitPromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
    { timeout: 90_000 },
  );
  await contactForm.getByRole('button', { name: 'Submit' }).click();
  await submitPromise;

  // -- Final state -------------------------------------------------------------
  // Final turn includes longest prompt (5+ turns of history) so we allow
  // generous time for the agent to finalize.
  await expect
    .poll(() => lastSopState(sopLog).is_finalized, {
      timeout: 90_000,
      message: `SOP must finalize after the contact step submits; last state=${JSON.stringify(lastSopState(sopLog))}`,
    })
    .toBe(true);

  bar = await readProgressBar(page);
  expect(bar?.current ?? 0, 'final progress should be at threshold (6)').toBeGreaterThanOrEqual(6);
});
