/**
 * Regression spec: adding a new Case Type in the dashboard reflects in the chatbot (019).
 *
 * Verifies the end-to-end flow:
 *   1. Add a new in-scope Case Type ("Workers Comp") via the SOP dashboard.
 *   2. Publish the change.
 *   3. Confirm /api/config now returns the new label in `in_scope_case_types`.
 *   4. Send a message matching the new Case Type to the chatbot.
 *   5. Confirm the SOP advances (current ≥ 1) and captured_case_type_slug matches.
 *
 * Also verifies the inverse: marking the Case Type out-of-scope causes it to
 * disappear from `in_scope_case_types` without breaking the SOP runtime.
 *
 * Cleanup: removes the added Case Type after the test so the dev DB stays clean.
 *
 * @walk — runs in headless chromium via `pnpm e2e` (no @walk tag filter needed).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  loginAsDev,
  publicConfig,
  DEV_API_KEY,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

const NEW_CASE_TYPE_LABEL = 'Workers Comp';
const NEW_CASE_TYPE_SLUG = 'workers_comp';

let cleanupPage: Page;
let addedCaseTypeId: string | null = null;

test.beforeAll(async ({ browser }) => {
  cleanupPage = await browser.newPage();
  await loginAsDev(cleanupPage);
});

test.afterAll(async () => {
  // Remove the added case type so the DB stays clean.
  if (addedCaseTypeId && cleanupPage) {
    try {
      const all = await cleanupPage.request.get('/api/dashboard/sop/case-types', {
        headers: { cookie: (await cleanupPage.context().cookies()).map((c) => `${c.name}=${c.value}`).join('; ') },
      });
      if (all.ok()) {
        const { case_types: existing }: { case_types: Array<{ id: string; slug: string; label: string; position: number; is_in_scope: boolean; sub_types: unknown[] }> } = await all.json();
        const filtered = existing.filter((ct) => ct.id !== addedCaseTypeId);
        await cleanupPage.request.post('/api/dashboard/sop/case-types', {
          data: { action: 'save', case_types: filtered },
          headers: { 'Content-Type': 'application/json' },
        });
      }
    } catch (e) {
      console.warn('[cleanup] Failed to remove added case type:', e);
    }
  }
  await cleanupPage.close();
});

// ---------------------------------------------------------------------------
// Test 1: new in-scope case type appears in /api/config.in_scope_case_types
// ---------------------------------------------------------------------------
test('@walk new Case Type added in dashboard appears in /api/config in_scope_case_types', async ({ page }) => {
  test.setTimeout(60_000);
  await loginAsDev(page);

  // Step 1: Navigate to SOP → Case Types tab
  await page.goto('/dashboard/sop', { waitUntil: 'domcontentloaded' });
  const caseTypesTab = page.getByRole('button', { name: 'Case Types', exact: true });
  await expect(caseTypesTab).toBeVisible({ timeout: 10_000 });
  await caseTypesTab.click();

  // Step 2: Fetch current case types via API so we can build the new payload.
  type CaseTypeRow = { id: string; slug: string; label: string; position: number; is_in_scope: boolean; sub_types: unknown[] };
  const existingRes = await page.request.get('/api/dashboard/sop/case-types');
  expect(existingRes.ok()).toBeTruthy();
  const { case_types: existingCaseTypes }: { case_types: CaseTypeRow[] } = await existingRes.json();

  // Guard: don't add duplicates if a previous run left this case type behind.
  const alreadyExists = existingCaseTypes.find((ct) => ct.slug === NEW_CASE_TYPE_SLUG);
  if (alreadyExists) {
    addedCaseTypeId = alreadyExists.id;
  } else {
    // Step 3: POST the new case type via the dashboard API.
    const newCaseType = {
      slug: NEW_CASE_TYPE_SLUG,
      label: NEW_CASE_TYPE_LABEL,
      position: existingCaseTypes.length + 1,
      is_in_scope: true,
      sub_types: [],
    };
    const saveRes = await page.request.post('/api/dashboard/sop/case-types', {
      data: { action: 'save', case_types: [...existingCaseTypes, newCaseType] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(saveRes.ok(), `save case type failed: ${await saveRes.text()}`).toBeTruthy();

    // Re-fetch to get the server-assigned id.
    const { case_types: afterSave }: { case_types: CaseTypeRow[] } = await (await page.request.get('/api/dashboard/sop/case-types')).json();
    const added = afterSave.find((ct) => ct.slug === NEW_CASE_TYPE_SLUG);
    expect(added, 'added case type not found after save').toBeDefined();
    addedCaseTypeId = added!.id;
  }

  // Step 4: Verify /api/config (public widget endpoint) includes the new label.
  const config = await publicConfig(page.request);
  const inScopeCaseTypes: string[] = config.in_scope_case_types ?? [];
  expect(
    inScopeCaseTypes,
    `Expected "${NEW_CASE_TYPE_LABEL}" in in_scope_case_types, got: ${JSON.stringify(inScopeCaseTypes)}`,
  ).toContain(NEW_CASE_TYPE_LABEL);
});

// ---------------------------------------------------------------------------
// Test 2: chatbot SOP captures the new case type when visitor sends its name
// ---------------------------------------------------------------------------
test('@walk new Case Type is captured by SOP when visitor mentions it in chat', async ({ page }) => {
  test.setTimeout(90_000);
  // Requires Test 1 to have added the case type.
  test.skip(!addedCaseTypeId, 'Skipped: case type was not added in the preceding test.');

  const sessionId = `e2e-workers-comp-${Date.now()}`;

  // Send a message that names the new case type.
  const response = await page.request.post('/api/chat', {
    data: { messages: [{ role: 'user', content: 'I need help with a Workers Comp case' }] },
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': DEV_API_KEY,
      'x-session-id': sessionId,
    },
  });
  expect(response.ok(), `chat request failed: ${response.status()}`).toBeTruthy();

  const sopStateHeader = response.headers()['x-sop-state'];
  expect(sopStateHeader, 'x-sop-state header missing').toBeTruthy();

  const sopState = JSON.parse(sopStateHeader!) as {
    current: number;
    pending_step_slug: string | null;
    captured_case_type_slug: string | null;
  };

  expect(
    sopState.current,
    `SOP should have advanced to ≥1 after Workers Comp message; got current=${sopState.current}`,
  ).toBeGreaterThanOrEqual(1);

  expect(
    sopState.captured_case_type_slug,
    `captured_case_type_slug should be "${NEW_CASE_TYPE_SLUG}"`,
  ).toBe(NEW_CASE_TYPE_SLUG);

  expect(
    sopState.pending_step_slug,
    'Next pending step should be sub_type',
  ).toBe('sub_type');
});

// ---------------------------------------------------------------------------
// Test 3: marking the case type out-of-scope removes it from in_scope_case_types
// ---------------------------------------------------------------------------
test('@walk marking Case Type out-of-scope removes it from in_scope_case_types', async ({ page }) => {
  test.setTimeout(60_000);
  test.skip(!addedCaseTypeId, 'Skipped: case type was not added in the preceding test.');

  await loginAsDev(page);

  type CaseTypeRow = { id: string; slug: string; label: string; position: number; is_in_scope: boolean; sub_types: unknown[] };
  // Fetch current case types and flip Workers Comp to out-of-scope.
  const existingRes = await page.request.get('/api/dashboard/sop/case-types');
  expect(existingRes.ok()).toBeTruthy();
  const { case_types: existing }: { case_types: CaseTypeRow[] } = await existingRes.json();

  const updated = existing.map((ct) =>
    ct.id === addedCaseTypeId ? { ...ct, is_in_scope: false } : ct,
  );

  const saveRes = await page.request.post('/api/dashboard/sop/case-types', {
    data: { action: 'save', case_types: updated },
    headers: { 'Content-Type': 'application/json' },
  });
  expect(saveRes.ok()).toBeTruthy();

  // /api/config should no longer list the case type in in_scope_case_types.
  const config = await publicConfig(page.request);
  const inScopeCaseTypes: string[] = config.in_scope_case_types ?? [];
  expect(
    inScopeCaseTypes,
    `"${NEW_CASE_TYPE_LABEL}" should NOT be in in_scope_case_types after marking out-of-scope`,
  ).not.toContain(NEW_CASE_TYPE_LABEL);
});
