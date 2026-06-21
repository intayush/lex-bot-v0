# Quickstart — Chat API Latency Reduction

**Feature**: 021-chat-api-latency · **Branch**: `021-chat-api-latency`

This guide walks through validating the feature end-to-end on a local dev machine. Use it to confirm that latency targets (SC-001, SC-002) and behavior-equivalence guarantees (SC-003, SC-004, SC-005, SC-006, SC-007) are met before opening a PR.

## Prerequisites

- Node.js 20+, pnpm, Playwright browsers installed.
- A local Neon branch URL set in `packages/api/.env.local` as `DATABASE_URL`, or rely on the in-memory SQLite test path for unit/integration runs.
- The feature branch `021-chat-api-latency` checked out.
- A clean baseline recording from `main` (instructions below).

## Setup

```bash
pnpm install --frozen-lockfile
pnpm --filter @legal-chatbot/api db:migrate   # idempotent; no-op on a clean DB
pnpm --filter @legal-chatbot/api db:seed      # seeds the dev fixtures
```

## Step 1 — Run unit + integration tests

```bash
pnpm --filter @legal-chatbot/api vitest run
```

Expected:

- All existing tests pass.
- New tests for `system-prompt-cache`, `run-after-response`, and the concurrent-double-send scenario all pass.
- Removed off-SOP-detour tests are no longer reported (they're deleted, not skipped).

## Step 2 — Run the surviving e2e walks

```bash
pnpm --filter @legal-chatbot/api test:e2e
```

Expected:

- Every `*.walk.spec.ts` passes, except the deleted `widget-us3-off-sop-detour.walk.spec.ts` which no longer exists in the tree.
- Conversation transcripts match the `main` baseline (see Step 4).

## Step 3 — Local smoke test

```bash
pnpm dev
```

Open the widget test app at the URL printed by the dev command. Walk a complete intake:

1. Greeting.
2. Pick a case-type chip.
3. Pick a sub-type chip.
4. Answer "where" with a free-text city.
5. Answer "what" with a free-text description.
6. Pick a "when" chip.
7. Submit the contact form.
8. (If a branch is configured for the (case_type, sub_type) pair) answer the branch question.

Verify:

- Each assistant reply begins streaming noticeably sooner than the `main` baseline (qualitative; quantitative numbers come in Step 4).
- The conversation transcript matches `main`'s transcript for the same inputs.
- The dashboard's leads table shows the captured lead with the same `classification`, `lead_score`, `score_reasons_json`, `case_type`, `incident_date`, and contact fields as `main` produced for the same fixture.
- The `urgent_lead` notification fires for HOT-classified leads (same trigger conditions as today).

## Step 4 — Quantitative latency measurement

Reproduce the perf measurement against the dominant SOP-driven traffic shape.

### 4a. Capture a `main` baseline

```bash
git switch main
pnpm install --frozen-lockfile
pnpm dev   # in a separate terminal
# Run the scripted SOP walk (see scripts/measure-chat-latency.ts in this feature's task list)
node packages/api/scripts/measure-chat-latency.ts > /tmp/latency-main.json
```

The script measures, for each of N=50 turns across a complete intake:

- Time to first stream chunk (TTFT).
- Time to stream-`done` event.

It writes a JSON file with P50, P90, and P99 for each metric.

### 4b. Measure on the feature branch

```bash
git switch 021-chat-api-latency
pnpm install --frozen-lockfile
pnpm dev   # restart in a separate terminal
node packages/api/scripts/measure-chat-latency.ts > /tmp/latency-021.json
```

### 4c. Compare

```bash
node packages/api/scripts/diff-latency.ts /tmp/latency-main.json /tmp/latency-021.json
```

Expected (SC-001, SC-002):

- P50 TTFT drop ≥150ms.
- P50 `done` event drop ≥200ms.

If either threshold is missed, the feature is NOT ready to merge; investigate which optimization regressed.

## Step 5 — Behavior-equivalence diff

```bash
# On main:
git switch main
node packages/api/scripts/dump-walk-fixtures.ts > /tmp/baseline.jsonl

# On feature branch:
git switch 021-chat-api-latency
node packages/api/scripts/dump-walk-fixtures.ts > /tmp/021.jsonl

diff /tmp/baseline.jsonl /tmp/021.jsonl
```

Expected (SC-003):

- Empty diff, or differences confined to monotonic timestamps.
- Any other difference (different classification, different message ordering, missing notification) is a bug; do not ship.

## Step 6 — Cache-invalidation smoke test (SC-006)

1. Start `pnpm dev`.
2. Open the widget against an account with a published configuration.
3. Send a message. Note the assistant's tone and contact-info echo.
4. In a separate browser tab, open the dashboard, edit the persona (e.g., change "tone" from "professional" to "friendly"), and publish.
5. Send the next visitor message in the widget.

Expected: the assistant's next reply reflects the new tone, no later than today's behavior (i.e., within the existing config-cache TTL window).

## Step 7 — Concurrent double-send (SC-005)

Run the dedicated Vitest integration test:

```bash
pnpm --filter @legal-chatbot/api vitest run src/app/api/chat/route.test.ts -t "concurrent"
```

Expected: the test asserts that two concurrent `POST /api/chat` calls for the same session result in a final row containing all four messages.

## Done when

- All steps above pass.
- Latency drops meet SC-001 and SC-002.
- Behavior-equivalence diff (Step 5) is empty (modulo timestamps).
- Constitution Check from `plan.md` is re-confirmed in the PR description.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Deferred-write tests hang | `runAfterResponse` is not falling back to inline await in Vitest. | Verify the `typeof after !== 'function'` branch is taken in tests. |
| Cache hit rate is 0% | Cache key includes a non-stable identifier. | Confirm `configVersionId` comes from `configurations.id`, not a synthesized value. |
| Stale prompt after publish | An `invalidateConfigCache` call site is missing the prompt-cache invalidator. | Grep for `invalidateConfigCache` and add `invalidateSystemPromptCache` next to each call. |
| Concurrent test flaky | The test's parallelism is too aggressive for SQLite. | Add 50ms gap between requests, matching real widget timing. |
| Off-SOP detour walk failure | The walk file wasn't deleted. | `rm packages/api/tests/e2e/widget-us3-off-sop-detour.walk.spec.ts`. |
