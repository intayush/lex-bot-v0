# Phase 1 — Data Model: Chat API Latency Reduction

**Feature**: 021-chat-api-latency · **Date**: 2026-06-21

## Persistent (database) entities

**None added, removed, or modified.** This feature is application-layer only (FR-015). The existing `sessions`, `leads`, `notifications`, `configurations`, `sop_configurations`, `sop_steps`, `case_types`, `sub_types`, `branches`, and `branch_versions` schemas are untouched.

## In-process (runtime) entities

Two new in-process entities are introduced. Both are private to `packages/api/src/lib/` and never leave the API server process.

### Entity 1 — `CachedStaticPromptEntry`

The memoized static portion of `composeSystemPrompt` for a single `(accountId, configVersionId, isPreview)` tuple.

**Shape**:

| Field | Type | Description |
|-------|------|-------------|
| `prefix` | `string` | The assembled static prompt prefix (persona, in-scope practice areas, boundaries, escalation, contact info, custom instructions, "Instructions for Using Context", "Lead Capture Instructions"). |
| `expiresAt` | `number` (epoch ms) | Absolute expiry time; entries past this point are evicted on read. |

**Storage**: `Map<string, CachedStaticPromptEntry>` keyed by `${accountId}:${configVersionId}:${isPreview ? 'p' : 'l'}`.

**Lifetime**:

- TTL: 60 seconds (matches `lib/config.ts` config cache TTL).
- Eviction: LRU at 256 entries; explicit on `invalidateSystemPromptCache(accountId)`; full clear on `__resetForTests()`.
- Cold-process behavior: empty `Map` at process start; warm-process behavior mirrors `lib/auth.ts` LRU.

**Validation rules**:

- `accountId` MUST be a non-empty string.
- `configVersionId` MUST be a stable per-(account, version) identifier. Use `configurations.id` (the row primary key); it is stable across publishes because publishing creates a new row.
- `isPreview` MUST be a boolean.
- `prefix` MUST be non-empty (if it would be empty the caller should not cache it; defensively, we don't cache empty strings).

**State transitions**:

```text
absent ── miss ──► insert ── 60s elapses ──► absent (TTL eviction on next read)
absent ── miss ──► insert ── publish event ──► absent (explicit invalidation)
absent ── miss ──► insert ── LRU pressure (>256) ──► absent (LRU eviction)
present ── hit ──► refreshed access order (still subject to TTL)
```

**Invalidation triggers**:

- `invalidateSystemPromptCache(accountId)` — wipes ALL entries for that `accountId`, regardless of version or preview/published variant. Called from every handler that mutates `configurations`.
- Process restart — empty `Map`; functionally equivalent to invalidation.
- TTL expiry — lazy, on next read.

**Privacy considerations** (Constitution V):

- The cached content is the same lawyer-configured data that `getPublishedConfig` already caches today. No new data category enters in-process state.
- The cache MUST NOT include the dynamic SOP block (which has PII-redacted captures) or the per-turn branch directive. Only the static persona/boundaries/contact prefix is cached.
- The key MUST be strictly per-account; cross-account bleed is a Constitution V violation.

---

### Entity 2 — `DeferredWriteBatch`

The collection of post-stream side effects enqueued via `after()` for asynchronous completion after the chat response stream closes.

**Conceptual contents** (per request):

1. `updateLeadSOPState(sessionId, sopState)` — backfill lead row with SOP snapshot + ISO incident date.
2. Branch-finalization UPDATE — when `branchFinalizationPayload != null`, write snapshot + score + classification + reasons.
3. `applyAndPersistHardOverrides({ accountId, leadId, sopState })` — downgrade-only safety net; only runs when the previous step wrote a branch row.
4. `savePartialLead(accountId, sessionId, partial, allMessages)` — abandoned-session recovery.

**Ordering invariants**:

- (1) → (2) → (3) MUST be sequential: each step operates on the same lead row, in some cases reading state the previous step wrote.
- (4) is independent of (1)-(3) and can run in parallel; today it already sits adjacent in the codebase. In the new flow it is awaited inside the deferred chain alongside the others to keep the chain a single `after()` enqueue.

**Lifetime**:

- Created at `onFinish` time inside `streamText`.
- Survives until the platform's `after()` callback resolves (subject to function-lifetime limits).
- Errors are captured by `runAfterResponse`'s `.catch(log)`.

**Critical-path vs deferred split**:

| Operation | Path | Reason |
|-----------|------|--------|
| `appendMessagesAndSOPState(sessionId, history, [newUserMessage, assistantText], sopState)` | **Critical (awaited)** | Next chat turn loads this row; must be durable before `done`. |
| `updateLeadSOPState` | Deferred | Read only by dashboard; eventual consistency is fine. |
| Branch finalization UPDATE | Deferred | Same — read only by dashboard / analytics. |
| `applyAndPersistHardOverrides` | Deferred | Downgrade-only safety; visitor never sees the result. |
| `savePartialLead` | Deferred | Abandoned-session recovery; runs only when no full lead exists. |
| `notifications` INSERT (HOT lead) | Deferred (rides with `updateLeadSOPState` chain via `captureLead`'s own internal write — already lives in the leads chain) | Latency-sensitive only for dashboard polling, not for the visitor. |

**Validation rules** (enforced by the helper):

- `runAfterResponse` MUST attach a `.catch` handler that logs to the structured logger with the session id, account id, and error details (no PII or stack traces beyond `Error.name: Error.message`).
- If `after()` is unavailable (test/dev environments), `runAfterResponse` MUST fall back to awaiting inline.

---

## Relationships

```text
ChatRequest
  ├── reads CachedStaticPromptEntry  ── (key: accountId, configVersionId, isPreview)
  │     └── miss ──► writes CachedStaticPromptEntry
  └── enqueues DeferredWriteBatch (one per request, after onFinish fires)
```

The two new entities are independent of each other.

---

## Non-entities (explicitly out of model)

To document what we are NOT doing:

- **No new database table**, view, or migration.
- **No new Drizzle schema** field.
- **No new Zod schema** at any cross-boundary surface (the cache is in-process, the deferred batch is in-process).
- **No change to the `Configuration`, `SOPConfiguration`, `Lead`, `Session`, or any other shared type** in `packages/shared`.
