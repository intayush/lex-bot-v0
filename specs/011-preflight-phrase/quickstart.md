# Quickstart: Preflight Phrase

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the visitor's experience after the Preflight
Phrase feature ships. It validates each of the 6 user stories from
spec.md.

## Prerequisites

- 010-sop-workflow merged + deployed (the SOP runtime is already live).
- API and widget Netlify sites deployed at known URLs.
- Dev account seeded with the default 6-step SOP (already done).
- A working `dev_test_key` for `x-api-key` auth.

## Walk-through

### US1 — Free-text message preflight

1. Open the widget demo (https://lex-bot-chatbot.netlify.app/).
2. Click the chat bubble in the bottom-right to open the panel.
3. Type "I had a DUI" and press Enter.

**Expected timeline**:

- t=0: Send fires.
- t=~50-300ms: Typing bubble appears with `● ● ●`.
- t=~300-500ms: Bubble swaps to "✨ Looking into your DUI matter…"
  (exact phrase varies — LLM output).
- t=~2-5s: Bubble disappears; agent's response streams in.

### US2 — Chip-click preflight

1. From the same conversation (or a fresh one), click any
   case-type chip ("DUI" / "Personal Injury" / etc.).

**Expected**: same timeline as US1. Phrase reflects the chip's label
(e.g., "Selecting personal injury" or "Looking into personal injury matter").

### US3 — Contact-form submit preflight

1. Walk the SOP to the contact-form step (case_type → sub_type →
   where → what → when).
2. Fill in name + email + phone.
3. Click Submit.

**Expected**: phrase like "✨ Recording your details…" appears
before the agent's finalize response streams.

### US4 — Silent failure on preflight error

1. Open DevTools → Network tab.
2. Right-click on the `/api/chat/preflight` row → Block request URL.
3. Reload the page; open the chat; send a message.

**Expected**: typing bubble shows `● ● ●` throughout (no phrase
attempts to load). Agent's response streams in normally. No error
UI shown. The visitor cannot tell preflight is broken.

4. Remove the block. Reload. Confirm phrases return.

### US5 — Rapid back-to-back messages

1. Open chat; type "DUI" and send.
2. Within ~200ms, type "First offense" and send (before any response
   arrives).

**Expected**: only ONE phrase ever shows in the typing bubble — the
one tailored to "First offense". The "DUI" preflight fired but its
result was discarded because the second `start()` aborted it. No
visible glitch.

### US6 — Race robustness (rare; manual setup needed)

This is hard to reproduce manually because it requires the main
agent's first token to arrive faster than the preflight (~250-400ms).
Verify via the unit test:

```bash
pnpm --filter @legal-chatbot/api test usePreflightPhrase 2>&1 | grep "race"
```

(Test is `[~]` deferred until widget Vitest infra lands; see
contracts/preflight-hook-contract.md.)

## Verification

### Smoke test against local dev

```bash
# Terminal 1: API
pnpm --filter @legal-chatbot/api dev

# Terminal 2: widget
pnpm --filter @legal-chatbot/widget dev

# Terminal 3: drive the verification
curl -s -X POST -H "Content-Type: application/json" -H "x-api-key: dev_test_key" \
  -d '{"message":"I had a DUI","pendingStepSlug":"case_type"}' \
  http://localhost:3000/api/chat/preflight

# Expected:
# {"phrase":"Looking into your DUI matter"}
# (exact wording varies)
```

### Smoke test against production

```bash
curl -s -X POST -H "Content-Type: application/json" -H "x-api-key: dev_test_key" \
  -d '{"message":"What are office hours?","pendingStepSlug":null}' \
  https://lex-bot-v0.netlify.app/api/chat/preflight
```

### E2E walk spec

```bash
pnpm --filter @legal-chatbot/api e2e:walk -- widget-preflight-phrase
```

Opens a real Chromium window, walks US1, asserts the bubble's content
swaps from dots → phrase → message bubble. Timing assertions use
generous margins (1.5s for phrase appearance) to tolerate dev-LLM
variance.

### Cost verification

After ~10 turns through the widget, confirm token usage went up by
~5% relative to baseline (the per-turn cost increased by the
preflight's ~330 tokens vs the main agent's ~3000 tokens).

```bash
DATABASE_URL=... pnpm --filter @legal-chatbot/api exec tsx -e "
  import { db, schema } from './src/db';
  import { eq, desc } from 'drizzle-orm';
  const rows = await db.select().from(schema.sessions).orderBy(desc(schema.sessions.created_at)).limit(5);
  for (const r of rows) console.log(r.id, r.tokens_in, r.tokens_out);
"
```

## Done-When (Spec SC) Verification Map

| Spec SC | Quickstart step | How verified |
|---|---|---|
| SC-001 | curl smoke test | 200 + valid phrase |
| SC-002 | US1 walk-through | typing-bubble timing |
| SC-003 | US6 unit test | turnId race fix |
| SC-004 | US4 walk-through | DevTools blocked URL |
| SC-005 | `pnpm verify-invariants` (when 009 lands the script) | invariants script |
| SC-006 | `pnpm e2e` headless | walk spec passes |
| SC-007 | redaction unit test in `route.test.ts` | log payload assertions |

## Troubleshooting

- **Phrase never appears, only dots.** Check the browser Network tab
  for `/api/chat/preflight` — is it 200, 401, 503? If 503, check
  server logs for `outcome: 'timeout'` (LLM was slow) or `outcome:
  'llm_error'` (Gemini provider issue).
- **Phrase appears AFTER the agent's message.** This is the R5 race
  bug. Verify the unit test for the `clearedTurnIds` fix is passing.
- **Preflight is rate-limited (429) but main chat works.** Both share
  the same per-account daily pool (FR-003); the main chat call would
  also be rate-limited at this point. If only preflight is rate-limited
  it's a counter-bug.
- **Bundle size regression.** Hook is ~500 bytes. If size-limit fails,
  check for an accidental import of a heavy module.

## References

- spec.md (this feature's spec)
- plan.md (this feature's implementation plan)
- contracts/preflight-route-contract.md (server contract)
- contracts/preflight-hook-contract.md (widget contract)
- research.md (decisions log)
