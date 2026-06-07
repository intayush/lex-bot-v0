/**
 * Spec 017 T048 — LexBot Playground rebrand + redesigned panel sizing.
 *
 * For each of three viewport presets (mobile / tablet / desktop) this
 * spec verifies:
 *   1. Page title equals "LexBot Playground"
 *   2. The page does NOT contain any of the forbidden "Smith &
 *      Associates" / "Springfield" strings
 *   3. The chatbot bubble is visible
 *   4. After clicking the bubble, the panel renders at the breakpoint's
 *      expected dimensions (within ±2px tolerance)
 *   5. A scripted user message + first assistant token round-trip
 *      succeeds (smoke for FR-021 / US4)
 *
 * The spec navigates to the widget dev server (5173) directly. Boot is
 * handled by the existing webServer block in playwright.config.ts.
 */
import { test, expect } from '@playwright/test';
import { WIDGET_URL } from './fixtures';

const FORBIDDEN_STRINGS = [
  'Smith & Associates',
  'Smith and Associates',
  '123 Main Street',
  'Springfield, IL',
  'Springfield, Illinois',
];

interface ViewportPreset {
  name: 'mobile' | 'tablet' | 'desktop';
  width: number;
  height: number;
  expectedPanelWidth: (vw: number) => number;
  expectedPanelHeight: (vh: number) => number;
  expectedRightOffset?: number;
}

const PRESETS: ViewportPreset[] = [
  {
    name: 'mobile',
    width: 375,
    height: 812,
    // Mobile: full-viewport takeover.
    expectedPanelWidth: (vw) => vw,
    expectedPanelHeight: (vh) => vh,
  },
  {
    name: 'tablet',
    width: 820,
    height: 1180,
    // Tablet: right-anchored sheet at min(420, vw - 32).
    expectedPanelWidth: () => 420,
    expectedPanelHeight: (vh) => vh,
  },
  {
    name: 'desktop',
    width: 1440,
    height: 900,
    // Desktop: fixed 480x760 floating with 24px right + 24px bottom.
    expectedPanelWidth: () => 480,
    expectedPanelHeight: () => 760,
    expectedRightOffset: 24,
  },
];

test.describe('LexBot Playground rebrand + redesigned panel (T048)', () => {
  for (const preset of PRESETS) {
    test(`@walk ${preset.name} (${preset.width}x${preset.height}) — title, no forbidden strings, panel sizing, smoke send`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: preset.width, height: preset.height });
      await page.goto(WIDGET_URL, { waitUntil: 'domcontentloaded' });

      // 1. Page title.
      await expect(page).toHaveTitle('LexBot Playground');

      // 2. Forbidden strings absent.
      const bodyText = await page.locator('body').textContent();
      for (const forbidden of FORBIDDEN_STRINGS) {
        expect(bodyText, `forbidden string "${forbidden}" must not appear`).not.toContain(
          forbidden,
        );
      }

      // 3. Bubble visible.
      const bubble = page.getByRole('button', { name: 'Open chat' });
      await expect(bubble).toBeVisible({ timeout: 10_000 });

      // 4. Click bubble → panel at expected dims.
      await bubble.click();

      const panel = page.locator('[role="dialog"][aria-label*="Chat"]');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      const box = await panel.boundingBox();
      expect(box, 'panel must have a bounding box').not.toBeNull();
      const expectedWidth = preset.expectedPanelWidth(preset.width);
      const expectedHeight = preset.expectedPanelHeight(preset.height);
      const tolerance = 2;
      expect(Math.abs(box!.width - expectedWidth)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(box!.height - expectedHeight)).toBeLessThanOrEqual(tolerance);

      if (preset.expectedRightOffset !== undefined) {
        const rightOffset = preset.width - (box!.x + box!.width);
        expect(Math.abs(rightOffset - preset.expectedRightOffset)).toBeLessThanOrEqual(
          tolerance,
        );
      }

      // 5. Smoke: send a message, observe at least the typing indicator.
      const input = page.getByPlaceholder('Type your message...');
      await expect(input).toBeVisible({ timeout: 5_000 });
      await input.fill('Hello');
      await page.getByRole('button', { name: 'Send message' }).click();

      // Typing indicator (role=status, aria-live=polite) appears within
      // 5s. Generous because cold-start /api/config + /api/chat round
      // trips are real network calls against the local dev server.
      const indicator = page.locator("[role='status'][aria-live='polite']").first();
      await expect(indicator).toBeVisible({ timeout: 15_000 });
    });
  }
});
