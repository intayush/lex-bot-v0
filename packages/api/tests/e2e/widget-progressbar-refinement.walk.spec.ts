/**
 * Walk-mode E2E spec for the ProgressBar Refinement (012-progressbar-refinement).
 *
 * Verifies the three visible refinements:
 *   1. The progress bar renders inside the chat content area (DOM-after
 *      the header, NOT before it).
 *   2. The visible label contains "Step - " prefix and matches X/Y format.
 *   3. ARIA attributes (role=progressbar, aria-valuenow, aria-valuemax)
 *      are preserved verbatim from the 010 contract.
 *
 * Structural assertions only — never asserts pixel values for height/top
 * etc. (the implementation may tune those without breaking the user-facing
 * contract; per research.md R6).
 *
 * @walk — runs in headed slow-mo via `pnpm --filter @legal-chatbot/api e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import { openWidget, sendMessage, resetWidgetSession } from './fixtures';

test.describe.configure({ mode: 'serial' });

test('@walk progressbar renders below header inside chat container', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  // Send a message so sopState is populated (widget hides the bar
  // when total === 0; sopState is null until the first chat response).
  await sendMessage(page, 'I had a DUI');
  // Wait for the assistant response to land — that's when sopState is set.
  await page.waitForTimeout(8_000);

  const bar = page.locator("[role='progressbar']").first();
  await expect(bar).toBeVisible({ timeout: 10_000 });

  // DOM order: bar should come AFTER the header. The header is identified
  // by the close-button (aria-label='Close chat'). We check via DOM
  // position: bar.compareDocumentPosition(header) → 2 means header
  // PRECEDES bar. (Node.DOCUMENT_POSITION_PRECEDING = 0x02.)
  const ordering = await page.evaluate(() => {
    const bar = document.querySelector('[role="progressbar"]');
    const closeBtn = document.querySelector('button[aria-label="Close chat"]');
    if (!bar || !closeBtn) return 'missing-elements';
    const pos = bar.compareDocumentPosition(closeBtn);
    // 0x02 (DOCUMENT_POSITION_PRECEDING) bit set means closeBtn precedes bar.
    return (pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ? 'header-before-bar' : 'bar-before-header';
  });
  expect(ordering, 'progress bar must render after the header in DOM order').toBe('header-before-bar');
});

test('@walk progressbar label uses "Step - X/Y" format', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  await sendMessage(page, 'I had a DUI');
  await page.waitForTimeout(8_000);

  const label = page.locator('.lc-progress-bar-label').first();
  await expect(label).toBeAttached({ timeout: 10_000 });

  const labelText = await label.innerText();
  // Format: "Step - X/Y" with X and Y both numeric.
  expect(labelText).toMatch(/^Step - \d+\/\d+$/);
});

test('@walk progressbar preserves ARIA attributes from 010 contract', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  await sendMessage(page, 'I had a DUI');
  await page.waitForTimeout(8_000);

  const bar = page.locator("[role='progressbar']").first();
  await expect(bar).toBeVisible({ timeout: 10_000 });

  // Required ARIA attributes from the 010 contract.
  const ariaValueNow = await bar.getAttribute('aria-valuenow');
  const ariaValueMin = await bar.getAttribute('aria-valuemin');
  const ariaValueMax = await bar.getAttribute('aria-valuemax');
  const ariaLabel = await bar.getAttribute('aria-label');

  expect(ariaValueNow, 'aria-valuenow required').toBeTruthy();
  expect(ariaValueMin).toBe('0');
  expect(ariaValueMax, 'aria-valuemax required').toBeTruthy();
  expect(ariaLabel, 'aria-label must be the verbose 010 wording').toMatch(/Lead qualification progress: \d+ of \d+ questions answered/);
});

test('@walk progressbar label is actually visible (not clipped by overflow)', async ({ page }) => {
  // Regression test for the original 010 implementation's label-clipping bug:
  // the label was rendered in DOM but clipped by the parent's overflow:hidden.
  // 012's restructure puts the label outside the overflow-hidden bar track.
  test.setTimeout(60_000);
  await resetWidgetSession(page);
  await openWidget(page);

  await sendMessage(page, 'I had a DUI');
  await page.waitForTimeout(8_000);

  // Verify the label has non-zero rendered size + the parent DIV at the
  // label's center contains the label text. (We can't use
  // elementsFromPoint with `includes(label)` because the label has
  // `pointer-events: none` — that excludes it from elementsFromPoint
  // results. We instead verify the rendering by checking that the
  // ancestor element at the label's location reports the label text
  // as part of its visible textContent, i.e. the label is part of
  // the painted region rather than being clipped away.)
  const result = await page.evaluate(() => {
    const label = document.querySelector('.lc-progress-bar-label') as HTMLElement | null;
    if (!label) return { reason: 'missing-label' };
    const r = label.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { reason: 'zero-size' };
    // Ancestor at label's center.
    const at = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const ancestorTextContains = at.some(
      (el) => (el as HTMLElement).textContent?.includes(label.textContent ?? '__sentinel__'),
    );
    if (!ancestorTextContains) return { reason: 'label-text-not-in-ancestor-visibility' };
    // Final check: clientRect should not be cropped by an overflow:hidden
    // ancestor. Walk up the tree; each ancestor with overflow:hidden must
    // contain the label's bounds.
    let parent: HTMLElement | null = label.parentElement;
    while (parent) {
      const cs = window.getComputedStyle(parent);
      if (cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflowY === 'hidden') {
        const pr = parent.getBoundingClientRect();
        if (r.right > pr.right || r.bottom > pr.bottom || r.left < pr.left || r.top < pr.top) {
          return { reason: 'clipped-by-overflow', ancestor: parent.tagName + '.' + parent.className };
        }
      }
      parent = parent.parentElement;
    }
    return { reason: 'visible' };
  });
  expect(result.reason, JSON.stringify(result)).toBe('visible');
});
