/**
 * Tests for run-after-response.ts (021-chat-api-latency T005).
 *
 * All tests use the inline fallback path (no Next.js server context),
 * which is identical to what Vitest observes.
 */
import { describe, it, expect, vi } from 'vitest';
import { runAfterResponse } from './run-after-response.js';

describe('runAfterResponse — inline fallback (no Next.js context)', () => {
  it('(a) inline fallback awaits fn and observes completion', async () => {
    let completed = false;
    const result = runAfterResponse(
      async () => {
        await Promise.resolve();
        completed = true;
      },
      () => {},
    );
    // fallback returns a Promise
    await result;
    expect(completed).toBe(true);
  });

  it('(b) onError is invoked when fn rejects and no rejection bubbles to the caller', async () => {
    const onError = vi.fn();
    const err = new Error('boom');

    let threw = false;
    try {
      await runAfterResponse(async () => {
        throw err;
      }, onError);
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('(c) calling twice for the same request enqueues both callbacks independently', async () => {
    const calls: number[] = [];

    const p1 = runAfterResponse(async () => { calls.push(1); }, () => {});
    const p2 = runAfterResponse(async () => { calls.push(2); }, () => {});

    await Promise.all([p1, p2]);

    expect(calls).toContain(1);
    expect(calls).toContain(2);
    expect(calls).toHaveLength(2);
  });
});
