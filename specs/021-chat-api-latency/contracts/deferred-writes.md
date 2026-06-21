# Contract: Deferred Post-Stream Writes

**Feature**: 021-chat-api-latency · **Files**: `packages/api/src/app/api/chat/route.ts`, new helper `packages/api/src/lib/run-after-response.ts`

## Purpose

Move the leads-side post-stream write chain off the critical path of `streamText`'s `onFinish`, so the assistant's `done` event fires ~200ms sooner. Use Next.js 15's `after()` to keep the worker alive until deferred writes complete.

## Public API (helper)

```ts
// packages/api/src/lib/run-after-response.ts

/**
 * Enqueue `fn` to run after the current response has been sent. Errors
 * thrown by `fn` are routed to `onError` and never re-thrown.
 *
 * Uses Next.js 15's `after()` from 'next/server' when available.
 * Falls back to inline `await` in environments where `after()` is not
 * available (Vitest test runner, certain dev contexts).
 */
export function runAfterResponse(
  fn: () => Promise<void>,
  onError: (err: unknown) => void,
): void | Promise<void>;
```

## Implementation contract

- Import `after` from `next/server`. If `typeof after === 'function'`, call `after(() => fn().catch(onError))`.
- If `after` is unavailable (test/dev), return `fn().catch(onError)` synchronously so callers awaiting in test setups still observe completion.
- The helper MUST NEVER re-throw; the caller cannot recover from a deferred-write failure.

## What goes inside `runAfterResponse` vs outside

**Inside (deferred)**:

1. `await updateLeadSOPState(sessionId, sopState)`
2. When `branchFinalizationPayload != null`:
   - `db.update(schema.leads).set({...branch_snapshot...}).where(eq(leads.session_id, sessionId)).returning({ id })`
   - `applyAndPersistHardOverrides({ accountId, leadId, sopState })`
3. `const partial = extractPartialLeadData(allMessages); await savePartialLead(accountId, sessionId, partial, allMessages)`

**Outside (critical path, awaited inside `onFinish`)**:

1. `appendMessagesAndSOPState(sessionId, history, newMessages, sopState)` — next chat turn loads this row; it MUST be durable before `done` fires.

## Ordering invariants

- Inside the deferred callback, the three steps MUST be sequential (1 → 2 → 3). Steps 1 and 2 touch the same `leads` row; step 2 reads what step 1 may have written. Step 3 (partial-lead) bails early if a full lead exists, so it MUST run after step 2 to see the updated row.
- The critical-path session write MUST complete before the response closes; this is automatic because it's `await`'d inside `onFinish`, and the AI SDK awaits `onFinish` before flushing the final stream chunk.

## Error contract (FR-007)

The `onError` callback passed to `runAfterResponse` MUST:

- Log to the structured logger with at minimum: `{ sessionId, accountId, eventName: 'chat.deferred_writes_failed', error: { name, message } }`.
- NOT include API keys, full PII, or stack traces beyond `Error.name: Error.message` (Constitution V).
- Use the `console.error` channel that the existing chat-route error handler uses (`route.ts:459`), so observability is consistent.

## Observability invariants

- Every structured-log event emitted today from the post-stream chain (e.g., `emitLeadClassifiedLog` from inside `updateLeadSOPState` / `captureLead`) continues to be emitted. The lifecycle timing changes (events fire after `done` instead of before); the content and queryability by session id are unchanged.
- The `urgent_lead` notification INSERT inside `captureLead` continues to run. Today the dashboard's notification poll picks it up after the chat-API request completes; that remains true after the change — the only difference is the dashboard may see the notification ~50ms later.

## Platform behavior

- **Netlify Next.js Runtime (production)**: `after()` keeps the function alive until enqueued work completes, subject to the platform's hard function timeout (default 26s on Netlify Functions; deferred chain typically completes in <100ms).
- **Vitest (tests)**: `after()` is not part of the test runtime; the helper falls back to inline `await`. Test assertions on DB state continue to work because the helper awaits before returning.
- **`pnpm dev` local Next.js**: `after()` is available; deferred writes complete in development just as in production.

## Forbidden behaviors

- MUST NOT use `void promise.catch(log)` without `after()`. Worker suspension on serverless drops the work.
- MUST NOT use `setImmediate`, `setTimeout(..., 0)`, or `process.nextTick` to defer work. These are killed when the function suspends.
- MUST NOT split the deferred chain across multiple `after()` calls; one call per request keeps observability and error attribution simple.

## Test surface

| Test | Behavior |
|------|----------|
| Inline fallback under Vitest | Calling `runAfterResponse(fn, onError)` resolves `fn`'s promise before the helper returns; observable in test by awaiting. |
| Error logged on rejection | A deferred `fn` that rejects causes `onError` to be invoked with the rejection reason; no rejection bubbles to the caller. |
| Critical-path write durable at `done` | After the chat route's `onFinish` resolves, the session row's `messages_json` contains the new messages. |
| Deferred writes complete after `done` | After awaiting `runAfterResponse`'s fallback in a Vitest test, the leads row reflects the deferred writes. |
| Notification firing preserved | A HOT-classified turn still produces an `urgent_lead` notification row by the time the deferred chain completes. |
