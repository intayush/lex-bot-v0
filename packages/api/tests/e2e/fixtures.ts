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
  qualified_lead_threshold: 6,
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
      chip_source: null,
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'what',
      position: 4,
      question_text: 'Can you briefly tell us what happened?',
      chip_source: null,
      inline_chips_json: null,
      accepts_free_text: true,
      is_required: true,
      counts_toward_threshold: true,
    },
    {
      slug: 'when',
      position: 5,
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
      position: 6,
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
 * the dev account ends back at "6 steps, threshold 6, published".
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
