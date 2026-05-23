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
  // SEQUENTIAL execution is intentional, not a perf tradeoff:
  //   - Specs share the Neon dev DB; parallel runs would race on
  //     sop_configurations writes.
  //   - For headed `pnpm e2e:walk`, parallel workers would open
  //     multiple Chromium windows that overlap on screen, defeating
  //     the eyes-on multi-use-case visualization. One window,
  //     specs running in order, is the explicit goal.
  fullyParallel: false,
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

  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000/api/config',
      reuseExistingServer: true,
      timeout: 60_000,
      // /api/config returns 401 without an x-api-key header, but Playwright
      // accepts any HTTP response (incl. 401) as "server is up".
      ignoreHTTPSErrors: true,
    },
    {
      // Widget dev server on :5173. Used by the LLM-driven walk specs
      // (US1 happy path / US2 skip detection / US3 off-SOP detour /
      // US5 no-goodbye) which navigate to the test-site host page and
      // drive the embedded <ChatWidget>. Reused if already running.
      command: 'pnpm --filter @legal-chatbot/widget dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: '../..',
    },
  ],

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
