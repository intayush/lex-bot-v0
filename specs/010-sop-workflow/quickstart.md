# Quickstart: SOP Workflow

**Feature**: `010-sop-workflow`
**Plan**: [plan.md](./plan.md)

This quickstart shows how to run the SOP Workflow locally and verify each user story end-to-end. It assumes Phases 1-9 are already implemented and the dev environment is running per `001-foundation/quickstart.md`.

## Prerequisites

- `pnpm i` from repo root.
- `.env.local` files in `packages/api` and `packages/widget` per Foundation quickstart.
- Local PostgreSQL via Docker (Foundation quickstart) — Phase 1 also supports SQLite for tests, but the SOP feature requires PG locally for the dashboard editor (Drizzle's transaction support).
- `GOOGLE_GENERATIVE_AI_API_KEY` set (Phase 3) — needed for date inference + Step 6 follow-up generation.

## One-Time Setup

```bash
# Apply this feature's schema migration (creates 5 new tables + 2 column additions)
pnpm --filter @legal-chatbot/api db:migrate

# Seed the dev account with the default SOP, 6 default case types, sub-types, goodbye phrases
pnpm --filter @legal-chatbot/api db:seed

# Start everything
pnpm dev
```

Expected output:
- API at http://localhost:3000
- Widget host at http://localhost:5173
- Database has new tables: `sop_configurations`, `sop_steps`, `case_types`, `sub_types`, `goodbye_phrases`
- Dev account has 1 published SOP with 5 default steps

## US1: Default SOP Happy Path

**Goal**: Verify all 5 default steps fire in order, chips appear for steps 1, 2, 5, and `captureLead` is invoked at finalization.

```bash
# Open the widget host:
open http://localhost:5173
```

Manual steps:
1. Click the launcher to open the chat panel. Verify a thin green progress bar appears at the top of the panel with label `0/5`.
2. The bot greets you and asks "What kind of legal matter can we help you with?". Verify case-type chips render (DUI, Criminal Defense, Personal Injury, Family Law, Drug Crime, Estate Planning).
3. Tap "DUI". Bot asks "What kind of DUI matter is this?". Verify sub-type chips render (First Offense, Repeat Offense, DUI with Injury, DUI with Property). Progress bar advances to `1/5`.
4. Tap "First Offense". Bot asks "Where did this happen?". No chips. Progress bar `2/5`.
5. Type "5th and Main, downtown". Bot asks "Can you briefly tell us what happened?". Progress bar `3/5`.
6. Type "I was pulled over for a DUI last night and arrested.". Bot asks "When did this happen?". Verify when-chips render. Progress bar `4/5`.
7. Tap "Yesterday". Progress bar `5/5`. Bot proceeds to Step 6: generates 2-5 follow-up questions tailored to a first-offense DUI (e.g., "Have you had any prior arrests?", "Was anyone injured?", "Have you taken a breathalyzer?").
8. Answer the follow-ups. Bot finalizes the lead. Behind the scenes `captureLead` was called.

Verification:
```bash
# Inspect the inserted lead
pnpm --filter @legal-chatbot/api db:query "SELECT classification, sop_state_snapshot FROM leads ORDER BY created_at DESC LIMIT 1"
```

Expected:
- `classification` is `hot` or `warm`.
- `sop_state_snapshot` is non-null JSON with `is_finalized=true`, all 5 steps `complete`.
- Server logs show events: `sop_step_completed` (×5), `sop_follow_up_generated`, `lead_captured` with `sop_finalization_reason='step_6_finalize'`.

## US2: Multi-Detail Skip Detection

**Goal**: Verify a single message answering multiple SOP steps marks all answered steps complete and skips ahead.

Manual steps:
1. Open a fresh chat panel (clear `sessionStorage`).
2. Bot asks "What kind of legal matter can we help you with?".
3. Type freeform: "I was in a car accident last week downtown and need help. It was a hit-and-run on 5th avenue.".
4. Verify the bot's next response acknowledges multiple captures and asks ONLY the earliest still-pending step (likely the sub-type step or "what happened" depending on which captured).
5. Progress bar advances by ≥ 2 in one step (e.g., from `0/5` to `3/5` or `4/5`).

Verification:
- Server logs show multiple `sop_step_inferred` events from the same turn.
- The pending step in the next response is the earliest unfilled one.

## US3: Off-SOP Detour

**Goal**: Verify mid-SOP off-topic question is answered, then the SOP step is re-prompted.

Manual steps:
1. Open a fresh chat panel.
2. Bot asks "What kind of legal matter can we help you with?".
3. Tap "Personal Injury".
4. Bot asks "What kind of Personal Injury matter is this?".
5. Type: "What are your office hours?" (off-topic mid-SOP).
6. Verify the bot answers with the configured office hours AND ends with "What kind of Personal Injury matter is this?" (re-prompts the pending step).
7. Progress bar stays at `1/5`.

Verification:
- Server logs show a `sop_off_topic_detour` event.

## US4: Progress Bar Engagement

**Goal**: Visual verification of progress-bar styling.

Manual steps:
1. Open the chat panel; verify bar is visible at the top with `0/5` label.
2. As you answer steps, verify each capture animates the bar with a smooth fill (300ms ease-out).
3. Verify the shimmer animation is visible on the filled portion.
4. Open browser DevTools → Rendering panel → enable "Emulate CSS media feature `prefers-reduced-motion: reduce`". Reload. Answer a step. Verify the bar updates instantly (no transition, no shimmer).
5. After Step 5 captures, verify the bar stays at 100% (does not regress on follow-up answers).

## US5: No-Goodbye Behavior

**Goal**: Verify the bot does NOT bid goodbye unless the visitor explicitly says one of the configured phrases.

Manual steps:
1. After answering a few SOP steps, type: "Okay great, that's helpful info." (NOT a goodbye phrase).
2. Verify the bot's response continues with the next pending SOP step (does NOT close with "Have a great day!" or similar).
3. Type: "thanks!" (configured goodbye phrase).
4. Verify the bot uses its configured polite closing.

## US6: Lawyer Configures Custom SOP

**Goal**: Verify the dashboard SOP editor saves + publishes a custom SOP.

Manual steps:
```bash
# Sign in to the dashboard:
open http://localhost:3000/dashboard/sop
```

1. Authenticate (per Phase 6 quickstart).
2. Verify the SOP editor shows the 5 default steps in order.
3. Drag-and-drop reorder: move "When did this happen?" above "Where did this happen?".
4. Click "Add step". Add a custom step: "Have you contacted any other lawyer about this?", chip source `inline`, chips `["Yes", "No"]`, `is_required=true`, `counts_toward_threshold=true`.
5. Click "Save". Verify a new draft version is created.
6. Click "Preview & Test" (Phase 6 §8.10) to test the new SOP in an isolated chat.
7. Click "Publish". Verify the live widget now uses the new SOP.

Verification:
```bash
pnpm --filter @legal-chatbot/api db:query "SELECT version, is_published FROM sop_configurations WHERE account_id='<dev-account-id>' ORDER BY version DESC"
```

Expected:
- New row with higher version, `is_published=true`.
- Previous version, `is_published=false`.

Open a fresh widget panel; verify the chat now uses 6 steps total (the 5 reordered defaults + the new custom step).

## US3.1 (Edge): Out-of-Scope Termination

**Goal**: Verify selecting an out-of-scope chip terminates the SOP gracefully and `captureLead` is invoked with `classification='out_of_scope'`.

Setup:
1. Dashboard → Case Types tab → mark "Estate Planning" as `is_in_scope=false`. Save.
2. Open fresh chat panel.
3. Bot asks "What kind of legal matter can we help you with?".
4. Tap "Estate Planning".
5. Verify the bot uses the configured out-of-scope deflection message.
6. Verify the SOP is finalized but progress bar still shows `1/5` (only Step 1 was captured).
7. Type a follow-up question about another matter — bot continues answering.

Verification:
- Server logs show `sop_out_of_scope_termination` and `lead_captured` with `sop_finalization_reason='out_of_scope_termination'`.

## Running the Full Test Suite

```bash
# Unit tests (state-machine, skip-detector, date-inferer, off-sop-detour, goodbye-detector, system-prompt-extension)
pnpm --filter @legal-chatbot/api test src/lib/sop

# Component tests (ProgressBar, Chips)
pnpm --filter @legal-chatbot/widget test

# Playwright E2E (full default-SOP path)
pnpm --filter @legal-chatbot/api test:e2e -- sop.spec.ts

# Eval suite (4 new SOP scenarios)
pnpm eval scenarios/sop-default-happy-path.yml
pnpm eval scenarios/sop-skip-detection.yml
pnpm eval scenarios/sop-off-sop-detour.yml
pnpm eval scenarios/sop-no-goodbye.yml
```

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| Progress bar not visible | Account has no published SOP; widget hides bar (FR-038) | Run `pnpm --filter @legal-chatbot/api db:seed` |
| Date inference always returns null | `GOOGLE_GENERATIVE_AI_API_KEY` missing | Set in `packages/api/.env.local` |
| Drag-and-drop in dashboard does nothing | `@dnd-kit/sortable` not installed | `pnpm --filter @legal-chatbot/api add @dnd-kit/sortable @dnd-kit/core @dnd-kit/accessibility` |
| Bot bids goodbye unprompted | Goodbye phrase list misconfigured (e.g., contains "ok") | Dashboard → Goodbye Phrases tab → review + save |
| Chips don't render in widget | `/api/config` response missing chip data | Verify the route was extended (per `sop-config-routes-contract.md`) |
| Existing accounts see no SOP after deploy | R11 lazy migration didn't run | First load of `/dashboard/sop` triggers migration; reload the page |

## Cleanup

```bash
# Reset to fresh defaults
pnpm --filter @legal-chatbot/api db:reset
pnpm --filter @legal-chatbot/api db:migrate
pnpm --filter @legal-chatbot/api db:seed
```

