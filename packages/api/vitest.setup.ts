/**
 * Vitest setup file: load `.env.local` before any test imports `lib/auth.ts`
 * or `lib/db/index.ts` (both throw at import time if DATABASE_URL or
 * SESSION_SECRET are absent).
 *
 * Tests that mock auth/DB still need the env vars present so the import
 * graph doesn't throw before the mocks have a chance to take over.
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';

loadDotenv({ path: resolve(__dirname, '.env.local') });

// Defensive defaults so even tests that run without an .env.local don't
// break on import. The mocks in test files take over the actual values.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'a'.repeat(32);
}
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'mock-key';
}
