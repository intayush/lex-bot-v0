/**
 * Spec 016 US2 — Happy-path Playwright walk for the configured
 * Car Accident branch (T035 + T042).
 *
 * Walks Personal Injury → Car Accident through the new 6-step
 * default SOP, then through ALL 9 configured branch questions, and
 * asserts the captured lead row carries:
 *   - branch_snapshot_json populated (FR-018)
 *   - branch_incomplete=false (completed branch)
 *   - lead_score numeric (deterministic scorer)
 *   - classification ∈ {HOT, WARM, COLD, SPAM} consistent with score
 *   - score_reasons_json populated
 *
 * This replaces the spec 015 smoke walk by testing the same pair
 * end-to-end against the new branch model. The chip selections are
 * crafted to land in HOT band (score ≥ 76) under the seeded Self
 * threshold table. Tagged @walk so it only runs via `pnpm e2e:walk`.
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
  type SopStateHeaderPayload,
} from './fixtures';

test.describe.configure({ mode: 'serial' });

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

test('@walk SMOKE 016 — Personal Injury / Car Accident HOT walk produces branch-scored lead', async ({
  page,
}) => {
  test.setTimeout(420_000); // 7 minutes — 6-step SOP + 9 branch questions, real LLM

  await resetWidgetSession(page);

  const sopLog: SopStateHeaderPayload[] = [];
  await openWidget(page, sopLog);

  let sessionId: string | null = null;
  page.on('response', (res) => {
    if (!res.url().includes('/api/chat')) return;
    const sid = res.headers()['x-session-id'];
    if (sid && !sessionId) sessionId = sid;
  });

  // ---------------------------------------------------------------------------
  // Default 6-step SOP
  // ---------------------------------------------------------------------------

  // Turn 1: case_type → Personal Injury (forward-only detection for pending case_type step)
  await sendMessage(page, 'I had a car accident and need help');
  await waitForSopProgress(sopLog, 1, 'case_type ≥ 1');

  // Turn 2: sub_type → Car Accident
  await chipOrFreeText(page, 'Car Accident', 'It was a car accident');
  await waitForSopProgress(sopLog, 2, 'sub_type ≥ 2');

  // Turn 3: where
  await sendMessage(page, 'Pittsburgh, PA');
  await waitForSopProgress(sopLog, 3, 'where ≥ 3');

  // Turn 4: what
  await sendMessage(page, 'Other driver ran a red light and hit my car');
  await waitForSopProgress(sopLog, 4, 'what ≥ 4');

  // Turn 5: when → Today (chip)
  await chipOrFreeText(page, 'Today', 'Today');
  await waitForSopProgress(sopLog, 5, 'when ≥ 5');

  // Turn 6: contact form
  const contactForm = page.getByRole('form', { name: /contact/i });
  await contactForm.getByRole('textbox', { name: /name/i }).fill('Pat Driver');
  await contactForm.getByRole('textbox', { name: /email/i }).fill('pat.driver@example.com');
  await contactForm.getByRole('textbox', { name: /phone/i }).fill('+15551112222');
  await contactForm.getByRole('button', { name: /submit/i }).click();

  // Wait for SOP to finalize.
  await expect
    .poll(
      () => (sopLog.length === 0 ? false : sopLog[sopLog.length - 1].is_finalized),
      { timeout: 90_000 },
    )
    .toBe(true);

  // ---------------------------------------------------------------------------
  // Configured Car Accident branch — 9 questions
  // ---------------------------------------------------------------------------

  // Q1 (request_type): Myself  (weight 0)
  await chipOrFreeText(page, 'Myself', 'Myself');

  // Q2 (geographic_qualification): Yes  (weight 0)
  await chipOrFreeText(page, 'Yes', 'Yes');

  // Q3 (accident_timing): Today  (+20)
  await chipOrFreeText(page, 'Today', 'Today');

  // Q4 (injury): Yes  (+15)
  await chipOrFreeText(page, 'Yes', 'Yes I was injured');

  // Q5 (medical_treatment): Emergency Room Visit  (+15)
  await chipOrFreeText(page, 'Emergency Room Visit', 'Emergency Room');

  // Q6 (accident_role): Driver  (+5)
  await chipOrFreeText(page, 'Driver', 'I was the driver');

  // Q7 (insurance_activity): Requested Recorded Statement  (+15)
  await chipOrFreeText(
    page,
    'Requested Recorded Statement',
    'They asked for a recorded statement',
  );

  // Q8 (work_impact): Missed Work  (+10)
  await chipOrFreeText(page, 'Missed Work', 'I missed work');

  // Q9 (attorney_status): No  (+20)
  await chipOrFreeText(page, 'No', "No I don't have a lawyer");

  // Allow the LLM final turn + persistence.
  await page.waitForTimeout(8_000);

  // ---------------------------------------------------------------------------
  // DB assertions
  // ---------------------------------------------------------------------------

  const DATABASE_URL = process.env.DATABASE_URL;
  expect(DATABASE_URL, 'DATABASE_URL must be set').toBeTruthy();
  const sql = neon(DATABASE_URL!);

  let leadRow: Record<string, unknown> | undefined;
  if (sessionId) {
    const rows = (await sql`
      SELECT classification, lead_score, score_reasons_json,
             branch_incomplete, branch_snapshot_json,
             contact_email, contact_phone, name
      FROM leads
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    leadRow = rows[0];
  } else {
    const rows = (await sql`
      SELECT classification, lead_score, score_reasons_json,
             branch_incomplete, branch_snapshot_json,
             contact_email, contact_phone, name
      FROM leads
      ORDER BY created_at DESC
      LIMIT 1
    `) as Array<Record<string, unknown>>;
    leadRow = rows[0];
  }

  expect(leadRow, 'expected a captured lead row in the dev DB').toBeDefined();

  // Branch path assertions
  expect(leadRow!.branch_snapshot_json).not.toBeNull();
  expect(leadRow!.branch_incomplete).toBe(false);
  expect(typeof leadRow!.lead_score).toBe('number');
  expect(leadRow!.lead_score).toBeGreaterThanOrEqual(76); // HOT band
  expect(leadRow!.classification).toBe('HOT');

  const reasons = JSON.parse(leadRow!.score_reasons_json as string) as string[];
  expect(Array.isArray(reasons)).toBe(true);
  expect(reasons.length).toBeGreaterThan(0);

  // Snapshot integrity
  const snapshot = JSON.parse(leadRow!.branch_snapshot_json as string) as {
    branch_id: string;
    branch_version_id: string;
    case_type_slug: string;
    sub_type_slug: string;
    captured_chips: Array<{ question_id: string; chip_slugs: string[] }>;
    score: number;
    classification: string;
    branch_incomplete: boolean;
  };
  expect(snapshot.case_type_slug).toBe('personal_injury');
  expect(snapshot.sub_type_slug).toBe('car_accident');
  expect(snapshot.branch_incomplete).toBe(false);
  expect(snapshot.captured_chips.length).toBe(9);
  expect(snapshot.score).toBe(leadRow!.lead_score);

  console.log('Smoke-016 happy-path captured lead:', {
    classification: leadRow!.classification,
    lead_score: leadRow!.lead_score,
    reasons,
    captured_chips_count: snapshot.captured_chips.length,
    sessionId,
  });
});
