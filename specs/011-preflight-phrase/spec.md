# Spec: Preflight Phrase (Query-Tailored Loading Status)

**Branch**: `011-preflight-phrase` (planned) | **Date**: 2026-05-24
**Status**: Brainstormed; awaiting user review before plan + tasks
**Supersedes**: nothing — extends the existing widget loading UX from `005-chat-widget`

## Problem

When a visitor sends a message in the widget today, they see a generic
3-dot typing indicator (`● ● ●`) for 2-7 seconds before the agent's first
token streams. The indicator carries no information about *what* the bot
is doing. Two real costs:

1. The wait feels longer than it is — the visitor has no signal the bot
   even understood their query.
2. On slow turns (tool-call invocations, long context retrievals) the
   silence is unsettling enough that a non-trivial fraction of visitors
   abandon mid-turn.

The bot is, in fact, doing concrete things during that wait: skip-detector
matching the visitor's message, advancing SOP state, composing a system
prompt, calling Gemini, possibly invoking `searchContext` or
`analyzeAndFollowUp` tools. We have plenty to communicate; we just don't.

## Goal

Replace the static 3-dot indicator with a query-tailored status phrase
("✨ Looking into your DUI matter…") that appears within ~500ms of Send,
while the main agent stream continues unchanged in parallel.

The phrase is **purely additive** — if it fails, times out, or is
disabled, the widget falls back silently to today's dots-only behavior.
The main chat path is never blocked by this feature.

## Non-Goals

- Multi-step progress indicators ("✓ Read message → ⊙ Searching → …").
  Considered and dropped: too much surface area; the cheap-LLM single-line
  approach gives 80% of the value at 5% of the cost.
- Real-time tool-call narration (replacing the phrase as
  `searchContext` / `analyzeAndFollowUp` tools fire). Considered for
  v2; out of scope for MVP because the value depends on tool calls
  taking >500ms each, which is a measurement we don't have yet.
- Voice/audio loading cues. Out of scope (Constitution V — privacy;
  no microphone access).
- Showing loading state for non-LLM round-trips (config fetches,
  session resumption). Out of scope; those are <100ms and don't need it.

## User Stories

### US1 — Free-text message preflight (P1)

A visitor types "I had a DUI" and clicks Send. Within ~500ms (before the
main agent has finished thinking) the typing indicator swaps from `● ● ●`
to "✨ Looking into your DUI matter…". When the agent's first response
token streams ~2-5 seconds later, the phrase is replaced by the
streaming message bubble.

**Independent test**: From a fresh widget session, send "I had a DUI"
and verify (a) the typing bubble shows non-dots content within 1.5s,
(b) the bubble's content changes to streamed agent text afterwards.

### US2 — Chip-click preflight (P1)

A visitor clicks the "DUI" case-type chip. The chip's label is
dispatched as a user message via `append()`. The same preflight pipeline
fires; the visitor sees a phrase like "✨ Selected DUI…" or
"✨ Looking into your DUI matter…" before the agent's response streams.

**Independent test**: Click any case-type chip; verify a tailored
phrase appears in the typing bubble before the agent responds.

### US3 — Contact-form submit preflight (P1)

A visitor fills the contact form (name + email) and clicks Submit. The
form dispatches a structured message via `append()`. The preflight
fires with that message; visitor sees a phrase like
"✨ Recording your details…" before the SOP finalizes.

**Independent test**: Walk to the contact step, submit the form, verify
a tailored phrase shows.

### US4 — Silent failure on preflight error (P1)

If the preflight LLM call times out (>800ms), errors, or is rate-limited,
the visitor sees the same 3-dot indicator they see today. No error
message, no broken UX. The main agent flow continues unaffected.

**Independent test**: Force the preflight to fail (mock 503 in
DevTools, or network-throttle the preflight URL). Verify the typing
bubble shows dots throughout and the agent response still streams normally.

### US5 — Rapid back-to-back messages (P2)

A visitor sends "DUI" then immediately sends "First offense" before
the first response arrives. The first preflight is aborted; the second
preflight fires. Only the second phrase is ever shown. No stale phrase
from message #1 appears.

**Independent test**: Send two messages in quick succession (~200ms
apart); verify the phrase shown reflects only the second message.

### US6 — Race: fast main agent (P3, robustness)

If the main agent's first token streams BEFORE the preflight phrase
arrives (rare; happens with FAQ semantic-cache hits or very short
prompts), the preflight result is discarded — no phrase ever appears
post-stream-start. Defensive against edge case #4 in the brainstorm.

**Independent test**: Time-mock a fast main response in an integration
test; verify `setPhrase` is a no-op when the assistant message is
already present.


## Functional Requirements

### Preflight route (`POST /api/chat/preflight`)

- **FR-001** Authenticated via the same `x-api-key` header used by `/api/chat`. Unauthenticated requests return 401.
- **FR-002** Body Zod-validated against `preflightRequestSchema`: `{ message: string (1-2000 chars), pendingStepSlug: string | null }`. Invalid bodies return 400.
- **FR-003** Counts against the same per-account daily rate-limit pool as `/api/chat` (the existing 1000-conversations cap from §11.1). Over-limit returns 429. **Note**: each visitor message now triggers TWO counted calls, effectively halving the per-account daily ceiling. This is acceptable at MVP scale; if production saturates we either bump the cap to 1500-2000 or move preflight to its own counter. Tracked as Open Question in §Open questions.
- **FR-004** Calls `gemini-2.5-flash-lite` via `@ai-sdk/google` with `generateObject` and the structured response schema `{ phrase: string (3-60 chars) }`. Temperature 0.3.
- **FR-005** Server-side timeout of 800ms via `AbortController`. Timeout returns 503 with `{ error: 'preflight_timeout' }`.
- **FR-006** Generic LLM errors (network, provider 5xx, content-filter rejection) return 503 with `{ error: 'preflight_failed' }`.
- **FR-007** Phrase post-filter strips leading/trailing whitespace, removes any trailing `.` or `…`, rejects phrases >60 chars, rejects phrases containing email-like or phone-like patterns. Failed post-filter returns 503 with `{ error: 'preflight_validation' }`.
- **FR-008** Successful response is `{ phrase: string }` with status 200. CORS headers identical to `/api/chat`.
- **FR-009** Response NEVER blocks on the main `/api/chat` call; the route handler returns immediately after the LLM call resolves or times out.

### Widget hook (`usePreflightPhrase`)

- **FR-010** Exports `{ phrase: string | null, start: (msg, slug) => void, clear: () => void }`.
- **FR-011** `start()` cancels any in-flight preflight (via `AbortController`) and resets `phrase` to null before firing the new fetch.
- **FR-012** `start()` increments an internal `turnId`; the fetch promise captures it; on resolve, only sets `phrase` if `turnId` still matches AND `clear()` has not been called for that turn.
- **FR-013** Hook has its own client-side timeout of 1000ms; the abort fires at 1000ms regardless of server timeout.
- **FR-014** Any non-200 response, network error, or abort silently no-ops; `phrase` stays null.
- **FR-015** `clear()` aborts in-flight, sets `phrase` to null, marks the current `turnId` as cleared.

### ChatPanel integration

- **FR-016** Three send-paths wire `start()`: free-text submit (`onSubmit`), chip click (`onChipSelect`), contact-form submit (`onContactFormSubmit`). Each calls `start(message, sopState?.pending_step_slug ?? null)` BEFORE invoking the existing `useChat` handler / `append()`.
- **FR-017** A `useEffect` watching `messages[messages.length-1]` calls `clear()` when the last message transitions to `{role: 'assistant', content: '<non-empty>'}`.
- **FR-018** The typing-indicator bubble's content swaps: `phrase ? "✨ {phrase}…" : "● ● ●"`. The bubble itself (position, padding, background) is unchanged.
- **FR-019** Bubble carries `role="status"` and `aria-live="polite"` for screen-reader announcement of both the dots and the phrase swap.

### Privacy + observability

- **FR-020** Preflight emits one structured log per call: `{ event: 'preflight', account_id, session_id?, duration_ms, outcome, pending_step_slug, message_token_count, phrase_word_count? }`.
- **FR-021** Logs MUST NOT contain raw message content or phrase content. Constitution V invariant.
- **FR-022** Preflight token usage counted into the per-conversation `tokens_in/tokens_out` tally on the `sessions` table (existing §11.3 columns).


## Architecture

```
Visitor clicks Send (free-text / chip / contact-form)
        │
        ▼
   ChatPanel (existing)
        │
        ├─────► usePreflightPhrase.start(msg, pendingStepSlug)
        │             │
        │             ▼
        │      fetch POST /api/chat/preflight     [parallel]
        │             │  body: { message, pendingStepSlug }
        │             ▼
        │      (server: gemini-2.5-flash-lite, ~250-400ms)
        │             │
        │             ▼  { phrase: "Looking into your DUI matter" }
        │      setPhrase(phrase)  (only if turnId matches + not cleared)
        │
        └─────► useChat.handleSubmit / append()    [parallel]
                      │
                      ▼
                fetch POST /api/chat               [main agent stream]
                      │
                      ▼ (server: gemini-2.5-flash + tools, 2-7s to first token)
                      │
                      ▼
                first assistant token streams
                      │
                      ▼
                useEffect detects new assistant message
                      │
                      ▼
                usePreflightPhrase.clear()   →  phrase = null
                      │
                      ▼
                bubble swaps from "✨ phrase…" to streaming message bubble
```

Two HTTP calls fired in parallel from the same Send action. The
preflight is fire-and-forget from the visitor's perspective — its result
adjusts the loading UI but never blocks anything. The existing
`useChat` flow is untouched.

## Components

### `packages/api/src/lib/preflight-phrase.ts` (NEW)

Pure helper around the LLM call. Single export:

```ts
export async function generatePreflightPhrase(input: {
  message: string;
  pendingStepSlug: string | null;
  abortSignal: AbortSignal;
}): Promise<{ phrase: string }>
```

- Calls `generateObject` with `gemini-2.5-flash-lite` and the response Zod schema.
- Applies the post-filter (FR-007).
- Throws on LLM error, abort, or post-filter rejection — caller distinguishes via the Error subclass.

Pure function from caller's perspective; no DB, no logging. Logging
lives in the route handler so the helper stays unit-testable.

### `packages/api/src/app/api/chat/preflight/route.ts` (NEW)

Route handler. Auth → rate limit → Zod-parse → 800ms-budget call to
`generatePreflightPhrase` → response. Emits the structured log entry.

### `packages/widget/src/hooks/usePreflightPhrase.ts` (NEW)

The React hook. ~80 LOC. Internal state: `phrase`, `turnIdRef`,
`abortControllerRef`, `clearedTurnIdsRef` (Set).

### `packages/widget/src/components/ChatPanel.tsx` (EDIT)

- Calls `usePreflightPhrase()` at the top.
- Wraps the three send-paths to call `start()` before existing logic.
- Adds `useEffect` watching `messages` to call `clear()` on first
  assistant token.
- Updates the typing-indicator bubble JSX to render either the phrase
  or the dots.

### `packages/shared/src/schemas/preflight.ts` (NEW)

`preflightRequestSchema` + `preflightResponseSchema`. Exported from the shared index.

### `.specify/memory/constitution.md` (EDIT)

Adds `gemini-2.5-flash-lite` to the §IV Required Stack with a "preflight-only" note. Version bump 1.0.0 → 1.1.0 (MINOR — adds an option without invalidating prior compliance).


## Edge cases (from brainstorming, all confirmed)

| # | Case | Behavior |
|---|---|---|
| 1 | Rapid back-to-back messages | Second `start()` aborts the first preflight. Only the second phrase is shown. |
| 2 | Chip click during stale phrase | Same as #1 — `start()` resets state per call. |
| 3 | Preflight beats main agent (common) | Phrase shows for ~1-6s then is replaced by the streaming bubble. |
| 4 | Main agent beats preflight (rare) | `turnId` + `cleared` flags ensure late preflight result is discarded. |
| 5 | Network drop mid-preflight | Caught silently; dots remain. |
| 6 | Rate-limit | 429 from server; widget silently no-ops; main `/api/chat` also 429s and the existing error UI handles that. |
| 7 | Account/auth mismatch | Inherits same auth as `/api/chat`; both fail or both succeed. |
| 8 | Very short / nonsensical messages | `flash-lite` produces weak phrases ("Wrapping up"); acceptable. Zod min/max clamps actively bad output. |
| 9 | Chip slug vs label | `append()` dispatches the human-readable label; preflight sees the label string ("DUI", "Yesterday"). Model handles fine. |
| 10 | PII in messages | Prompt forbids verbatim restate + PII in phrase; post-filter regex rejects email/phone-like patterns; defense in depth. |

## Constraints

- **Constitution II** Type Safety: every boundary input/output Zod-validated.
- **Constitution III** Test-First: route handler unit tests written before implementation; widget hook tests written but `[~]` until widget Vitest infra lands; one new walk-tagged Playwright spec.
- **Constitution IV** Serverless: Route Handler only (no Server Actions); pure JS dependencies; CORS wildcard preserved. `gemini-2.5-flash-lite` is an additional model from the same provider — no new SDK.
- **Constitution V** Privacy: no message content or phrase content in logs. Token counts only.
- **Constitution VI** Bounded agent: preflight does NOT count against the existing `maxSteps: 5` cap (different LLM call entirely). It IS counted against the per-account daily 1000-conversation cap. Adds ~1.05x token cost per turn.
- **Latency budget**: server-side ≤800ms (hard timeout); client-side ≤1000ms (hard timeout); typical resolved time ~250-400ms.
- **Token budget**: prompt is ~300 tokens, response is ~10-30 tokens, total ~330 tokens per call. Negligible vs. main agent's ~3000-tokens-per-turn.

## Performance targets

> **Latency vocabulary used in this spec**:
> - "typical resolved time" ≈ 250-400ms (the median end-to-end time
>   from Send → phrase visible)
> - "≤800ms" = the server's hard timeout via `AbortController`
> - "≤1000ms" = the widget's hard client-side timeout (just above the server)
> - "1.5s" = the test-assertion threshold (margin for network + DOM update
>   in CI)
>
> So "phrase appears within ~500ms" (Goal section) and "within 800ms for
> ≥80% of turns" (target below) and "within 1.5s" (test SC-002) are NOT
> contradictions — they're the same metric measured at different
> percentiles + with test margin.

- Phrase appears within 800ms for ≥80% of turns (the other 20% are when main agent beats preflight, which is correct behavior — the visitor sees the agent response instead).
- Visitor never sees a stale phrase after the agent starts streaming (race fix verified by US6 unit test).
- Preflight failure rate <2% in production (excluding rate-limit cases).
- No measurable impact on `/api/chat` latency (preflight runs in parallel, never blocks).

## Success criteria

| ID | Criterion |
|---|---|
| SC-001 | Preflight route returns 200 with a valid 3-60-char phrase against a sample request. |
| SC-002 | Widget shows the phrase within 1.5s of Send for ≥80% of typical turns. |
| SC-003 | Phrase never appears after the agent's first token has streamed (turnId race closed). |
| SC-004 | Preflight failure (timeout, error, rate-limit) is visually indistinguishable from today's behavior — dots remain throughout. |
| SC-005 | Constitution invariants pass (`pnpm verify-invariants`); no Server Actions, no native deps, CORS wildcard preserved. |
| SC-006 | All new unit tests green; e2e walk spec green against both dev server and production URL. |
| SC-007 | Logs contain only metadata (no message content, no phrase content). Verified by a redaction unit test. |


## Testing

### Unit tests

- `packages/api/src/lib/preflight-phrase.test.ts`:
  - Happy path: mocked `generateObject` returns `{phrase: "Looking into your DUI matter"}` → helper returns same.
  - LLM throws → helper throws subclass `PreflightLLMError`.
  - LLM returns phrase >60 chars → helper throws subclass `PreflightValidationError`.
  - LLM returns phrase containing "(555) 867-5309" → helper throws `PreflightValidationError`.
  - Abort signal fired before LLM resolves → helper throws AbortError.

- `packages/api/src/app/api/chat/preflight/route.test.ts`:
  - 200 happy path with mocked helper.
  - 401 missing/invalid `x-api-key`.
  - 400 Zod-invalid body.
  - 429 over rate limit.
  - 503 timeout (helper aborts).
  - 503 helper throws `PreflightLLMError`.
  - 503 helper throws `PreflightValidationError`.
  - Logs structured entry with no message/phrase content.

- `packages/widget/src/hooks/usePreflightPhrase.test.ts` (deferred `[~]`):
  - `start()` fires fetch with right body.
  - Second `start()` aborts first; only second phrase appears.
  - `clear()` resets phrase and aborts in-flight.
  - Late-arriving response (after `clear()`) is discarded.
  - Non-200 response is silent.

### Integration / E2E

- One new Playwright walk-tagged spec: `tests/e2e/widget-preflight-phrase.walk.spec.ts`.
  - Sends "I had a DUI"; asserts the typing bubble shows non-dots content within 1.5s; asserts the bubble disappears after the assistant message arrives.
  - Doesn't assert exact phrase content (LLM variance).

## Rollout phases

| Phase | Scope | Independently revertible? |
|---|---|---|
| A | Backend: shared schemas + `lib/preflight-phrase.ts` + route handler + route tests | Yes (no UI change) |
| B | Widget: `usePreflightPhrase` hook + ChatPanel wiring + bubble swap | Yes (revert ChatPanel edit) |
| C | Observability: structured log emission + token counting | Yes (additive) |
| D | Constitution amendment (PR + version bump 1.0.0 → 1.1.0) | Separate PR per governance rules |

Each phase is one commit. If preflight UX turns out net-negative, revert
Phase B and the rest stays harmless.

## Cost analysis

- Preflight LLM call: `gemini-2.5-flash-lite`, ~330 tokens per turn, ~$0.0001-0.0003 per turn.
- Main agent call (existing): `gemini-2.5-flash`, ~3000 tokens per turn, ~$0.005 per turn.
- **Net increase: ~2-6% per visitor turn.** Negligible at MVP scale; worth measuring at production scale (the existing per-conversation token tally captures this automatically once we add the column updates in Phase C).

## Open questions

- **Rate-limit pool sharing**: each visitor turn now triggers two counted
  calls (preflight + main). FR-003 keeps them on the same pool for MVP.
  Decision deferred until production traffic data is available; if the
  daily cap saturates we either raise it (1000 → 1500-2000) or split
  preflight onto its own counter. Tracked but not blocking.
- All other clarifying questions resolved during brainstorm. The
  constitution amendment is a known follow-up to this work.

## References

- Brainstorming session: this conversation (2026-05-24)
- Existing typing indicator: `packages/widget/src/components/ChatPanel.tsx` lines 314-327
- Main chat flow: `packages/api/src/app/api/chat/route.ts`
- Existing model usage: `gemini-2.5-flash` in `composeSystemPrompt` + tools
- Constitution §IV Required Stack: `.specify/memory/constitution.md`
- Vercel AI SDK: `generateObject` for structured-output preflight call
