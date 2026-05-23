/**
 * Walk-mode dashboard tour: visits each tab of /dashboard/sop and exercises
 * the most-visible interactions so a `pnpm e2e:walk` in headed slow-mo mode
 * gives an eyes-on demo of the SOP editor's three tabs.
 *
 * These specs are tagged `@walk` so the headed runner picks them up.
 * They also pass on the default `pnpm e2e` headless run because the
 * assertions are visibility-based rather than visual.
 *
 * Source of truth: specs/010-sop-workflow/quickstart.md US6 +
 * contracts/sop-config-routes-contract.md.
 */
import { test, expect } from '@playwright/test';
import { loginAsDev } from './fixtures';

test.describe.configure({ mode: 'serial' });

async function navigateToSop(page: import('@playwright/test').Page) {
  await loginAsDev(page);
  // `waitUntil: 'commit'` — Next.js dev HMR keeps `load` pending forever.
  await page.goto('/dashboard/sop', { waitUntil: 'commit' });
  await expect(page.getByRole('heading', { name: 'Standard Operating Procedure' })).toBeVisible({ timeout: 15_000 });
  // Wait for the client editor to hydrate — its tab buttons aren't
  // interactive until React mounts. We use the SOP Steps tab as the
  // hydration signal because the tab buttons render only inside the
  // client `<SopEditor>` component.
  await expect(page.getByRole('button', { name: 'SOP Steps' })).toBeVisible({ timeout: 15_000 });
  // Stronger hydration check: the client component sets up the DnD
  // mount-gate (use-is-mounted), which only renders the drag handles
  // after the first useEffect tick. Wait for at least one drag handle
  // to confirm the client tree is fully interactive.
  await expect(page.locator("button[aria-label^='Drag to reorder']").first()).toBeVisible({ timeout: 15_000 });
}

/**
 * Click a tab button reliably. The bare `button.click()` sometimes fires
 * before React has bound its onClick (the SSR'd DOM has the button visible
 * but not interactive yet). Pattern: click + assert the active state
 * highlight switched, retrying on a short polling interval.
 *
 * `exact: true` keeps "Case Types" from also matching "Save case types".
 */
async function clickTab(page: import('@playwright/test').Page, name: 'SOP Steps' | 'Case Types' | 'Goodbye Phrases') {
  const button = page.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  await button.click();
  // The active button gets bg-[#171717] (dark background). The other tabs
  // don't. Use that as the "tab actually switched" signal.
  await expect(button).toHaveClass(/bg-\[#171717\]/, { timeout: 5_000 });
}

test('@walk SOP editor — Steps tab shows drag handles and add-step form', async ({ page }) => {
  await navigateToSop(page);

  // Tab is "SOP Steps" by default.
  await expect(page.getByRole('button', { name: 'SOP Steps' })).toBeVisible();

  // Threshold input + step count visible.
  const threshold = page.locator("input[type='number']").first();
  await expect(threshold).toBeVisible();
  const thresholdValue = await threshold.inputValue();
  expect(Number(thresholdValue)).toBeGreaterThan(0);

  // 6 default-SOP drag handles visible.
  const dragHandles = page.locator("button[aria-label^='Drag to reorder']");
  await expect(dragHandles.first()).toBeVisible();
  expect(await dragHandles.count()).toBeGreaterThanOrEqual(5);

  // Add-step form toggles open and back closed.
  await page.getByRole('button', { name: '+ Add step' }).click();
  await expect(page.getByText('New step')).toBeVisible();
  // Cancel goes back to the read-only step list.
  await page.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByText('New step')).not.toBeVisible();
});

test('@walk SOP editor — Case Types tab expands a sub-types editor', async ({ page }) => {
  await navigateToSop(page);
  await clickTab(page, 'Case Types');

  // Header for the tab body.
  await expect(page.locator("text=/Case types \\(\\d+\\)/")).toBeVisible();

  // Three of the seeded case-type labels appear as input values.
  for (const label of ['DUI', 'Criminal Defense', 'Personal Injury']) {
    await expect(page.locator(`input[value='${label}']`).first()).toBeVisible();
  }

  // Expand DUI's sub-types editor.
  const duiRow = page.locator("div:has(input[value='DUI'])").first();
  const expandButton = duiRow.locator("button:has-text('sub-types')").first();
  await expandButton.click();
  // First Offense should be one of the seeded sub-types.
  await expect(page.locator("input[value='First Offense']")).toBeVisible();

  // Collapse again so the next walk doesn't accumulate state.
  await page.getByRole('button', { name: 'Collapse' }).first().click();
});

test('@walk SOP editor — Goodbye Phrases tab adds and removes a chip', async ({ page }) => {
  await navigateToSop(page);
  await clickTab(page, 'Goodbye Phrases');

  // Header counter.
  await expect(page.locator("text=/Goodbye phrases \\(\\d+\\/50\\)/")).toBeVisible();

  // At least 5 of the 7 seeded phrase chips visible.
  const chips = page.locator("span.inline-flex:has(button[aria-label^='Remove'])");
  await expect(chips.first()).toBeVisible();
  expect(await chips.count()).toBeGreaterThanOrEqual(5);

  // Add a fresh phrase.
  const phraseInput = page.locator("input[placeholder*='thanks']").first();
  await phraseInput.fill('walk-test phrase');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('walk-test phrase')).toBeVisible();

  // Remove it again so the page is clean for the next run.
  const removeBtn = page.locator(
    "span.inline-flex:has(span:text-is('walk-test phrase')) >> button[aria-label^='Remove']",
  );
  await removeBtn.first().click();
  await expect(page.getByText('walk-test phrase')).not.toBeVisible();
});
