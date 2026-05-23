# Phase 0 Research: SOP Workflow

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the SOP
Workflow feature against `product-spec-legal-chatbot.md` (§2.6,
§4.3 Section C, §7.5, §7.7, §7.8, §11.1) and the Lex Bot
Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers in the Technical
Context — all 12 R-items below are gap-fill / new-build
decisions for this feature.

## R1. Default SOP Seed and Case-Type Library

**Decision**: The default SOP and the seed list of case types + sub-types are committed to the repo as a TypeScript constant in `packages/api/src/db/seed-defaults/sop.ts`. The `pnpm db:seed` script reads from this constant and inserts:

- One default `sop_configurations` row per fresh account with `version=1`, `is_published=true`.
- Five default `sop_steps` rows for that configuration (case-type, sub-type, where, what, when), in order, with the canonical question text from spec.md FR-001.
- ~6 default `case_types` rows (DUI, criminal defense, personal injury, family law, drug crimes, estate planning) with `is_in_scope=true`.
- ≥3 `sub_types` per case_type (e.g., personal injury → car accident, slip and fall, medical malpractice, dog bite; DUI → first offense, repeat offense, DUI with injury, DUI with property damage).
- Default `goodbye_phrases` rows (English): "bye", "goodbye", "thanks", "thank you", "good night", "see you", "that's all".

**Rationale**:
- FR-004 binds the seed mechanism via Foundation `pnpm db:seed`.
- FR-009 binds 6 default case types each with ≥ 3 sub-types.
- A TS constant (vs. a JSON or YAML file) gives type-checking against the shared Zod schema at compile time.
- Per-account seeding (vs. global) lets each lawyer's customizations remain independent — Constitution V (account-scoped data).

**Alternatives considered**:
- **Global default rows shared across accounts**: rejected. Lawyers would inadvertently affect each other's chips when editing.
- **Lazy seed on first chat**: rejected. The progress bar and chip UI need the SOP to exist by the time the dashboard loads, not at first chat.
- **JSON seed file**: rejected. TS gives type-checking; JSON loses the Zod validation at compile time.

**Implementation notes**:
- Seed is idempotent per Foundation contract: existing accounts that already have an SOP are skipped (R11 covers the legacy migration path).
- Sub-type lists are intentionally rich (≥ 3 each) so the chip UI looks complete out of the box; lawyers can prune.
- Out-of-scope chip example: a criminal-defense firm might mark "Estate Planning" as `is_in_scope=false` so visitors selecting it get the deflection.

## R2. Chip Data Model and Wire Format

**Decision**: Chips are NOT a separate data type — they are derived from `sop_steps.chip_source` which references either:

- A literal array of `{ label, slug }` pairs stored in the step row itself (e.g., for the "When" step's relative-date chips like "today", "yesterday", "this week").
- A foreign-key-style reference to `case_types` (for Step 1) or `case_types.id → sub_types` (for Step 2).

The agent's system prompt tells the LLM about the available chip slugs for the current step; the widget receives the chip labels via the `/api/config` extension to render them as buttons. Chip taps dispatch the slug as the user message text (so the existing `useChat` flow works unchanged).

**Rationale**:
- §6.5 already binds quick-reply chips to the `/api/config` endpoint; this feature extends that endpoint with per-step chip data.
- Treating chips as part of `sop_steps` (not a separate `chips` table) keeps the data model simple and matches the user description ("the list of these case types ... must come from a database that will be seeded with some default values and will be configurable").
- A polymorphic `chip_source` column (literal array OR FK reference) keeps the schema flexible: case-type/sub-type chips reference live tables; relative-date chips are inline static labels.

**Alternatives considered**:
- **Always inline chip arrays**: rejected. Case-type and sub-type chip lists are per-account and edited from a dedicated dashboard tab; storing them inline in every SOP step row would duplicate data.
- **Separate `chip_lists` table**: rejected. Adds a level of indirection without benefit — there are only two natural sources (case_types/sub_types tables, or step-local literal arrays).

**Implementation notes**:
- The `/api/config` response shape extends with `current_sop_step` info: `{ step_id, label, chips: Array<{ label, slug }> | null, accepts_free_text: boolean }`.
- Chip-tap dispatches the chip's `label` (not slug) as the visible user message; the agent's skip-detector matches on slug equivalents server-side. This keeps the user-visible UI human-readable.

## R3. Date Inference for "When did it happen?"

**Decision**: Add `lib/sop/date-inferer.ts` that calls the existing Gemini model (`@ai-sdk/google` provider, already wired in `004-chat-api-agent`) with a small structured-output prompt:

```
Convert the following natural-language date expression to an ISO 8601 date,
relative to today's date (passed in the prompt).
Return JSON: { "iso_date": "YYYY-MM-DD" | null, "confidence": 0..1 }.
If you cannot confidently parse the expression, return null with low confidence.

Today: {todayISO}
Expression: {userText}
```

Confidence threshold: ≥ 0.6 → captured value used; < 0.6 → step NOT marked complete, agent asks a clarifying question (FR-014).

**Rationale**:
- FR-013 binds the AI date inference. The existing agent already has Gemini wired; reusing the same provider keeps the dep surface flat.
- A structured-output prompt is faster + cheaper than a free-form chat completion (Gemini supports `responseMimeType: 'application/json'`).
- A confidence threshold is the cheapest signal for "step incomplete" without requiring a separate classifier.

**Alternatives considered**:
- **Pure-JS date parser** (`chrono-node`): viable for many cases, but the user description specifically calls out AI inference. Hand-rolled regex misses long-tail expressions ("a couple weekends ago"). Chrono is also a non-trivial dep.
- **Always parse; never ask clarifying questions**: rejected. Spec edge case "Visitor's 'When' answer is unparseable" mandates a clarifying follow-up.

**Implementation notes**:
- The inference call counts toward the agent's `maxSteps: 5` budget when triggered as a tool. Alternative: invoke it as a non-tool helper from the route handler before tool-calling begins. Decision: helper invocation, not a tool — it's deterministic and has no agent-orchestration value.
- Cache: each conversation's "today" is the conversation's `created_at` (per FR-042 anchor) — relative dates resolve against the conversation start, not the moment of the LLM call. This makes resumed-session date inference deterministic.

## R4. Skip Detection

**Decision**: Add `lib/sop/skip-detector.ts` with a single function `detectSkippedSteps(message, currentSOPState, sopConfig)` that returns a list of `{ step_id, captured_value, confidence }`. Implementation strategy:

1. **Phase A — Pattern-based extraction** (fast, ~µs): regex/keyword passes for:
   - Case-type slug match (against active `case_types` slugs).
   - Sub-type slug match.
   - Date expression presence (run `date-inferer.ts` with low confidence threshold).
   - Free-text where/what extraction (proper nouns, locations, accident keywords).
2. **Phase B — LLM disambiguation** (only if Phase A produced ambiguous matches): a single Gemini call with the visitor message + the list of pending SOP steps + ambiguous candidates, asking which steps the message answers.

The detector returns ONLY high-confidence matches; ambiguous matches are dropped (FR-018).

**Rationale**:
- FR-016 to FR-019 bind the skip-detection contract.
- Phase A handles the common case (visitor types "I had a DUI last night at the corner of 5th and Main") cheaply.
- Phase B handles edge cases the regex misses without ALWAYS spending a second LLM call.

**Alternatives considered**:
- **Pure LLM detection on every message**: rejected. Doubles the LLM cost; a regex match for "DUI" or a known case-type slug is free.
- **Pure regex/keyword detection**: rejected. Misses paraphrased answers like "I'm being charged with a drunk driving offense" which a regex for "DUI" misses.

**Implementation notes**:
- The detector is stateless w.r.t. the agent — it inspects message text + SOP state and returns a list of captures. The state machine (R5) consumes the list.
- Phase A uses the `case_types.slug` field for normalization (Constitution II — Zod-typed slugs).
- Phase B is gated: only triggered if Phase A produced 0 high-confidence matches AND ≥ 2 SOP steps are still pending. This bounds the cost.

## R5. SOP State Machine and Off-SOP Detour

**Decision**: Add `lib/sop/state-machine.ts` exporting `advanceSOP(state, action)` and `nextPendingStep(state, sopConfig)`. The state machine consumes:

- `state`: `SOPState` per data-model.md (per-step status, captured values, pending pointer).
- `action`: one of `{ type: 'capture_step', step_id, value }`, `{ type: 'skip_step', step_id }`, `{ type: 'mark_off_sop_detour' }`, `{ type: 'finalize' }`.

The state machine returns a new `SOPState` (immutable update). The route handler in `004-chat-api-agent` calls it after each turn to compute the post-turn state.

For **off-SOP detour** (FR-020 to FR-023): a separate helper `lib/sop/off-sop-detour.ts` analyzes the visitor message against the pending SOP step's expected answer shape. If the message is clearly off-topic (no SOP captures from R4's skip-detector AND no chip slug match for the pending step), the detour helper:

1. Logs a `sop_off_topic_detour` event.
2. Returns a system-prompt instruction to the agent: "Answer the visitor's question, then ask: <pending step's question text>".

**Rationale**:
- FR-020 binds the off-SOP detour behavior.
- A pure-functional state machine (immutable updates, no side effects) is testable in isolation.
- The off-SOP detour is a system-prompt instruction (not a hardcoded suffix on the response) so the agent's natural conversational tone is preserved while still ending with the SOP prompt.

**Alternatives considered**:
- **Hardcoded suffix appender**: rejected. The agent's response stream cannot be safely post-processed (it's already streaming).
- **Two-pass agent call**: rejected. Doubles latency; the system-prompt instruction approach lets the LLM weave the SOP question naturally.

**Implementation notes**:
- The state machine's transitions are exhaustively unit-tested.
- The off-SOP detour helper's "is this off-topic" classifier is a small heuristic: if the visitor message has 0 R4 captures AND no chip-slug match for the pending step AND the pending step's question text shares ≤ 1 keyword with the message → off-topic. Otherwise → not off-topic (let the SOP step's normal handling proceed).

## R6. AI Follow-Up Tool (Step 6)

**Decision**: Implement Step 6 as a new Vercel AI SDK tool registered in `004-chat-api-agent`'s route. The tool, `analyzeAndFollowUp`, takes the captured SOP state and decides one of two outcomes:

- Generate 2–5 follow-up questions tailored to the matter.
- Decide existing information is sufficient and emit a finalization message.

```ts
const analyzeAndFollowUp = tool({
  description: 'Run after all SOP steps complete. Either generate 2-5 tailored follow-up questions or signal that the lead is ready to finalize.',
  parameters: z.object({
    sop_captures: z.record(z.string(), z.string()),  // step slug → captured value
  }),
  execute: async ({ sop_captures }) => {
    // Gemini call with structured output: { mode: 'follow_up' | 'finalize', questions?: string[], finalization_message?: string }
    // Hard cap: max 5 questions.
    return result;
  },
});
```

The agent calls this tool after the state machine indicates all required SOP steps are complete. The tool's result is returned to the agent which weaves it into the next response.

**Rationale**:
- FR-024 to FR-028 bind the Step 6 contract.
- Implementing as a tool (not inline LLM call) lets the agent decide when to invoke (e.g., after 4/5 steps if visitor info is rich; after 5/5 normally).
- Counts toward `maxSteps: 5` (Constitution VI).

**Alternatives considered**:
- **Hardcoded follow-up questions per case-type**: rejected. User description says "AI analysis" — a static list defeats the purpose.
- **Skip Step 6 entirely**: rejected. FR-024 binds it.

**Implementation notes**:
- Hard cap: 5 questions max enforced server-side regardless of model output (FR-026).
- Failure path: on LLM error, fall back to `mode: 'finalize'` with a generic finalization message (FR-028).
- Logging: emit `sop_follow_up_generated` (count + truncated question previews) or `sop_finalized` (FR-058).

## R7. Goodbye Detection

**Decision**: Add `lib/sop/goodbye-detector.ts` with a single function `detectGoodbye(message, configuredPhrases)`. Implementation: case-insensitive substring match on `configuredPhrases`. The detector returns `{ matched: boolean, phrase?: string }`.

The route handler runs the detector after each visitor message (BEFORE invoking the SOP detour or skip-detection). If matched, the agent's response uses the configured polite closing message (per FR-032).

**Rationale**:
- FR-029 to FR-032 bind goodbye behavior.
- Substring match is the simplest correct approach. Phrase list is configurable from the dashboard so lawyers can add culture-specific phrases.

**Alternatives considered**:
- **LLM intent classification**: rejected. Deterministic substring match is reliable and free.
- **Regex with word boundaries**: refinement, not alternative. Decision: use word-boundary regex (`\b`) to avoid false positives like "byelaw" matching "bye". Implemented in code as `new RegExp('\\b' + escapeRegex(phrase) + '\\b', 'i')`.

**Implementation notes**:
- Default goodbye phrases seeded in `goodbye_phrases` table per FR-030.
- The detector's output flows into the system-prompt extension: when matched, the prompt instructs the agent to use the closing message; when not matched, the prompt instructs the agent to end with an open re-prompt (FR-031).

## R8. Progress Bar UX

**Decision**: Implement `<ProgressBar>` as a new component in `packages/widget/src/components/ProgressBar.tsx` per `005-chat-widget`'s component conventions. Layout:

- **Mobile (full-screen panel)**: bar sits above the sticky header.
- **Tablet/Desktop (floating panel)**: bar sits at the very top of the panel chrome, above the chatbot-name title.

Visual specs:
- Height: 3px (within FR-033's "≤ 4 px").
- Color: CSS custom property `--lc-progress-color` (default: `#22c55e`, a green that satisfies WCAG AA contrast on the default `--lc-background: #ffffff`).
- Fill: smooth CSS transition (`transform: scaleX(<ratio>)` with `transform-origin: left`) over 300ms.
- Shimmer: a subtle linear-gradient animation (CSS `@keyframes` translating a highlight band left-to-right) on the FILLED portion only.
- Label: `<x>/<N>` text in 11px font in the top-right of the bar; on viewports < 360 px the label is hidden via media query (visual snapshot test enforces).

Reduced motion (`prefers-reduced-motion: reduce`):
- Transition: `transition: none`.
- Shimmer: animation removed.
- The bar still updates instantly on captures (FR-036, FR-013 of `005-chat-widget`).

**Rationale**:
- FR-033 to FR-040 bind the bar's contract.
- Reusing CSS custom properties (per `005-chat-widget` theming contract) lets lawyers re-color the bar without code changes.
- A `transform: scaleX` transition is GPU-accelerated; a `width` transition would force layout. Standard UI optimization.

**Alternatives considered**:
- **SVG-based progress bar**: rejected. CSS is lighter; the bundle-size CI gate (Phase 4 R8) is tight.
- **Pre-rendered shimmer image**: rejected. Adds an asset; pure CSS keyframes are smaller and respect `prefers-reduced-motion`.

**Implementation notes**:
- The component receives `current` (captured count) + `total` (configured threshold) as props.
- The widget's `useSOPState` hook reads SOP state from response headers (`x-sop-state`, JSON-encoded) on every chat-API response and updates a React state passed to `<ProgressBar>`.
- A bundle-size budget impact estimate: ~1 KB gzipped for the component. Stays within `005-chat-widget` budgets.

## R9. SOP State Persistence

**Decision**: Add a new column `sop_state_json text` to the existing `sessions` table (Foundation schema, §2.6). Stored as a JSON-serialized `SOPState` shape (per data-model.md). On every successful chat turn the route handler:

1. Reads existing `sop_state_json` (or initializes from the firm's published SOP if the session is fresh).
2. Runs skip-detection + state-machine transitions.
3. Persists the new `sop_state_json` in the same `appendMessages` call that already updates `messages_json` (Phase 3 / `004-chat-api-agent` lib/session.ts).

The widget receives the current SOP state on each response via a custom header (`x-sop-state`, JSON-encoded compact representation: `{ current: number, total: number, pending_step_id?: string }`).

**Rationale**:
- FR-041 binds session-scoped persistence.
- Co-locating SOP state with `messages_json` on the same row keeps writes atomic (single transaction).
- A custom header (vs. embedding in the streaming response body) lets the widget update the progress bar BEFORE the assistant's text arrives.

**Alternatives considered**:
- **Separate `sop_state` table keyed by session_id**: rejected. Adds a JOIN on every read; co-located JSON column is simpler.
- **Redirect SOP state through `messages_json`** (e.g., as a synthetic system message): rejected. Pollutes the visitor-facing message history.
- **Server-Sent Events with SOP-state events embedded in the AI SDK stream**: viable but the AI SDK's stream protocol is text + structured-tool-call only; injecting custom events requires forking. The header approach is simpler.

**Implementation notes**:
- The `x-sop-state` header is exposed via `Access-Control-Expose-Headers` in the existing CORS middleware (Phase 3 `cors.ts`).
- The widget's `useChat` hook's `onResponse` callback parses the header and updates state.
- Resumed sessions (per `005-chat-widget` `sessionStorage` pattern): the chat panel reads SOP state from the `x-sop-state` response header on the next chat turn. There is no separate "fetch conversation history" endpoint in MVP — the widget's resumed-session restoration relies on the existing per-turn header propagation.

## R10. Dashboard SOP Editor

**Decision**: Implement the SOP editor as a new dashboard page at `/dashboard/sop` per the existing Phase 6 R1 co-location (lives under `packages/api/src/app/dashboard/sop/`). Components:

- **`page.tsx`**: server-rendered shell with auth guard.
- **`sop-editor.tsx`**: client component. Drag-and-drop reordering via `@dnd-kit/sortable`. Each step rendered as a card showing question text + chip-source + flags + "edit" button.
- **`step-form.tsx`**: modal/inline form for adding or editing a step. Fields: question text, chip source (none / case-types / sub-types / inline literal array), `required` flag, `counts_toward_threshold` flag, position.
- **`case-types-tab.tsx`**: separate tab for editing the case-type list and per-case-type sub-types. Drag-and-drop reordering. Toggle `is_in_scope` per case type.
- **`goodbye-phrases-tab.tsx`**: simple list editor for the configurable goodbye phrase list.

Save / Publish actions reuse the existing `POST /api/dashboard/config` versioning model from Phase 6 (`007-dashboard` plan R8 — version history + rollback applies). New routes: `POST /api/dashboard/sop` (with discriminated `action` field for save / publish / rollback) and `POST /api/dashboard/sop/case-types` for case-type CRUD.

**Rationale**:
- FR-045 to FR-054 bind the editor.
- `@dnd-kit/sortable` is the modern React DnD library; pure JS; widely used; small bundle (~6KB gz).
- Reusing Phase 6's versioning model keeps SOP changes auditable + rollback-able.

**Alternatives considered**:
- **`react-beautiful-dnd`**: deprecated by Atlassian; `@dnd-kit/sortable` is the maintained successor.
- **Server Actions for save/publish**: rejected per Constitution IV.
- **Build a custom DnD from scratch**: rejected — accessibility (keyboard reorder, screen reader announcements) is non-trivial; `@dnd-kit` ships with `@dnd-kit/accessibility` helpers.

**Implementation notes**:
- Add `@dnd-kit/sortable`, `@dnd-kit/core`, `@dnd-kit/accessibility` to `packages/api/package.json` `dependencies` (the dashboard is co-located with the API per Phase 6 R1).
- Route handler uses Zod to validate the SOP shape on save (Constitution II).
- Preview chat (`007-dashboard` §8.10) automatically picks up the unpublished SOP version because its preview-mode flag uses the latest config (`x-preview: true`).

## R11. Legacy `qualifying_questions` Migration

**Decision**: Add a one-shot migration helper in `packages/api/src/db/migrate-legacy-qualifying-questions.ts`. When the dashboard SOP page loads for an account whose `sop_configurations` table is empty AND whose `configurations` table has rows with non-empty `config_json.qualifying_questions`:

1. Read the most recently published configuration's `qualifying_questions` array.
2. Auto-generate an `sop_configurations` row with `version=1, is_published=true, derived_from_legacy=true`.
3. Auto-generate `sop_steps` rows: prepend the 5 default steps (case-type → sub-type → where → what → when), then append each legacy question as a custom step with `chip_source=null, required=true, counts_toward_threshold=false` (the threshold defaults to 5 = the default-step count).
4. Mark the legacy `qualifying_questions` field in `config_json` with a deprecation note: `"deprecated_in_favor_of": "sop_configurations"`.

The migration is **idempotent** (re-runs are no-ops).

**Rationale**:
- FR-056 binds the migration.
- Running on first dashboard load (vs. on deploy) lets each account migrate at the lawyer's own cadence without forcing a system-wide downtime.
- Preserving the legacy questions as custom SOP steps preserves the lawyer's prior work; they can rearrange or delete after migration.

**Alternatives considered**:
- **Hard cutover at deploy**: rejected. Lawyers would lose their custom questions.
- **Run migration in a Netlify deploy hook**: rejected. Per-account state is hard to manage in a deploy hook; lazy/on-load is simpler.
- **Migrate via a separate CLI command**: rejected. Lawyers wouldn't know to run it; on-load is automatic.

**Implementation notes**:
- The migration is idempotent: it checks for existing `sop_configurations` rows before inserting.
- The original `qualifying_questions` field stays in `config_json` (not deleted) so the migration can be re-run if needed.
- Logged as `legacy_sop_migration` event with `{ account_id, migrated_step_count }`.

## R12. Observability and Audit

**Decision**: Add structured-log events for every SOP transition, emitted via the Foundation logger:

| Event | Trigger | Payload |
|---|---|---|
| `sop_step_completed` | A step transitions to `complete` | `{ step_id, step_label, captured_value_summary }` |
| `sop_step_skipped` | A step transitions to `skipped` (refusal-to-answer) | `{ step_id, step_label, reason }` |
| `sop_step_inferred` | Skip-detector matched | `{ step_id, step_label, source: 'pattern' \| 'llm' }` |
| `sop_off_topic_detour` | Off-SOP detour triggered | `{ pending_step_id, message_token_count }` |
| `sop_finalized` | Step 6 emitted finalization | `{ outcome: 'follow_up' \| 'finalize', follow_up_count? }` |
| `sop_follow_up_generated` | Step 6 generated follow-ups | `{ count, question_topics: string[] }` |
| `sop_qualified` | Threshold reached | `{ captured_count, threshold }` |
| `sop_out_of_scope_termination` | Out-of-scope chip selected | `{ case_type_slug }` |
| `legacy_sop_migration` | One-shot migration ran | `{ account_id, migrated_step_count }` |

The captured SOP state at completion is persisted on the lead row's `sop_state_snapshot` field (FR-059), so the lawyer can review captured answers in the dashboard's lead detail view.

Foundation logger redaction list applies (Constitution V): `captured_value_summary` MUST NOT contain raw user message content; it is a 30-char truncated summary with PII fields (email, phone, name regexes) redacted.

**Rationale**:
- FR-058 to FR-060 bind observability.
- Structured events let the conversation-quality eval suite (Phase 8 R5) detect SOP-flow regressions deterministically.
- A `sop_state_snapshot` column on the `leads` row gives Phase 6 dashboard's lead detail view (§8.6) a place to render the SOP responses.

**Alternatives considered**:
- **Embed SOP state in `leads.classification_rationale`**: rejected. That field is for the LLM's rationale; mixing in SOP captures pollutes its semantics.
- **Re-derive SOP state from session at lead-detail render time**: viable but couples the dashboard to the session's storage; snapshot at finalization is simpler.

**Implementation notes**:
- The `leads.sop_state_snapshot` column is added by this feature's schema migration (R-schema in data-model.md).
- The `captureLead` tool's execute body (Phase 5 `006-lead-classification`) is extended to accept a `sop_state` param and persist it.

## Constitution Cross-Reference Summary

| Constitution element | SOP Workflow decision | Aligned |
|---|---|---|
| I (MVP-First) | All decisions cite §-anchors and FR numbers; no scope creep beyond the 6 user stories | ✅ |
| II (Type Safety) | New shared Zod schemas in `packages/shared/src/schemas/sop.ts`; SOP CRUD bodies Zod-validated; chip lists Zod-typed via Drizzle; SOP state shape Zod-validated on read/write | ✅ |
| III (TDD layered) | Each new helper has a test file (state-machine, skip-detector, date-inferer, off-sop-detour, goodbye-detector, system-prompt-extension); component tests for `<ProgressBar>` + `<Chips>`; Playwright E2E covering full SOP path; 4 new eval scenarios | ✅ |
| IV (Serverless / Stateless) | Route Handlers only (no Server Actions); `@dnd-kit/sortable` is pure JS (verified); SOP state lives on existing `sessions` row (no new fs writes); Phase 8 invariants script catches regressions at PR time | ✅ |
| V (Privilege & Privacy) | Foundation logger redaction extended for SOP captures; account-scoped queries on every SOP read; out-of-scope deflection routes preserved | ✅ |
| VI (Observable Agent) | `analyzeAndFollowUp` tool counts toward existing `maxSteps: 5`; SOP-state injection respects the §7.7 ~4500 token budget; structured-log events for every SOP transition | ✅ |
| VII (Phased Delivery) | Cross-feature touches are coordinated via existing contracts of `004`-`007`; legacy `qualifying_questions` migration is one-shot + idempotent + per-account on-load | ✅ |
| Required Stack | One new dep: `@dnd-kit/sortable` + companions (pure JS, dashboard-only). Documented in plan.md Complexity Tracking; Constitution Required Stack lists "dashboard tech stack" as Next.js + Tailwind without forbidding additions | ✅ |
| Architectural Limits | Inherits all upstream limits (50 msg/conv, 1000 conv/day/key, maxSteps:5, ~4500 token cap, widget bundle ≤35/50KB gz). New SOP-state header + `<ProgressBar>` add ~1KB to widget bundle within budget | ✅ |

## Open Questions — None

All decisions resolve cleanly against the source spec, the user description, and the existing 9-feature stack. No `NEEDS CLARIFICATION` markers remain. Ready to proceed to Phase 1.

