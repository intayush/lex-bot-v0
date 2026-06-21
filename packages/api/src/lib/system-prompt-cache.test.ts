/**
 * Tests for system-prompt-cache.ts (021-chat-api-latency T007).
 *
 * Covers every row in the contract's test surface:
 *   miss-then-hit, TTL expiry, explicit invalidation, account isolation,
 *   version isolation, preview isolation, LRU eviction at >256 entries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedStaticPrompt,
  invalidateSystemPromptCache,
  __resetSystemPromptCacheForTests,
} from './system-prompt-cache.js';

beforeEach(() => {
  __resetSystemPromptCacheForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const OPTS_A = { accountId: 'acct_a', configVersionId: 'v1', isPreview: false };
const OPTS_B = { accountId: 'acct_b', configVersionId: 'v1', isPreview: false };

describe('getCachedStaticPrompt — miss-then-hit', () => {
  it('calls produce on first miss, returns same value on second call', () => {
    const produce = vi.fn(() => 'static-prompt-content');

    const first = getCachedStaticPrompt({ ...OPTS_A, produce });
    const second = getCachedStaticPrompt({ ...OPTS_A, produce });

    expect(first).toBe('static-prompt-content');
    expect(second).toBe('static-prompt-content');
    expect(produce).toHaveBeenCalledOnce(); // cache hit on second call
  });
});

describe('getCachedStaticPrompt — TTL expiry', () => {
  it('triggers recompute after 60 s TTL', () => {
    const produce = vi.fn(() => 'prompt-v1');

    getCachedStaticPrompt({ ...OPTS_A, produce });
    expect(produce).toHaveBeenCalledOnce();

    // Advance just past the 60 s TTL.
    vi.advanceTimersByTime(60_001);

    getCachedStaticPrompt({ ...OPTS_A, produce });
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('does NOT recompute before TTL expires', () => {
    const produce = vi.fn(() => 'prompt-v1');

    getCachedStaticPrompt({ ...OPTS_A, produce });
    vi.advanceTimersByTime(59_999);
    getCachedStaticPrompt({ ...OPTS_A, produce });

    expect(produce).toHaveBeenCalledOnce();
  });
});

describe('invalidateSystemPromptCache', () => {
  it('drops all entries for the account after invalidation', () => {
    const produce = vi.fn(() => 'static-prompt');
    // Warm the cache for two different version IDs under the same account.
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: false, produce });
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v2', isPreview: true, produce });
    expect(produce).toHaveBeenCalledTimes(2);

    invalidateSystemPromptCache('acct_a');

    // Both entries dropped → produce called again for each.
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: false, produce });
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v2', isPreview: true, produce });
    expect(produce).toHaveBeenCalledTimes(4);
  });
});

describe('Account isolation', () => {
  it('acct_a entries are not visible with acct_b key', () => {
    const produceA = vi.fn(() => 'prompt-a');
    const produceB = vi.fn(() => 'prompt-b');

    const resultA = getCachedStaticPrompt({ ...OPTS_A, produce: produceA });
    const resultB = getCachedStaticPrompt({ ...OPTS_B, produce: produceB });

    expect(resultA).toBe('prompt-a');
    expect(resultB).toBe('prompt-b');
    expect(produceA).toHaveBeenCalledOnce();
    expect(produceB).toHaveBeenCalledOnce();

    // Invalidating acct_a must NOT affect acct_b's cache.
    invalidateSystemPromptCache('acct_a');
    const secondB = getCachedStaticPrompt({ ...OPTS_B, produce: produceB });
    expect(secondB).toBe('prompt-b');
    expect(produceB).toHaveBeenCalledOnce(); // still cached
  });
});

describe('Version isolation', () => {
  it('different configVersionIds produce separate cache entries', () => {
    const produce = vi.fn(() => 'prompt');

    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: false, produce });
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v2', isPreview: false, produce });

    // Two misses (different versions).
    expect(produce).toHaveBeenCalledTimes(2);

    // Each version hits its own entry on the second call.
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: false, produce });
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v2', isPreview: false, produce });
    expect(produce).toHaveBeenCalledTimes(2);
  });
});

describe('Preview isolation', () => {
  it('isPreview=true and isPreview=false produce separate cache entries', () => {
    const produce = vi.fn(() => 'prompt');

    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: false, produce });
    getCachedStaticPrompt({ accountId: 'acct_a', configVersionId: 'v1', isPreview: true, produce });

    expect(produce).toHaveBeenCalledTimes(2);
  });
});

describe('LRU eviction at >256 entries', () => {
  it('oldest entry is evicted when cache grows past 256', () => {
    // Fill exactly 256 entries: i=0 is added first (oldest), i=255 is newest.
    for (let i = 0; i < 256; i++) {
      const captured = i; // capture loop var
      getCachedStaticPrompt({
        accountId: 'acct_lru',
        configVersionId: `v${captured}`,
        isPreview: false,
        produce: () => `prompt-${captured}`,
      });
    }

    // Do NOT touch v0 again (that would move it to the tail and save it from eviction).
    // Adding the 257th entry (v256) should evict v0 (the Map's oldest = first inserted).
    getCachedStaticPrompt({
      accountId: 'acct_lru',
      configVersionId: 'v256',
      isPreview: false,
      produce: () => 'prompt-256',
    });

    // v0 was the oldest entry and should now be evicted; the next call must recompute.
    const afterEvict = vi.fn(() => 'prompt-0-after-evict');
    getCachedStaticPrompt({ accountId: 'acct_lru', configVersionId: 'v0', isPreview: false, produce: afterEvict });
    expect(afterEvict).toHaveBeenCalledOnce();
  });
});
