# Contract: usePreflightPhrase Hook

**Owner**: Preflight Phrase (`011-preflight-phrase`)
**Consumed by**: `packages/widget/src/components/ChatPanel.tsx`
**Source of Truth**: spec.md FR-010 to FR-019 + research.md R4-R5.

## Module Path

`packages/widget/src/hooks/usePreflightPhrase.ts`

## Public API

```ts
export interface UsePreflightPhraseOptions {
  /** Base URL of the API. The hook calls `${apiUrl}/preflight`. */
  apiUrl: string;
  /** API key forwarded as x-api-key header. */
  apiKey: string;
  /** Optional session id forwarded as x-session-id header. */
  sessionId?: string;
}

export interface UsePreflightPhraseReturn {
  /** Latest preflight phrase, or null. Reset to null when a new turn starts or clear() is called. */
  phrase: string | null;
  /**
   * Call when the visitor sends a message (free-text submit, chip click,
   * or contact-form submit). Fires the preflight in the background.
   */
  start: (message: string, pendingStepSlug: string | null) => void;
  /**
   * Call when the agent's first response token has streamed (clears phrase
   * and aborts any in-flight preflight).
   */
  clear: () => void;
}

export function usePreflightPhrase(opts: UsePreflightPhraseOptions): UsePreflightPhraseReturn;
```

## Behavior

### `start(message, pendingStepSlug)`

1. Aborts any in-flight preflight (via the previous turn's `AbortController`).
2. Increments internal `turnIdRef.current` → new `turnId = N`.
3. Sets `phrase = null` (clears stale phrase from prior turn).
4. Creates fresh `AbortController`; schedules `setTimeout(abort, 1000)` for the client-side ceiling.
5. Fires `fetch(`${apiUrl}/preflight`, ...)`:
   - Method: POST
   - Headers: `Content-Type: application/json`, `x-api-key: ${apiKey}`, optional `x-session-id`.
   - Body: `JSON.stringify({ message, pendingStepSlug })`.
   - `signal`: the new AbortController's signal.
6. On resolve:
   - If `!res.ok` → silent no-op.
   - If `res.ok` → parse body, check `turnIdRef.current === N` AND `!clearedTurnIdsRef.current.has(N)`. Only then `setPhrase(json.phrase)`.
7. On reject (network error, abort): silent no-op.
8. Always: clear the `setTimeout` (to free the abort handle).

### `clear()`

1. Aborts the current AbortController (if any).
2. Adds `turnIdRef.current` to `clearedTurnIdsRef.current` Set.
3. Clears the in-flight `setTimeout`.
4. `setPhrase(null)`.

### Internal state

| Ref/state | Type | Purpose |
|---|---|---|
| `phrase` (state) | `string \| null` | Public output; current phrase. |
| `turnIdRef` | `MutableRefObject<number>` | Monotonic counter; identifies the latest turn. |
| `clearedTurnIdsRef` | `MutableRefObject<Set<number>>` | Turns that have been explicitly cleared (race fix R5). |
| `abortControllerRef` | `MutableRefObject<AbortController \| null>` | Current in-flight fetch's controller. |
| `timeoutRef` | `MutableRefObject<ReturnType<typeof setTimeout> \| null>` | Current 1000ms client-side timeout handle. |

`turnId` integer overflow is not a concern (number is safe up to 2^53;
visitors won't send 9 quadrillion messages).

## Failure modes

| Condition | Hook reaction | Visitor sees |
|---|---|---|
| Server returns 4xx/5xx | silent no-op | dots remain |
| Network error (fetch rejects) | silent no-op | dots remain |
| Client 1000ms timeout fires | abort + silent no-op | dots remain |
| Body parse fails (malformed JSON) | silent no-op | dots remain |
| Server returns valid 200 but turnId is stale (R5) | silent no-op | dots remain (or whatever current state) |
| `clear()` called before fetch resolves | abort + silent no-op | bubble already swapped to streaming message |

The hook NEVER surfaces errors to the visitor. NEVER logs to the
browser console (unless devmode flag set; not in MVP). The widget
falls back to today's behavior on every failure.

## Integration in ChatPanel

```tsx
const { phrase, start, clear } = usePreflightPhrase({
  apiUrl: apiUrl.replace(/\/chat$/, ''),  // turn ".../api/chat" into ".../api"
  apiKey,
  sessionId: getSessionId(),
});

// Free-text submit:
function onSubmit(e: React.FormEvent) {
  e.preventDefault();
  if (!input.trim()) return;
  start(input, sopState?.pending_step_slug ?? null);
  handleSubmit(e);  // existing useChat handler
}

// Chip click:
function onChipSelect(chipLabel: string) {
  start(chipLabel, sopState?.pending_step_slug ?? null);
  append({ role: 'user', content: chipLabel });
}

// Contact-form submit:
function onContactFormSubmit(message: string) {
  start(message, sopState?.pending_step_slug ?? null);
  append({ role: 'user', content: message });
}

// Effect that calls clear() on first assistant token:
useEffect(() => {
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && (last.content?.length ?? 0) > 0) {
    clear();
  }
}, [messages, clear]);

// Bubble JSX:
{isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
  <div role="status" aria-live="polite" style={...bubble styles...}>
    {phrase ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <span aria-hidden="true">✨</span>
        <span>{phrase}…</span>
      </span>
    ) : (
      <span className="lc-typing">● ● ●</span>
    )}
  </div>
)}
```

## Tests

`packages/widget/src/hooks/usePreflightPhrase.test.ts`. **DEFERRED `[~]`**
until widget Vitest+jsdom infrastructure lands (T036/T048 from
010-sop-workflow). When unblocked, tests cover:

- `start()` fires fetch with correct URL/headers/body.
- Second `start()` aborts the first; only second phrase appears.
- Resolved phrase calls `setPhrase`.
- `clear()` resets phrase + cancels in-flight + adds turnId to cleared set.
- Late-arriving response after `clear()` is discarded (R5 race fix).
- Client 1000ms timeout aborts fetch.
- Non-200 response is silent no-op.
- Network error is silent no-op.

Until widget test infra exists, the e2e walk spec
(`tests/e2e/widget-preflight-phrase.walk.spec.ts`) provides black-box
coverage.

## Constitution Compliance

- Constitution III: tests are written-but-deferred, matching the
  established `[~]` pattern from 010-sop-workflow's T036/T048.
- Constitution IV (widget bundle ≤35 KB / 50 KB gz): the hook adds
  ~500 bytes of pure JS. Bundle-size CI gate (Phase 8 R3) catches
  any regression.
- Constitution V: hook never logs message/phrase content to the
  browser console. The structured log lives entirely server-side.
