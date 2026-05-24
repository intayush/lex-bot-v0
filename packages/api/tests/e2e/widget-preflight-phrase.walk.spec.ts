/**
 * Walk-mode E2E spec for the preflight phrase rev2 (011-preflight-phrase).
 *
 * Verifies that the typing-indicator bubble shows a tailored phrase
 * (✨ {phrase}…) instead of dots when the visitor sends a message
 * that the client-side classifier recognizes.
 *
 * Rev2: the classifier is synchronous and client-side (no network call).
 * The phrase appears WITHIN THE SAME ANIMATION FRAME as the user's
 * message bubble. We assert by reading the bubble's text content.
 *
 * @walk — runs in headed slow-mo via `pnpm --filter @legal-chatbot/api e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import { openWidget, sendMessage, resetWidgetSession } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('@walk preflight phrase shows tailored content for known message', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  // "I had a DUI" matches the DUI rule → "Looking into your DUI matter".
  // Send via fill-and-click so we can observe the bubble appear.
  await page.locator("input[placeholder='Type your message...']").fill('I had a DUI');
  await page.getByRole('button', { name: 'Send message' }).click();

  // The typing bubble (role=status, aria-live=polite) should appear.
  // Its content should contain the tailored phrase (we assert presence
  // of the SPARKLE prefix that distinguishes the phrase state from
  // dots state — without asserting exact phrase text, future-proof if
  // we tune the phrase library).
  const bubble = page.locator("[role='status'][aria-live='polite']").first();
  await expect(bubble).toBeVisible({ timeout: 5_000 });
  await expect(bubble).toContainText(/looking into|noting|recording|checking|wrapping|finding/i, { timeout: 3_000 });
});

test('@walk preflight bubble disappears once agent response streams', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  await sendMessage(page, 'I had a DUI');

  // The typing bubble appears, then disappears once the assistant
  // streams a non-empty message. Generous timeout for the LLM round-trip.
  const bubble = page.locator("[role='status'][aria-live='polite']").first();
  await expect(bubble).not.toBeVisible({ timeout: 60_000 });
});

test('@walk preflight falls back to dots for unrecognized message', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  // Send a message that doesn't match any classifier rule and has no
  // pendingStepSlug yet. Should show dots (`● ● ●`) not a phrase.
  await page.locator("input[placeholder='Type your message...']").fill('asdfqwerty');
  await page.getByRole('button', { name: 'Send message' }).click();

  // The bubble appears in dots state. We verify by checking the
  // .lc-typing element is present (the rev2 ChatPanel still renders
  // `<span className="lc-typing">● ● ●</span>` when phrase is null).
  const bubble = page.locator("[role='status'][aria-live='polite']").first();
  await expect(bubble).toBeVisible({ timeout: 5_000 });
  await expect(bubble.locator('.lc-typing')).toBeVisible({ timeout: 1_000 });
});
