# Quickstart: Context Search

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the engineer experience after the Context
Search feature is fully implemented. It validates the §12.7
done-when checklist.

## Prerequisites

- Foundation (`001-foundation`) complete: `pnpm install` clean,
  `.env` populated, dev seed inserted.
- Crawler (`002-crawler-cli`) has run at least once against the
  seeded `chatbot-context/` so a `_manifest.json` exists.
- Local dev testbed running (`pnpm dev`) so
  `http://localhost:5173/chatbot-context/_manifest.json` is
  reachable.

## Standalone Harness (per §12.7 deliverable)

The harness is the canonical interactive validation tool for this
feature.

```bash
pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts \
  "I was in a car accident"
```

Expected output (against the seeded Shrager content):

```
Score   Path                                      Title
0.74    pages/practice-areas--personal-injury.md  Personal Injury Practice
0.31    pages/contact.md                          Contact Us
```

(Scores are illustrative; exact values depend on extracted keywords.)

## Done-When Verification (§12.7 done-when)

| Criterion | Verification |
|---|---|
| Query "personal injury" returns the PI file as top result | `… exec tsx scripts/test-search.ts "personal injury"` → top row is `practice-areas--personal-injury.md` |
| Query "John Smith" returns the attorney bio | `… "John Smith"` → top row is the attorney bio (against any context that has one) |
| Query "divorce" returns the family-law file | `… "divorce"` → top row is the family-law practice-area (when present) |
| Query "tax law" returns no results (below threshold — out of scope for this firm) | `… "tax law"` → empty output, exit code 1 |
| Token budget cap respected (never exceeds ~4500 tokens) | Inspect harness output's reported token count; OR run unit test `pnpm --filter @legal-chatbot/api test budget` |
| Unit tests pass (scoring, threshold, token budget) | `pnpm --filter @legal-chatbot/api test context-search` |

## Override the Context Store URL

```bash
CONTEXT_STORE_URL=https://example-lawfirm.com/chatbot-context/ \
  pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts \
  "personal injury"
```

This is useful for:

- Testing against a real production crawl.
- Reproducing a lawyer's reported behavior locally.
- Validating Phase 6's "Test context retrieval" feature.

## Verify the Cache Behavior

Run the harness twice in succession with the same query:

```bash
time pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "divorce"
time pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "divorce"
```

Caveat: each `tsx scripts/test-search.ts` invocation is a fresh
process, so the cache is reset between runs. To observe cache
behavior, the same `searchContext` call inside a long-running
process (e.g., the API server's chat handler) should show the
second call avoiding network round-trips. The Vitest test
`cache.test.ts` is the binding cache behavior verification.

## Verify Empty-Result Behavior

```bash
pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "quantum physics"
```

Expected output (no results):

```
No results above relevance threshold (0.15).
```

Exit code: 1 (so CI scripts can assert "tax law" / "quantum
physics" produce empty results deterministically).

## Verify Manifest Validation

To exercise R2 (Zod validation on read), point the harness at a
broken manifest:

```bash
# Create a malformed manifest:
echo '{"version":"oops","files":[]}' > /tmp/_manifest.json
python3 -m http.server 9999 --directory /tmp &  # serves /_manifest.json

CONTEXT_STORE_URL=http://localhost:9999/ \
  pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "anything"
```

Expected output:

```
Context unavailable. (Manifest validation failed.)
```

Exit code 1. The structured log emits a `manifest_validation_failed`
event with Zod issues.

## Verify Reachability Error

```bash
CONTEXT_STORE_URL=http://localhost:1/ \
  pnpm --filter @legal-chatbot/api exec tsx scripts/test-search.ts "anything"
```

Expected output:

```
Context unavailable. (Context store unreachable.)
```

Exit code 1. Log emits `context_store_unreachable`.

## Run the Full Test Suite

```bash
pnpm --filter @legal-chatbot/api test context-search
```

Expected: all tests in `context-search.test.ts` plus the new
modular tests (`cache.test.ts`, `manifest-fetcher.test.ts`,
`file-fetcher.test.ts`, `scoring.test.ts`, `tokenizer.test.ts`,
`budget.test.ts`) pass.

## Out of Scope for This Quickstart

- Wiring `searchContext` into the agent runtime — Phase 3
  (`004-chat-api-agent`).
- Surfacing the search in the dashboard — Phase 6
  (`007-dashboard` §8.9).
- The system-prompt composition that the search feeds —
  Phase 3 (`004-chat-api-agent` §7.8).

