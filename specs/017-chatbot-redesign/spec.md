# Feature Specification: Chatbot Redesign + LexBot Playground

**Feature Branch**: `017-chatbot-redesign`

**Created**: 2026-06-07

**Status**: Draft

**Input**: User description: "Redesign the chatbot and the test website. Rename the test website to LexBot Playground with a LexBot brand feel. Redesign the chatbot itself: when a user clicks the chat icon on mobile, the chatbot opens taking the entire viewport (full page); on desktop the chatbot is bigger than today. Take design inspiration from `chatbot-redesign-inspiration.png`. Pre-decided design direction: card-based layout with floating elements; glassmorphism / frosted panels; minimal distinctive UI (just messages and input); warm + serious brand feel (Anthropic-like); mobile is a full-viewport takeover with slide-up animation; desktop is 480px wide × 760px tall, floating with edge padding."

## Context & Background

This feature delivers two coupled but independently-shippable changes to the
in-repo demo experience used to showcase the LexBot widget:

1. **Test-site rebrand** — the React test page rendered by the `widget` package
   (today branded as "Smith & Associates", a fictional law firm) becomes
   **"LexBot Playground"**, a developer-facing demo page that signals the
   product (LexBot) rather than impersonating a customer law firm. This is
   the page a prospect or operator lands on when they run the local dev
   server or visit the hosted widget demo. It is *not* a customer-facing
   law-firm site.
2. **Chatbot visual redesign** — the bubble + panel widget gets a new visual
   language: glassmorphism / frosted panels, a card-based layout with
   floating elements, a minimal "messages and input only" surface, and a
   warm-but-serious brand feel. The mobile experience becomes a true
   full-viewport takeover with a slide-up entry animation; the desktop
   panel grows from the current 400×600 footprint to 480×760 with edge
   padding from the viewport corner.

Both changes are scoped to the **widget package's visual layer** and the
**widget's local test page**. No backend, agent, schema, lead-classification,
or SOP-state behavior changes — the widget continues to call the same
`/api/chat` and `/api/config` endpoints, with the same payloads, the same
streaming shape, the same SOP / chips / quick-replies / contact-form
behaviors. This is a "skin and shell" change, not a behavior change.

This work follows spec 016 (multi-branch SOP), which is complete and merged.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mobile full-viewport chatbot takeover (Priority: P1)

A visitor on a phone taps the chat bubble in the corner of the LexBot
Playground (or any embedding site). Instead of the bubble inflating into a
small panel that leaves the page underneath visible, the chatbot enters the
screen with a slide-up animation and occupies the **entire viewport**. The
visitor sees only the chatbot — header with brand mark and close affordance,
the conversation area, and the input. Tapping the close affordance slides
the panel back down and returns the visitor to the host page exactly as
they left it (scroll position, selection, anything in-flight on the page).

**Why this priority**: Mobile is where the existing widget feels most cramped
and where small panels lose to system UI (browser chrome, on-screen
keyboard). A real full-viewport takeover is the single largest perceived
quality jump and is what the user explicitly asked for first.

**Independent Test**: Open the LexBot Playground on a viewport ≤ 767px wide
(or in the mobile preset of the dev tools), tap the bubble, confirm the
panel covers the full viewport with the slide-up animation; confirm the
host page scroll position is preserved on close. Can be tested with no
backend running because mobile layout, animation, and scroll-restore are
all client-only.

**Acceptance Scenarios**:

1. **Given** a viewport width < 768px and the chat bubble visible,
   **When** the visitor taps the bubble,
   **Then** the chatbot panel covers 100% of the viewport (top, bottom,
   left, right edges all flush) with no part of the host page visible
   behind it, and the panel has entered with a slide-up animation from
   the bottom.
2. **Given** the chatbot is open in mobile full-viewport mode,
   **When** the visitor taps the close affordance in the chatbot header,
   **Then** the panel slides down out of view and the host page is
   restored at the same scroll offset and with the same content as
   before the panel was opened.
3. **Given** the chatbot is open in mobile full-viewport mode and the
   visitor focuses the message input,
   **When** the on-screen keyboard appears,
   **Then** the input remains visible above the keyboard and the
   conversation area shrinks to fit the remaining visible space (no
   content is permanently hidden underneath the keyboard).
4. **Given** a visitor with `prefers-reduced-motion: reduce` set,
   **When** they open the chatbot on mobile,
   **Then** the panel appears in place without the slide-up animation
   (reduced-motion is honored end-to-end).

---

### User Story 2 - Larger, glass-styled desktop chatbot (Priority: P1)

A visitor on a desktop browser opens the chatbot and is presented with a
larger, more inviting panel: **480px wide × 760px tall**, floating in the
bottom-right corner with comfortable edge padding from the viewport
corner. The panel uses **glassmorphism** — a frosted, translucent
background that subtly reveals the host page through it — sits on a soft
shadow, has rounded corners, and has a thin contrasting border. Inside,
the layout is **minimal and card-based**: messages appear as floating
cards (assistant cards distinct from visitor cards), the input is a single
floating card pinned to the bottom, and there are no decorative chrome,
side panels, or extra UI surfaces — just messages and input. The overall
feel is warm but serious — the typography, spacing, and palette evoke a
considered legal-tech tool, not a toy.

**Why this priority**: This is the second half of the user's explicit
request. A larger panel reduces line-wrapping and makes the chatbot feel
substantial; the glass + minimal aesthetic is what differentiates it from
generic support widgets. Independently shippable from US1 because desktop
breakpoint code paths are separate from mobile code paths.

**Independent Test**: Open the LexBot Playground on a viewport ≥ 1024px,
open the chatbot, confirm the panel measures 480×760 (within ±2px),
floats with edge padding from the bottom-right corner, has a translucent
frosted background through which the page is faintly visible, has
rounded corners and a soft shadow, and presents messages and input as
the only UI surfaces.

**Acceptance Scenarios**:

1. **Given** a viewport width ≥ 1024px and the chat bubble visible,
   **When** the visitor clicks the bubble,
   **Then** the chatbot panel appears at 480px × 760px in the
   bottom-right of the viewport, with edge padding (gap between panel
   and viewport edge) on the right and bottom.
2. **Given** the chatbot is open on desktop,
   **When** the visitor inspects the panel,
   **Then** the panel background is translucent with a backdrop blur
   such that page content behind it is visibly but softly present, and
   the panel has a rounded corner radius and a soft drop shadow.
3. **Given** the chatbot is open on desktop,
   **When** the visitor scrolls the conversation,
   **Then** the input stays pinned to the bottom of the panel as a
   floating card, and the message list scrolls independently above it.
4. **Given** a viewport between 768px and 1023px (tablet range),
   **When** the visitor opens the chatbot,
   **Then** the panel uses a tablet-appropriate sizing that is larger
   than mobile but not the full desktop 480×760 (assumption documented
   below).
5. **Given** a visitor with a viewport shorter than 760px + edge padding
   on desktop,
   **When** they open the chatbot,
   **Then** the panel height shrinks to fit available vertical space
   without overflowing the viewport.

---

### User Story 3 - LexBot Playground rebrand of the test site (Priority: P2)

A developer or stakeholder running the widget package locally (or
visiting the hosted demo) lands on a page that is clearly **"LexBot
Playground"** — the page identifies itself as a demo / sandbox for the
LexBot product, not as a fictional law firm. The page carries a LexBot
brand mark in the header, an explanatory hero ("Try the LexBot widget
on a sample legal-services page"), a clearly demarcated demo area that
still simulates a believable law-firm site so the chatbot has
realistic context to talk about, and a footer that identifies it as a
LexBot product surface (not "© Smith & Associates"). The chatbot
widget continues to render in the corner exactly as in production
embeds. The overall vibe is warm + serious, matching the redesigned
chatbot.

**Why this priority**: P2 because the chatbot redesign (US1+US2) is the
visible product change; the playground rebrand is the *framing* around
that change. Shippable independently — rebranding the test page does
not require any chatbot changes — but lower priority because internal
demos work fine with the current "Smith & Associates" stand-in. The
user explicitly asked for it, so it must be in scope; deferring it
would mean shipping a redesigned widget on a page that still says
"Smith & Associates," which would feel inconsistent.

**Independent Test**: Open the test page (`pnpm --filter widget dev`),
confirm the page title, header, hero, and footer use "LexBot
Playground" / LexBot brand language; confirm the page still includes
demo law-firm content (practice areas, contact CTA) so the chatbot
has something to talk about; confirm the chatbot bubble still appears
in the corner.

**Acceptance Scenarios**:

1. **Given** the LexBot Playground page is loaded,
   **When** the visitor reads the header and hero,
   **Then** the brand identifier shown is "LexBot Playground" (or
   equivalent LexBot product wording) and there is no reference to
   "Smith & Associates" in the page title, header, hero, or footer.
2. **Given** the LexBot Playground page is loaded,
   **When** the visitor reviews the page body,
   **Then** the page contains a clearly-labeled demo / sample legal-
   services area (with practice-area cards and a contact CTA) so the
   chatbot has realistic content to refer to during conversation,
   labeled as demo / example content rather than a real firm.
3. **Given** the LexBot Playground page is loaded,
   **When** the visitor inspects the chatbot,
   **Then** the chatbot bubble and panel render as specified in US1
   and US2, with the redesigned look-and-feel.
4. **Given** the page is loaded on any viewport size from 320px to
   1920px wide,
   **When** the visitor scrolls the page,
   **Then** the playground branding (header / footer) and demo content
   remain readable and visually coherent at every breakpoint.

---

### User Story 4 - Conversation surface preserves all functional widget behavior (Priority: P1)

A visitor uses the redesigned chatbot end-to-end: opens it, sees a
greeting, sends a question, gets a streaming response, sees a typing
indicator with the existing preflight phrase, sees quick-reply chips
when offered, sees SOP step chips when offered, sees the contact form
when offered, and submits a lead. Every existing widget behavior
(streaming, preflight phrasing, SOP state, chips, quick replies,
contact form submission, progress bar, session resumption from
`sessionStorage`) works identically to before the redesign — only the
visual layer changes.

**Why this priority**: P1 because a redesign that breaks the widget's
functional behavior is a regression, regardless of how good it looks.
This story is what protects every behavior shipped in specs 001–016.

**Independent Test**: Run the existing widget unit/integration test
suite against the redesigned components; all tests pass without
changes to behavior expectations. Manually walk through a full
conversation including a contact-form lead submission and confirm
streaming, chips, quick replies, SOP chips, and form submission all
behave as they did before the redesign.

**Acceptance Scenarios**:

1. **Given** a visitor opens the redesigned chatbot,
   **When** they send a message,
   **Then** the assistant response streams token-by-token into the
   panel exactly as before (no regression in streaming behavior).
2. **Given** an SOP is configured with quick-reply chips for the
   current step,
   **When** the visitor reaches that step,
   **Then** chips render in the redesigned panel and clicking a chip
   advances the conversation identically to pre-redesign behavior.
3. **Given** the SOP advances to a contact-collection step,
   **When** the contact form is shown,
   **Then** the form layout fits within the new panel dimensions on
   mobile, tablet, and desktop, and submitting it produces the same
   `captureLead` API result as before.
4. **Given** a visitor closes the chatbot mid-conversation and
   re-opens it within the same browser tab,
   **When** the panel re-opens,
   **Then** the conversation history is preserved (sessionStorage
   continues to drive session resumption — no regression).
5. **Given** every existing widget unit and integration test in
   `packages/widget`,
   **When** the redesign is implemented,
   **Then** every test continues to pass without modification of test
   expectations for behavior (only test expectations for inline-style
   strings or class names may change to match the new visual layer).

---

### Edge Cases

- **Tiny viewports (< 320px wide)**: rare in 2026 but still possible
  (small wearables / odd embedded contexts). The mobile full-viewport
  layout must remain usable: input visible, send button reachable, no
  horizontal scroll.
- **Very tall viewports (> 1080px)**: the desktop panel is fixed at
  760px tall; it must remain bottom-anchored with edge padding rather
  than stretching to fill or floating in the middle.
- **Very wide viewports (≥ 2560px ultra-wide)**: the panel stays at
  480px wide and edge-padded; it must not scale up or move toward
  the center.
- **Backdrop-filter unsupported** (older browsers): the glass effect
  must degrade gracefully to a solid (or near-solid) panel background
  with the same shadow and corner radius — content must remain
  readable and the brand feel preserved.
- **Host page with `position: fixed` overlays** (cookie banners,
  newsletter modals): when the chatbot opens in mobile full-viewport
  mode, it must layer above all host-page fixed elements so nothing
  pokes through.
- **Host page with custom scroll-locking** (e.g., `overflow: hidden`
  on body): opening the chatbot on mobile must not permanently break
  the host page's scroll state on close.
- **High-contrast / forced-colors mode**: the chatbot must remain
  readable; glass effects may be replaced by solid surfaces with
  system-defined colors.
- **Low-end mobile devices** (slow GPUs, no compositor acceleration):
  the slide-up animation and backdrop blur must not produce visible
  jank > 100ms on devices representative of mid-tier Android (2024
  baseline). Implementations exceeding this budget should fall back
  to a simpler entry (fade) or solid panel.
- **Long bot replies (multi-paragraph) on small viewports**: the
  message card must wrap, the conversation must remain scrollable,
  and the input must stay anchored.
- **Quick-reply chips that overflow horizontally** in the redesigned
  layout: chips must wrap to a new line within the floating card
  rather than introducing horizontal scroll.

## Requirements *(mandatory)*

### Functional Requirements

#### Chatbot panel — sizing & layout

- **FR-001**: On viewports `< 768px` wide, the chatbot panel MUST
  occupy the full viewport (top, bottom, left, right edges flush;
  no rounded corners; no margin gap from any edge).
- **FR-002**: On viewports `≥ 1024px` wide, the chatbot panel MUST
  render at exactly 480px wide × 760px tall (within ±2px), pinned
  to the bottom-right of the viewport with edge padding (an
  intentional gap, not flush) on the right and bottom.
- **FR-003**: On viewports between 768px and 1023px (tablet), the
  chatbot panel MUST render at a tablet-appropriate size that is
  visibly larger than mobile but does not need to match the desktop
  480×760 footprint exactly. The exact tablet sizing is recorded in
  Assumptions.
- **FR-004**: On viewports where the available vertical space is less
  than 760px plus desktop edge padding, the panel height MUST shrink
  to fit the viewport without overflowing or being clipped.
- **FR-005**: On mobile, when the visitor opens the chatbot, the
  panel MUST enter with a slide-up animation from the bottom of the
  viewport. The animation duration MUST be perceptibly under 400ms
  end-to-end.
- **FR-006**: On mobile, when the visitor closes the chatbot, the
  panel MUST exit with a slide-down animation back to its origin
  point.
- **FR-007**: When the user agent reports `prefers-reduced-motion:
  reduce`, both the slide-up and slide-down animations MUST be
  replaced with an instant appearance / disappearance.
- **FR-008**: On mobile, closing the chatbot MUST restore the host
  page to the same scroll position and content state it had before
  the chatbot was opened.
- **FR-009**: On mobile, when the on-screen keyboard appears while
  the input is focused, the input MUST remain visible above the
  keyboard, and the conversation area MUST shrink rather than the
  input being pushed off-screen.

#### Chatbot panel — visual language (glassmorphism + minimalism)

- **FR-010**: The desktop chatbot panel MUST use a glassmorphism
  treatment: a translucent background combined with a backdrop blur
  such that page content behind the panel is faintly but visibly
  present.
- **FR-011**: The chatbot panel MUST have rounded corners on every
  breakpoint where it is not flush with viewport edges (i.e.,
  desktop and tablet — mobile full-viewport has square corners).
- **FR-012**: The chatbot panel MUST cast a soft drop shadow on
  every breakpoint where it floats (desktop and tablet).
- **FR-013**: When `backdrop-filter` is unsupported by the user
  agent, the panel MUST fall back to a near-solid background with
  the same shadow and corner radius. Functionality MUST be
  unaffected by the fallback.
- **FR-014**: The chatbot panel MUST render only two interactive
  surface kinds inside the panel body: message cards (one per
  assistant or user message) and a single input card pinned to the
  bottom. No sidebar, secondary panel, branded chrome strip, or
  decorative panel beyond the header bar is permitted.
- **FR-015**: Assistant message cards and user message cards MUST be
  visually distinguishable from each other (e.g., different
  alignment and/or surface treatment) without relying on color
  alone (accessibility: works in greyscale and high-contrast).
- **FR-016**: The input MUST be presented as a floating card pinned
  to the bottom of the panel; it MUST remain visible at all times
  when the panel is open.
- **FR-017**: The chatbot header MUST contain a brand mark
  identifying the chatbot (configurable from `widgetConfig` —
  defaulting to "LexBot" when no firm-specific name is configured)
  and a close affordance.

#### Brand feel & typography

- **FR-018**: The chatbot's typography, color palette, and spacing
  MUST evoke a "warm + serious" tone — comparable in feel to
  Anthropic.com's typographic restraint and palette warmth — rather
  than a generic SaaS support-widget style.
- **FR-019**: Color contrast for body text against panel surfaces
  MUST meet WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large
  text), measured against the effective surface color including
  glass translucency.
- **FR-020**: The persistent disclaimer required by Constitution
  Principle VI ("I am an AI assistant, not a lawyer. Nothing I say
  constitutes legal advice.") MUST remain visible somewhere in the
  panel layout (e.g., below input or in header subtitle); the
  redesign MUST NOT remove it.

#### Behavior preservation (no regressions)

- **FR-021**: All existing chatbot widget behaviors MUST continue
  to function unchanged: streaming responses via the AI SDK
  `useChat` hook, preflight typing-indicator phrases, SOP state
  progression, quick-reply chips, SOP step chips, contact-form
  submission, progress bar, session persistence in
  `sessionStorage`, multi-turn session resumption via the
  `x-session-id` header.
- **FR-022**: The widget MUST continue to call `/api/chat` and
  `/api/config` with the same request and response shapes; no
  backend, schema, or API contract change is permitted in this
  feature.
- **FR-023**: The bundle-size budgets defined in Constitution
  Principle IV (NPM widget ≤ 35KB gz, CDN bundle ≤ 50KB gz) MUST
  continue to hold after the redesign.
- **FR-024**: Existing widget unit and integration tests in
  `packages/widget` MUST continue to pass; behavior-level
  expectations MUST NOT be relaxed. Tests that asserted exact
  inline-style strings or pixel values may be updated to match
  the new visual layer, but the test's intent MUST be preserved.

#### LexBot Playground (test site rebrand)

- **FR-025**: The widget package's local test page (the page
  rendered by `pnpm --filter widget dev`) MUST be rebranded as
  "LexBot Playground". The HTML `<title>`, the page header, the
  hero, and the footer MUST identify the page as a LexBot product
  surface.
- **FR-026**: The page MUST NOT contain any "Smith & Associates"
  branding in title, header, hero, footer, or call-to-action copy.
- **FR-027**: The page MUST retain demo law-firm content
  (practice-area cards, contact CTA, sample copy) so the chatbot
  has realistic content to refer to during conversations. Such
  content MUST be clearly framed as demo / sample content (e.g.,
  via a banner, label, or hero copy) rather than presented as a
  real firm.
- **FR-028**: The Playground page's typography, palette, and
  spacing MUST be coherent with the redesigned chatbot's brand
  feel (warm + serious), so the page and the widget read as a
  single product.
- **FR-029**: The Playground page MUST remain readable and
  visually coherent at viewport widths from 320px to 1920px,
  matching the same breakpoints the widget uses.
- **FR-030**: The chatbot widget MUST continue to render on the
  Playground page exactly as it would on a customer's embedded
  site (no Playground-only override of widget behavior).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor on a mobile viewport (≤ 767px)
  can open the chatbot, see the panel cover the full viewport, send
  a question, receive a streaming reply, and close the chatbot
  back to the host page in under 30 seconds with no horizontal
  scroll, no clipped content, and no host-page scroll loss.
- **SC-002**: A visitor on a desktop viewport (≥ 1024px) sees the
  chatbot panel render at the configured 480×760 dimensions in
  100% of opens (measured by manual visual check on Chrome,
  Safari, and Firefox at 1280×800 and 1920×1080).
- **SC-003**: 100% of existing widget unit and integration tests
  continue to pass after the redesign without relaxing
  behavior-level expectations.
- **SC-004**: The widget's gzipped bundle size remains within
  Constitution-mandated budgets: NPM ≤ 35KB gz, CDN ≤ 50KB gz,
  measured by the existing CI bundle-size check.
- **SC-005**: The slide-up open animation on mobile completes in
  under 400ms on a representative mid-tier 2024 Android device
  with no visible jank (defined as no frame longer than 100ms
  during the animation).
- **SC-006**: The redesigned chatbot meets WCAG 2.1 AA color
  contrast for body text against its effective panel surface,
  verified by an automated accessibility audit (e.g., axe-core)
  with zero contrast violations on the message body, input
  placeholder, and disclaimer text.
- **SC-007**: A reviewer reading the LexBot Playground page can
  determine within 5 seconds, without scrolling, that the page is
  a LexBot product demo (not a real law firm), based on header
  and hero copy alone.
- **SC-008**: An internal stakeholder shown the redesigned widget
  side-by-side with the previous design rates the new design
  "warm + serious" rather than "generic SaaS" in qualitative
  feedback (sample of ≥ 3 reviewers, majority agreement).
- **SC-009**: Across a manual end-to-end conversation that
  includes streaming, an SOP transition, quick-reply chips, an
  SOP step chip, and a contact-form lead submission, every
  interaction succeeds on the redesigned chatbot exactly as it
  did on the prior design (zero functional regressions).

## Assumptions

- **Scope is widget-package-local**: this feature touches only the
  `packages/widget` source tree and its local dev test page. No API
  routes, no Drizzle schemas, no dashboard pages, no shared types,
  no agent prompts, no SOP behavior, and no lead-classification
  changes are in scope.
- **Inspiration source is unavailable to the implementer at design
  time**: the user-supplied `chatbot-redesign-inspiration.png` lives
  at the repo root but the present session cannot read images. The
  design direction is therefore taken from the user's textual
  summary: card-based with floating elements; glassmorphism /
  frosted panels; minimal "messages and input" UI; warm + serious
  brand feel (Anthropic-like); mobile full-viewport with slide-up;
  desktop 480×760 floating with edge padding.
- **Tablet sizing default**: at viewports 768px–1023px, the panel
  defaults to a right-anchored sheet roughly 420px wide × full
  viewport height with a small left-edge shadow (this preserves
  today's tablet behavior while widening it). The plan phase may
  refine this value; the spec only requires "larger than mobile,
  not necessarily 480×760."
- **Desktop edge padding default**: 24px from the right viewport
  edge and 24px from the bottom viewport edge (matching the
  current bubble inset). The plan phase may tune this; the spec
  only requires "edge padding, not flush."
- **Brand mark / wordmark assets**: a "LexBot" wordmark suitable
  for both the Playground header and the chatbot panel header is
  produced as part of the implementation (text-based mark is
  acceptable; no separate asset commission required for MVP).
- **Color palette**: the redesign introduces a new widget palette
  in `packages/widget` that defaults to a warm-neutral background
  family (off-white / soft beige) with a deep indigo / charcoal
  accent. Existing CSS-custom-property override hooks
  (`--lc-primary-color`, `--lc-background`, `--lc-primary-text`,
  `--lc-border-radius`, `--lc-font-family`) MUST continue to be
  respected so embedding firms can override the palette to match
  their site.
- **Animation library**: animations are implemented with CSS
  transitions / keyframes and no new runtime dependency. This
  protects the bundle-size budget (FR-023 / SC-004).
- **Glass effect**: implemented via `backdrop-filter: blur(...)`
  with `background-color: rgba(...)`. The fallback (no
  backdrop-filter) uses a near-opaque solid surface.
- **Test-site label disclosure**: the Playground page identifies
  itself as a demo / playground in visible header copy; this
  makes FR-027's "framed as demo content" trivially true at the
  page level.
- **Accessibility scope**: this redesign maintains existing
  accessibility (keyboard reachability, ARIA roles, screen-reader
  labels) and adds reduced-motion handling (FR-007) and contrast
  guarantees (FR-019). It is not a comprehensive a11y overhaul.
- **Reduced motion**: the existing `useReducedMotion` hook in
  `packages/widget/src/hooks/useReducedMotion.ts` is reused for
  FR-007; no new motion-preference plumbing is introduced.

## Out of Scope

- Any backend (`packages/api`), dashboard (`packages/dashboard`),
  crawler, or shared-package change.
- Any change to chat agent behavior, system prompts, tool calls,
  SOP step semantics, lead classification, or guardrails.
- New widget features (e.g., voice input, file upload, message
  reactions, conversation export). Only existing features are
  re-skinned.
- A net-new design system or theme abstraction beyond what is
  needed to express this redesign. (A future spec may extract a
  reusable design-token layer.)
- A real customer-facing marketing site for LexBot. The
  Playground is a developer/stakeholder demo page, not a public
  marketing surface.
- Embedding-customer (firm) overrides beyond the existing CSS
  custom properties already supported by the widget.
- Any change to the bundle-output configuration (build targets,
  CDN delivery, package exports).
