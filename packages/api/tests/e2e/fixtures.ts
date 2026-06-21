/**
 * Shared fixtures for the API package's E2E tests.
 *
 * - `loginAsDev(page)` — logs in via /api/auth/login using the seeded dev
 *   account (dev@legalchatbot.com / password123) and returns once the
 *   session cookie is set. Subsequent navigations to /dashboard/* are
 *   already authenticated.
 *
 * - `getCurrentSop()` / `publicConfig()` — small Neon-dev-DB inspection
 *   helpers that go through the existing API rather than touching the DB
 *   directly. Keeps the tests honest: they observe what a real client
 *   would observe.
 *
 * - `restoreDefaultSop()` — best-effort cleanup that publishes a fresh
 *   default 6-step SOP. Used by `test.afterAll` so a failing spec
 *   doesn't leave the dev DB in a degraded state.
 */
import type { APIRequestContext, Page } from '@playwright/test';

export const DEV_EMAIL = 'dev@legalchatbot.com';
export const DEV_PASSWORD = 'password123';
export const DEV_API_KEY = 'dev_test_key';

export async function loginAsDev(page: Page): Promise<void> {
  const res = await page.request.post('/api/auth/login', {
    data: { email: DEV_EMAIL, password: DEV_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`);
  }
}

export interface SopHistoryRow {
  id: string;
  version: number;
  is_published: boolean;
  created_at: string;
}

export interface CurrentSop {
  current_published: {
    id: string;
    version: number;
    qualified_lead_threshold: number;
    is_published: boolean;
    steps: Array<{ slug: string; position: number; chip_source: string | null }>;
  } | null;
  history: SopHistoryRow[];
}

/**
 * Fetch with a small retry loop. Next.js dev server occasionally returns
 * a 500 mid-HMR-recompile (e.g., "SyntaxError: Unexpected end of JSON
 * input" inside a route module that's about to be replaced). Tests
 * shouldn't fail for that — retry once after a short delay before
 * giving up.
 */
async function fetchWithRetry(
  request: APIRequestContext,
  url: string,
  attempts = 3,
): Promise<import('@playwright/test').APIResponse> {
  let lastRes: import('@playwright/test').APIResponse | null = null;
  for (let i = 0; i < attempts; i += 1) {
    lastRes = await request.get(url);
    if (lastRes.ok()) return lastRes;
    if (lastRes.status() < 500) return lastRes; // 4xx is a real error, don't retry.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return lastRes!;
}

export async function getCurrentSop(request: APIRequestContext): Promise<CurrentSop> {
  const res = await fetchWithRetry(request, '/api/dashboard/sop');
  if (!res.ok()) throw new Error(`GET /api/dashboard/sop failed: ${res.status()}`);
  return res.json();
}

export interface PublicConfig {
  sop: {
    version: number;
    qualified_lead_threshold: number;
    steps: Array<{ slug: string; position: number }>;
  } | null;
  /** 019-remove-practice-areas: in-scope case type labels for the widget. */
  in_scope_case_types?: string[];
}

export async function publicConfig(request: APIRequestContext): Promise<PublicConfig> {
  const res = await request.get('/api/config', { headers: { 'x-api-key': DEV_API_KEY } });
  if (!res.ok()) throw new Error(`GET /api/config failed: ${res.status()}`);
  return res.json();
}

/**
 * Default 6-step SOP body — kept here so cleanup is self-contained and
 * matches what `pnpm db:seed` produces. Including the bonus `contact_form`
 * step from 010-sop-workflow's enhancement.
 */
export const DEFAULT_SIX_STEP_SOP = {
  action: 'save' as const,
  qualified_lead_threshold: 5,
  steps: [
    {
      slug: 'case_type',
      position: 1,
      question_text: 'What kind of legal matter can we help you with?',
      chip_source: 'case_types',
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'sub_type',
      position: 2,
      question_text: 'What kind of {case_type} matter is this?',
      chip_source: 'sub_types',
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'where',
      position: 3,
      question_text: 'Where did this happen?',
      chip_source: 'inline',
      inline_chips_json: JSON.stringify([
        { label: 'In Pittsburgh', slug: 'in_pittsburgh' },
        { label: 'Outside Pittsburgh', slug: 'outside_pittsburgh' },
      ]),
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'when',
      position: 4,
      question_text: 'When did this happen?',
      chip_source: 'inline',
      inline_chips_json: JSON.stringify([
        { label: 'Today', slug: 'today' },
        { label: 'Yesterday', slug: 'yesterday' },
        { label: 'This week', slug: 'this_week' },
        { label: 'Last week', slug: 'last_week' },
        { label: 'This month', slug: 'this_month' },
        { label: 'Earlier this year', slug: 'earlier_this_year' },
        { label: 'Longer ago', slug: 'longer_ago' },
      ]),
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'contact',
      position: 5,
      question_text: "What's your name and how can we reach you?",
      chip_source: 'contact_form',
      inline_chips_json: null,
      accepts_free_text: false,
      is_required: true,
      counts_toward_threshold: true,
    },
  ],
};

/**
 * Best-effort cleanup. Saves a fresh default SOP and publishes it so
 * the dev account ends back at "5 steps, threshold 5, published".
 * Called from `test.afterAll`.
 */
export async function restoreDefaultSop(request: APIRequestContext): Promise<void> {
  const save = await request.post('/api/dashboard/sop', { data: DEFAULT_SIX_STEP_SOP });
  if (!save.ok()) {
    throw new Error(`restoreDefaultSop save failed: ${save.status()} ${await save.text()}`);
  }
  const pub = await request.post('/api/dashboard/sop', { data: { action: 'publish' } });
  if (!pub.ok()) {
    throw new Error(`restoreDefaultSop publish failed: ${pub.status()} ${await pub.text()}`);
  }
}

// ---------------------------------------------------------------------------
// Widget helpers (used by US1-US5 walk specs)
// ---------------------------------------------------------------------------

import type { Locator, Response as PlaywrightResponse } from '@playwright/test';
import { expect } from '@playwright/test';

export const WIDGET_URL = process.env.E2E_WIDGET_URL ?? 'http://localhost:5173';

export interface SopStateHeaderPayload {
  current: number;
  total: number;
  pending_step_id: string | null;
  pending_step_slug: string | null;
  is_finalized: boolean;
  captured_case_type_slug?: string | null;
}

/**
 * Open the widget test site and click the chat bubble open. Waits for the
 * input to be ready (proves the panel mounted and useChat initialized).
 *
 * Also installs a response listener that captures the `x-sop-state` header
 * from every `/api/chat` response and pushes the parsed payload onto a
 * caller-supplied array — handy for assertion ordering.
 */
export async function openWidget(
  page: import('@playwright/test').Page,
  sopStateLog?: SopStateHeaderPayload[],
) {
  if (sopStateLog) {
    page.on('response', (res: PlaywrightResponse) => {
      if (!res.url().includes('/api/chat')) return;
      const headerValue = res.headers()['x-sop-state'];
      if (!headerValue) return;
      try {
        sopStateLog.push(JSON.parse(headerValue));
      } catch {
        // Header was missing or malformed; ignore for the spec's purposes.
      }
    });
  }

  await page.goto(WIDGET_URL, { waitUntil: 'commit' });

  // Open the bubble.
  const bubble = page.getByRole('button', { name: 'Open chat' });
  await expect(bubble).toBeVisible({ timeout: 15_000 });
  await bubble.click();

  // Wait for the input to be ready.
  const input = page.getByPlaceholder('Type your message...');
  await expect(input).toBeVisible({ timeout: 10_000 });

  return { input, page };
}

/**
 * Type a message and click Send. Returns the response promise that resolves
 * when /api/chat finishes — useful so callers can await the SOP state
 * snapshot for that turn.
 */
export async function sendMessage(
  page: import('@playwright/test').Page,
  text: string,
): Promise<PlaywrightResponse> {
  const input = page.getByPlaceholder('Type your message...');
  await input.fill(text);

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );

  // Click Send. The button is identified by aria-label='Send message'.
  await page.getByRole('button', { name: 'Send message' }).click();
  return responsePromise;
}

/**
 * Click a chip with the given label (case-insensitive substring match
 * against `aria-label`, so 'DUI' matches the chip with that label exactly).
 * Returns the /api/chat response promise — chip click dispatches the
 * label as a user message via useChat.
 */
export async function clickChip(
  page: import('@playwright/test').Page,
  label: string,
): Promise<PlaywrightResponse> {
  // The widget renders inline chips with aria-label="Choose an option"
  // (see packages/widget/src/components/ChatPanel.tsx). Older specs used
  // the "Quick reply options" default — left as a fallback in case any
  // other surface still uses it.
  const chipPrimary = page.locator(
    `[role='group'][aria-label='Choose an option'] button`,
    { hasText: label },
  ).first();
  const chipFallback = page.locator(
    `[role='group'][aria-label='Quick reply options'] button`,
    { hasText: label },
  ).first();

  // Prefer the primary; race the fallback as a defensive layer for old
  // spec compatibility.
  const chip = chipPrimary.or(chipFallback).first();
  await expect(chip, `chip "${label}" should be visible`).toBeVisible({ timeout: 10_000 });

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat') && res.request().method() === 'POST',
    { timeout: 60_000 },
  );
  await chip.click();
  return responsePromise;
}

/**
 * Wait for the typing indicator to disappear, signalling the agent
 * finished streaming its response.
 */
export async function waitForAgentResponse(page: import('@playwright/test').Page) {
  const typing = page.locator('.lc-typing');
  // The typing indicator shows up when the agent is mid-stream. Wait for
  // it to disappear (response complete). It may not appear at all if the
  // server responded faster than React rendered, so use a permissive
  // assertion: not visible within the timeout (which is true if it
  // appeared and then disappeared, or never appeared).
  await expect(typing).not.toBeVisible({ timeout: 60_000 });
}

/**
 * Read the most recent SOP state payload from the response listener log.
 * Throws if the log is empty.
 */
export function lastSopState(log: SopStateHeaderPayload[]): SopStateHeaderPayload {
  const last = log[log.length - 1];
  if (!last) throw new Error('SOP state log is empty');
  return last;
}

/**
 * Read the current progress-bar value from the rendered widget.
 * Returns { current, total } from the `aria-valuenow` / `aria-valuemax`
 * attributes. Returns null if the bar isn't rendered (no SOP threshold).
 */
export async function readProgressBar(
  page: import('@playwright/test').Page,
): Promise<{ current: number; total: number } | null> {
  const bar = page.locator("[role='progressbar']");
  if ((await bar.count()) === 0) return null;
  const valuenow = await bar.first().getAttribute('aria-valuenow');
  const valuemax = await bar.first().getAttribute('aria-valuemax');
  if (valuenow === null || valuemax === null) return null;
  return { current: Number(valuenow), total: Number(valuemax) };
}

/**
 * Force-clear the widget's sessionStorage so each spec starts a fresh
 * conversation. Without this, the widget would resume the previous
 * spec's session.
 */
export async function resetWidgetSession(page: import('@playwright/test').Page) {
  await page.context().clearCookies();
  // Best-effort: only valid after a navigation has happened.
  try {
    await page.evaluate(() => sessionStorage.clear());
  } catch {
    // Page might not have any document yet (pre-navigation). Safe to ignore.
  }
}
