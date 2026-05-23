import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for end-to-end tests in packages/api.
 *
 * Specs live under `tests/e2e/`. The standard run is headless; pass
 * `--headed --project=walk` (or use `pnpm e2e:walk`) to run the
 * single-window slow-mo "walkthrough" project that's optimized for
 * eyes-on verification of multiple use cases in one session.
 *
 * The webServer block boots the existing `pnpm dev` (Next.js dev
 * server on :3000) before tests run; Playwright reuses an already-
 * running server when `reuseExistingServer=true`, which is what we
 * want during local dev (faster feedback, lets `pnpm dev` stay
 * warm in another terminal).
 *
 * The dev server reads packages/api/.env.local for the live Neon
 * dev DB URL, the Gemini API key, and the iron-session secret.
 * Tests therefore run against the real Neon dev DB and clean up
 * after themselves — see the "Cleanup" steps in each spec.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Specs share Neon dev DB; serialize to keep state predictable.
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/api/config',
    reuseExistingServer: true,
    timeout: 60_000,
    // The dev server expects the request to be authorized; /api/config
    // returns 401 without an x-api-key header, but Playwright accepts
    // any HTTP response (incl. 401) as "server is up".
    ignoreHTTPSErrors: true,
  },

  projects: [
    // Default headless run — one project, one browser. CI-friendly.
    // The "walk" project is opt-in via `pnpm e2e:walk` (which passes
    // --project=walk on the CLI), so by default `pnpm e2e` runs each
    // spec exactly once in the chromium project below.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    // "Walk" project: headed, slow, single window. Opt-in only via
    //   pnpm e2e:walk
    // (which also greps for @walk so only specs marked for the
    // walkthrough are picked up).
    {
      name: 'walk',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        headless: false,
        launchOptions: { slowMo: 350 },
      },
    },
  ],
});
