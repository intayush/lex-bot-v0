import { checkRateLimit } from './rate-limit.js';

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------
// NOTE: The rate limiter uses a module-level Map, so tests share state.
// Each test uses a unique key to avoid interference.
// ---------------------------------------------------------------------------
describe('checkRateLimit', () => {
  it('first request is allowed with remaining = 19', () => {
    const result = checkRateLimit('test-first-request');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
  });

  it('subsequent requests decrement remaining count', () => {
    const key = 'test-decrement';
    const r1 = checkRateLimit(key);
    expect(r1.remaining).toBe(19);

    const r2 = checkRateLimit(key);
    expect(r2.remaining).toBe(18);

    const r3 = checkRateLimit(key);
    expect(r3.remaining).toBe(17);
  });

  it('after 20 requests, request is denied (allowed: false)', () => {
    const key = 'test-denied-after-20';

    for (let i = 0; i < 20; i++) {
      const result = checkRateLimit(key);
      expect(result.allowed).toBe(true);
    }

    const result = checkRateLimit(key);
    expect(result.allowed).toBe(false);
  });

  it('21st request returns allowed: false, remaining: 0', () => {
    const key = 'test-21st-request';

    for (let i = 0; i < 20; i++) {
      checkRateLimit(key);
    }

    const result = checkRateLimit(key);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('different keys have independent limits', () => {
    const keyA = 'test-independent-a';
    const keyB = 'test-independent-b';

    // Exhaust key A
    for (let i = 0; i < 20; i++) {
      checkRateLimit(keyA);
    }

    // Key B should still be allowed
    const resultB = checkRateLimit(keyB);
    expect(resultB.allowed).toBe(true);
    expect(resultB.remaining).toBe(19);

    // Key A should be denied
    const resultA = checkRateLimit(keyA);
    expect(resultA.allowed).toBe(false);
    expect(resultA.remaining).toBe(0);
  });

  it('resetIn returns a positive number', () => {
    const result = checkRateLimit('test-reset-in-positive');
    expect(result.resetIn).toBeGreaterThan(0);
  });
});
