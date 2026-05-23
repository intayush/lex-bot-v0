import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Load .env.local before tests run. Several lib files (db/index.ts,
    // auth.ts) read DATABASE_URL / SESSION_SECRET / GOOGLE_GENERATIVE_AI_API_KEY
    // at import time and throw if absent, so loading the env BEFORE any
    // test imports them is required even when the tests stub those modules.
    setupFiles: ['./vitest.setup.ts'],
  },
});
