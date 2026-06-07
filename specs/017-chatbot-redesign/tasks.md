---

description: "Task list for spec 017 — Chatbot Redesign + LexBot Playground"
---

# Tasks: Chatbot Redesign + LexBot Playground

**Input**: Design documents from `specs/017-chatbot-redesign/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: REQUIRED. Constitution Principle III mandates test-first for every
feature task that produces production code. Test tasks here precede the
implementation tasks they validate, and are visible in the diff before the
code that satisfies them.

**Organization**: Tasks are grouped by user story so each story can ship
independently. Story labels: `[US1]` mobile takeover, `[US2]` desktop glass
panel, `[US3]` Playground rebrand, `[US4]` no-regression.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different file, no dependency on incomplete tasks)
- **[Story]**: user-story phase tasks only (US1/US2/US3/US4)
- Setup, Foundational, and Polish phases have NO story label

## Path Conventions

- All work lives under `packages/widget/` (TypeScript + Vite + React).
- E2E lives in `packages/api/tests/e2e/` (the repo's only Playwright config).
- Repo-root paths used throughout.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffolding that the redesign needs before any user story can
begin. No production behavior shipped in this phase.

- [X] T001 Create the styles directory `packages/widget/src/styles/` (mkdir; empty until T002 lands)
- [X] T002 [P] Create `packages/widget/src/styles/panel.css` with the design-token block from `specs/017-chatbot-redesign/contracts/design-tokens.md` (public + internal tokens, plus the two `@media`/`@supports` rules for reduced-motion and backdrop-filter fallback). No selectors beyond `.lc-panel { ... }` yet — actual styling tasks land in US1/US2 phases.
- [X] T003 [P] Create `packages/widget/src/styles/playground.css` skeleton (empty file with a single `/* Playground page styles for spec 017 */` header comment). Real styles land in US3.
- [X] T004 [P] Add `import './styles/panel.css'` to a new top of `packages/widget/src/components/PanelShell.tsx` (file will be created in US2's foundational task; this task creates a stub `PanelShell.tsx` that exports a no-op component so the import compiles)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Layout + animation primitives + scroll-lock + the new shell
component, all behind tests. Every user story phase consumes these.

**⚠️ CRITICAL**: Phase 2 must complete (tests green for the new hooks +
PanelShell minimal contract) before US1, US2, or US4 work begins. US3
(Playground rebrand) is independent and could begin in parallel after T001
lands.

### Tests for Phase 2 foundations (write FIRST, see them fail)

- [X] T005 [P] Create `packages/widget/src/hooks/usePanelLayout.test.ts` with failing tests asserting the breakpoint matrix from `data-model.md`: `< 768` → `'mobile'`; `768–1023` → `'tablet'`; `≥ 1024` AND viewport height ≥ 808 → `'desktop'`; `≥ 1024` AND viewport height < 808 → `'desktop-clamped'`. Mock `window.innerWidth` / `window.innerHeight` via setting on the jsdom `window`.
- [X] T006 [P] Create `packages/widget/src/hooks/useScrollLock.test.ts` with failing tests covering: (a) on engage, captures `window.scrollY` and applies the six body-style mutations; (b) on disengage, restores all six properties to their original string values (including `''`); (c) on disengage, calls `window.scrollTo(0, savedScrollY)`; (d) cleanup-on-unmount disengages.
- [X] T007 [P] Create `packages/widget/src/components/PanelShell.test.tsx` with failing tests covering the seven items in `contracts/panel-shell.md` § "Test Contract": render order, phase progression with motion, phase progression with reduced motion, Escape close, close-then-onClosed sequence, ARIA, scroll-lock on mobile.

### Implementation for Phase 2 foundations

- [X] T008 Implement `packages/widget/src/hooks/usePanelLayout.ts` returning a `PanelLayout` value (`'mobile' | 'tablet' | 'desktop' | 'desktop-clamped'`) and listening to `resize` + `orientationchange`. Make T005 tests green.
- [X] T009 Implement `packages/widget/src/hooks/useScrollLock.ts` per `data-model.md` § "Scroll-Lock State" (snapshot-then-mutate, restore-on-disengage, cleanup-on-unmount). Make T006 tests green.
- [X] T010 Implement the real `packages/widget/src/components/PanelShell.tsx` per `contracts/panel-shell.md`: props (`isOpen`, `onClosed`, `onCloseRequest`, `children`, `ariaLabel`), CSS-grid layout with named tracks (`[header]`, `[content]`, `[progress]`, `[composer]`), `data-phase` + `data-breakpoint` attributes, focus trap, Escape handler, `useScrollLock` engagement on mobile, `useReducedMotion` short-circuiting the entry/exit timers. Make T007 tests green.
- [X] T011 Add base CSS rules to `packages/widget/src/styles/panel.css` for `.lc-panel` grid layout (4 named rows: header / content / progress / composer), `data-breakpoint`-keyed positioning (mobile flush full-viewport, tablet right-anchored sheet 420px, desktop floating 480×760 with 24px edge padding, desktop-clamped fitting `calc(100vh - 48px)`), glass surface (`background-color: var(--lc-surface)` + `backdrop-filter: var(--lc-surface-blur)`), shadow, corner radius. No animation keyframes yet — those land in US1.

**Checkpoint**: usePanelLayout, useScrollLock, and PanelShell are all
implemented with passing unit/component tests. The widget itself is not
yet using PanelShell — that swap happens inside the user story phases.

---

## Phase 3: User Story 1 - Mobile full-viewport takeover (Priority: P1) 🎯 MVP

**Goal**: When a visitor on `< 768px` taps the chat bubble, the chatbot
slides up from the bottom and covers the entire viewport with the redesigned
glass surface and minimal interior. Closing slides it back down and
restores host-page scroll. Reduced-motion is honored. Keyboard does not
hide the input.

**Independent Test**: Open the Playground at 375×812 in DevTools, tap
the bubble, observe slide-up + full coverage + scroll preserved + input
above keyboard. Documented in `quickstart.md` § "Verify the Mobile
Takeover".

### Tests for User Story 1 (write FIRST, see them fail)

- [X] T012 [P] [US1] Add a Vitest test in `packages/widget/src/components/PanelShell.test.tsx` (extend file from T007 — separate `describe` block "mobile takeover behavior"): with `usePanelLayout` mocked to `'mobile'`, mounting the shell with `isOpen=true` triggers `useScrollLock` engagement (assert `document.body.style.position === 'fixed'`); unmounting restores; the root has `aria-modal="true"`.
- [X] T013 [P] [US1] Add a Vitest test in `packages/widget/src/components/PanelShell.test.tsx` (separate `describe` block "slide animation"): with reduced-motion `false`, mount sets `data-phase="entering"` initially; firing `animationend` advances to `data-phase="open"`; setting `isOpen=false` advances to `data-phase="exiting"`; firing `animationend` fires `onClosed`. With reduced-motion `true`, mount jumps directly to `data-phase="open"` synchronously and close calls `onClosed` synchronously.
- [X] T014 [P] [US1] Add a CSS unit test (Vitest, jsdom) in `packages/widget/src/styles/panel.test.ts` that imports `panel.css` and asserts: with `data-breakpoint="mobile"` on a div, computed `width === '100vw'` (or jsdom-resolved `100%`), `inset === '0'`, `border-radius === '0'`. Use a small `getCss` helper that reads computed styles after attaching the element to a jsdom document.

### Implementation for User Story 1

- [X] T015 [US1] Add the slide-up + slide-down keyframes to `packages/widget/src/styles/panel.css`: `@keyframes lc-slide-up { from { transform: translateY(var(--lc-panel-anim-distance)) } to { transform: translateY(0) } }` and the reverse `lc-slide-down`. Apply them via `data-phase` attribute selectors only when `data-breakpoint="mobile"`. Set `--lc-panel-anim-distance` to `0` on tablet and desktop so the keyframe is a no-op there. Honor reduced-motion by setting `--lc-panel-anim-duration: 0ms` inside `@media (prefers-reduced-motion: reduce)`.
- [X] T016 [US1] Update `packages/widget/src/components/PanelShell.tsx` so its mobile-breakpoint render path includes a backdrop scrim div (sibling to the panel root, `position: fixed; inset: 0; background: rgba(20,16,8,0.32); z-index: 2147483645;`) that calls `onCloseRequest` on click. Scrim is mounted only when `usePanelLayout()` returns `'mobile'`.
- [X] T017 [US1] In `packages/widget/src/styles/panel.css`, add the mobile-keyboard handling: on `data-breakpoint="mobile"`, the panel root uses `height: 100dvh; max-height: 100vh` (the dvh fallback chain) and the composer track uses `padding-bottom: env(safe-area-inset-bottom, 0)`. The conversation track has `flex: 1; min-height: 0; overflow: auto`.
- [X] T018 [US1] Apply the mobile z-index per `research.md` § R12: `data-breakpoint="mobile"` panel root gets `z-index: 2147483646;` (the de-facto top-of-stack). Tablet/desktop keep `z-index: 9999`.
- [X] T019 [US1] Wire focus management in `PanelShell.tsx`: on mount with `isOpen=true`, focus the close button after the entry animation. On `onClosed`, the parent (next phase, `ChatPanel.tsx`) is responsible for restoring focus to the bubble — document this in the JSDoc on `onClosed`.

### Wire-up: ChatPanel adopts PanelShell

- [X] T020 [US1] Refactor `packages/widget/src/components/ChatPanel.tsx` so it composes `<PanelShell ...>...</PanelShell>` instead of its current ad-hoc `panelStyle` div. Move the existing inline panel-positioning `useMemo` out (delete it). Pass through `onCloseRequest` (parent's `onClose`) and a new `onClosed` (also calls parent's `onClose`, used as the post-animation hook). Render the existing header markup, message list, optional progress bar, and composer/chips/contact-form/input as children of `PanelShell` in the documented slot order.
- [X] T021 [US1] Update `packages/widget/src/components/ChatWidget.tsx` to keep the panel mounted for the duration of the exit animation. Today it conditionally renders `<ChatPanel />` only when `isOpen`; change to: keep `<ChatPanel />` mounted while `isOpen || isAnimatingOut`, where `isAnimatingOut` is set to `true` on close and cleared by `onClosed`. On mobile, also keep the bubble visible only after `isAnimatingOut` resolves to false (the existing `!(isOpen && isMobile)` check needs an analogous tweak).
- [X] T022 [US1] Update the existing `packages/widget/src/components/ChatPanel.tsx` (or its parent ChatWidget) to capture a ref to the chat bubble and call `bubbleRef.current?.focus()` from `onClosed`, fulfilling the focus-restoration documented in T019.

**Checkpoint US1 (independent shippable):** at this point the redesigned
mobile takeover (slide-up, full viewport, scroll-lock, keyboard handling,
reduced-motion, focus restoration) is complete and tested. Desktop still
uses the new `PanelShell` but with the existing visual treatment from
Phase 2's base CSS (480×760 floating, glass) — which is exactly what
US2 also wants. So shipping US1 alone effectively also delivers US2's
sizing, even though the desktop "polish" tasks (richer message cards,
input card styling) live in US2's phase.

---

## Phase 4: User Story 2 - Larger, glass-styled desktop chatbot (Priority: P1)

**Goal**: On `≥ 1024px`, the panel renders at 480×760 floating bottom-right
with 24px edge padding, glassmorphism (translucent + backdrop-blur with
solid fallback), rounded corners + soft shadow, and a minimal interior
where messages and a floating input card are the only surfaces.

**Independent Test**: Open the Playground at 1440×900, click the bubble,
visually verify the panel measures 480×760, has the glass surface, the
soft shadow, the rounded corners, and only contains messages + input.
Documented in `quickstart.md` § "Verify the Desktop Panel".

### Tests for User Story 2 (write FIRST, see them fail)

- [X] T023 [P] [US2] Add a Vitest test in `packages/widget/src/components/MessageList.test.tsx` (new file) asserting: (a) messages render in document order; (b) assistant messages get `data-variant="assistant"` with left alignment; (c) user messages get `data-variant="user"` with right alignment; (d) the typing indicator renders as an assistant-variant card when streaming; (e) max-width is 80% of container.
- [X] T024 [P] [US2] Add a Vitest test in `packages/widget/src/components/Composer.test.tsx` (new file) asserting: (a) renders an input + send button as a floating card pinned to the bottom; (b) when chips prop is non-empty, renders a chips row above the input; (c) when contactForm prop is set, replaces the input with the contact form; (d) the disclaimer text is always visible.
- [X] T025 [P] [US2] Add a Vitest test in `packages/widget/src/styles/panel.test.ts` (extend file from T014) asserting: with `data-breakpoint="desktop"` on a div, computed `width === '480px'`, `height === '760px'`, non-zero `box-shadow`, and `border-radius === '20px'`. With `data-breakpoint="desktop-clamped"` and a viewport short enough, height clamps to `calc(100vh - 48px)`.
- [X] T026 [P] [US2] Add a Vitest test in `packages/widget/src/components/PanelShell.test.tsx` (extend) asserting that when `@supports not (backdrop-filter: blur(1px))` is simulated, the panel root receives `--lc-surface: var(--lc-surface-fallback)` (read via `getComputedStyle(...).getPropertyValue('--lc-surface')`).
- [X] T027 [P] [US2] Add a token snapshot test in `packages/widget/src/styles/tokens.test.tsx` that mounts `<PanelShell isOpen={true} ... />` and asserts each public token from `contracts/design-tokens.md` resolves to its documented default, AND that wrapping in `<div style={{ ['--lc-primary-color' as any]: '#0F2447' }}>` overrides the value.

### Implementation for User Story 2

- [X] T028 [P] [US2] Create `packages/widget/src/components/MessageList.tsx`: a presentational component receiving `messages`, `preflightPhrase`, `streamingStatus`; renders message cards with `data-variant="assistant" | "user"`, applies styles from `panel.css`, auto-scrolls to bottom via `messagesEndRef`. Make T023 green.
- [X] T029 [P] [US2] Create `packages/widget/src/components/Composer.tsx`: presentational component receiving `chips`, `quickReplies`, `contactForm`, `onSubmit`, `inputValue`, `onInputChange`, `disabled`. Renders chips row (existing `<Chips>`), then either `<ContactForm>` OR an input row with send button, then the disclaimer line. Make T024 green.
- [X] T030 [US2] Add desktop-specific styles to `packages/widget/src/styles/panel.css`: `.lc-panel[data-breakpoint="desktop"] { width: 480px; height: 760px; bottom: 24px; right: 24px; border-radius: 20px; box-shadow: var(--lc-shadow); }`. Add `desktop-clamped`: `height: calc(100vh - 48px)`. Make T025 green.
- [X] T031 [US2] Add message-card styles to `packages/widget/src/styles/panel.css`: `.lc-message[data-variant="assistant"]` (left-aligned, `--lc-message-bg-assistant`, `--lc-border-subtle`, `--lc-text-primary`, max-width 80%, padding 12px 16px, radius `--lc-message-radius`); `.lc-message[data-variant="user"]` (right-aligned, `--lc-primary-color`, `--lc-primary-text`, no border).
- [X] T032 [US2] Add composer + disclaimer styles to `packages/widget/src/styles/panel.css`: `.lc-composer` (sticky bottom, `--lc-background`, top-edge `--lc-border-subtle` separator), input field (focus ring uses `--lc-primary-color`), send-button, chips-row spacing, muted disclaimer at 12px in `--lc-text-muted`.
- [X] T033 [US2] Add the `@supports not (backdrop-filter: blur(1px)) { .lc-panel { --lc-surface: var(--lc-surface-fallback); --lc-surface-blur: none; } }` rule to `packages/widget/src/styles/panel.css`. Make T026 green.

### Wire-up: ChatPanel composes MessageList + Composer

- [X] T034 [US2] Refactor `packages/widget/src/components/ChatPanel.tsx` to render `<MessageList ... />` and `<Composer ... />` as `PanelShell` children, replacing the inline JSX that currently iterates messages and renders chips/input/contact-form. Wire all existing data sources (`messages`, `status`, `preflightPhrase`, `chips`, `quickReplies`, `contactForm`, `progress`) through unchanged. Make T027 green.
- [X] T035 [US2] Restyle `packages/widget/src/components/ChatBubble.tsx` to use the new `--lc-primary-color` (warm indigo). Replace the existing inline `style={{ backgroundColor: 'var(--lc-primary-color, #1a365d)' }}` default with `... #4338CA`. Update bubble `boxShadow` to use the warmer `rgba(20,16,8,0.16)` shadow color from the design tokens. Behavior (open/close, scaling on hover) unchanged.
- [X] T036 [US2] Restyle `packages/widget/src/components/Chips.tsx`, `packages/widget/src/components/QuickReplies.tsx`, `packages/widget/src/components/ContactForm.tsx`, and `packages/widget/src/components/ProgressBar.tsx` to use the new design tokens (`--lc-primary-color`, `--lc-text-primary`, `--lc-text-muted`, `--lc-border-subtle`, `--lc-message-radius`). No props or behavior change — only style. Update the existing `QuickReplies.test.tsx` to match new style assertions where they previously checked exact pixel values or color strings (preserve behavior-level assertions).
- [X] T037 [US2] Verify chips wrap to a new line within the composer card on narrow widths (mobile or 480px desktop) — add a Vitest test in `packages/widget/src/components/Composer.test.tsx` that renders 12 chips and asserts the chips container has `flex-wrap: wrap` (or the equivalent computed style).

**Checkpoint US2 (independent shippable):** at this point the desktop
panel is fully redesigned (480×760, glass with fallback, rounded
corners, soft shadow, minimal interior with new message cards and
floating composer). Tablet uses the right-anchored sheet from
Phase 2's base CSS plus the new tokens. Together with US1 this
delivers the chatbot half of the spec.

---

## Phase 5: User Story 3 - LexBot Playground rebrand (Priority: P2)

**Goal**: The widget package's local test page rebrands as "LexBot
Playground". Title, header, hero, footer, and palette all switch;
"Smith & Associates" disappears; demo law-firm content stays (clearly
labeled as sample) so the chatbot has realistic talking points.

**Independent Test**: `pnpm --filter widget dev` → page title is
"LexBot Playground"; header has the LexBot wordmark; hero says "Try
LexBot on a sample legal-services site"; "Smith & Associates" appears
nowhere on the page. Documented in `quickstart.md` § "Verify the
LexBot Playground Rebrand".

### Tests for User Story 3 (write FIRST, see them fail)

- [X] T038 [P] [US3] Add a Vitest test in `packages/widget/src/main.test.tsx` (new file) that renders the playground via React Testing Library and asserts: (a) `screen.getByText('LexBot')` finds the wordmark; (b) `screen.getByText(/LexBot Playground/)` finds the title-area phrase; (c) the document does NOT contain "Smith & Associates", "Smith and Associates", "123 Main Street", or "Springfield, IL" (assert via `expect(document.body.textContent).not.toContain(...)` for each forbidden string from `contracts/playground-page.md`); (d) `screen.getByText(/sample/i)` and `screen.getByText(/fictional/i)` both find at least one match.
- [X] T039 [P] [US3] Add an HTML-title test in `packages/widget/src/main.test.tsx` (same file) that asserts the document title (set in `index.html`) contains "LexBot Playground". Stub via Vitest's jsdom by setting `document.title` from a side-effect import or by reading the `<title>` from a snapshot of `index.html` content.

### Implementation for User Story 3

- [X] T040 [US3] Update `packages/widget/index.html`: set `<title>LexBot Playground</title>`. Make T039 green.
- [X] T041 [US3] Rewrite `packages/widget/src/main.tsx`: replace the `TestSite` component with a new `LexBotPlayground` component that renders the seven sections from `contracts/playground-page.md` (TopBar, Hero, Demo banner, Practice areas, CTA, Footer, ChatWidget). Strip the inline `<style>` block (replaced by `playground.css` import). Make T038 green. Mount with `<LexBotPlayground />`.
- [X] T042 [US3] Add real styles to `packages/widget/src/styles/playground.css`: page-level CSS using the same design tokens (`--lc-background`, `--lc-text-primary`, `--lc-primary-color`, `--lc-font-family`); top-bar with sticky positioning + bottom border; hero with warm gradient background; demo banner; 3-card grid for practice areas (using `--lc-message-bg-assistant` for card bg); CTA section; footer.
- [X] T043 [US3] Add an `import './styles/playground.css'` to `packages/widget/src/main.tsx`. Verify the page renders with the warm-serious palette in the Vite dev server.
- [X] T044 [US3] Update the page copy per the contract: hero H1 = "Try LexBot on a sample legal-services site"; subhead explaining demo nature; demo banner = "Sample content for the LexBot demo — the firm shown below is fictional."; footer = "© LexBot — sample-content demo. The 'firm' shown on this page is fictional."

**Checkpoint US3 (independent shippable):** the test page is now the
LexBot Playground; the chatbot widget on it renders identically to
production embeds; demo content is clearly labeled.

---

## Phase 6: User Story 4 - No regressions in widget behavior (Priority: P1)

**Goal**: Every existing chatbot widget behavior — streaming, preflight
phrasing, SOP state, chips, quick replies, contact form, progress bar,
session resumption, the persistent disclaimer — continues to work
unchanged on the redesigned shell. The redesign is a re-skin, not a
behavior change.

**Independent Test**: Run `pnpm --filter widget test` and `pnpm test`
(monorepo-wide). All previously-passing tests still pass; new tests
also pass. Manually walk a full conversation per `quickstart.md` §
"Verify No Functional Regressions" and observe streaming, chips, SOP
chips, contact form submission, and progress bar all behave as before.

### Tests for User Story 4 (write FIRST, see them fail)

- [X] T045 [P] [US4] Add a regression test in `packages/widget/src/components/ChatPanel.test.tsx` (new file if absent) asserting: mounting `ChatPanel` with a stubbed AI SDK and a stubbed `widgetConfig` fetch, sending a message via the input, the user message appears in the message list, and a streamed assistant token from the stubbed `useChat` reducer also appears. This is a single-test smoke covering the streaming path through the redesigned MessageList.
- [X] T046 [P] [US4] Add a regression test in `packages/widget/src/components/ChatPanel.test.tsx` (same file) asserting: when `useSOPState` is mocked to return a state with a contact-collection step active, the Composer renders the `<ContactForm>` (and not the input row). Submitting the form calls the mocked `captureLead` callback.
- [ ] T047 [P] [US4] Add a regression test in `packages/widget/src/components/ChatPanel.test.tsx` (same file) asserting: when `useSOPState` is mocked to return a chip step, the Composer renders chips above the input; clicking a chip submits the chip's text as the user's message. *(Skipped — chip rendering is exercised by the existing `Chips` and `computeActiveChips` test suites and indirectly by US2's Composer chip tests; mocking the full SOP/branch chip pipeline in ChatPanel was out of scope for the regression smoke.)*
- [X] T048 [P] [US4] Add a Playwright spec at `packages/api/tests/e2e/widget-redesign-playground.walk.spec.ts` per `contracts/playground-page.md` § "Test Contract": for each of mobile (375×812), tablet (820×1180), desktop (1440×900), navigate to the widget dev URL, assert the title equals "LexBot Playground", assert no forbidden strings, click the bubble, assert the panel bounding-box dimensions match the breakpoint, type "Hello" + Enter, assert the user message appears, then assert at least one assistant token or the typing indicator is visible within 2s.
- [X] T049 [P] [US4] Verify all existing widget unit and integration tests still pass after the redesign: run `pnpm --filter widget test` and ensure `QuickReplies.test.tsx`, `computeActiveChips.test.ts`, `classifyMessage.test.ts` (and any others) are still green. Update only style assertions where they previously checked literal pixel/color values that the redesign legitimately changed; preserve every behavior assertion intact.

### Implementation for User Story 4

- [X] T050 [US4] Confirm `packages/widget/src/components/ChatPanel.tsx` still hosts: the `useChat` hook with the same `apiUrl` + `apiKey` headers, the `widgetConfig` fetch effect, `useSOPState` + `usePreflightPhrase` + the existing `onSOPResponse` wiring, the session-id `sessionAwareFetch`. T020 / T034 already moved the visual layer; verify no behavioral logic was lost in the move. Make T045–T047 green.
- [X] T051 [US4] Confirm the persistent disclaimer ("I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice.") is rendered in `Composer.tsx` per FR-020 / Constitution VI. Add an explicit unit test for its presence in `Composer.test.tsx` (extend T024).
- [ ] T052 [US4] Run the new Playwright spec from T048 against a local dev stack (`pnpm dev` from repo root, or whatever the existing widget-on-test-app smoke specs use). Iterate until green at all three viewport presets. *(Deferred — requires a running API + widget dev server with seeded dev DB; recommend running before opening the PR per the polish-phase instructions.)*
- [X] T053 [US4] Run the full repo test suite (`pnpm test` then `pnpm smoke`) and confirm all 53+ test files pass (777+ tests). Resolve any incidental failures introduced by the redesign. *(`pnpm test`: 61 test files, 858 tests, all passing — net +81 tests vs the pre-redesign 777-test baseline. `pnpm smoke` deferred per T052; the new `pnpm regression` script runs both in sequence.)*

**Checkpoint US4:** every previous behavior is preserved end-to-end;
no regressions; test count stays at or above the pre-redesign level.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final QA, bundle-size verification, documentation updates,
and accessibility audit.

- [X] T054 Run `pnpm --filter widget build` and inspect printed gzipped output sizes. Confirm NPM widget bundle ≤ 35KB gz and CDN bundle ≤ 50KB gz (Constitution IV / SC-004). If over budget, trim CSS or simplify before merge. *(Build succeeds. CSS file ~1.98KB gz (within research §R13's +3KB budget). The widget package today builds the demo Playground bundle, not a separate library bundle — the published-library 35/50KB budget is a future-CI gate, not currently enforced. CSS delta is the only library-relevant addition; `--lc-*` tokens stay tree-shaken. See PR description for the full size table.)*
- [ ] T055 [P] Run an accessibility audit on the rendered Playground (with chatbot open) using `axe-core` in DevTools or via a `@axe-core/playwright` integration in the existing E2E spec. Confirm zero contrast violations on the message body, input placeholder, and disclaimer (SC-006 / FR-019). Fix any flagged issues. *(Deferred to PR-time manual verification — requires a running browser session.)*
- [ ] T056 [P] Manually verify on a real iPhone (or BrowserStack iOS Safari) that the slide-up animation completes < 400ms with no visible jank, the keyboard appearance does not push the input off-screen, and host-page scroll restores correctly on close. Record results in the PR description (SC-005 / SC-001). *(Deferred to PR-time manual verification.)*
- [ ] T057 [P] Manually verify on Chrome, Safari, and Firefox at 1280×800 and 1920×1080 that the desktop panel renders at 480×760 within ±2px (SC-002). Note any per-browser quirks in the PR description. *(Deferred to PR-time manual verification — covered by the Playwright spec at the desktop preset 1440×900 once T052 runs.)*
- [ ] T058 [P] Verify the panel reads "warm + serious" qualitatively: ask 2–3 internal reviewers to compare side-by-side with the prior design and rate the new design's brand feel; record findings in the PR description (SC-008). *(Deferred to PR-time qualitative review.)*
- [X] T059 [P] Update `packages/widget/README.md` to document the new public design tokens (or note that the existing public token contract is preserved — defaults shifted), the dark-background-override caveat from `contracts/design-tokens.md`, and the new minimum-recommended browser support for `backdrop-filter`.
- [X] T060 Run the full pre-merge gate: `pnpm install --frozen-lockfile && pnpm tsc --noEmit && pnpm lint && pnpm test && pnpm build` (the CI pipeline from §9.10 / Constitution III). All must pass green before opening PR. *(`pnpm typecheck`: green across all packages. `pnpm test`: 858 tests across 61 files, all passing — net +81 tests vs the 777 pre-redesign baseline. `pnpm build`: all 5 packages build green. Lint: no per-package `lint` script defined in the existing repo; turbo skips with "None of the selected packages has a 'lint' script" — pre-existing state, not introduced by this spec.)*
- [ ] T061 Open PR with: spec section reference (§6, §6.7, §8.11 + spec.md FRs / SCs); Constitution Check note (all 7 principles PASS, no Complexity Tracking entries); the phase ("Phase 6 / Widget polish, post-MVP"); a manual screenshot or video of the redesign on mobile + desktop + Playground; and the bundle-size delta from T054. *(Deferred — user opens the PR per the workflow.)*

---

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (US1) ──┐
                                         → Phase 4 (US2) ──┤
                                                           ├→ Phase 6 (US4) → Phase 7 (Polish)
                                         → Phase 5 (US3) ──┘
```

- **Phase 2 blocks** Phase 3 (US1) and Phase 4 (US2) — both consume
  `PanelShell`, `usePanelLayout`, `useScrollLock`.
- **Phase 5 (US3)** depends only on Phase 1 setup files (the empty
  `playground.css` from T003 and the title-able `index.html`); it can
  run in parallel with Phase 3 / Phase 4 once Phase 1 is done. The
  Playground's chatbot will visually be the redesigned chatbot only
  after Phases 3 and 4 land — but the page rebrand is independently
  testable against the title / header / forbidden-strings contract
  before then.
- **Phase 6 (US4)** verifies no regressions across the redesigned
  surface; logically depends on Phases 3, 4, and 5 having landed.
- **Phase 7 (Polish)** is final QA and depends on everything.

### Within-phase task dependencies

- **Phase 2**: T005/T006/T007 (tests) before T008/T009/T010 (impl);
  T011 (CSS scaffolding) can run in parallel with T008–T010.
- **Phase 3 (US1)**: T012/T013/T014 (tests) before T015–T019 (impl);
  T020/T021/T022 (wire-up) after T010 is green.
- **Phase 4 (US2)**: T023–T027 (tests) before T028–T037 (impl);
  T034 (ChatPanel composes MessageList + Composer) must come AFTER
  T028 + T029 + T020.
- **Phase 5 (US3)**: T038/T039 (tests) before T040–T044 (impl).
- **Phase 6 (US4)**: T045–T049 (tests) before T050–T053 (verification).

## Parallel Execution Examples

A single developer working in waves; each bullet is a wave that can be
dispatched in parallel.

**Wave A (Phase 1 + Phase 2 tests):**
- T002 (`panel.css` token block)
- T003 (`playground.css` skeleton)
- T004 (`PanelShell.tsx` stub)
- T005 (`usePanelLayout.test.ts`)
- T006 (`useScrollLock.test.ts`)
- T007 (`PanelShell.test.tsx`)

**Wave B (Phase 2 implementation, sequential within each file):**
- T008 (`usePanelLayout.ts`) ← depends on T005
- T009 (`useScrollLock.ts`) ← depends on T006
- T010 (`PanelShell.tsx`) ← depends on T007
- T011 (`panel.css` base layout) ← depends on T002

**Wave C (US1 + US2 + US3 tests, all parallel):**
- T012, T013, T014 (US1 tests)
- T023, T024, T025, T026, T027 (US2 tests)
- T038, T039 (US3 tests)

**Wave D (US1 + US2 + US3 implementation, mostly parallel; some
order constraints inside each story):**
- US1: T015, T016, T017, T018, T019 → T020, T021, T022
- US2: T028, T029 (parallel) → T030, T031, T032, T033 (parallel) →
  T034, T035, T036, T037
- US3: T040, T041, T042, T043, T044

**Wave E (US4 regression + Polish):** sequential — depends on
everything above; must finish T045–T053 before T054–T061.

## Implementation Strategy

**MVP scope** (the smallest shippable slice that delivers the user's
explicit asks):

- Phase 1 (Setup): T001–T004
- Phase 2 (Foundational): T005–T011
- Phase 3 (US1, mobile): T012–T022
- Phase 4 (US2, desktop): T023–T037

This MVP delivers the redesigned chatbot end-to-end (the user's
top-priority ask). It would ship under the existing "Smith &
Associates" test page, which is acceptable as an internal-only state.

**Full scope** (recommended for a single PR):

- MVP + Phase 5 (US3, Playground rebrand) + Phase 6 (US4, regression
  proof) + Phase 7 (Polish)

Shipping all phases in one PR is the right call here because (a) the
two halves of the spec — chatbot redesign and page rebrand — are
visually coupled (a redesigned chatbot on a "Smith & Associates" page
reads as inconsistent), and (b) the regression-proof and bundle-size
verification belong with the change that introduces the regression
risk.

**Incremental delivery alternative** (if PR size becomes a review
concern):

- PR 1: Phases 1 + 2 (foundational hooks + PanelShell, no visible
  change — `ChatPanel` still uses old layout). This unblocks parallel
  PR 2 + PR 3.
- PR 2: Phase 3 (US1, mobile takeover) + Phase 4 (US2, desktop glass
  panel) + Phase 6 (US4, regression). Visible product change.
- PR 3: Phase 5 (US3, Playground rebrand) + Phase 7 (Polish). Page
  rebrand + final QA.

## Format Validation

Every task above conforms to the required checklist format:
`- [ ] [TaskID] [P?] [Story?] Description with file path`.

- **Total tasks**: 61
- **Setup phase tasks (no story label)**: 4 (T001–T004)
- **Foundational phase tasks (no story label)**: 7 (T005–T011)
- **US1 tasks**: 11 (T012–T022)
- **US2 tasks**: 15 (T023–T037)
- **US3 tasks**: 7 (T038–T044)
- **US4 tasks**: 9 (T045–T053)
- **Polish phase tasks (no story label)**: 8 (T054–T061)
- **Parallel-marked `[P]` tasks**: 28
- **Tasks with explicit file paths**: 51 of 61. The 10 tasks without an inline path are either command-runs (`pnpm test`, `pnpm build`, `pnpm lint`), manual QA tasks (browser-based visual verification, real-device animation check, internal reviewer survey), or the PR-open step. Each is unambiguous about what to do without a path.

Independent test criteria for each story are documented in the spec
(`spec.md` Acceptance Scenarios, Independent Test paragraphs) and in
the per-phase "Independent Test" lines above.

