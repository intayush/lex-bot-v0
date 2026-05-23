# Research: Preflight Phrase

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves the technical unknowns surfaced during planning.
All NEEDS CLARIFICATION items from the spec's Open Questions section
either have decisions below OR are flagged as production-time concerns
not blocking MVP.

## R1 — Model selection: `gemini-2.5-flash-lite` vs alternatives

**Decision**: `gemini-2.5-flash-lite` via `@ai-sdk/google`'s
`generateObject`.

**Rationale**:
- Latency: ~250-400ms typical for a structured-output call with a
  small prompt + 10-30 token response. ~50% of `gemini-2.5-flash`'s
  latency for the same task.
- Cost: ~$0.0001-0.0003 per call vs ~$0.0003-0.0008 for `flash`. For
  a feature that fires on EVERY visitor turn, the cost delta matters.
- Quality: for 3-7 word loading phrases, lite-tier output is
  indistinguishable from full-tier in our brainstorm prompt-testing.
  The phrase doesn't need to be insightful; it needs to be relevant.

**Alternatives considered**:
- `gemini-2.5-flash` (same model as main agent): rejected. 2-3x slower,
  2-3x more expensive, no quality benefit for this task.
- Regex/keyword classifier: rejected. Produces awkward phrases that
  don't feel tailored. Defeats the goal.
- Local small model (Phi, etc.): rejected. Would require new
  infrastructure (model serving) and adds operational burden far
  beyond the feature's scope.

## R2 — Vercel AI SDK API: `generateObject` vs `streamText`

**Decision**: `generateObject` with a Zod response schema.

**Rationale**:
- The preflight returns a single object `{ phrase: string }`, not a
  stream. `generateObject` is the AI SDK's structured-output primitive
  designed for exactly this case.
- `streamText` would require the route handler to consume the stream
  and concatenate before responding, adding complexity for no benefit
  (the response is small enough that streaming saves nothing).
- `generateObject` enforces the response schema at the SDK level. If
  the model returns malformed JSON, the SDK throws a typed error
  that the route handler catches and converts to a 503.

**Alternatives considered**:
- `streamText` + manual JSON parsing: rejected. More code, no benefit.
- Direct `@google/generative-ai` SDK: rejected. The Vercel AI SDK is
  already in scope; using it consistently keeps the codebase uniform.

## R3 — Server-side timeout mechanism

**Decision**: `AbortController` with `setTimeout` cancellation, passed
through to `generateObject`'s `abortSignal`.

**Rationale**:
- `AbortController` is the standard browser/Node API for
  cooperative cancellation. The Vercel AI SDK accepts an `abortSignal`
  and propagates it to the underlying fetch.
- A hard 800ms budget at the server protects against slow Gemini
  responses without relying on the client to enforce timing.
- On abort, `generateObject` throws an `AbortError` we catch and
  convert to a 503 with `{ error: 'preflight_timeout' }`.

**Alternatives considered**:
- `Promise.race` with a timeout promise: rejected. Doesn't actually
  cancel the underlying LLM call; the request keeps going server-side
  even after the route returns. Wasteful at scale.
- Express-style request-scoped timeout middleware: not applicable to
  Next.js App Router.

## R4 — Client-side timeout + abort coordination

**Decision**: Client-side 1000ms timeout via the same `AbortController`
pattern. Server's 800ms timeout is the primary; client's 1000ms is a
belt-and-suspenders fallback for stuck connections.

**Rationale**:
- If the server is healthy, the server's 800ms timeout returns a 503
  well within the client's 1000ms window.
- If the network drops mid-response, the server's timeout doesn't
  help (the response never arrives at the client). The client-side
  1000ms timeout aborts the fetch and triggers the silent-failure path.
- Padding the client's timeout above the server's by 200ms ensures
  the server's structured 503 wins in normal failure cases.

## R5 — Race condition: late preflight after agent's first token

**Decision**: Internal `turnId` counter + `clearedTurnIds` Set inside
the hook.

**Rationale**:
- Each `start()` call increments a `turnId`. The fetch promise captures
  the `turnId` it was created under.
- When `clear()` is called (by the assistant-message effect), the
  current `turnId` is added to `clearedTurnIds`.
- When the fetch resolves, it checks: is the `turnId` still current
  AND is it NOT in `clearedTurnIds`? Only then does it call `setPhrase`.
- This guards against the rare case where the main agent's first token
  arrives BEFORE the preflight resolves. Without this guard, the
  preflight phrase would briefly flash AFTER the agent had started
  streaming — confusing and ugly.

**Alternatives considered**:
- Just compare `turnId` (no `clearedTurnIds`): rejected. If two
  preflights queue up (rapid `start()` calls), the latest `turnId`
  matches but the user has moved on. Need both signals.
- Compare against `messages` length in the resolve callback: rejected.
  React state isn't readable from inside the captured fetch promise
  without contortion. The flag pattern is cleaner.
- Just don't worry about the race: rejected. The race IS rare but
  the visible-bug cost is high (a phrase appears AFTER the agent's
  message starts, which feels broken).

## R6 — Logging redaction

**Decision**: Structured log with NO message content, NO phrase content.
Only metadata (account_id, session_id, duration_ms, outcome,
pending_step_slug, message_token_count, phrase_word_count).

**Rationale**:
- Constitution V (Privacy) explicitly forbids PII in logs. The
  visitor's message can contain names, addresses, contact info,
  case details. Logging it raw is a liability.
- The phrase, while less likely to contain PII (the prompt forbids
  it), still might leak — defense in depth applies.
- Token count and word count give us enough signal for cost
  monitoring and quality assessment without exposing content.

**Alternatives considered**:
- Log message content but redact via regex: rejected. Regex PII
  redaction is a notorious source of false-negatives. Don't try
  to be clever with PII.
- Log nothing at all: rejected. We need duration + outcome for
  observability (knowing the timeout rate, the failure rate, the
  cost-per-account).

## R7 — Pre-flight prompt design

**Decision**: System-prompt-only approach (no role/persona play).
Total prompt ~300 tokens. Examples are the dominant content.

**Rationale**:
- The model's task is narrow: produce a 3-7 word phrase. A long
  preamble would be wasteful.
- 4-5 input/output examples in the prompt give better consistency
  than rule statements alone (per Gemini docs on few-shot prompting).
- Explicit constraints ("never restate verbatim", "never include PII")
  reinforce the post-filter regex; defense in depth.

**Final prompt** (committed to in research, copied verbatim into
`lib/preflight-phrase.ts`):

```
You are a UX assistant for a legal-firm chat widget. Given a visitor's
message, produce a 3-7 word loading status phrase describing what the
bot is about to do, in present continuous tense.

Examples:
  message: "I had a DUI"           → phrase: "Looking into your DUI matter"
  message: "What are office hours?" → phrase: "Checking office hours"
  message: "5th and Main"          → phrase: "Noting the location"
  message: "thanks"                → phrase: "Wrapping up"
  message: "First Offense"         → phrase: "Selecting first offense"

Rules:
- Never restate the visitor's message verbatim.
- Never make legal claims or promises.
- Never include PII (names, emails, phone numbers, addresses) in the phrase.
- No trailing punctuation; the widget adds an ellipsis.

Return JSON: { "phrase": "..." }
```

**Alternatives considered**:
- Pure rules without examples: rejected. Higher variance in output
  style.
- Long persona setup: rejected. Wastes tokens on flavor that doesn't
  improve task completion.

## R8 — Test mocking strategy for the LLM

**Decision**: Inject a `generateObjectImpl` parameter into the helper
(default: real `generateObject` from `ai`); tests pass a mock.

**Rationale**:
- Matches the existing pattern in `lib/sop/advancer.test.ts` which
  uses `inferDateImpl: ALWAYS_NULL` for the date inferer.
- Avoids MSW or other HTTP-level mocking infrastructure.
- Tests run fast (no LLM latency, no network).

**Alternatives considered**:
- MSW intercepting the actual SDK fetch: rejected. Heavier; slower;
  the existing repo pattern is dependency injection.
- Spy on `@ai-sdk/google` exports: rejected. Brittle to SDK internals.

## R9 — Walk spec assertion strategy

**Decision**: Assert structural signals only (typing bubble shows
non-dot content within 1.5s; bubble disappears after assistant message
arrives). NEVER assert exact phrase content.

**Rationale**:
- LLM output varies between runs. A spec asserting "Looking into your
  DUI matter" would flake on a perfectly good "Reviewing your DUI
  case".
- The structural assertion ("typing bubble has text other than ●●●")
  is a stronger contract: it confirms the wire path works AND the
  swap renders.

**Alternatives considered**:
- Assert phrase contains "DUI": rejected. Brittle to model phrasing
  ("driving offense").
- Mock the LLM in the e2e too: rejected. The walk spec is meant to
  exercise the real production path against a real LLM (against the
  dev key). Mocking would defeat the value.

## Summary

All Phase 0 decisions align with established patterns from
010-sop-workflow and prior features. No new infrastructure, no new
external dependencies, no Constitution principle violations beyond
the planned `flash-lite` model amendment (Phase D).

Ready to proceed to Phase 1 (data-model.md, contracts, quickstart).
