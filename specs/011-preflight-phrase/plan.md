# Implementation Plan: Preflight Phrase

**Branch**: `011-preflight-phrase` | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the static 3-dot widget typing indicator (`● ● ●`) with a
query-tailored status phrase ("✨ Looking into your DUI matter…")
that appears within ~500ms of Send while the main agent stream
continues unchanged in parallel.

The implementation lives entirely inside three existing packages —
`packages/api` (route + helper), `packages/widget` (hook + ChatPanel
edit), `packages/shared` (Zod schemas). One new dependency consumed:
the `gemini-2.5-flash-lite` model from the same provider already used
for the main agent (`@ai-sdk/google`). No new SDKs.

The feature is **purely additive**. The main `/api/chat` flow is
untouched. If the preflight fails for any reason (timeout, error,
rate-limit, network drop), the widget falls back silently to today's
dots-only behavior — no error UI shown, no main flow interrupted.

A 4-phase rollout (backend → widget → observability → constitution
amendment) makes each piece independently revertible. Effort estimate:
~3-4 hours total.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation
constraint); module is ESM. Server-side code runs in Next.js Route
Handlers under Netlify Functions; client-side runs in the React widget.

**Primary Dependencies** (all already in scope; no new runtime deps):

- `ai` (Vercel AI SDK) — `generateObject` for the structured-output
  preflight call.
- `@ai-sdk/google` — Gemini provider; specifically `gemini-2.5-flash-lite`
  for the preflight call. The main agent continues using `gemini-2.5-flash`.
- `zod` — boundary validation for the new shared schemas.
- `@legal-chatbot/shared` — re-exports the new preflight schemas.
- React + `useEffect`/`useRef`/`useState` for the new hook. No new
  React ecosystem deps.

**Storage**: Read-only for this feature. No new tables, no new columns.
The existing `sessions.tokens_in/tokens_out` columns from §11.3 will
get incremented with preflight token usage in Phase C, but no schema
changes.

**Testing**:

- Vitest unit tests for `lib/preflight-phrase.ts` (helper) and
  `app/api/chat/preflight/route.ts` (route handler).
- Vitest unit tests for `usePreflightPhrase` hook — DEFERRED until
  widget Vitest+jsdom infra lands (T036/T048 from 010-sop-workflow);
  written as `[~]` placeholder.
- One new Playwright walk-tagged spec (`tests/e2e/widget-preflight-phrase.walk.spec.ts`)
  covering US1.

**Target Platform**: Same as upstream features — Netlify Functions
(serverless) for API; modern evergreen browsers for the widget.
Constitution IV invariants (no Server Actions, no native binaries,
CORS wildcard) inherited.

**Project Type**: Cross-cutting feature inside the existing pnpm +
Turborepo monorepo. No new workspace packages.

**Performance Goals**:

- Preflight server-side: ≤800ms hard timeout via `AbortController`;
  typical ~250-400ms.
- Preflight client-side: ≤1000ms hard timeout (just above server).
- Phrase visible within 1.5s of Send for ≥80% of turns (test threshold).
- Main `/api/chat` latency: unchanged (preflight runs in parallel).

**Constraints**:

- TS strict (Constitution II).
- All new boundary inputs Zod-validated (Constitution II): preflight
  request body, response body, model's structured output.
- No Server Actions in the new route (Constitution IV; Route Handler
  pattern only).
- No native binaries added (Constitution IV; same `@ai-sdk/google`
  already in use is pure JS).
- Logger redaction (Constitution V): preflight log payloads MUST NOT
  contain raw message content or phrase content. Token counts and
  outcome-string only.
- Token budget (§7.7): preflight is OUT-OF-BAND from the main agent's
  ~4500-token cap — it has its own separate prompt of ~300 tokens +
  response of ~10-30 tokens. Negligible.
- Per-account daily rate-limit pool: per FR-003, preflight counts
  against the same 1000-conversations cap. Net effect is 500
  conversation-equivalents/day (open question in spec for production
  scale).
- Constitution VI: preflight is NOT a tool call; it does NOT count
  against the existing `maxSteps: 5` cap. It IS a separate Gemini call.

**Scale/Scope**: Per visitor turn, +1 LLM call (~330 tokens, ~$0.0001-0.0003).
At MVP scale (≤1000 conv/day per account), this adds ~$0.10-0.30/day
per account in cost. Acceptable.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Preflight applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | The preflight phrase is a §6 widget UX enhancement. Not in §10 "Out of Scope (MVP)"; explicitly improves the §1.7 success metric (perceived response latency). All FRs cite spec sections. No scope creep. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | New shared Zod schemas in `packages/shared/src/schemas/preflight.ts`; preflight route body + response Zod-validated; LLM structured-output schema enforced via `generateObject`. | ✅ PASS |
| III | Test-First, Layered Testing | Route handler unit tests written before implementation (covers all 6 failure paths + happy). Helper unit tests written before implementation. Widget hook tests written but deferred `[~]` until widget Vitest infra lands (T036/T048). Playwright walk spec covers US1 happy path. | ✅ PASS — with one acknowledged `[~]` per existing pattern |
| IV | Serverless-Compatible & Stateless | Route Handler only (no Server Actions); preflight is HTTP-stateless (no fs writes, no in-memory state across requests); no new native deps; CORS wildcard preserved on the new route. | ✅ PASS |
| V | Privilege & Privacy | Preflight logs explicitly forbid raw message content and phrase content (FR-021); only metadata. Post-filter regex strips email/phone-like patterns from the phrase before returning (FR-007). System prompt forbids verbatim restatement of visitor message and PII echo. Defense in depth. | ✅ PASS |
| VI | Bounded, Observable, Cost-Aware Agent | Preflight is OUT-OF-BAND from the main agent's `maxSteps: 5` (it's a separate, single-shot `generateObject` call, not a tool). Counts against the existing per-account daily 1000-conversation cap. Token usage recorded into the per-conversation tally (Phase C). Adds ~2-6% per-turn token cost. Structured log emission planned (FR-020). | ✅ PASS |
| VII | Phased Incremental Delivery | Single feature, 4 phases (A: backend, B: widget, C: observability, D: constitution amendment). Each independently revertible. Phases A and C are dark (no UI change). Phase B is the visible UX flip. Constitution amendment is its own PR per §Governance rules. | ✅ PASS |

**Architectural Limits**:

- Per-conversation messages cap of 50 (§11.1) inherited unchanged.
- Per-key daily cap of 1000 (§11.1) inherited; **see open question in
  spec §Open questions about whether preflight should count against
  this same pool** (currently it does, per FR-003).
- LLM tool-call recursion `maxSteps ≤ 5` (§7.2) inherited and unaffected
  (preflight is not a tool).
- Token budget ~4500 (§7.7) inherited unchanged for the main agent;
  preflight has its own ~330-token budget out-of-band.
- Widget bundle size ≤ 35 KB / 50 KB gz (§6.10) inherited; the new
  hook adds ≤500 bytes of pure JS. Bundle-size CI gate (Phase 8 R3)
  will catch any regression.

**Required model amendment**: Constitution §IV Required Stack today
lists only `gemini-2.5-flash` as the LLM. This feature adds a SECOND
model (`gemini-2.5-flash-lite`) to the same provider for preflight-only
use. This is a MINOR amendment per §Governance versioning rules:
adds an option without invalidating prior compliance.

The amendment is Phase D of this rollout. Until that lands the
implementation is technically Constitution-blocked, but in practice
every prior phase compiles and runs without it (the model name is a
string passed to `@ai-sdk/google`, not a structural dependency). I'll
ship Phase A-C with a note pointing at the amendment, then land the
amendment + bump the constitution version (1.0.0 → 1.1.0) in Phase D.

**Result**: All gates PASS contingent on the Constitution amendment
landing as Phase D of the rollout. Re-checked after Phase 1 design
artifacts below.

## Project Structure

### Documentation (this feature)

```text
specs/011-preflight-phrase/
├── plan.md
├── research.md
├── data-model.md           # New shared schemas only — no DB additions
├── quickstart.md
├── contracts/
│   ├── preflight-route-contract.md       # POST /api/chat/preflight wire shape
│   └── preflight-hook-contract.md        # usePreflightPhrase widget API
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (touchpoints across packages)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/shared/src/
├── schemas/
│   ├── preflight.ts                     # ❌ NEW — preflightRequestSchema, preflightResponseSchema
│   └── index.ts                         # ⚠ EXTEND — re-export preflight.ts

packages/api/src/
├── lib/
│   ├── preflight-phrase.ts              # ❌ NEW — generatePreflightPhrase helper
│   └── preflight-phrase.test.ts         # ❌ NEW — helper unit tests
├── app/
│   └── api/
│       └── chat/
│           └── preflight/
│               ├── route.ts             # ❌ NEW — POST /api/chat/preflight handler
│               └── route.test.ts        # ❌ NEW — route handler unit tests

packages/widget/src/
├── hooks/
│   ├── usePreflightPhrase.ts            # ❌ NEW — the hook
│   └── usePreflightPhrase.test.ts       # ❌ NEW — deferred [~] until widget test infra
├── components/
│   └── ChatPanel.tsx                    # ⚠ EDIT — wire hook + bubble swap

packages/api/tests/e2e/
└── widget-preflight-phrase.walk.spec.ts # ❌ NEW — Playwright walk-tagged spec

.specify/memory/
└── constitution.md                      # ⚠ EDIT — Phase D: add gemini-2.5-flash-lite to §IV
```

**Structure Decision**: All new code lives inside the existing
`packages/api`, `packages/widget`, and `packages/shared` per the
established Phase 6 R1 co-location decision. NO new workspace packages.
The new `lib/preflight-phrase.ts` follows the same one-module-per-concern
pattern used by `lib/sop/*.ts` (010-sop-workflow). The new hook follows
the widget's existing `hooks/useSOPState.ts` pattern.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Adding a 2nd LLM model (`gemini-2.5-flash-lite`) | The main agent's `gemini-2.5-flash` would also work but is ~3x slower and ~3x more expensive per call. For a fire-and-forget preflight that produces a 5-7 word phrase, the lite model gives equivalent UX value at ~30% the cost and ~50% the latency. | **`gemini-2.5-flash`**: same UX but adds ~$0.0003/turn instead of ~$0.0001/turn (2-6x cost). At 100k conv/day production scale that's $300-600/year vs $100-200/year. Worth the constitution PATCH. <br> **Regex/keyword classifier (no LLM)**: cheapest but produces awkward phrases ("Looking up…") that don't actually feel tailored. Defeats the goal. <br> **No new model — reuse `flash`**: feasible technically but loses the latency advantage. Phrase appears at ~600-800ms instead of ~250-400ms; cuts the visible-before-agent-streams window in half. |
