# Contract: Session Message Append (Chat Route)

**Feature**: 021-chat-api-latency · **File**: `packages/api/src/lib/session.ts`

## Goal

Eliminate the duplicate `SELECT messages_json` round trip inside `appendMessagesAndSOPState` by accepting the in-memory history from the caller. The chat route already loaded the session row at the top of the turn (`route.ts:106`); reading it again before the UPDATE is wasted work.

## API change

### Today

```ts
export async function appendMessagesAndSOPState(
  sessionId: string,
  messages: Message[],     // new messages to append
  sopState: SOPState | null,
): Promise<void>;

// Internal: SELECT messages_json, JSON.parse, concat, UPDATE
```

### After

```ts
export async function appendMessagesAndSOPState(
  sessionId: string,
  existingHistory: Message[],  // <-- NEW: caller-supplied history, MAY be empty
  newMessages: Message[],
  sopState: SOPState | null,
): Promise<void>;

// Internal: concat existingHistory + newMessages, UPDATE — no SELECT
```

## Migration

- The chat route is the only caller of `appendMessagesAndSOPState`. Its single call site is updated to pass `history` (already in scope at the relevant lexical position).
- `appendMessages` (the non-chat helper used by the contact-form path and others) keeps the SELECT-then-write pattern. No migration of other callers.

## Behavior contract

- The UPDATE statement is unchanged in shape (`SET messages_json = $value, sop_state_json = $value, updated_at = $now WHERE id = $sessionId`). Only the value composition changes.
- The function MUST NOT issue a SELECT before the UPDATE.
- The function MUST handle `existingHistory = []` correctly. This is the cold-session path (a session was just created in the same turn).
- The function MUST handle `existingHistory` containing the prior turn's messages correctly. This is the warm-session path.
- The function MUST NOT mutate the input arrays.

## Race semantics

Today's path has a TOCTOU window between the SELECT and the UPDATE: two concurrent writers can read the same history, append disjoint messages, and the second writer's UPDATE clobbers the first. The change does NOT increase this window — both writers compute their final array from the history each saw at the top of its own turn. Last-writer-wins for the entire `messages_json` field is the existing semantic; this is acceptable per spec SC-005 (which requires both turns' messages preserved under realistic concurrent timing, NOT under simultaneous-to-the-nanosecond races).

The widget single-flights `POST /api/chat` per session, so this is rarely exercised in production. The integration test for SC-005 fires two requests with a 50ms gap, which is realistic for double-click; both turns load history in sequence and the test asserts the final row contains all four messages.

## Forbidden behaviors

- MUST NOT use `existing.push(...)` (mutation). Always construct a fresh array.
- MUST NOT skip the UPDATE when `newMessages.length === 0` (callers should not call with empty `newMessages`, but if they do, the function MUST still update `sop_state_json` and `updated_at`).

## Test surface

| Test | Behavior |
|------|----------|
| Empty existing history (cold session) | Calling with `existingHistory: []` results in `messages_json = JSON.stringify(newMessages)`. |
| Non-empty existing history (warm session) | Calling with `existingHistory: [{...prior turn...}]` results in `messages_json = JSON.stringify([...prior, ...new])`. |
| No SELECT issued | A spy on the DB query path observes exactly one UPDATE and zero SELECTs for `sessions`. |
| `updated_at` advances | The UPDATE sets `updated_at` to the current time. |
| `sop_state_json` written | The UPDATE writes `JSON.stringify(sopState)` when non-null, `null` otherwise. |
| Concurrent double-send | Two `POST /api/chat` calls 50ms apart produce a final row containing all four messages in chronological order (integration test against in-memory SQLite). |
