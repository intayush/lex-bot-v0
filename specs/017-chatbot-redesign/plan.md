# Implementation Plan: Chatbot Redesign + LexBot Playground

**Branch**: `017-chatbot-redesign` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/017-chatbot-redesign/spec.md`

## Summary

Re-skin the chat widget and rebrand the in-repo demo page. Two coupled
visual-layer changes, zero backend/agent/SOP/lead-classification changes.

Three observable changes:

1. **Mobile becomes a true full-viewport takeover** with a slide-up
   entry / slide-down exit animation, on-screen-keyboard-aware layout,
   `prefers-reduced-motion` honored, and host-page scroll preserved on
   close. (Today the mobile layout is already inset-zero but lacks the
   slide-up entry, scroll-preservation, and keyboard handling.)
2. **Desktop panel grows to 480×760** floating in the bottom-right with
   24px edge padding, gets glassmorphism (translucent surface +
   backdrop-blur with a near-solid fallback), rounded corners, soft
   shadow, and a minimal "messages and input only" interior. Tablet
   stays as a right-anchored sheet.
3. **Test page rebrands as "LexBot Playground"**: the
   `packages/widget/index.html` title, `packages/widget/src/main.tsx`
   header / hero / footer / page palette / typography all switch to a
   warm-serious LexBot product surface; "Smith & Associates" goes
   away. Demo law-firm content (practice areas, contact CTA) is
   retained but explicitly framed as sample / demo content so the
   chatbot still has realistic context to talk about.

All existing widget behavior is preserved verbatim — streaming via
`@ai-sdk/react`'s `useChat`, preflight phrasing via `usePreflightPhrase`,
SOP state via `useSOPState`, chips, quick replies, contact form,
progress bar, `sessionStorage`-backed session resumption, the
`x-session-id` header dance, and the persistent "I am an AI assistant,
not a lawyer" disclaimer (Constitution VI). API contracts to
`/api/chat` and `/api/config` are unchanged. Bundle-size budgets
(NPM ≤ 35KB gz, CDN ≤ 50KB gz) are preserved by using only CSS
keyframes / transitions / `backdrop-filter` — no new runtime
dependency.

The implementation factors today's monolithic `ChatPanel.tsx` (512 LOC,
inline-styles, all four breakpoint layouts in one `useMemo`) into a
cleaner shell:

- `ChatPanel.tsx` becomes a thin shell that owns chat state and
  composes a new `PanelShell` (positioning + glass surface + animation
  + keyboard handling) around `MessageList` + `Composer`. The internal
  components `QuickReplies`, `Chips`, `ContactForm`, `ProgressBar`
  stay where they are and continue to receive the same props.
- A new `usePanelLayout` hook centralizes breakpoint sizing rules
  (mobile / tablet / desktop / clamped-desktop) and exposes them as
  CSS custom properties.
- A new `useScrollLock` hook implements the "open chatbot on mobile →
  preserve host scroll → restore on close" contract (FR-008). Two
  candidates — `body { overflow: hidden }` snapshot/restore vs. the
  modern `inert` attribute on the host — are evaluated in research.md.
- A small CSS module (`packages/widget/src/styles/panel.css`) holds
  the glass surface, keyframes for slide-up/down, and reduced-motion
  overrides. Existing inline-style override hooks
  (`--lc-primary-color`, `--lc-background`, `--lc-primary-text`,
  `--lc-border-radius`, `--lc-font-family`) remain respected and are
  joined by new tokens (`--lc-surface`, `--lc-surface-blur`,
  `--lc-shadow`, `--lc-message-radius`) that customers can override.

Estimated implementation time: ~2.5–3 working days. Most of the LOC is
in `ChatPanel.tsx` (refactor + new visual layer) and the playground
page; nothing in `packages/api` or `packages/dashboard` is touched.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (ESM). All work
is inside `packages/widget` of the existing pnpm + Turborepo workspace.

**Primary Dependencies** (no new deps):

- `react` 18 (NPM build) and `preact` (CDN bundle) — already present
- `@ai-sdk/react` `useChat` — already wired in `ChatPanel.tsx`
- `vite` — for the dev server / build of `packages/widget`
- `vitest` + `@testing-library/react` + `jsdom` — already configured
- No new motion / glass / styling library — animations are pure CSS
  keyframes, glass uses native `backdrop-filter`

**Storage**: N/A. The widget continues to use `sessionStorage` for the
session id only; no schema changes anywhere.

**Testing**: Vitest unit + integration tests under
`packages/widget/src/**/*.test.tsx` and a Playwright smoke test on the
Playground page (the existing `pnpm test:e2e` widget-on-test-app
smoke). Visual / layout regressions are caught by:

- Vitest tests on the new `usePanelLayout` and `useScrollLock` hooks
- Vitest component tests asserting structural ARIA / role contracts
  (not pixel values) for `PanelShell`, `MessageList`, `Composer`
- A new Playwright test that opens the Playground at three viewport
  presets (mobile 375×812, tablet 820×1180, desktop 1440×900) and
  asserts: panel-bounding-box dimensions per FR-001 / FR-002 / FR-003,
  page header copy contains "LexBot Playground" and never "Smith &
  Associates", and a full conversation including chips + contact form
  succeeds (US4 / FR-021)
- Existing widget test suite continues to run unchanged

**Target Platform**: Modern evergreen browsers (Chrome, Safari,
Firefox, Edge — last 2 versions), iOS Safari 16+, Android Chrome
last 2 versions. The mobile takeover targets viewports `< 768px`;
tablet 768–1023px; desktop ≥ 1024px (matches today's
`useBreakpoint`).

**Project Type**: Frontend redesign inside an existing TypeScript
monorepo package (`packages/widget`).

**Performance Goals**:

- Slide-up animation completes < 400ms with no frame > 100ms on
  mid-tier 2024 Android (SC-005)
- First chatbot-open Time-to-Interactive (panel rendered + bubble
  click handler resolved) ≤ 100ms additional vs. today's baseline
- No layout-thrash reflows during the slide-up animation
  (transform-only animation, no width/height/opacity-only fallback
  for the entry)

**Constraints**:

- Bundle-size: NPM widget ≤ 35KB gz, CDN bundle ≤ 50KB gz
  (Constitution Principle IV; SC-004). The redesign MUST add only
  CSS / TSX, no runtime deps.
- WCAG 2.1 AA contrast (FR-019) on body text against the effective
  glass surface
- `prefers-reduced-motion` MUST be honored end-to-end (FR-007)
- Backdrop-filter unsupported → graceful fallback to near-solid
  surface (FR-013)
- No backend, schema, or API-contract change (FR-022, Out of Scope)
- Existing CSS-custom-property override hooks MUST remain respected

**Scale/Scope**:

- ~5 component files modified or added in `packages/widget/src/components/`
- ~2 hooks added in `packages/widget/src/hooks/`
- 1 new CSS file under `packages/widget/src/styles/`
- 1 rewritten `packages/widget/src/main.tsx` (Playground)
- 1 updated `packages/widget/index.html` (title)
- ~10–15 unit/integration tests added or updated
- ~1 new Playwright spec (3 viewport presets × 4 assertions)
- Net diff: roughly +800 / −400 LOC across the widget package

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I — MVP-First Discipline

**Status**: PASS.

The MVP scope (§10) does not list "redesign the chatbot widget" or
"rebrand the test page" as either in-scope or out-of-scope items —
these are purely visual / brand changes to surfaces that already
exist in the MVP. The core loop ("user asks question → chatbot
retrieves context → chatbot qualifies lead → lead is stored")
remains the contract; the redesign re-skins the user-facing surface
of that loop without altering it. No deferred feature from the §10
out-of-scope table is being smuggled in. Spec section reference for
the PR description: §6 (Widget) and §6.7 / §8.11 (styling).

### Principle II — Type Safety & Schema-Validated Boundaries

**Status**: PASS.

All new code (new hooks `usePanelLayout`, `useScrollLock`; new
component `PanelShell`; refactored `MessageList`, `Composer`) is
authored in TypeScript strict and passes through the existing
`tsconfig.base.json`. No new cross-boundary data is introduced —
the widget continues to send/receive the same already-Zod-validated
payloads to `/api/chat` and `/api/config`. No new shared types are
needed. `tsc --noEmit` continues to pass across packages.

### Principle III — Test-First, Layered Testing Strategy

**Status**: PASS, with explicit test-first discipline.

The tasks plan (Phase 2, generated by `/speckit.tasks`) will produce
a failing test before the implementation that satisfies it for every
new behavior:

- `usePanelLayout` unit tests (mobile / tablet / desktop / clamped
  desktop) before the hook is implemented
- `useScrollLock` unit tests (snapshot/restore body overflow,
  preserve scrollY) before the hook is implemented
- `PanelShell` component test asserting the structural contract
  (header / scroll region / pinned composer) before the component
  is built
- The new Playwright spec (Playground at three viewport presets
  with the four assertions) is written before the visual layer is
  implemented; it starts red and goes green as the work lands

The conversation-quality eval scripts (manual gate) are NOT required
for this redesign because no system prompt, agent logic, guardrail,
or lead-classification path is changing (Principle III, last bullet).

### Principle IV — Serverless-Compatible & Stateless Server Architecture

**Status**: PASS.

No server-side change in this feature. The widget remains a pure UI
layer with no sensitive state (§2.10 confirmed). The bundle-size
budgets are explicit constraints (FR-023 / SC-004) and the chosen
approach (CSS keyframes + native `backdrop-filter`, no new runtime
dependency) is the cheapest possible. A bundle-size delta check is
part of the PR's Constitution-Check evidence.

### Principle V — Privilege, Privacy, and Data-Boundary Integrity

**Status**: PASS.

No data-handling change. The disclaimer required by §11.4 ("I am an
AI assistant, not a lawyer. Nothing I say constitutes legal advice.")
is preserved as a non-removable widget element (FR-020). System-prompt
non-disclosure (§11.2) is unaffected. Logging / consent / archival
flows are untouched.

### Principle VI — Bounded, Observable, Cost-Aware Agent

**Status**: PASS, no agent changes.

`maxSteps: 5`, the 4500-token context budget, the 50-message and
1000-conv-per-day rate limits, the two-tool registry, the prompt-
injection screen, the structured logging, and the token-usage
recording are all unchanged. The persistent disclaimer (above) is
explicitly preserved. The redesign cannot affect agent behavior
because it is widget-package-local.

### Principle VII — Phased Incremental Delivery

**Status**: PASS, with note.

The §12.5 phase order (Crawler → Search → Chat API → Widget → Lead
Classification → Dashboard) is a phasing plan for the original
build-out. The widget phase is long since complete; spec 017 is a
post-MVP polish on the widget surface. This is consistent with the
project's current trajectory (specs 010–016 have all been
post-Phase-6 incremental work). No phase regression.

### Architectural Limits

All hard limits unchanged: widget bundle ≤ 35/50KB gz (verified by
existing CI check); per-conversation messages ≤ 50; per-API-key/day
≤ 1000; `maxSteps ≤ 5`; context budget ~4500 tokens;
`sessionStorage`-only persistence. None of these are touched by a
visual-layer change.

### Tech Stack Conformance

The required stack is honored: TypeScript strict (II); React/Preact
(IV); Tailwind is NOT used in the widget today (widget uses CSS
custom properties per §6.7) and continues not to be used; no native
binary deps added. Build orchestration (Turborepo), linting (ESLint
flat config), formatting (Prettier), and CI (GitHub Actions) flow
unchanged.

**Result**: All gates PASS. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/017-chatbot-redesign/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (visual data model: tokens, layout regions, animation states)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (UI / component contracts; no HTTP contracts since none change)
│   ├── panel-shell.md
│   ├── design-tokens.md
│   └── playground-page.md
├── checklists/
│   └── requirements.md  # Created during /speckit.specify
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

All work is inside `packages/widget`. Files added (`+`), modified
(`~`), or deleted (`−`):

```text
packages/widget/
├── index.html                                          ~  # title → "LexBot Playground"
├── src/
│   ├── main.tsx                                        ~  # rewrite TestSite → LexBotPlayground
│   ├── components/
│   │   ├── ChatWidget.tsx                              ~  # pass animation hooks; tweak open/close
│   │   ├── ChatBubble.tsx                              ~  # adopt new tokens (warm-serious palette)
│   │   ├── ChatPanel.tsx                               ~  # become a thin shell over PanelShell
│   │   ├── PanelShell.tsx                              +  # positioning + glass surface + animation
│   │   ├── MessageList.tsx                             +  # extracted message-rendering surface
│   │   ├── Composer.tsx                                +  # extracted floating input card
│   │   ├── Chips.tsx                                   ~  # restyle to floating chip rows; props unchanged
│   │   ├── QuickReplies.tsx                            ~  # restyle; props unchanged
│   │   ├── ContactForm.tsx                             ~  # restyle to fit narrower mobile / 480 desktop
│   │   ├── ProgressBar.tsx                             ~  # restyle (warm palette); behavior unchanged
│   │   ├── PanelShell.test.tsx                         +
│   │   ├── MessageList.test.tsx                        +
│   │   ├── Composer.test.tsx                           +
│   │   └── QuickReplies.test.tsx                       ~  # update style assertions only
│   ├── hooks/
│   │   ├── usePanelLayout.ts                           +  # breakpoint → CSS-var sizing
│   │   ├── usePanelLayout.test.ts                      +
│   │   ├── useScrollLock.ts                            +  # mobile host-page scroll preservation
│   │   ├── useScrollLock.test.ts                       +
│   │   ├── useReducedMotion.ts                         (unchanged; reused for FR-007)
│   │   ├── useSOPState.ts                              (unchanged)
│   │   ├── usePreflightPhrase.ts                       (unchanged)
│   │   ├── classifyMessage.ts                          (unchanged)
│   │   └── computeActiveChips.ts                       (unchanged)
│   ├── styles/
│   │   ├── panel.css                                   +  # glass surface + keyframes + tokens
│   │   └── playground.css                              +  # LexBot Playground page styling
│   └── index.ts                                        (unchanged)
└── tests/
    └── e2e/
        └── playground.spec.ts                          +  # Playwright: 3 viewports × 4 assertions
```

**Structure Decision**: keep the existing flat `components/` and
`hooks/` layout — adding two new components, one new shell,
two new hooks, and a `styles/` subdirectory is the smallest
delta that delivers the redesign without inventing a new
directory taxonomy. The `tests/e2e/` folder is already used by
the repo's existing Playwright config (a top-level `tests/e2e/`
exists too — the new Playground spec lives next to existing
widget e2e specs; exact location is confirmed in research.md).

## Complexity Tracking

> No constitution-check violations to justify. This section is
> retained for template completeness; no entries.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none)    | n/a        | n/a                                 |

## Post-Design Constitution Re-Check

After completing Phase 1 (data-model, contracts, quickstart), re-running
the constitution check:

- **Principle I (MVP discipline)**: still PASS. Phase 1 added no
  scope beyond what the spec already enumerated. The redesign
  remains a re-skin of an already-MVP-included surface.
- **Principle II (type safety)**: still PASS. The component
  contracts (panel-shell.md) define strict TypeScript prop types
  (`PanelShellProps`). No `any` introduced; no new cross-boundary
  data.
- **Principle III (test-first)**: PASS, with concrete test
  contracts now written down (`PanelShell.test.tsx` requirements
  in `contracts/panel-shell.md`, token snapshot in
  `contracts/design-tokens.md`, and the Playground Playwright
  spec in `contracts/playground-page.md`). The tasks phase will
  schedule each test BEFORE its implementation.
- **Principle IV (serverless / bundle)**: PASS. Research §R13
  estimates +3KB gz to the NPM bundle, well within the 35KB
  budget. No new runtime deps; no server changes.
- **Principle V (privacy)**: PASS. The disclaimer remains
  permanently visible (FR-020 + Composer region 4 in
  data-model.md). No data-handling changes.
- **Principle VI (bounded agent)**: PASS. No agent change.
- **Principle VII (phased delivery)**: PASS. No phase
  regression.

All Phase 1 artifacts (data-model.md, contracts/*.md,
quickstart.md) align with the constitution. No Complexity
Tracking entries needed.

## Next Phase

`/speckit.tasks` to generate `tasks.md` with the test-first task
breakdown for the four user stories. Tasks SHOULD use the
labels:

- `[setup]` — design-token + CSS scaffolding
- `[us1]` — mobile takeover (P1)
- `[us2]` — desktop glass panel (P1)
- `[us3]` — Playground rebrand (P2)
- `[us4]` — preserve behavior / regression tests (P1)
- `[polish]` — bundle-size verify, documentation, final QA
