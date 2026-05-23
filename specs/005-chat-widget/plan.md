# Implementation Plan: Chat Widget

**Branch**: `005-chat-widget` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-chat-widget/spec.md`

## Summary

The Chat Widget is the only user-facing piece of Lex Bot (§6.1).
It is a lightweight, embeddable component that renders the chat UI
on the lawyer's website. Per §2.10 it is a pure UI layer holding no
sensitive state; per §6.6 it streams responses from
`POST /api/chat` via the Vercel AI SDK `useChat` hook; per §6.2 it
ships through two distribution channels (an NPM package for
React/Next.js sites and a CDN script tag for static sites that
bundles Preact internally).

This is **Phase 4** per §12.5. It depends on
`004-chat-api-agent` for the streaming endpoint and `/api/config`
endpoint, on Foundation for shared schemas, and is consumed by
`007-dashboard` (which embeds the widget for §8.10 Preview & Test).

A working React implementation already exists in
`packages/widget/src/components/` (479 LOC across `ChatWidget`,
`ChatPanel`, `ChatBubble`, `QuickReplies`). It already covers:
mobile/tablet/desktop responsive layouts, `useChat` streaming,
`sessionStorage` persistence, a quick-reply UI fed from
`/api/config`, and a typing indicator. The 52 FRs in the spec map
to an implementation that is **roughly 60% complete**. This plan
targets the remaining gaps:

- **R1** — Public NPM library entry point (FR-001, FR-005). The
  `dist/index.js` is currently empty (`packages/widget/src/index.ts`
  is `export {};`); NPM consumers can't import `LegalChatbot`. The
  build must produce a proper library bundle with React as a peer
  dependency.
- **R2** — CDN/Preact build (FR-002, FR-003, FR-004). No
  CDN-shaped artifact exists; Preact bundling is required so
  static sites without React can use the widget.
- **R3** — Analytics props/events (FR-005, FR-006, FR-047 to
  FR-049). `onChatOpen`, `onMessageSent`, `onLeadSubmitted`,
  `onChatClosed`, `onEscalationTriggered` are absent on the
  current React component, and the CDN-mode DOM events
  (`legalchatbot:open`, `:message`, `:lead`) do not yet exist.
- **R4** — Persistent legal disclaimer (FR-050). The
  "I am an AI assistant, not a lawyer..." line must appear in the
  widget chrome (e.g., footer of the chat panel), not just in the
  system prompt.
- **R5** — Consent banner (FR-051, FR-052). No banner is shown
  before personal-data fields would be collected; `008-hardening`
  persists the timestamp but the UI surface lives here.
- **R6** — Accessibility hardening (FR-027 to FR-033). Tab/Enter
  work today, but Escape-to-close, focus trap, ARIA-live message
  announcements, `prefers-reduced-motion`, `prefers-contrast`,
  and explicit 44×44px touch targets need verification or
  implementation.
- **R7** — Offline & error handling (FR-042 to FR-046). The
  current implementation surfaces a generic error; it lacks the
  "Reconnecting..." indicator + queued-messages behavior, the
  10-second-disconnect message, and the dedicated 429 message.
- **R8** — Bundle-size budget enforcement in CI (FR-034, FR-035,
  SC-009, SC-010). NPM ≤ 35 KB gz and CDN ≤ 50 KB gz are
  Constitution Architectural Limits; without a CI gate they will
  silently regress.
- **R9** — CSS scoping (FR-036). Current implementation uses
  inline styles + a global `.lc-typing` class. Shadow DOM or
  CSS Modules must scope styles so they don't collide with the
  host page.
- **R10** — Auto-growing multi-line input (FR-015). Current
  `<input>` is single-line; spec requires auto-grow textarea.
- **R11** — Group-level relative timestamps (FR-012). No
  timestamps are rendered today.
- **R12** — Component test coverage (Constitution Principle III).
  No tests exist for widget components; spec mandates Vitest +
  Testing Library coverage.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (Foundation).
Runtime is the user's browser (modern evergreen browsers per
§6.9 implications: CSS custom properties, `sessionStorage`,
`prefers-*` media queries, Vercel AI SDK streaming).

**Primary Dependencies** (already in
`packages/widget/package.json`, Constitution Required Stack):

- `react` + `react-dom` (NPM channel; peer dependency).
- `preact` (CDN channel; bundled internally — to be added; see R2).
- `@ai-sdk/react` — `useChat` hook for streaming (§6.6, §9.1).
- `@legal-chatbot/shared` — shared types (Constitution II).
- `vite` + `@vitejs/plugin-react` — dev server + library bundler.
- `@testing-library/react` + `vitest` — component tests (R12;
  Constitution III; §9.8).
- `@preact/compat` — runtime React-API shim used in the CDN bundle
  so the same component code works under Preact.
- A bundle-size measurement tool (Vite's
  `build.rollupOptions.output.manualChunks` + `gzip-size` or
  `size-limit`) for R8.

**Storage**: `sessionStorage` only, exactly the `lc_session_id`
key (§6.8 binding; FR-023 to FR-025 + SC-018). The widget MUST
NOT use `localStorage`, IndexedDB, cookies, or any other
persistence. Cross-tab session sharing is intentionally out of
scope.

**Testing**: Vitest + `@testing-library/react` for component
tests; visual verification in Chrome DevTools responsive mode for
the §12.9 "Manual + visual" done-when items. The spec is explicit
that a manual browser check is the binding verification for
several UX criteria (§12.9 done-when "Visual verification in
browser (no automated test — UI correctness)").

**Target Platform**: Modern evergreen browsers. The widget must
function on the lawyer's site regardless of host framework
(React, Vue, plain HTML). Two artifacts cover this:

| Artifact | Target | Channel |
|---|---|---|
| `@legal-chatbot/widget` | React 18+ host apps | NPM |
| `legal-chatbot.js` | Static / non-React sites | CDN script tag |

**Project Type**: TypeScript library + small demo site
(`index.html` + `main.tsx`) used for §12.9 deliverable
verification.

**Performance Goals**:
- NPM bundle ≤ 35 KB gz (§6.10, FR-034, SC-009).
- CDN bundle ≤ 50 KB gz (§6.10, FR-035, SC-010).
- Lazy-load the chat panel on first interaction (§6.11 closing
  line, FR-039) — the bubble alone has minimal DOM footprint.
- No external CSS files (FR-036, §6.10).

**Constraints**:
- TS strict (Constitution II).
- Pure UI layer; no sensitive state; only `sessionStorage` for
  the session ID (Constitution V; §2.10).
- Persistent disclaimer (R4; FR-050; §11.4).
- Consent banner before any personal-data collection (R5;
  FR-051; §11.5).
- Bundle-size limits enforced in CI (R8; Constitution
  Architectural Limits + Phase 7 CI gate from
  `001-foundation` deferred to here).
- WCAG 2.1 AA compliance (§6.9, FR-027 to FR-033).
- The widget MUST NOT introduce new dependencies beyond those
  named in the Constitution Required Stack.

**Scale/Scope**: One widget per host page (the spec does not
support multiple instances on a single page; documented as out of
scope in `005-chat-widget/spec.md`). Per-session message volume
≤ 50 (§11.1 binding upstream); per-day conversations ≤ 1000 per
key (also upstream).

## Constitution Check

| # | Principle | Chat Widget applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Every FR cites §-anchors; no scope creep beyond §6 + §11.4/§11.5 surfaces | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | Component props typed; `useChat` types from `@ai-sdk/react`; config-fetch response shape validated via shared Zod schema (extends `packages/shared` to expose a small `widgetConfigSchema`) | ✅ PASS — pending shared schema export |
| III | Test-First, Layered Testing | Existing components have NO tests today (R12). All new modules and the consent banner / disclaimer / accessibility helpers test-first | ✅ PASS — pending R12 test coverage |
| IV | Serverless / Stateless Architecture | Widget runs in the browser; no server-side concern. NPM bundle does not depend on Node-only APIs. CDN bundle is a single self-contained JS file | ✅ PASS |
| V | Privilege & Privacy | Only `sessionStorage` for the session ID (FR-026, SC-018); consent banner before personal-data collection (R5); no third-party analytics injection (analytics are emitted as events for the lawyer to wire) | ✅ PASS — pending R5 |
| VI | Bounded, Observable Agent | Agent boundedness lives in Phase 3; the Widget surfaces token-stream + tool-call events visually only (typing indicator). Analytics events (R3) feed the lawyer's existing analytics platform | ✅ PASS |
| VII | Phased Incremental Delivery | Phase 4 of §12.5; consumes Phase 3 streaming endpoint + Phase 3 `/api/config` endpoint; reused unchanged inside Phase 6 dashboard's Preview chat | ✅ PASS |

**Architectural Limits**:
- Widget bundle: NPM ≤ 35 KB gz; CDN ≤ 50 KB gz (R8).
- Per-conversation messages ≤ 50, per-key daily conversations ≤ 1000 — these are enforced upstream (Phase 3); Widget surfaces the resulting 429 with the spec wording (R7; FR-046).
- No widget UI element exceeds 44×44 px tap target on mobile (R6; FR-033).

**CI Gates**: Foundation's CI pipeline is in place
(stages 1–5 from `001-foundation` FR-037). The bundle-size check
(stage 6 in Constitution CI Gates) lands in this feature (R8) —
Phase 7 hardening only owns it conceptually; the implementation
must ship here so widget builds are gated.

**Result**: All gates PASS. Pending items (Zod widget config
schema, R12 tests, R5 consent banner) are tracked as gap-fills,
not Constitution violations.

## Project Structure

### Documentation (this feature)

```text
specs/005-chat-widget/
├── plan.md
├── research.md
├── data-model.md          # Component tree, theme tokens, sessionStorage shape
├── quickstart.md
├── contracts/
│   ├── react-component-contract.md   # <LegalChatbot /> props, callbacks
│   ├── cdn-script-contract.md         # data-api-key + DOM events
│   ├── theming-contract.md            # CSS custom properties
│   └── analytics-events-contract.md   # Event names + payloads
└── tasks.md               # Phase 2 — created by /speckit.tasks
```

### Source Code (`packages/widget/`)

Existing files (✅ keep; ⚠ extend; ❌ new):

```text
packages/widget/
├── package.json                       # ⚠ EXTEND — peerDependencies for React; exports map for NPM lib build (R1)
├── vite.config.ts                     # ⚠ EXTEND — library mode + CDN entry (R1, R2)
├── vite.config.cdn.ts                 # ❌ NEW — separate CDN/Preact bundle config (R2)
├── netlify.toml                       # ✅ keep (already publishes via Netlify per §9.7)
├── index.html                         # ✅ keep — demo site
├── tsconfig.json                      # ✅ keep
├── vitest.config.ts                   # ❌ NEW — Vitest + jsdom for component tests (R12)
└── src/
    ├── index.ts                       # ⚠ REPLACE — proper public exports (R1)
    ├── main.tsx                       # ✅ keep — demo site entry
    ├── cdn-entry.tsx                  # ❌ NEW — auto-mounts on data-api-key script tag (R2)
    ├── components/
    │   ├── ChatWidget.tsx             # ⚠ EXTEND — analytics props, forwardRef (R3)
    │   ├── ChatWidget.test.tsx        # ❌ NEW (R12)
    │   ├── ChatPanel.tsx              # ⚠ EXTEND — disclaimer footer (R4); textarea + auto-grow (R10); group timestamps (R11); error/offline (R7); consent banner (R5)
    │   ├── ChatPanel.test.tsx         # ❌ NEW (R12)
    │   ├── ChatBubble.tsx             # ✅ keep
    │   ├── ChatBubble.test.tsx        # ❌ NEW (R12)
    │   ├── QuickReplies.tsx           # ✅ keep
    │   ├── QuickReplies.test.tsx      # ❌ NEW (R12)
    │   ├── ConsentBanner.tsx          # ❌ NEW (R5)
    │   ├── ConsentBanner.test.tsx     # ❌ NEW
    │   ├── DisclaimerFooter.tsx       # ❌ NEW (R4)
    │   ├── ReconnectingIndicator.tsx  # ❌ NEW (R7)
    │   ├── MessageGroup.tsx           # ❌ NEW (R11) — handles relative timestamps
    │   └── AutoGrowTextarea.tsx       # ❌ NEW (R10)
    ├── hooks/
    │   ├── useFocusTrap.ts            # ❌ NEW (R6 — focus trap)
    │   ├── useFocusTrap.test.ts       # ❌ NEW
    │   ├── useReducedMotion.ts        # ❌ NEW (R6 — prefers-reduced-motion)
    │   ├── useNetworkStatus.ts        # ❌ NEW (R7 — online/offline tracking)
    │   └── useAnalyticsEvents.ts      # ❌ NEW (R3 — emits via prop callbacks AND DOM events)
    ├── styles/
    │   ├── shadow-root.css            # ❌ NEW (R9 — shadow DOM scoped styles)
    │   └── index.ts                   # ❌ NEW — exports compiled CSS string for inline injection
    └── lib/
        ├── widget-config.ts           # ❌ NEW — fetch + Zod-validate /api/config response
        └── widget-config.test.ts      # ❌ NEW
```

The `chatbot-context/` directory at the repo root is ALREADY
served by the Vite dev server middleware (existing
`vite.config.ts`); no change needed there.

**Structure Decision**: Keep the existing `components/`
organization. Add a parallel `hooks/`, `styles/`, and `lib/`
folder. Two distinct entry points:

- `src/index.ts` for the **NPM library** (`react` + `react-dom`
  as peer deps; exports `LegalChatbot`).
- `src/cdn-entry.tsx` for the **CDN script tag** (Preact
  bundled, auto-mounts when it finds a `<script data-api-key="…">`).

Vite's library mode produces both artifacts via two configs.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. The dual-build (NPM + CDN) is part of the §6.2 binding
distribution model, not a complexity choice.


## Phase 1 Outputs Summary

| Artifact | Path | Status |
|---|---|---|
| Plan | `specs/005-chat-widget/plan.md` | ✅ written |
| Research | `specs/005-chat-widget/research.md` | ✅ written (12 research items: R1–R12) |
| Data model | `specs/005-chat-widget/data-model.md` | ✅ written (component tree + props + theme tokens + storage shape + state diagrams + cross-feature coordination) |
| Contracts | `specs/005-chat-widget/contracts/` | ✅ written (4 contracts: react-component, cdn-script, theming, analytics-events) |
| Quickstart | `specs/005-chat-widget/quickstart.md` | ✅ written (full §12.9 walkthrough + R1–R12 verification + bundle-size check + CDN test + analytics events test) |
| AGENTS.md | repo root | ✅ updated |

## Constitution Re-Check (Post-Design)

| # | Principle | Concrete artifact verification | Status |
|---|---|---|---|
| I | MVP-First | All artifacts cite §-anchors; no scope creep | ✅ |
| II | Type Safety & Zod | `widgetConfigSchema` extends `packages/shared`; component props typed; `LegalChatbotProps` and `LegalChatbotTheme` exported via `dist/index.d.ts` | ✅ |
| III | TDD layered | All 12 component / hook / lib test files enumerated in project structure (R12) | ✅ |
| IV | Serverless / Stateless | Browser-only; `sessionStorage` is the only persistence; no Node-only APIs | ✅ |
| V | Privilege & Privacy | Consent banner before personal-data collection (R5); persistent disclaimer (R4); only 2 `sessionStorage` keys (FR-026, SC-018) | ✅ |
| VI | Observable Agent | Agent boundedness is upstream (Phase 3); widget emits 5 analytics events (R3, contracts/analytics-events-contract.md) | ✅ |
| VII | Phased Delivery | Bundle-size CI gate (R8) lands here per Foundation deferral; Preview chat reuse coordinated with Phase 6 dashboard; consent timestamp persistence coordinated with Phase 7 hardening | ✅ |

**Architectural Limits**: NPM ≤ 35 KB gz, CDN ≤ 50 KB gz (R8) —
both enforced by `size-limit` in CI.

**Result**: All gates PASS post-design. The 12 gap-fills are the
binding work; no Constitution amendments required.

## Hand-Off to `/speckit.tasks`

`tasks.md` will derive from:

- 7 user stories (P1×4, P2×3) in `spec.md`.
- 52 FRs in 13 groups.
- 12 research items.
- 4 contracts.

Task graph:

- **Phase A** (foundational, sequential): R1 NPM build → R2 CDN
  build → R8 bundle-size check (depends on both build outputs).
- **Phase B** (parallel after Phase A): R3 analytics events;
  R4 disclaimer; R5 consent banner; R6 accessibility hooks;
  R7 offline/error UI; R9 Shadow DOM; R10 auto-grow textarea;
  R11 timestamps; R12 tests for each new module.

Convergence point: integrating all new components/hooks into
`<ChatPanel>` and `<ChatWidget>`, then running the full test
suite + `pnpm size`.

