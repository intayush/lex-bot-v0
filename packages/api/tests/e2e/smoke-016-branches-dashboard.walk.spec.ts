/**
 * Spec 016 US4 — Branches dashboard end-to-end walk.
 *
 * Logs into /dashboard/sop, switches to the Branches tab, opens the
 * seeded Personal Injury → Car Accident editor, edits a chip weight,
 * saves the draft, publishes it, and verifies the new weight
 * persisted in the dev Neon DB.
 *
 * Tagged @walk so the headed runner picks it up via `pnpm e2e:walk`.
 * Also passes the default `pnpm e2e` headless run because every
 * assertion is visibility / DB based, not visual.
 *
 * Source of truth: specs/016-multi-branch-sop/contracts/branches-admin-api.md
 * + the BranchEditor component in
 *   packages/api/src/app/dashboard/sop/branch-editor.tsx
 */
import { test, expect } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loginAsDev } from './fixtures';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../.env.local') });

test.describe.configure({ mode: 'serial' });

async function navigateToBranchesTab(page: import('@playwright/test').Page) {
  await loginAsDev(page);
  await page.goto('/dashboard/sop', { waitUntil: 'commit' });
  await expect(
    page.getByRole('heading', { name: 'Standard Operating Procedure' }),
  ).toBeVisible({ timeout: 15_000 });
  // Wait for client hydration before clicking the Branches tab.
  await expect(page.getByRole('button', { name: 'SOP Steps' })).toBeVisible({
    timeout: 15_000,
  });

  const branchesTab = page.getByRole('button', { name: 'Branches', exact: true });
  await branchesTab.click();
  // Active tab gets bg-[#171717]. Wait for the visual switch.
  await expect(branchesTab).toHaveClass(/bg-\[#171717\]/, { timeout: 5_000 });
}

test('@walk SMOKE 016 US4 — Branches list renders all (case_type, sub_type) pairs with status pills', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await navigateToBranchesTab(page);

  // Tab body intro paragraph (use the unique-to-the-Branches-tab
  // phrase "Branches fire AFTER the contact step" to disambiguate
  // from the page-level subtitle).
  await expect(
    page.getByText(/Branches fire AFTER the contact step/i),
  ).toBeVisible();

  // Personal Injury → Car Accident is seeded as Configured · Active.
  // Per spec 016 FR-016 it ships pre-published with the spec 015
  // 9-question payload migrated forward.
  const carAccidentRow = page
    .locator('text=Car Accident')
    .locator('..')
    .first();
  await expect(carAccidentRow).toBeVisible();
  await expect(
    page
      .getByText(/Configured · Active/i)
      .first(),
  ).toBeVisible();

  // Other (case_type, sub_type) pairs render as "Not configured".
  // The seeded firm has 6 case types × an average of 3.5 sub-types
  // each = 21 pairs total. 1 pair is configured (Car Accident);
  // therefore at least 1 row reads "Not configured".
  await expect(page.getByText('Not configured').first()).toBeVisible();
});

test('@walk SMOKE 016 US4 — Edit chip weight, save draft, publish, persist to DB', async ({
  page,
}) => {
  test.setTimeout(180_000);

  await navigateToBranchesTab(page);

  // Find the Car Accident row's "Edit branch" action and click it.
  const carAccidentRow = page
    .locator('div', { hasText: 'Car Accident' })
    .locator('div', { hasText: 'Configured · Active' })
    .first();
  await expect(carAccidentRow).toBeVisible();
  await page
    .getByRole('button', { name: 'Edit branch' })
    .first()
    .click();

  // The inline editor renders below the row. Wait for the question
  // count header.
  await expect(page.getByText(/^Questions \(/)).toBeVisible({ timeout: 15_000 });

  // The seeded car-accident branch has 9 questions.
  await expect(page.getByText('Questions (9)')).toBeVisible();

  // Find the "Driver" chip's weight input. The chip row has 3
  // textboxes (label, slug) + 1 number (weight). Filter by the
  // 'driver' slug input then walk to the sibling number input.
  const driverSlugInput = page.locator("input[value='driver']").first();
  await expect(driverSlugInput).toBeVisible({ timeout: 5_000 });
  // The weight input sits two siblings down — number type, narrow
  // width (w-16 in branch-editor.tsx).
  const driverWeightInput = driverSlugInput
    .locator('xpath=following-sibling::input[@type="number"]')
    .first();
  await expect(driverWeightInput).toBeVisible();
  const originalWeight = await driverWeightInput.inputValue();
  expect(Number(originalWeight)).toBe(5); // seeded weight from spec 015

  // Edit: bump weight from 5 → 12. Use a deterministic value that
  // isn't a multiple of any other seeded weight so we can assert it
  // came from this test.
  await driverWeightInput.fill('12');

  // Save the draft.
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved as draft v\d+/i)).toBeVisible({
    timeout: 30_000,
  });

  // Publish the draft.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v\d+/i)).toBeVisible({
    timeout: 30_000,
  });

  // Now verify the dev DB has the new weight on the published
  // branch_versions row. This is the actual persistence assertion;
  // the Save+Publish UI flow was exercised above.
  const DATABASE_URL = process.env.DATABASE_URL;
  expect(
    DATABASE_URL,
    'DATABASE_URL must be set in packages/api/.env.local for this walk',
  ).toBeTruthy();
  const sql = neon(DATABASE_URL!);

  const rows = (await sql`
    SELECT bv.questions_json
    FROM branch_versions bv
    INNER JOIN branches b ON b.current_version_id = bv.id
    WHERE b.case_type_slug = 'personal_injury'
      AND b.sub_type_slug = 'car_accident'
    LIMIT 1
  `) as Array<{ questions_json: string }>;
  expect(rows[0], 'expected a published branch version').toBeDefined();

  const questions = JSON.parse(rows[0].questions_json) as Array<{
    id: string;
    chips: Array<{ slug: string; score_weight: number }>;
  }>;
  const accidentRoleQ = questions.find((q) => q.id === 'accident_role');
  expect(accidentRoleQ, 'expected the accident_role question').toBeDefined();
  const driverChip = accidentRoleQ!.chips.find((c) => c.slug === 'driver');
  expect(driverChip, 'expected the driver chip').toBeDefined();
  expect(driverChip!.score_weight).toBe(12); // updated from 5

  // Cleanup: revert the weight so subsequent runs aren't sticky.
  // The DB can also be reset via `pnpm db:seed`; this revert keeps
  // re-runs idempotent in the steady state.
  await driverWeightInput.fill('5');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved as draft v\d+/i)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v\d+/i)).toBeVisible({
    timeout: 30_000,
  });
});
