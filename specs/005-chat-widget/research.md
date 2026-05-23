# Phase 0 Research: Chat Widget

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document resolves Technical Context decisions for the Chat
Widget against `product-spec-legal-chatbot.md` (§6.1–§6.13, §11.4,
§11.5, §12.9) and the Lex Bot Constitution v1.0.0.

There were no `NEEDS CLARIFICATION` markers; items below are the
gap-fill plan for R1–R12.

## R1. NPM Library Build

**Decision**: Configure `vite.config.ts` for library mode using
Vite's `build.lib` option. Output an ES module bundle at
`dist/index.js` with TypeScript declarations at `dist/index.d.ts`.
Replace `src/index.ts` to export `LegalChatbot`,
`LegalChatbotProps`, and the `LegalChatbotRef` type. Update
`packages/widget/package.json`:

```jsonc
{
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

`@ai-sdk/react` becomes a peer dependency too (it depends on
React).

**Rationale**:
- §6.2 NPM Package binds `npm install @legal-chatbot/widget` and
  `import { LegalChatbot } from '@legal-chatbot/widget'`. FR-001.
- React as a peer dep avoids bundling React into the widget
  artifact; the host app's React is reused.
- Vite library mode is the standard for shipping React component
  libraries; produces ESM with `vite-plugin-dts` for declarations.
- Bundle-size budget (≤ 35 KB gz) is achievable when React isn't
  bundled; including React would push this over 100 KB.

**Alternatives considered**:
- Rollup directly: rejected. Vite already orchestrates the dev
  server and library mode wraps Rollup with sensible defaults.
- tsup: rejected. The widget needs JSX/TSX compilation that
  Vite handles natively.

**Implementation notes**:
- Add `vite-plugin-dts` for `.d.ts` emission.
- `external` includes: `react`, `react-dom`, `react/jsx-runtime`,
  `@ai-sdk/react`. Everything else (`@legal-chatbot/shared`)
  is bundled.
- Include sourcemaps for debugging (`build.sourcemap: true`).

## R2. CDN Bundle with Preact

**Decision**: Add a second Vite config (`vite.config.cdn.ts`)
that builds a self-contained UMD bundle using Preact and
`@preact/compat` as the React-API shim. The bundle includes ALL
runtime dependencies (Preact, the widget code, the shared types,
@ai-sdk/react's runtime — possibly via a Preact-compatible
fallback). Output: `dist/cdn/legal-chatbot.js` (single file).

A new `src/cdn-entry.tsx` mounts the widget automatically:

1. Find the `<script>` tag with `data-api-key`.
2. Read `data-api-key`, `data-api-url`, `data-position`.
3. Create a host `<div>` after the script (or at body end).
4. Render `<LegalChatbot apiKey="…" />` into it.
5. Dispatch a `legalchatbot:ready` DOM event so host pages can
   detect readiness.

**Rationale**:
- §6.2 CDN binding: `<script src="…/legal-chatbot.js"
  data-api-key="…">` MUST work standalone on static pages. FR-002,
  FR-004.
- §6.2 explicitly: "The CDN version bundles Preact internally to
  avoid requiring React as a host dependency." FR-003.
- Preact + `@preact/compat` is the standard pattern for shipping
  React-written components without React; `@preact/compat`
  re-exports Preact under the React names.
- Bundle-size budget ≤ 50 KB gz is achievable with Preact (3 KB
  gz) versus React (45+ KB gz).

**Alternatives considered**:
- Bundle full React in the CDN: rejected. Would exceed 50 KB
  budget.
- ESM-only CDN (no UMD): rejected. Many static-site CMSes still
  inject scripts as classic IIFE/UMD; UMD is the safer interop
  default for the CDN channel.
- Web Component (`customElements.define('legal-chatbot', …)`):
  intriguing but post-MVP; the spec binds the script-tag-with-
  data-attribute pattern.

**Implementation notes**:
- Vite config aliases `react`, `react-dom`, `react/jsx-runtime`
  to `preact/compat`.
- The `@ai-sdk/react`'s `useChat` is React-tied but
  `@preact/compat` shims React's hooks API; it should work
  unchanged. If incompatibility arises, fall back to a thin
  hand-rolled streaming hook (out of scope to predict — verify
  during implementation).
- The CDN entry script's auto-mount honors `defer` / `async` —
  it runs `DOMContentLoaded` before mounting, with idempotency
  if the script is loaded twice.
- The Constitution Required Stack lists Preact under "Frontend
  framework: React (NPM widget, Dashboard); Preact (CDN widget
  bundle)" — already aligned.

## R3. Analytics Props & DOM Events

**Decision**: Extend `<LegalChatbot>` props with the five callbacks
from §6.13:

```ts
interface LegalChatbotProps {
  apiKey: string;
  apiUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  theme?: Partial<LegalChatbotTheme>;
  onChatOpen?: () => void;
  onChatClosed?: () => void;
  onMessageSent?: (message: { role: 'user'; content: string }) => void;
  onLeadSubmitted?: (lead: { classification: string; leadId: string }) => void;
  onEscalationTriggered?: () => void;
}
```

Add a `useAnalyticsEvents` hook that dispatches both:

1. The prop callback (if provided).
2. A `CustomEvent` on `document` named
   `legalchatbot:open` / `:closed` / `:message` / `:lead` /
   `:escalation` with the same payload as `event.detail`.

The CDN entry script doesn't pass props — it relies on DOM events
exclusively (the lawyer adds `document.addEventListener('legalchatbot:open', …)`).
The React API offers both patterns simultaneously per §6.13.

**Rationale**:
- §6.13 binds both shapes (React props and CDN DOM events).
  FR-047, FR-048, FR-049.
- A single internal pipeline avoids drift between the two
  surfaces.
- DOM events also work in the React channel (the host page's
  analytics integration may prefer DOM events for symmetry with
  other widgets).

**Alternatives considered**:
- React Context provider for events: rejected. No use case for
  in-tree consumers; DOM events + props cover all surfaces.
- A pub-sub library: rejected. CustomEvent + DOM is sufficient.

**Implementation notes**:
- The hook's emit function takes an event name and payload;
  internally it calls the matching prop callback (if defined)
  and dispatches a `CustomEvent` on `document`.
- Detection of "lead submitted" comes from the `useChat`'s tool
  invocation results stream — when a `captureLead` tool returns
  a successful result, emit `:lead`.
- Detection of "escalation triggered" comes from a marker in the
  agent's response (Phase 3 may include an explicit signal in
  the stream; until then, regex-match on the configured
  escalation phrase — captured in Assumptions on the spec).

## R4. Persistent Legal Disclaimer

**Decision**: Add `<DisclaimerFooter>` component inside the chat
panel, anchored to the bottom of the messages area (above the
input). It renders the §11.4 text:

> *"I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice."*

with subtle styling (small font, muted color). The disclaimer is
**not removable** by configuration (FR-024 cross-reference; the
guardrails form's Custom Instructions cannot suppress it).

**Rationale**:
- §11.4 binds the persistent visible disclaimer. FR-050.
- Constitution V (Privacy/Privilege) reinforces non-removability.
- Anchoring above the input keeps it always visible during a
  conversation.

**Alternatives considered**:
- Show only on first turn: rejected. "Persistent" per §11.4.
- Tooltip on the chatbot name: rejected. Hidden affordances
  fail accessibility expectations.

**Implementation notes**:
- Subtle styling (12px font, `--lc-disclaimer-color` defaulting
  to `#718096`); never display: none.
- A Vitest test asserts the text content is present.

## R5. Consent Banner

**Decision**: Add `<ConsentBanner>` component shown the FIRST
time the chat panel opens for a fresh session. Banner says:

> "Before continuing, please review our [privacy policy]. By chatting,
> you consent to our processing of your name, email, and phone if you
> share them. You can request deletion at any time."

Two buttons: "Continue" (records consent and dismisses banner) and
"Privacy policy" (link configured by the lawyer in §4.3 Section F
extension or §11.5 template).

Consent state persists in `sessionStorage` under key
`lc_consent_accepted`. Once accepted, the banner does not appear
again for that session. On consent acceptance, the widget POSTs
to a yet-to-be-defined `/api/consent` endpoint (owned by
`008-hardening` per FR-006 of that spec) so the timestamp is
persisted server-side.

**Rationale**:
- §11.5 binds: "Display a consent banner in the widget before
  collecting any personal data." FR-051.
- §11.5 also binds the privacy policy link: "Draft a privacy
  policy template that lawyers can customize and link from the
  widget." FR-052.
- `sessionStorage` keeps banner dismissal scoped to the same tab
  (consistent with §6.8 session model — closing the tab resets
  consent prompt).
- Server-side persistence is `008-hardening`'s responsibility;
  the widget submits.

**Alternatives considered**:
- Inline-in-greeting consent: rejected. §11.5 says "banner."
- Block all interaction until consent: rejected (overly
  aggressive); allow viewing the panel but disable input until
  consent is given (matches typical CCPA-style banners).

**Implementation notes**:
- Banner is rendered above the message list when consent is
  unrecorded.
- "Continue" button focuses the input after dismissal.
- Banner respects `prefers-reduced-motion` (no slide-in).
- Privacy policy link comes from `widgetConfig.privacy_policy_url`
  (extends `/api/config` shape — coordinated with Phase 6
  dashboard's privacy template surface).

## R6. Accessibility (WCAG 2.1 AA)

**Decision**: Add three hooks plus targeted component edits:

- `useFocusTrap(ref, isActive)`: traps Tab/Shift+Tab inside the
  panel when open; restores focus on close. Cycles through
  focusable elements using a documented selector.
- `useReducedMotion()`: returns `true` when
  `prefers-reduced-motion: reduce`; consumed by the typing
  indicator and panel slide-in animation.
- ARIA: panel has `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby` pointing at the chatbot-name title. Each
  message has `role="log"` on the messages container with
  `aria-live="polite"` so screen readers announce new messages.
- `prefers-contrast: more` triggers a high-contrast palette
  swap (CSS custom property fallbacks).
- Touch targets: enforce minimum 44×44 px on bubble, send,
  close, minimize, and quick-reply chips via min-width/min-height
  CSS.

**Rationale**:
- §6.9 binds all six items: keyboard nav, ARIA labels, screen
  reader announcements, focus trap, high-contrast mode,
  reduced-motion, 44×44 px touch targets. FR-027 to FR-033.
- WCAG 2.1 AA is not negotiable for legal-domain software where
  end users include people with disabilities seeking legal help.

**Alternatives considered**:
- Use a community focus-trap library
  (`focus-trap-react`): rejected. Adds a dep; the logic is ~30
  LOC — implement directly.

**Implementation notes**:
- Escape key listener at the panel level closes the chat
  (matches §6.9 "Tab, Enter, Escape to close").
- A Vitest + Testing Library test validates focus trap behavior
  (Tab/Shift+Tab cycling, focus restoration on close).
- Manual verification via Chrome DevTools' accessibility tree
  is captured in `quickstart.md`.

## R7. Offline & Error Handling

**Decision**: Add `useNetworkStatus()` hook listening to
`navigator.onLine` + `online`/`offline` events. The chat panel
renders state-conditional UI:

| State | UI |
|---|---|
| Online + idle/streaming | Normal |
| Offline (transient) | `<ReconnectingIndicator>` shown above input; sent messages queued locally (in-memory) |
| Online again | Queued messages flushed sequentially; indicator dismissed |
| API unreachable >10 s | Replace error UI with: "I'm having trouble connecting. Please try again in a moment or call us at [phone]." (phone from `widgetConfig`) |
| API returns 4xx/5xx (non-429) | Generic error: "Something went wrong. Please try again or call us at [phone]." |
| API returns 429 | "Please wait a moment before sending another message." |

The 10-second timer uses `setTimeout` from the start of a fetch;
if `fetch` resolves before the timer fires, clear it.

**Rationale**:
- §6.12 binds all five rows of the error/offline matrix.
  FR-042 to FR-046.
- A network-aware hook is the standard React pattern.
- The 10-second threshold matches §6.12 row 3 verbatim.

**Alternatives considered**:
- Service worker for offline queueing: rejected. The widget
  must work on any host page without registering a service
  worker (host pages may have their own).
- Block input when offline: rejected. §6.12 says "queues
  outbound messages."

**Implementation notes**:
- The `useChat` hook does not expose a "queue while offline"
  primitive; implement an in-memory queue at the form-submit
  handler that calls `useChat`'s `append` once `online` returns
  true.
- The `<ReconnectingIndicator>` is small text + animated
  triple-dot (respects `prefers-reduced-motion`).
- Phone substitution comes from `widgetConfig.phone` (already
  fetched from `/api/config`).

## R8. Bundle-Size Budget Enforcement

**Decision**: Add a CI step that runs after `pnpm build` for the
widget package and checks both bundles' gzipped sizes against the
budget. Use `size-limit` with config:

```jsonc
[
  { "name": "NPM bundle", "path": "packages/widget/dist/index.js", "limit": "35 KB" },
  { "name": "CDN bundle", "path": "packages/widget/dist/cdn/legal-chatbot.js", "limit": "50 KB" }
]
```

Add `pnpm --filter @legal-chatbot/widget size` script invoking
`size-limit`. Add the script to the GitHub Actions CI workflow
(`001-foundation` FR-037 stage 5 or 6) AFTER the build stage so
it runs on every PR. Failure blocks merge.

**Rationale**:
- §6.10 binding: NPM ≤ 35 KB gz; CDN ≤ 50 KB gz. FR-034, FR-035.
- Constitution Architectural Limits + CI Gates (stage 6 in the
  Constitution's CI table is "Bundle-size check on
  `packages/widget` outputs").
- Without enforcement, an innocent dep added in a feature PR
  silently breaks the §6.10 binding.

**Alternatives considered**:
- `bundlewatch` instead of `size-limit`: equivalent; spec is
  silent.
- Manual measurement at release time: rejected. Drift sneaks in
  between releases.

**Implementation notes**:
- `size-limit` measures gzipped size by default — matches the
  spec's "gzipped" requirement.
- The Foundation's CI workflow plan (`001-foundation` plan.md)
  already deferred this stage to Phase 4; Phase 4 owns the
  implementation.
- A baseline run after first successful build establishes the
  starting point; subsequent regressions are measured against
  budgets, not history.

## R9. CSS Scoping (Shadow DOM)

**Decision**: Render the chat panel inside a Shadow DOM root.
The bubble trigger remains in the light DOM (it must be a
"button" anchored to the viewport, and its styling is tiny). The
panel and all its children attach to a shadow root via React's
`createPortal` to a host element with `attachShadow({ mode: 'open' })`.

Inline styles applied via the `style={{...}}` prop are scoped
naturally by Shadow DOM; the global `.lc-typing` keyframe
animation moves into a `<style>` tag injected once into the
shadow root. CSS custom properties (the theming surface) cross
the Shadow DOM boundary so host-page overrides still work.

**Rationale**:
- §6.10 binds: "No external CSS files — styles are scoped and
  bundled inline (shadow DOM or CSS modules)." FR-036.
- Shadow DOM is the strongest scoping mechanism — host page
  styles cannot bleed into the widget; widget styles cannot
  bleed out.
- CSS custom properties traverse Shadow DOM boundaries, so the
  §6.7 theming contract still works.

**Alternatives considered**:
- CSS Modules: viable but requires a bundler config change and
  doesn't fully isolate (host page can still target widget
  classes by selector). Shadow DOM gives stronger isolation.
- Global `:where(.lc-...)` low-specificity selectors: rejected
  for the same reason.

**Implementation notes**:
- The bubble is one button; its inline styles are sufficient.
- The panel's shadow root contains a single `<style>` element
  injected at mount with the keyframe definitions and
  any non-inline CSS (e.g., focus-visible outline tweaks).
- `@ai-sdk/react`'s `useChat` works inside Shadow DOM (it's a
  React hook, not DOM-position-dependent).
- A Vitest test verifies the shadow root mount.

## R10. Auto-Growing Multi-Line Input

**Decision**: Replace the current single-line `<input>` with an
`<AutoGrowTextarea>` component that:

1. Renders a `<textarea>` whose `rows` defaults to 1.
2. On change, measures content and adjusts `rows` up to a max
   of 5 (after which scroll appears within the textarea).
3. Submits on Enter (without Shift) — Shift+Enter inserts a
   newline.

**Rationale**:
- §6.5 binds: "Text input with send button; auto-grows for
  multi-line messages." FR-015.
- Enter-to-send matches §6.9's keyboard-navigation requirement.
- Shift+Enter for newline is the standard chat convention.

**Alternatives considered**:
- A library like `react-textarea-autosize`: rejected per the
  Constitution's no-new-deps rule. The auto-grow logic is ~30
  LOC.

**Implementation notes**:
- Measurement uses a hidden `<textarea>` mirror or
  `scrollHeight`-driven auto-sizing.
- IME composition (CJK input methods): on `compositionstart`,
  do not submit on Enter; on `compositionend`, restore.
- A Vitest test covers single-line-to-multi-line growth + max
  cap.

## R11. Group-Level Relative Timestamps

**Decision**: Add `<MessageGroup>` component that wraps a run of
consecutive messages from the same role (user or assistant) and
shows a single relative timestamp ("2 min ago") below the last
message in the group. The timestamp updates every 30 seconds.

**Rationale**:
- §6.5 binds: "Relative timestamps ('2 min ago') on message
  groups." FR-012.
- Per-message timestamps would clutter; group-level is the
  spec's wording.

**Alternatives considered**:
- Show absolute time on hover: viable extra; not required by
  spec.
- Library like `dayjs` for relative-time formatting: rejected
  per no-new-deps; relative-time logic is ~40 LOC.

**Implementation notes**:
- Pure function `formatRelativeTime(timestamp: number, now: number): string`.
  Granularity: <1 min "just now"; <60 min "X min ago"; <24 h
  "X hr ago"; otherwise full date.
- A 30-second `setInterval` triggers re-render; cleared on
  unmount.

## R12. Component Test Coverage

**Decision**: Add Vitest + `@testing-library/react` config
(`vitest.config.ts` with `jsdom` environment). Write tests for
each component:

- `ChatBubble.test.tsx`: renders, clicking calls onClick.
- `QuickReplies.test.tsx`: renders chips for given options;
  clicking calls onSelect with prefilled text.
- `ChatPanel.test.tsx`: renders header/messages/input;
  Escape closes; focus trap behavior.
- `ChatWidget.test.tsx`: state machine (open/closed); analytics
  callbacks.
- `ConsentBanner.test.tsx`: renders when no consent stored;
  acceptance dismisses + records.
- `DisclaimerFooter.test.tsx`: renders the §11.4 text.
- `AutoGrowTextarea.test.tsx`: rows scale with content.
- `MessageGroup.test.tsx`: relative-time formatting.
- `useFocusTrap.test.ts`: Tab/Shift+Tab cycling; focus restore.
- `useNetworkStatus.test.ts`: online/offline transitions.
- `useAnalyticsEvents.test.ts`: emits both prop callbacks AND
  DOM events.
- `widget-config.test.ts`: Zod validation; fallback on invalid.

**Rationale**:
- Constitution Principle III: tests-before-implementation.
- §9.8 row 4: "Widget tests — Vitest + Testing Library —
  Component rendering, interaction states."
- §12.9 done-when also includes "Visual verification in browser
  (no automated test — UI correctness)" — automated tests don't
  replace the visual check; both are required.

**Alternatives considered**:
- Skip automated tests, rely on §12.9's manual visual
  verification: rejected. Constitution III is binding.

**Implementation notes**:
- `@testing-library/jest-dom` provides matchers; `@testing-library/user-event`
  simulates real keystrokes and clicks.
- Tests run in `jsdom`; Shadow DOM tests need additional
  configuration (`jsdom` supports Shadow DOM since v22).
- The `@ai-sdk/react`'s `useChat` is mocked at test time using
  `vi.mock('@ai-sdk/react')` so tests don't hit a network.

## Constitution Cross-Reference Summary

| Constitution element | Chat Widget decision | Aligned |
|---|---|---|
| I (MVP-First) | All decisions cite §6.x / §11.4 / §11.5 / §12.9 | ✅ |
| II (Type Safety) | Component props typed; widget-config Zod-validated (R5/R8 helper) | ✅ |
| III (TDD layered) | Each new component test-first (R12); existing components retrofitted with tests | ✅ |
| IV (Serverless / Stateless) | Browser-only; no Node-only APIs; only `sessionStorage` (FR-026) | ✅ |
| V (Privilege & Privacy) | Consent banner (R5); no third-party analytics injection; persistent disclaimer (R4); minimal storage surface | ✅ |
| VI (Observable Agent) | Widget surfaces tool/streaming UI states; analytics events feed lawyer's stack (R3) | ✅ |
| VII (Phased Delivery) | Phase 4; consumes Phase 3 streaming + `/api/config`; widget-config schema coordinates with `008-hardening`'s privacy template surface (R5) | ✅ |
| Required Stack | All decisions stay inside the binding stack table (React, Preact, Vercel AI SDK, CSS custom properties, Vitest, Testing Library) | ✅ |
| Architectural Limits | NPM ≤ 35 KB gz, CDN ≤ 50 KB gz enforced in CI (R8) | ✅ |

## Open Questions — None

All decisions resolve cleanly. No `NEEDS CLARIFICATION` markers
remain. Ready to proceed to Phase 1.
