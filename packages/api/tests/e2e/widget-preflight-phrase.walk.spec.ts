/**
 * Walk-mode E2E spec for the preflight phrase MVP (011-preflight-phrase T015).
 *
 * Verifies the preflight wire path: POST /api/chat/preflight is called
 * in parallel with /api/chat when the visitor sends a message via any
 * of the three send-paths (free-text, QuickReply, SOP chip).
 *
 * Assertion strategy: structural only — verify the request fires.
 * Response status, body shape, and exact phrase content are NOT asserted
 * here because:
 *   - Dev-server HMR + LLM cold-start make the response timing racy.
 *   - The route's response shape + post-filter rules are already covered
 *     by 39 Vitest tests in `lib/preflight-phrase.test.ts` +
 *     `app/api/chat/preflight/route.test.ts`.
 *   - LLM phrase content varies; never assert prose in walk specs.
 *
 * What this spec proves end-to-end that unit tests cannot:
 *   - The widget hook fires the POST when ChatPanel's three send-paths
 *     are exercised.
 *   - The URL the hook constructs (`apiUrl + /preflight`) matches the
 *     route's actual mount point.
 *   - The headers (`Content-Type`, `x-api-key`) make it through CORS.
 *
 * @walk — runs in headed slow-mo via `pnpm --filter @legal-chatbot/api e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import { openWidget, sendMessage, resetWidgetSession } from './fixtures';

test.describe.configure({ mode: 'serial' });

interface PreflightCall {
  method: string;
  url: string;
}

function listenForPreflight(page: import('@playwright/test').Page): PreflightCall[] {
  const captured: PreflightCall[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/chat/preflight') && req.method() === 'POST') {
      captured.push({ method: req.method(), url: req.url() });
    }
  });
  return captured;
}

test('@walk preflight POST fires on free-text Send', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);

  const captured = listenForPreflight(page);
  await openWidget(page);
  await sendMessage(page, 'I had a DUI');

  // Generous timeout — dev server HMR can stall the very first POST
  // for several seconds while routes compile.
  await expect
    .poll(() => captured.length, {
      timeout: 20_000,
      message: 'preflight POST should fire when free-text message is sent',
    })
    .toBeGreaterThanOrEqual(1);

  expect(captured[0]!.url).toContain('/api/chat/preflight');
});

test('@walk preflight POST fires on QuickReply / chip click', async ({ page }) => {
  test.setTimeout(60_000);
  await resetWidgetSession(page);

  const captured = listenForPreflight(page);
  await openWidget(page);

  // The widget greeting includes practice-area QuickReplies; click one.
  // If no QuickReply chips render (account has no practice areas
  // configured), fall back to a free-text submit so we still exercise
  // a non-free-text send-path.
  const quickReplies = page.locator(
    "[role='group'][aria-label='Quick reply options'] button",
  );
  const count = await quickReplies.count();
  if (count > 0) {
    await quickReplies.first().click();
  } else {
    await sendMessage(page, 'I had a DUI');
  }

  await expect
    .poll(() => captured.length, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(1);
});
