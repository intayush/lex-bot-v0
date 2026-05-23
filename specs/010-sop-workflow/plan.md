# Implementation Plan: SOP Workflow

**Branch**: `010-sop-workflow` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-sop-workflow/spec.md`

## Summary

The SOP Workflow defines a configurable, ordered, chip-driven intake flow the chat assistant follows to capture lead-qualification information. It supersedes the §7.5 system-prompt-driven "qualifying questions" flow already in production (`004-chat-api-agent`'s `system-prompt.ts` lines listing `config.qualifying_questions`) and replaces the §4.3 Section C dashboard surface with a richer drag-and-drop SOP editor.

This is a **cross-cutting feature**: it touches every layer of the existing 9-feature stack:

- **Foundation (`001`)**: new schema entities (SOP configurations, SOP steps, case types, sub-types, goodbye phrases, SOP-state column on sessions); shared Zod schemas for the new types in `packages/shared/src/schemas/sop.ts`.
- **Context Search (`003`)**: unchanged.
- **Chat API + Agent (`004`)**: system-prompt extension to inject SOP state; new `analyzeAndFollowUp` tool for Step 6; date-inference helper invoked on Step 5 inputs; off-SOP detour logic that ends every off-topic response with the next SOP step prompt.
- **Chat Widget (`005`)**: new `<ProgressBar>` component at top of panel; new chip rendering inside the message stream; `prefers-reduced-motion` respected; new `--lc-progress-color` CSS custom property.
- **Lead Classification (`006`)**: `captureLead` invoked at SOP completion / out-of-scope termination; SOP captured values feed the tool params.
- **Dashboard (`007`)**: new `/dashboard/sop` editor page; reorder via drag-and-drop; CRUD on SOP steps, case types, sub-types, threshold, goodbye phrases; configuration versioning + Preview integration.
- **Hardening (`008`)**: per-session debug mode (R8 of that feature) gains visibility into SOP transitions.
- **Deployment (`009`)**: SOP and chip-list seeds deployed alongside the API; eval suite gains 4 new scenarios covering the SOP flow.

The default SOP ships pre-seeded with 5 ordered steps (case-type → sub-type → where → what → when), 6 default case types each with ≥ 3 sub-types, and a default qualified-lead threshold of 5. Lawyers customize from the dashboard; changes go through the existing configuration versioning model from Phase 6.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation constraint); module is ESM. Server-side code runs in Next.js Route Handlers under Netlify Functions; client-side runs in the React widget.

**Primary Dependencies** (already in scope; no new runtime deps required):

- `drizzle-orm` + `@neondatabase/serverless` — DB writes for new tables/columns.
- `zod` — boundary validation for new shared schemas.
- `nanoid` — IDs for new entities.
- `ai` (Vercel AI SDK) — `streamText` + `tool` for Step 6 `analyzeAndFollowUp` tool, reusing the existing `maxSteps: 5` cap.
- `@ai-sdk/google` — Gemini provider for date inference + follow-up generation; no new provider.
- `@legal-chatbot/shared` — new SOP schemas exported.
- `react` + `react-dom` (or `preact` in CDN bundle) — `<ProgressBar>` component.
- `@dnd-kit/sortable` (or `react-beautiful-dnd`) — drag-and-drop in the dashboard SOP editor. **NEW** — needs Constitution amendment OR justification under existing dashboard tech-stack guidance.

**Storage**: Neon PostgreSQL (production) + in-memory SQLite (tests). New tables and column additions to `001-foundation`'s schema, coordinated via Foundation's `drizzle-kit` migration tooling. New entities (per `data-model.md`): `sop_configurations`, `sop_steps`, `case_types`, `sub_types`, `goodbye_phrases`. New column: `sessions.sop_state_json`.

**Testing**: Vitest for unit tests of helpers (date inference, skip detection, goodbye detection, system-prompt extension); Vitest + Testing Library for the `<ProgressBar>` component; Playwright E2E covering the full default-SOP happy path (additional spec file in `packages/api/tests/e2e/sop.spec.ts`); 4 new scenarios in the `evals/` suite (Phase 8) covering SOP completion, skip-detection, off-SOP detour, no-goodbye behavior.

**Target Platform**: Same as upstream features — Netlify Functions (serverless) for API + Dashboard, modern evergreen browsers for the widget. Constitution IV invariants (no Server Actions, no native binaries, CORS wildcard) inherited.

**Project Type**: Cross-cutting feature inside the existing pnpm + Turborepo monorepo. No new workspace packages. Code lands in:
- `packages/shared/src/schemas/sop.ts` (NEW — shared Zod types).
- `packages/api/src/lib/sop/*.ts` (NEW — SOP state machine, skip detector, date inferer, off-SOP detour, goodbye detector, system-prompt extension).
- `packages/api/src/db/schema.ts` (EXTEND — new tables + sessions column).
- `packages/api/src/db/seed.ts` (EXTEND — default SOP + chips seed).
- `packages/api/src/app/api/chat/route.ts` (EXTEND — wire SOP state to system prompt + tool registration for `analyzeAndFollowUp`).
- `packages/api/src/app/api/dashboard/sop/route.ts` (NEW — SOP CRUD).
- `packages/api/src/app/dashboard/sop/page.tsx` (NEW — SOP editor UI; co-located per Phase 6 R1 decision).
- `packages/widget/src/components/ProgressBar.tsx` (NEW).
- `packages/widget/src/components/Chips.tsx` (NEW — used inside message stream when an SOP step has chips).

**Performance Goals**:
- SOP state injection into the system prompt: ≤ 500 added tokens (must fit inside §7.7's 1000-token guardrail block budget); evaluated in research R-system-prompt.
- Date inference: ≤ 500 ms on average (it's a Gemini call; budgeted within the existing chat-turn latency).
- Step 6 follow-up generation: 1 LLM call, counts as one of the existing `maxSteps: 5`; no additional latency budget needed.
- Progress bar advance: ≤ 300 ms animation; 0 ms under `prefers-reduced-motion: reduce`.
- Skip-detection: pure function on captured-state + visitor message; ≤ 50 ms; runs in-band on every turn.

**Constraints**:
- TS strict (Constitution II).
- All new boundary inputs Zod-validated (Constitution II): SOP CRUD route bodies, SOP step shape, chip lists, threshold value, goodbye-phrase list.
- All new persistent shapes use Drizzle typed inserts (Constitution II).
- No Server Actions in the new dashboard SOP editor (Constitution IV; reuse Phase 6's POST `/api/dashboard/*` Route Handler pattern).
- No native binaries added (Constitution IV; `@dnd-kit/sortable` is pure JS — verify before commitment).
- Logger redaction (Constitution V): SOP-state log payloads MUST NOT contain raw user message content; only step ids, step labels, captured-value summaries (e.g., redact emails/phones in captured `where` field).
- Token budget (§7.7): SOP-state injection MUST fit within the existing ~1000-token guardrails block plus a small SOP-state appendix (~500 tokens max). Total system-prompt size MUST stay under the existing ~4500-token cap.
- Constitution VII: schema additions coordinated via Foundation migration tooling; legacy `qualifying_questions` migration runs once on first dashboard load post-deploy (FR-056).

**Scale/Scope**: Per-firm SOP has ≤ 20 steps in practice (default 5 + a handful of customizations). Per-firm case-type list has ~10-30 entries with ~5-15 sub-types each. SOP-state column on `sessions` adds ~500-2000 bytes per row. Default-SOP seed runs once per fresh account at signup.

## Constitution Check

| # | Principle | SOP Workflow applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites the user description or a downstream feature spec. The SOP supersedes the legacy §7.5 flow but preserves all guardrail behavior. No scope creep beyond the 6 user stories. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | New shared Zod schemas in `packages/shared/src/schemas/sop.ts`; SOP CRUD bodies Zod-validated; SOP state shape Zod-validated on read; chip lists Zod-typed via Drizzle. | ✅ PASS |
| III | Test-First, Layered Testing | Each new helper (state machine, skip detector, date inferer, goodbye detector, system-prompt extension) gets a Vitest test before implementation; `<ProgressBar>` and `<Chips>` get component tests; Playwright E2E covers the full SOP path; 4 new eval scenarios. | ✅ PASS |
| IV | Serverless / Stateless | Route Handlers only (no Server Actions); SOP state is process-stateless (lives on `sessions` row); no fs writes; new dep `@dnd-kit/sortable` is pure JS. | ✅ PASS — pending native-binary verification of `@dnd-kit/sortable` |
| V | Privilege & Privacy | Foundation logger redaction extended for SOP captured-value payloads; out-of-scope deflection routes preserved; no new PII collection beyond existing intake; SOP-state column is account-scoped via the `sessions.account_id` FK. | ✅ PASS |
| VI | Bounded, Observable Agent | `analyzeAndFollowUp` tool counts toward existing `maxSteps: 5` cap; SOP transitions emit structured-log events (FR-058); SOP-state injection respects the §7.7 token budget. | ✅ PASS |
| VII | Phased Incremental Delivery | This feature is downstream of all 9 phases — it is the "Phase 9" extension that integrates them. Cross-feature changes coordinated via the existing contracts of `004`, `005`, `006`, `007`. Schema additions go through Foundation migration tooling. Legacy `qualifying_questions` migration is one-shot, idempotent. | ✅ PASS |

**Architectural Limits**:

- Per-conversation messages cap of 50 (§11.1) and per-key daily cap of 1000 (§11.1) inherited unchanged.
- LLM tool-call recursion `maxSteps ≤ 5` (§7.2) inherited; `analyzeAndFollowUp` is a single tool call within this cap.
- Token budget ~4500 (§7.7) inherited; SOP-state injection in the system prompt MUST stay within the existing ~1000-token guardrails block plus a ~500-token SOP appendix.
- Widget bundle size ≤ 35 KB / 50 KB gz (§6.10) inherited; `<ProgressBar>` + `<Chips>` add roughly ~2 KB combined per the existing pattern. Bundle-size CI gate (Phase 4 R8 / Phase 8 R3) will catch any regression.

**Risk: New dashboard dependency** — `@dnd-kit/sortable` is the most likely new dep. It is pure-JS (no native binaries) and is widely used in React dashboards. Decision: ADD to `packages/api/package.json` `dependencies` (NOT `devDependencies`) since the dashboard is co-located. Constitution IV invariant verified at PR time by Phase 8's `verify-deploy-invariants.sh` check. If `@dnd-kit/sortable` were ever to introduce a native binary in a future version, the invariant check catches it.

**Result**: All gates PASS. R-items below are gap-fill / new-build work, not Constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/010-sop-workflow/
├── plan.md
├── research.md
├── data-model.md           # 5 NEW tables + 1 column addition; SOP state shape; legacy migration model
├── quickstart.md
├── contracts/
│   ├── sop-state-contract.md            # SOP runtime state shape on the session
│   ├── sop-config-routes-contract.md    # POST/GET/PATCH/DELETE /api/dashboard/sop
│   ├── system-prompt-extension-contract.md  # SOP-state appendix in the system prompt
│   ├── progress-bar-contract.md         # Widget UI contract
│   └── capturelead-integration-contract.md  # How SOP captures feed Phase 5
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

### Source Code (touchpoints across packages)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/shared/src/
├── schemas/
│   ├── configuration.ts                 # ⚠ EXTEND — deprecate qualifying_questions field; add SOP version pointer
│   └── sop.ts                           # ❌ NEW — SOP / SOPStep / CaseType / SubType / GoodbyePhrase / SOPState Zod schemas
└── index.ts                             # ⚠ EXTEND — export sop.ts schemas

packages/api/src/
├── db/
│   ├── schema.ts                        # ⚠ EXTEND — 5 NEW tables: sop_configurations, sop_steps, case_types, sub_types, goodbye_phrases; 1 NEW column: sessions.sop_state_json
│   ├── test-schema.ts                   # ⚠ EXTEND — mirror for SQLite tests
│   ├── migrate.ts                       # ✅ keep
│   └── seed.ts                          # ⚠ EXTEND — seed default SOP + 6 case types + sub-types + default goodbye phrases for the dev account; legacy migration helper for existing accounts
├── lib/
│   ├── sop/                             # ❌ NEW — entire SOP runtime module
│   │   ├── state-machine.ts             # SOP state advance/skip/complete operations
│   │   ├── state-machine.test.ts
│   │   ├── skip-detector.ts             # Volunteered-info detection (FR-016 to FR-019)
│   │   ├── skip-detector.test.ts
│   │   ├── date-inferer.ts              # Natural-language date → ISO 8601 (FR-013)
│   │   ├── date-inferer.test.ts
│   │   ├── off-sop-detour.ts            # Off-SOP question handler that re-prompts pending step
│   │   ├── off-sop-detour.test.ts
│   │   ├── goodbye-detector.ts          # Configurable phrase pattern match (FR-029-FR-032)
│   │   ├── goodbye-detector.test.ts
│   │   ├── system-prompt-extension.ts   # Append SOP state to the existing system-prompt composer
│   │   ├── system-prompt-extension.test.ts
│   │   └── follow-up-tool.ts            # analyzeAndFollowUp tool definition for Step 6
│   ├── system-prompt.ts                 # ⚠ EXTEND — call system-prompt-extension at the right spot
│   └── leads.ts                         # ⚠ EXTEND — accept SOP-state-derived params on captureLead path (FR-057)
├── app/
│   ├── api/
│   │   ├── chat/route.ts                # ⚠ EXTEND — register analyzeAndFollowUp tool; load SOP state on session resume; persist SOP state on onFinish
│   │   └── dashboard/
│   │       └── sop/
│   │           ├── route.ts             # ❌ NEW — POST/GET/PATCH/DELETE for SOP CRUD
│   │           └── case-types/
│   │               └── route.ts         # ❌ NEW — POST/GET/PATCH/DELETE for case types + sub-types
│   └── dashboard/
│       └── sop/                         # ❌ NEW — SOP editor page
│           ├── page.tsx
│           ├── sop-editor.tsx           # Drag-and-drop step list
│           ├── step-form.tsx            # Add/edit a single step
│           ├── case-types-tab.tsx       # Case types + sub-types editor
│           └── goodbye-phrases-tab.tsx  # Goodbye phrase list editor

packages/widget/src/
├── components/
│   ├── ChatPanel.tsx                    # ⚠ EXTEND — render <ProgressBar> at top; render <Chips> inside message stream when SOP step has chips
│   ├── ProgressBar.tsx                  # ❌ NEW — thin shiny green bar (FR-033 to FR-040)
│   ├── ProgressBar.test.tsx             # ❌ NEW
│   ├── Chips.tsx                        # ❌ NEW — selectable chip rendering with chip-tap → message dispatch
│   └── Chips.test.tsx                   # ❌ NEW
└── hooks/
    └── useSOPState.ts                   # ❌ NEW — fetches SOP state from response headers + drives ProgressBar

packages/api/tests/e2e/
└── sop.spec.ts                          # ❌ NEW — Playwright covering the default-SOP happy path

evals/scenarios/
├── sop-default-happy-path.yml           # ❌ NEW
├── sop-skip-detection.yml               # ❌ NEW
├── sop-off-sop-detour.yml               # ❌ NEW
└── sop-no-goodbye.yml                   # ❌ NEW
```

**Structure Decision**: All new code lives inside the existing `packages/api`, `packages/widget`, and `packages/shared` per the established Phase 6 R1 co-location decision. NO new workspace packages introduced (Constitution Required Stack respected). The `lib/sop/` sub-tree is the binding home for runtime SOP logic — one module per concern, paralleling the layout used by `005-chat-widget` (hooks/, styles/, components/) and `006-lead-classification` (lead.ts + partial-lead.ts).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. The new dashboard dep `@dnd-kit/sortable` is pure JS (verified at planning time) and adds drag-and-drop affordance only to the SOP editor; it is consistent with Constitution Required Stack ("dashboard tech stack") and does not introduce a native binary. Phase 8's `verify-deploy-invariants.sh` script provides ongoing protection.

