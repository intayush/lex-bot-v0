/**
 * E2E spec for User Story 6: lawyer configures custom SOP (T070).
 *
 * Source of truth: specs/010-sop-workflow/quickstart.md US6 +
 * specs/010-sop-workflow/contracts/sop-config-routes-contract.md.
 *
 * What this verifies end-to-end:
 *   1. Sidebar nav (T068) — SOP link is present and navigates correctly.
 *   2. Page renders with the editor (T063) and the preview pane (T069).
 *   3. Save Draft round-trip — UI button → POST /api/dashboard/sop
 *      → new draft row in `sop_configurations` (is_published=false).
 *   4. Publish — UI button → POST /api/dashboard/sop {action:'publish'}
 *      → published flag flipped exclusively to the latest version.
 *   5. Public widget GET /api/config picks up the new published SOP.
 *   6. Preview-mode (x-preview: true) sees an unpublished draft, while
 *      the public widget continues to see only the published one.
 *
 * Cleanup (afterAll): restores the default 6-step SOP and publishes it
 * so the dev DB ends in a clean state.
 *
 * @walk — also runnable in headed slow-mo mode via `pnpm e2e:walk`.
 *
 * Implementation notes:
 *  - We do NOT use `waitForLoadState('networkidle')` anywhere because the
 *    Next.js dev server keeps HMR long-polls open and 'networkidle' never
 *    fires. Instead we wait for specific UI elements.
 *  - Cleanup logs in via `page.request` rather than the test fixture's
 *    bare `request` context, because iron-session cookies are page-scoped.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  loginAsDev,
  getCurrentSop,
  publicConfig,
  restoreDefaultSop,
  DEV_API_KEY,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

// Module-scoped page used by `afterAll` so cleanup runs with the same
// authenticated request context the specs used.
let cleanupPage: Page;

test.beforeAll(async ({ browser }) => {
  cleanupPage = await browser.newPage();
  await loginAsDev(cleanupPage);
});

test.afterAll(async () => {
  if (cleanupPage) {
    try {
      await restoreDefaultSop(cleanupPage.request);
    } finally {
      await cleanupPage.close();
    }
  }
});

test('@walk lawyer configures custom SOP (US6)', async ({ page }) => {
  // --- 1. Login + sidebar nav -----------------------------------------------
  await loginAsDev(page);
  // `waitUntil: 'commit'` returns as soon as the URL is committed; we don't
  // wait for `load` because Next.js dev's HMR socket keeps "load" pending
  // forever in some configurations (especially under slowMo).
  await page.goto('/dashboard/leads', { waitUntil: 'commit' });

  // The sidebar renders twice in the DOM: a mobile drawer (off-canvas) AND
  // a desktop <aside>. Both are technically "in the DOM" so we scope to
  // <aside> to pick the desktop copy unambiguously.
  const sopLink = page.locator("aside a[href='/dashboard/sop']");
  await expect(sopLink).toBeVisible({ timeout: 15_000 });
  await sopLink.click();
  // Wait for the URL change rather than the load event (HMR pending issue).
  await page.waitForURL('**/dashboard/sop', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Standard Operating Procedure' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Preview Chat')).toBeVisible();
  await expect(page.getByText('Preview Chat')).toBeVisible();
  // Page-header version badge.
  await expect(page.locator("text=/v\\d+ (Published|Draft)/").first()).toBeVisible();

  // Capture starting state via the API so we can assert deltas.
  const before = await getCurrentSop(page.request);
  const beforePublishedVersion = before.current_published?.version ?? 0;
  const beforeLatestVersion = before.history[0]?.version ?? 0;

  // --- 3. Save Draft round-trip --------------------------------------------
  // The default editor state mirrors whatever the page's getLatestSOP returned.
  // We trigger Save without editing the steps so the request body matches the
  // current (already-validated) SOP shape — this still creates a new draft
  // version row, which is all we need to verify the round-trip.
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.locator('text=/Saved as draft v\\d+/').first()).toBeVisible({ timeout: 10_000 });

  const afterSave = await getCurrentSop(page.request);
  // The route caps history at 20 rows, so we can't reliably assert the depth
  // grew by 1. Instead assert the latest version moved forward.
  const newDraft = afterSave.history[0]!;
  expect(newDraft.version, 'a new draft version must appear at history[0]').toBeGreaterThan(beforeLatestVersion);
  expect(newDraft.is_published, 'newly saved version must be a draft').toBe(false);
  expect(newDraft.version).toBeGreaterThan(beforePublishedVersion);

  // --- 4. Publish ----------------------------------------------------------
  await page.getByRole('button', { name: 'Publish latest version' }).click();
  await expect(page.locator('text=/Published v\\d+/').first()).toBeVisible({ timeout: 10_000 });

  // The page reloads after publish to refresh the header badge.
  // Wait for the editor's tabbed Save button to be re-attached (proves the
  // reload completed) instead of `networkidle`.
  await expect(page.getByRole('button', { name: 'Save Draft' })).toBeVisible({ timeout: 10_000 });

  const afterPublish = await getCurrentSop(page.request);
  expect(afterPublish.current_published, 'something must be published after Publish').not.toBeNull();
  expect(
    afterPublish.current_published!.version,
    'the latest draft is now the published version',
  ).toBe(newDraft.version);

  // --- 5. Public widget GET /api/config picks up the new SOP ---------------
  const widgetCfg = await publicConfig(page.request);
  expect(widgetCfg.sop, 'widget /api/config must include SOP').not.toBeNull();
  expect(widgetCfg.sop!.version).toBe(newDraft.version);
});

test('@walk preview mode sees unpublished drafts (US6 / T069)', async ({ page }) => {
  await loginAsDev(page);

  // Snapshot the currently published version so we can assert the public
  // widget continues to see it after we save (but don't publish) a draft.
  const beforePublic = await publicConfig(page.request);
  const publishedVersion = beforePublic.sop?.version ?? 0;
  expect(publishedVersion).toBeGreaterThan(0);

  // Save a single-step DRAFT (NOT published).
  const draftBody = {
    action: 'save' as const,
    qualified_lead_threshold: 1,
    steps: [
      {
        slug: 'preview_only_step',
        position: 1,
        question_text: 'PREVIEW-ONLY: how did you hear about us?',
        chip_source: null,
        inline_chips_json: null,
        accepts_free_text: true,
        is_required: true,
        counts_toward_threshold: true,
      },
    ],
  };
  const saveRes = await page.request.post('/api/dashboard/sop', { data: draftBody });
  expect(saveRes.ok(), `draft save failed: ${saveRes.status()} ${await saveRes.text()}`).toBe(true);
  const saveBody = await saveRes.json();
  const draftVersion = saveBody.version as number;
  expect(draftVersion).toBeGreaterThan(publishedVersion);

  // Public widget must STILL see only the published SOP.
  const afterDraftPublic = await publicConfig(page.request);
  expect(afterDraftPublic.sop?.version).toBe(publishedVersion);
  expect(afterDraftPublic.sop?.steps.length).toBeGreaterThan(1);

  // Preview-mode chat (x-preview: true) must see the 1-step draft.
  const previewRes = await page.request.post('/api/chat', {
    headers: {
      'x-api-key': DEV_API_KEY,
      'x-preview': 'true',
      'Content-Type': 'application/json',
    },
    data: { messages: [{ role: 'user', content: 'hi' }] },
  });
  expect(previewRes.ok(), `preview chat failed: ${previewRes.status()}`).toBe(true);

  const sopStateHeader = previewRes.headers()['x-sop-state'];
  expect(sopStateHeader, 'x-sop-state header missing on preview response').toBeTruthy();
  const sopState = JSON.parse(sopStateHeader!);
  expect(sopState.total, 'preview should run against the 1-step draft').toBe(1);
});
