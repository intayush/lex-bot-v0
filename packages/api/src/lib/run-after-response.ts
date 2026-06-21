/**
 * Defer a side-effect until after the HTTP response is flushed (021-chat-api-latency).
 *
 * When Next.js `after` is available (Next.js 15+), the callback is enqueued
 * via `after()` so it runs outside the response-time window. When running
 * outside a Next.js request context (Vitest, scripts, older runtimes) we fall
 * back to an inline `await fn().catch(onError)` so the behaviour is still
 * observable in tests.
 *
 * @param fn      Async side-effect to run.
 * @param onError Called when `fn` rejects; must never re-throw.
 */
export function runAfterResponse(
  fn: () => Promise<void>,
  onError: (err: unknown) => void,
): void | Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const next = require('next/server') as { after?: unknown };
    if (typeof next.after === 'function') {
      next.after(() => fn().catch(onError));
      return;
    }
  } catch {
    // next/server unavailable (Vitest, Node scripts, etc.)
  }
  return fn().catch(onError);
}
