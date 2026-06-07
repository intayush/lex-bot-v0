# Phase 0 Research: Chatbot Redesign + LexBot Playground

This document captures the design decisions made before implementation,
each in the standard `Decision / Rationale / Alternatives considered`
format. There were no `[NEEDS CLARIFICATION]` markers in the spec —
the user pre-decided the design direction in a prior session — so this
research focuses on technical-implementation choices that the spec
intentionally left to the plan.

## R1 — Glass effect implementation

**Decision**: Use native CSS `backdrop-filter: blur(20px) saturate(180%)`
combined with a translucent `background-color: rgba(252, 250, 245, 0.72)`
(warm-neutral surface). For browsers that do not support
`backdrop-filter` (detected via `@supports not (backdrop-filter: blur(1px))`),
fall back to a near-opaque solid surface using
`background-color: rgba(252, 250, 245, 0.96)`. No JavaScript-driven
blur; no canvas-based glass; no third-party library.

**Rationale**:

- Zero bytes added to the bundle (FR-023 / SC-004 / Constitution IV).
- `backdrop-filter` is supported in all evergreen targets (Chrome 76+,
  Safari 9+ with `-webkit-` prefix, Firefox 103+, Edge 79+).
- The fallback path keeps the same shadow, corner radius, and palette,
  so the panel still feels coherent on browsers that drop the blur
  (FR-013).
- `@supports` is the standards-blessed feature-detection mechanism;
  using it inside a CSS file means no JS runs to compute support.

**Alternatives considered**:

- *SVG `feGaussianBlur` filter on a fixed-position background image*:
  rejected because it cannot blur arbitrary host-page content
  underneath the chatbot; only `backdrop-filter` reads the live
  composited surface.
- *Tinted solid surface with no blur on every browser*: rejected
  because it abandons the "glassmorphism" requirement (FR-010) for
  the majority of users that do support backdrop-filter.
- *Third-party motion / glass library (e.g., `framer-motion`,
  `glasscn`)*: rejected because every such library is multi-KB
  gzipped and the redesign's bundle-size budget is non-negotiable.

## R2 — Slide-up animation technique

**Decision**: Pure-CSS keyframe animation on a wrapper div, animating
`transform: translateY(100%) → translateY(0)` over 320ms with
`cubic-bezier(0.16, 1, 0.3, 1)` (an "easeOutExpo"-ish curve). The exit
animation is the inverse, on close. The animation is scoped to mobile
breakpoint via a CSS variable (`--lc-panel-anim`) that is set to
`none` on tablet/desktop.

`prefers-reduced-motion: reduce` is honored via a single
`@media (prefers-reduced-motion: reduce)` rule that sets
`animation: none` on the wrapper. Additionally, the existing
`useReducedMotion` hook (already present in
`packages/widget/src/hooks/useReducedMotion.ts`) is consulted to
short-circuit the close-animation timer (so close is instant rather
than waiting on a phantom 320ms timeout).

**Rationale**:

- `transform` animates on the compositor thread → no layout thrash,
  meets SC-005 (no frame > 100ms).
- 320ms total < 400ms budget (FR-005).
- The curve is the one Apple / Material use for "expressive" entries
  — feels more product-y than the default `ease-out`.
- Reduced-motion is honored at *both* the CSS layer (the animation
  itself) and the JS layer (close timing), so visually-impaired users
  get instant transitions without dead time.

**Alternatives considered**:

- *Web Animations API (`element.animate(...)`)*: rejected because
  the static CSS variant is simpler, has identical compositor
  behavior, and pairs more naturally with the `@media (reduced-motion)`
  override.
- *Framer-motion / react-spring*: rejected on bundle-size grounds.
- *Animating `bottom: -100% → 0`*: rejected — `bottom` triggers
  layout, will jank on low-end devices, fails SC-005.

## R3 — Host-page scroll preservation on mobile open/close

**Decision**: Implement a `useScrollLock` hook that, when the chatbot
opens on mobile, captures `window.scrollY`, sets
`document.body.style.position = 'fixed'`,
`document.body.style.top = '-${scrollY}px'`,
`document.body.style.left = '0'`,
`document.body.style.right = '0'`,
`document.body.style.width = '100%'`, and remembers the original
inline values. On close, restore each captured property and call
`window.scrollTo(0, scrollY)`. The hook only engages when
`breakpoint === 'mobile'`; on tablet/desktop, no scroll-lock is
applied (the panel doesn't cover the host page anyway).

**Rationale**:

- This is the well-known iOS-Safari-compatible scroll-lock idiom.
  iOS Safari ignores `body { overflow: hidden }` for scroll lock;
  the `position: fixed; top: -scrollY` trick is the only reliable
  cross-browser approach.
- Snapshotting and restoring the original inline styles (rather
  than blindly setting them to `''`) protects host pages that have
  their own inline styles on `<body>` (FR-008 / SC-001 must not
  break host pages).
- Localized to a hook with a small surface — easy to unit-test
  against a jsdom `document.body`.

**Alternatives considered**:

- *`<dialog>` element with `showModal()`*: would handle scroll
  lock natively, but the chatbot is *not* a modal in the formal
  ARIA sense (it has its own dismiss control and lives in the
  page), and `<dialog>`'s default user-agent styles are heavy.
  Adopting it would entangle this redesign with an a11y semantics
  shift that is out of scope.
- *`overflow: hidden` on `<html>` and `<body>`*: rejected
  because of the iOS Safari scroll-lock bug noted above; it
  also doesn't preserve scroll position.
- *`inert` attribute on host content*: doesn't lock scroll;
  only blocks interaction. Useful for a11y but not for this
  scroll-preservation requirement.

## R4 — On-screen-keyboard handling on mobile

**Decision**: Use `100dvh` (dynamic viewport height) for the panel's
height on mobile, with a `100vh` fallback chained via CSS
`min(100dvh, 100vh)`. Pin the composer to the bottom of the panel
with `position: sticky; bottom: 0` and `padding-bottom:
env(safe-area-inset-bottom, 0)` for iOS notch/home-indicator
clearance. The conversation area uses `flex: 1; min-height: 0`
so it shrinks naturally as the keyboard collapses the dynamic
viewport.

**Rationale**:

- `dvh` is the modern unit specifically designed to track on-screen
  keyboard insets and browser-chrome show/hide. Supported in iOS
  Safari 15.4+, Chrome 108+, Firefox 101+ — well within the target
  matrix.
- The `100vh` fallback covers older browsers; in those cases the
  composer may be partially obscured under the keyboard, but only
  on legacy versions outside the FR-009 contract.
- `safe-area-inset-bottom` is the standards-blessed way to clear
  the iOS home indicator without baking in a magic number.
- Sticky composer means the message list naturally scrolls behind
  it; no JS scroll math required.

**Alternatives considered**:

- *`window.visualViewport` API listeners*: would let us read the
  exact keyboard height and resize the panel imperatively.
  Rejected as more complex than the CSS-only solution and
  unnecessary given dvh support.
- *Fixed `100vh` only*: fails FR-009 on iOS Safari where
  `100vh` includes the area under the keyboard.
- *Polyfilled `--vh` JS variable updated on `resize`*: was the
  pre-`dvh` workaround; obsolete now.

## R5 — Styling architecture: inline styles → CSS file + custom properties

**Decision**: Move the panel's structural and visual styles out of
inline-style objects in `ChatPanel.tsx` and into a dedicated
`packages/widget/src/styles/panel.css` file imported by
`PanelShell.tsx`. The CSS file defines the new design tokens as
CSS custom properties on a single `.lc-panel` root class:

```text
.lc-panel {
  --lc-surface: rgba(252, 250, 245, 0.72);
  --lc-surface-fallback: rgba(252, 250, 245, 0.96);
  --lc-surface-blur: blur(20px) saturate(180%);
  --lc-shadow: 0 8px 40px rgba(20, 16, 8, 0.16);
  --lc-message-radius: 16px;
  --lc-panel-radius: 20px;
  /* existing customer-facing tokens preserved: */
  --lc-primary-color: #4338CA;       /* warm indigo, was #1a365d */
  --lc-primary-text:  #ffffff;
  --lc-background:    #fcfaf5;       /* warm off-white, was #ffffff */
  --lc-border-radius: 20px;
  --lc-font-family: ...;
}
```

Customer-facing override tokens (`--lc-primary-color`, etc.) keep the
same names so embedded firms' theme overrides continue to work
(FR's "preserve existing CSS-custom-property override hooks").
New internal tokens (`--lc-surface*`, `--lc-shadow`,
`--lc-message-radius`) are documented in the design-tokens contract
but are not part of the public override surface for v1.

**Rationale**:

- Inline-style objects in `ChatPanel.tsx` (`panelStyle = useMemo(...)`
  with branching on `breakpoint`) make the file 512 LOC and force
  every visual change into TypeScript. A single CSS file with
  breakpoint media queries is the right home for breakpoint
  switching; React state should drive *open/close*, CSS should drive
  *layout*.
- Customer overrides have always been CSS-custom-property based
  (`--lc-primary-color` etc., see existing `ChatBubble.tsx` line 18).
  This decision is purely a continuation; we just add more tokens.
- Importing a `.css` file from a Vite-built package works in both
  the NPM and CDN bundle paths today (Chips and ContactForm already
  use small style blocks; no Vite config change is needed).

**Alternatives considered**:

- *Tailwind*: rejected — Constitution §IV.Required Stack lists
  Tailwind for the dashboard but explicitly notes the Widget uses
  CSS custom properties (per §6.7, §8.11). Adding Tailwind to the
  widget would inflate the bundle and break the override contract.
- *CSS-in-JS (`@emotion/styled`, `styled-components`)*: rejected on
  bundle-size grounds (each is ~10KB+ gzipped) and adds runtime
  overhead the redesign does not need.
- *CSS Modules*: would be acceptable but offers no advantage over
  one global `.lc-panel`-scoped CSS file for a single component
  surface. Adding a Vite config flag for CSS Modules is unwarranted
  complexity.
- *Continue inline styles, add new tokens as inline JS objects*:
  rejected — the file is already too large and the reviewer who
  came before us flagged inline-style sprawl as a code-health debt
  in spec 016's PR review.

## R6 — Color palette + typography for "warm + serious"

**Decision**:

- **Surface**: warm off-white `#fcfaf5` with a soft alpha
  (`rgba(252, 250, 245, 0.72)`) for the glass panel. Fallback
  near-solid: `rgba(252, 250, 245, 0.96)`.
- **Foreground / body text**: deep warm charcoal `#1f1b16` —
  4.5:1+ contrast against the effective glass surface (FR-019 / SC-006).
- **Accent (primary)**: warm indigo `#4338CA` — replaces the
  current `#1a365d` blue. Used for assistant message accents,
  the bubble, focused input ring, and chip selected state.
- **Assistant message card**: surface-tinted (`#f5f1e8`) on white;
  slight inner border `1px rgba(31, 27, 22, 0.06)`.
- **User message card**: filled accent (`var(--lc-primary-color)`,
  white text), right-aligned.
- **Disclaimer text** (Constitution VI): muted warm grey
  `#65604f` at 12px, beneath input.
- **Typography**: system font stack (`-apple-system, "Segoe UI",
  Roboto, Inter, sans-serif`) with letter-spacing tightened by
  -0.005em on body and -0.01em on headings. No web-font load —
  zero bytes added.
- **Spacing**: 16px base unit. Message card padding 12px 16px;
  panel padding 16px; composer padding 12px.

**Rationale**:

- The "warm + serious" target maps directly to: warm-neutral
  surfaces (off-white, not pure white), deep but non-corporate
  accent (indigo, not navy blue), generous spacing, no hard
  saturated reds/greens. This palette is also Anthropic-adjacent
  in *spirit* (warm cream + considered accent) without copying it
  pixel-for-pixel — which would risk the trademark concern flagged
  in the canvas-design / brand-guidelines skills.
- All contrast ratios verified against the *effective* glass
  surface (alpha-composited over a worst-case white host page →
  effective `#fcfaf5` ≈ 250-luminance, 4.5:1 against `#1f1b16`
  passes; against the worst-case dark host the alpha goes higher
  in fallback so contrast is preserved).
- System fonts are chosen because (a) zero bundle bytes, (b)
  modern system stacks (SF Pro, Segoe UI Variable, Roboto Flex)
  are already high-quality, (c) avoiding a Google Fonts request
  preserves the privacy posture (§5 / §11) — no third-party
  request is made when the widget renders.

**Alternatives considered**:

- *Load Inter via Google Fonts / `@fontsource/inter`*: rejected
  because the widget package today is request-free at render time
  and we want to keep it that way (privacy posture + bundle size).
- *Use the existing `#1a365d` blue accent*: rejected — the spec
  asks for a brand feel reset, and the existing navy-blue is too
  associated with the "Smith & Associates" mock.
- *Pure-white surface*: rejected — fails the "warm" half of "warm
  + serious"; the off-white is the smallest visible change that
  conveys warmth without becoming sepia / Instagrammy.

## R7 — Tablet sizing default

**Decision**: At viewports 768–1023px, the panel renders as a
right-anchored sheet: `width: min(420px, 100vw - 32px)`,
`height: 100dvh`, `top: 0`, `right: 0`, `bottom: 0`,
`border-radius: 20px 0 0 20px` (rounded only on the inner
edges), with the same glass treatment as desktop. No edge
padding from the right; flush with the right edge of the
viewport.

**Rationale**:

- The existing tablet behavior is a flush right-edge sheet
  (380px wide); this widens it to 420px, rounds the inner
  corners, and applies the glass treatment to match the
  redesign. Functionally identical to today on tablet for
  customers, with the new visual language.
- 420px gives ~33% width on a 1280×800 tablet landscape,
  which is the "sheet that doesn't dominate" target.
- Rounded inner corners only is the standard "drawer / sheet"
  pattern and reads as intentional.

**Alternatives considered**:

- *Same 480×760 floating panel as desktop*: rejected because at
  768px viewport width, a 480px floating panel with right edge
  padding would consume `480 + 24 + 24 = 528px` (more than the
  viewport width) — would either need to scale down or overlap
  the left edge. A right-anchored sheet is the cleaner pattern.
- *Mobile-style full takeover on tablet*: rejected because tablet
  users typically have side-by-side host content that they
  expect to stay visible.

## R8 — Playground page styling

**Decision**: A new `packages/widget/src/styles/playground.css`
file replaces the inline-style block in `main.tsx`. The
Playground page uses the *same* design tokens as the chatbot
panel (warm off-white background, deep charcoal text, warm
indigo accent), creating visual coherence between the page and
the widget. The layout is:

- **Top bar**: 64px tall, sticky, glassy bottom border. Left:
  "LexBot" wordmark (text-only, in the brand font, indigo
  accent). Right: a "Playground" pill label with a muted
  "demo / sample content" subtext.
- **Hero**: H1 "Try LexBot on a sample legal-services site",
  subhead explaining this is a demo of the chatbot widget, not
  a real firm. ~480px tall, generous padding, off-white-on-cream
  gradient.
- **Demo law-firm content**: kept similar in structure to today
  (practice-area cards in a 3-up grid, "Ready to Talk?" CTA,
  footer) but restyled with the warm palette. A subtle
  "Sample content for the LexBot demo" banner sits above the
  cards (FR-027).
- **Footer**: "© LexBot — sample-content demo. The 'firm' shown
  on this page is fictional." — replaces the Smith & Associates
  copyright (FR-026).

**Rationale**:

- Reusing the chatbot's design tokens makes the page and the
  panel feel like one product (FR-028).
- The hero copy + subhead + sample-content banner together make
  it impossible for a 5-second-skim reader to mistake the page
  for a real firm (SC-007).
- The structure of the demo content is preserved (practice
  areas, contact CTA) so the chatbot's `searchContext` tool
  retrieval continues to find realistic content if and when
  someone runs the crawler against this page (out of scope, but
  not foreclosed).

**Alternatives considered**:

- *Strip the demo content entirely and ship a barebones page*:
  rejected — the chatbot would have nothing legal-domain to
  refer to during conversation, breaking the "talk to a real
  firm" demo loop.
- *Build a marketing-quality LexBot landing page*: explicitly
  Out of Scope (spec.md). The Playground is a developer/internal
  surface.

## R9 — Component refactor: keep ChatPanel.tsx as the orchestrator

**Decision**: `ChatPanel.tsx` keeps ownership of:

- The `useChat` hook (AI SDK)
- `useSOPState`, `usePreflightPhrase`, the session-id /
  `widgetConfig` fetch effect, all SOP / scoring callbacks
- The `messages` / `sendMessage` / `status` chat state
- The `onClose` callback wiring

It delegates *only the visual surface* to a new
`PanelShell.tsx`:

```tsx
<PanelShell isOpen={isOpen} breakpoint={bp} onClose={onClose}>
  <PanelHeader title={...} onClose={onClose} />
  <MessageList messages={...} preflightPhrase={...} />
  <Composer
    chips={chips}
    quickReplies={qr}
    onSubmit={...}
    contactForm={contactForm}
    progress={progress}
  />
</PanelShell>
```

`MessageList` and `Composer` are extracted from inline JSX in
today's `ChatPanel.tsx` but receive the same data they used to
read directly. No state lifts up; no context is introduced.
This keeps the redesign a *visual* refactor and minimizes test
churn.

**Rationale**:

- Test churn is a real cost; the existing `QuickReplies.test.tsx`
  and the SOP integration tests in `packages/widget` exercise
  `ChatPanel` and friends. Keeping `ChatPanel` as the
  orchestrator means those tests' mounting strategy continues
  to work; only style assertions need updates (FR-024).
- Each new component (`PanelShell`, `MessageList`, `Composer`,
  `PanelHeader`) has a single visual responsibility — easy to
  test in isolation, easy to restyle in the future.
- Avoids a Context-API or Zustand-based state lift, which would
  be a larger architectural change unjustified by the spec.

**Alternatives considered**:

- *Move chat state to a React Context provider, make ChatPanel
  presentational*: rejected — bigger refactor than the redesign
  needs; would force every test to wrap in a provider.
- *One monolithic redesigned `ChatPanel.tsx`*: rejected — the
  current 512-LOC monolith was a maintenance pain in 016 and
  17 only makes it worse.

## R10 — Playwright smoke test location

**Decision**: Add the new Playground spec to
`packages/api/tests/e2e/widget-redesign-playground.walk.spec.ts`,
alongside the existing widget-on-test-app smoke specs
(`widget-preflight-phrase.walk.spec.ts`, `widget-sop-subtype-chips.walk.spec.ts`,
etc.). The repo's only Playwright configuration lives at
`packages/api/playwright.config.ts`, and all existing widget
e2e specs run from that directory.

The spec runs the existing widget dev server in CI (the same
way the existing widget e2e specs do), navigates to it at three
viewport presets:

- 375×812 (mobile, iPhone 13 Pro)
- 820×1180 (tablet, iPad)
- 1440×900 (desktop)

For each preset it asserts:

1. Page header text contains "LexBot Playground" and does NOT
   contain "Smith & Associates" (FR-025, FR-026, SC-007)
2. The chatbot bubble is visible
3. After clicking the bubble, the panel's bounding box matches
   the breakpoint's expected sizing (FR-001 / FR-002 / FR-003)
4. A scripted conversation (greet → user message → first
   streamed token received) succeeds (FR-021, US4 smoke)

**Rationale**:

- Co-locating with existing widget e2e specs reuses the
  Playwright config, fixtures, and dev-server bootstrap. No new
  CI plumbing.
- The viewport-preset coverage matches the three breakpoint
  branches in `usePanelLayout`, giving the e2e spec direct
  alignment with the unit tests of the same hook.
- Naming follows the repo's `*.walk.spec.ts` convention for
  walkthrough-style smoke tests.

**Alternatives considered**:

- *New `packages/widget/tests/e2e/`*: rejected — would require
  a second Playwright config and CI step. The repo intentionally
  has one Playwright config (the API package's).
- *Visual regression test (Playwright screenshots)*: rejected
  for v1 — flaky across OS/font-rendering differences, and the
  spec already has manual / qualitative success criteria for
  the visual half (SC-008).

## R11 — Brand mark wordmark for header / Playground

**Decision**: Use a text-only "LexBot" wordmark rendered in the
system font stack at 18px, weight 600, letter-spacing -0.01em,
color `var(--lc-primary-color)` (warm indigo). In the chatbot
panel header it sits left, accompanied by the firm-configured
`chatbot_name` from `widgetConfig` as a subtitle (smaller,
muted). On the Playground top bar it sits left as well, paired
with a "Playground" pill on the right.

If the embedding firm provides a `chatbot_name` via the
existing `/api/config` response (already used by the widget
today — see `widgetConfig.chatbot_name` in `ChatPanel.tsx`),
the firm's name remains the panel's primary header label and
"LexBot" steps back to a tiny "Powered by LexBot" footer
attribution under the disclaimer. This preserves white-label
behavior for production embeds.

**Rationale**:

- Text-only wordmark = zero asset bytes, no SVG to ship, no
  raster to retina-scale. Bundle-size friendly.
- The behavior degradation for production white-label embeds
  is what customers expect — they paid for "their bot," not
  "LexBot." The Playground page is the exception because it
  has no firm configured.
- The wordmark in the brand color reads as deliberate
  branding without an icon dependency.

**Alternatives considered**:

- *Commission a logo / SVG mark*: out of scope; not needed for
  v1 and would block on a non-engineering deliverable.
- *Use an emoji or unicode glyph as a logo*: rejected — feels
  toy-ish, undermines the "warm + serious" brand feel.

## R12 — Z-index and layering on host pages

**Decision**: The mobile full-viewport overlay uses
`z-index: 2147483646` (one less than the maximum signed 32-bit
int, the de-facto "always on top" value used by Intercom,
Zendesk, etc. for embedded widgets). The desktop floating
panel uses `z-index: 9999` (today's value, kept as-is). The
backdrop overlay (mobile only — a faint scrim behind the
panel that prevents accidental host-page interaction) uses
`z-index: 2147483645`.

**Rationale**:

- Edge-cases section calls out "host page with `position: fixed`
  overlays (cookie banners, newsletter modals)": those typically
  sit at `z-index: 9999` or `99999`. Using `2147483646` on
  mobile guarantees the chatbot covers them when the user has
  consciously opened it — which is the user's expectation.
- Desktop panels intentionally do *not* override host overlays
  with the max value, because the desktop panel doesn't pretend
  to be a takeover; it's a floating widget and host overlays
  taking precedence over it is reasonable.

**Alternatives considered**:

- *Use a single `z-index: 9999` for both breakpoints*: fails
  the "host page with position: fixed overlays" edge case on
  mobile.
- *Use `dialog` element with native top-layer*: out-of-scope
  semantic shift (see R3).

## R13 — Bundle-size budget verification

**Decision**: After implementation, run `pnpm build` in
`packages/widget` and inspect `dist/` gzipped sizes against
the existing CI bundle-size check (the widget package already
fails the build if it exceeds 35KB gz NPM / 50KB gz CDN per
Constitution IV). No new tooling needed.

**Pre-implementation budget estimate**:

- New CSS file (`panel.css`): ~2KB raw, ~1KB gz
- New CSS file (`playground.css`): ~1.5KB raw, ~0.6KB gz (only
  in playground build, not in published widget bundle — Vite
  excludes `main.tsx` from the widget library build)
- New TSX (`PanelShell` + `MessageList` + `Composer` +
  `usePanelLayout` + `useScrollLock`): ~150 LOC each on
  average; in-tree TypeScript that gzips well; net add ~3KB gz
- Removed inline styles from `ChatPanel.tsx`: -2KB raw, ~-1KB gz

**Net estimated delta**: +3KB gz to the NPM bundle, well within
the 35KB → 35KB headroom (today's bundle is well under budget;
exact number recorded in the PR description before merge).

**Rationale**: keeping a written budget estimate makes it easy
to flag a regression in code review before merge. SC-004 is the
gate.

**Alternatives considered**: none — there is no other reasonable
verification strategy given the existing CI check.

## Open Items

None. All decisions above are final for this plan. The next phase
(Phase 1) produces:

- `data-model.md` — visual data model (design tokens, layout
  regions, animation states, breakpoint matrix)
- `contracts/panel-shell.md` — the new `PanelShell` component's
  prop / slot / event contract
- `contracts/design-tokens.md` — the new and preserved CSS
  custom properties
- `contracts/playground-page.md` — the Playground page's
  structural contract (sections, copy, branding rules)
- `quickstart.md` — how to run, see, and verify the redesign
  locally
