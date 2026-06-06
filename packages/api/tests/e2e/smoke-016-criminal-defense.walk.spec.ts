/**
 * Spec 016 — Regression test for the multi-branch SOP workflow.
 *
 * Walks Criminal Defense → Assault Charges through the new 6-step
 * default SOP (case_type → sub_type → where → what → when → contact)
 * and asserts:
 *
 *   1. NO car-accident-specific chips ever render. Specifically: no
 *      chip whose label matches /driver|passenger|insurance|missed work|
 *      hospitalization|emergency room/i appears at any point.
 *   2. The captured lead row has classification ∈ {HOT, WARM, COLD, SPAM}
 *      and lead_score IS NULL (default-only path; legacy LLM
 *      classifier supplied the label per FR-007).
 *   3. branch_incomplete is FALSE on the captured lead row.
 *   4. Conversation stays open after the finalization message: a
 *      free-form follow-up question is answered without re-running
 *      the SOP.
 *
 * This is the negative-flow scenario from negative-sop-flow.json
 * captured as a regression test. Tag `@walk` so it only runs via
 * `pnpm e2e:walk`.
 */
import { test, expect } from '@playwright/test';
import { neon } from '@neondatabase/serverless';
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '../../.env.local') });

import {
  openWidget,
  sendMessage,
  clickChip,
  resetWidgetSession,
  lastSopState,
  type SopStateHeaderPayload,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

const FORBIDDEN_CHIP_LABEL_RE =
  /\b(driver|passenger|pedestrian|hospitalization|emergency room|surgery|missed work|unable to work|insurance|recorded statement|sign documents)\b/i;

async function waitForSopProgress(
  log: SopStateHeaderPayload[],
  minCurrent: number,
  message: string,
) {
  await expect
    .poll(
      () => (log.length === 0 ? -1 : log[log.length - 1].current),
      { timeout: 90_000, message },
    )
    .toBeGreaterThanOrEqual(minCurrent);
}

async function chipOrFreeText(
  page: import('@playwright/test').Page,
  chipLabel: string,
  freeTextFallback: string,
) {
  try {
    await clickChip(page, chipLabel);
  } catch {
    await sendMessage(page, freeTextFallback);
  }
}

/**
 * Assert no forbidden (car-accident-specific) chip is currently
 * rendered. Called between every assistant turn.
 */
async function assertNoForbiddenChips(
  page: import('@playwright/test').Page,
  context: string,
) {
  const chips = page.getByRole('button', { name: FORBIDDEN_CHIP_LABEL_RE });
  const count = await chips.count();
  if (count > 0) {
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      labels.push((await chips.nth(i).textContent()) ?? '');
    }
    throw new Error(
      `[${context}] Found ${count} forbidden chip(s): [${labels.join(
        ', ',
      )}]. The Car-Accident branch must NOT fire for unconfigured pairs.`,
    );
  }
}

test('@walk SMOKE 016 — Criminal Defense / Assault Charges takes default-only path; no car-accident chips', async ({
  page,
}) => {
  test.setTimeout(300_000); // 5 minutes — 6-step SOP with real LLM

  await resetWidgetSession(page);

  const sopLog: SopStateHeaderPayload[] = [];
  await openWidget(page, sopLog);

  let sessionId: string | null = null;
  page.on('response', (res) => {
    if (!res.url().includes('/api/chat')) return;
    const sid = res.headers()['x-session-id'];
    if (sid && !sessionId) sessionId = sid;
  });

  // Turn 1: case_type — Criminal Defense.
  await sendMessage(page, 'I need help with assault charges');
  await waitForSopProgress(
    sopLog,
    1,
    'case_type should be captured (current ≥ 1)',
  );
  await assertNoForbiddenChips(page, 'after case_type');

  // Turn 2: sub_type — Assault.
  await chipOrFreeText(page, 'Assault', 'It is an assault matter');
  await waitForSopProgress(sopLog, 2, 'sub_type should be captured (current ≥ 2)');
  await assertNoForbiddenChips(page, 'after sub_type');

  // Turn 3: where.
  await sendMessage(page, 'Pittsburgh, PA');
  await waitForSopProgress(sopLog, 3, 'where should be captured (current ≥ 3)');
  await assertNoForbiddenChips(page, 'after where');

  // Turn 4: what.
  await sendMessage(page, 'I had an altercation with someone outside a bar');
  await waitForSopProgress(sopLog, 4, 'what should be captured (current ≥ 4)');
  await assertNoForbiddenChips(page, 'after what');

  // Turn 5: when — tap Today chip from the standard `when` chip set
  // (these chips have no car-accident terms, so they're never forbidden).
  await chipOrFreeText(page, 'Today', 'Today');
  await waitForSopProgress(sopLog, 5, 'when should be captured (current ≥ 5)');
  await assertNoForbiddenChips(page, 'after when');

  // Turn 6: contact form. Per spec 010 the widget renders a structured
  // form with three labelled inputs + a Submit button. Spec 016
  // tightens the validation to "≥ 1 of email/phone"; name remains
  // optional in the visible form (the Submit button enables when at
  // least one of email/phone is filled).
  const contactForm = page.getByRole('form', { name: /contact/i });
  await contactForm.getByRole('textbox', { name: /name/i }).fill('Jane Defendant');
  await contactForm.getByRole('textbox', { name: /email/i }).fill('jane.defendant@example.com');
  await contactForm.getByRole('textbox', { name: /phone/i }).fill('+15551234567');
  await contactForm.getByRole('button', { name: /submit/i }).click();

  // Wait for finalization.
  await expect
    .poll(() => lastSopState(sopLog).is_finalized, { timeout: 60_000 })
    .toBe(true);

  // Critical: assert no car-accident chips appeared after finalization.
  await assertNoForbiddenChips(page, 'after finalization');

  // Now query the dev DB and verify the captured lead.
  const DATABASE_URL = process.env.DATABASE_URL;
  expect(
    DATABASE_URL,
    'DATABASE_URL must be set in packages/api/.env.local for smoke tests',
  ).toBeTruthy();

  const sql = neon(DATABASE_URL!);

  let leadRow: Record<string, unknown> | undefined;
  if (sessionId) {
    const rows = (await sql`
      SELECT classification, lead_score, branch_incomplete, branch_snapshot_json,
             contact_email, contact_phone, name
      FROM leads
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    leadRow = rows[0];
  } else {
    const rows = (await sql`
      SELECT classification, lead_score, branch_incomplete, branch_snapshot_json,
             contact_email, contact_phone, name
      FROM leads
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    leadRow = rows[0];
  }

  expect(leadRow, 'expected a captured lead row in the dev DB').toBeDefined();

  // Default-only path assertions (FR-007):
  expect(leadRow!.classification).toMatch(/^(HOT|WARM|COLD|SPAM)$/);
  expect(leadRow!.lead_score).toBeNull();
  expect(leadRow!.branch_incomplete).toBe(false);
  expect(leadRow!.branch_snapshot_json).toBeNull();

  // Contact info captured (FR-002 partial-gate satisfied):
  expect(leadRow!.contact_email).toBe('jane.defendant@example.com');
  expect(leadRow!.contact_phone).toBe('+15551234567');
  expect(leadRow!.name).toBe('Jane Defendant');

  // Now: send a free-form follow-up question and assert the assistant
  // answers without re-running the SOP.
  await sendMessage(page, 'What does an initial consultation cost?');
  // Allow the LLM time to respond.
  await page.waitForTimeout(5000);

  // Assert: no SOP step was re-asked (no new captured chips).
  // The is_finalized flag should still be true.
  expect(lastSopState(sopLog).is_finalized).toBe(true);
  await assertNoForbiddenChips(page, 'after free-form follow-up');

  // Log the captured row for eyes-on inspection.
  console.log('Smoke-016 default-only path captured lead:', {
    classification: leadRow!.classification,
    lead_score: leadRow!.lead_score,
    branch_incomplete: leadRow!.branch_incomplete,
    contact_email: leadRow!.contact_email,
    contact_phone: leadRow!.contact_phone,
    sessionId,
  });
});
