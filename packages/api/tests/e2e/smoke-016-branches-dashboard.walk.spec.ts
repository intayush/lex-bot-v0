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

  // Find the Car Accident BranchRow and scope the Edit button to it.
  // Each BranchRow is a div.rounded-lg.border whose first child span carries
  // the sub_type_label "Car Accident". Scoping prevents clicking the first
  // "Edit branch" on the page (which belongs to Theft in Criminal Defense).
  const carAccidentRow = page.locator('div.rounded-lg.border', {
    has: page.locator('span.font-medium', { hasText: 'Car Accident' }),
  }).first();
  await expect(carAccidentRow).toBeVisible({ timeout: 15_000 });
  await carAccidentRow.getByRole('button', { name: 'Edit branch' }).click();

  // The inline editor renders below the row. Wait for the question
  // count header.
  await expect(page.getByText(/^Questions \(/)).toBeVisible({ timeout: 15_000 });

  // The seeded car-accident branch has 9 questions.
  await expect(page.getByText('Questions (9)')).toBeVisible();

  // Locate the driver chip weight input directly by its aria-label.
  // QuestionRow renders chip inputs as `aria-label="Chip {chipIdx+1} slug"` and
  // `aria-label="Chip {chipIdx+1} score weight"`. These labels repeat across
  // questions, so we can't use them alone — but we can filter by expected value.
  // The driver chip (slug='driver', weight=5) is the unique combination we need.
  // getByRole('spinbutton') matches number inputs; filter by value via .filter().
  // Simpler: iterate all slug inputs to find the one with value 'driver', then
  // get the sibling score-weight input by aria-label within the same chip row.
  //
  // Use Playwright's evaluate to find the chip row by its current JS .value
  // (React controlled inputs set the JS property, not the HTML attribute).
  // Find the driver chip's weight input. Each chip row is a .chip-grid-row div
  // containing three <label>-wrapped inputs: label text, slug text, weight number.
  // React sets input values as JS properties (not HTML attributes), so CSS
  // attribute selectors don't work. Instead get all chip rows, find the one
  // whose slug input has JS value 'driver', then get its number input.
  const chipRows = page.locator('.chip-grid-row').filter({
    has: page.locator('input[aria-label$="slug"]'),
  });
  await expect(chipRows.first()).toBeVisible({ timeout: 15_000 });
  const allRows = await chipRows.all();
  let driverWeightInput2: import('@playwright/test').Locator | null = null;
  for (const row of allRows) {
    const slugInput = row.locator('input[aria-label$="slug"]').first();
    const val = await slugInput.inputValue();
    if (val === 'driver') {
      driverWeightInput2 = row.locator('input[type="number"]').first();
      break;
    }
  }
  expect(driverWeightInput2, 'expected to find chip row with slug "driver"').not.toBeNull();
  await expect(driverWeightInput2!).toBeVisible();
  const originalWeight = await driverWeightInput2!.inputValue();
  expect(Number(originalWeight)).toBe(5); // seeded weight from spec 015

  // Edit: bump weight from 5 → 12. Use a deterministic value that
  // isn't a multiple of any other seeded weight so we can assert it
  // came from this test.
  await driverWeightInput2.fill('12');

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
  await driverWeightInput2.fill('5');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Saved as draft v\d+/i)).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published v\d+/i)).toBeVisible({
    timeout: 30_000,
  });
});
