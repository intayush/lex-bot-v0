# Quickstart: Chatbot Redesign + LexBot Playground

How to run the redesigned widget locally, see the visual changes, and
verify the contract is met. Targeted at engineers picking up this work
mid-implementation or reviewing the PR.

## Prerequisites

- Node.js 20+
- `pnpm` (workspace package manager — required)
- A running API for the chatbot to talk to. Either:
  - Local: `pnpm --filter @legal-chatbot/api dev`
  - Or: skip the API and accept that the chatbot will fail to load
    `widgetConfig` and fail to stream — most visual checks still work

## Run the Playground

```sh
pnpm --filter widget dev
```

This boots Vite at the URL printed in the terminal (typically
`http://localhost:5173`). Open the URL in a browser. You should see:

- Page title: "LexBot Playground"
- Top bar with "LexBot" wordmark on the left and a "Playground" pill
  on the right
- Hero: "Try LexBot on a sample legal-services site"
- Demo banner explaining sample content
- Three practice-area cards (Personal Injury, Family Law, Estate
  Planning) styled in the warm palette
- A chat bubble in the bottom-right corner

## Verify the Mobile Takeover (US1)

1. Open Chrome DevTools → Device toolbar (Cmd+Shift+M / Ctrl+Shift+M).
2. Choose the iPhone 13 Pro preset (or any 375×812 viewport).
3. Click the chat bubble.
4. **Expected**:
   - The chatbot panel slides up from the bottom of the screen over
     ~320ms.
   - The panel covers the entire viewport (no host page visible).
   - The host page underneath does not scroll while the panel is
     open.
5. Click the close button in the panel header.
6. **Expected**:
   - The panel slides down out of view.
   - The host page returns to its previous scroll position.
7. Re-open the panel; tap the input; the on-screen keyboard appears
   (use DevTools' "Toggle device toolbar" + "show keyboard" if your
   browser supports it; otherwise verify on a real phone).
8. **Expected**: the input remains visible above the keyboard; the
   conversation area shrinks to fit the remaining space.

### Reduced motion

In your OS, set "Reduce motion" (macOS: System Settings → Accessibility →
Display → Reduce motion; iOS / Android: similar accessibility menu).
Re-open the chatbot. The panel should appear instantly without the
slide-up animation.

## Verify the Desktop Panel (US2)

1. Resize the browser to ≥ 1280px wide and ≥ 800px tall.
2. Click the chat bubble.
3. **Expected**:
   - Panel measures 480px × 760px.
   - Panel sits 24px from the right edge and 24px from the bottom edge.
   - Panel has rounded corners (20px) and a soft drop shadow.
   - Panel background is translucent — content behind it is faintly
     visible (frosted glass).
   - Inside: only messages and a floating input — no sidebar, no
     extra chrome strip, no decorative elements.

To verify the glass effect, scroll the page underneath while the
panel is open. The frosted area should subtly reflect the scrolling
content.

To verify the fallback: in DevTools, force-disable backdrop-filter
(or test in a browser without support — older Safari). The panel
should still look intentional, just less translucent.

## Verify the LexBot Playground Rebrand (US3)

1. View the page source (View → Page Source / Cmd+U).
2. Search for "Smith & Associates". **Expected**: zero matches.
3. Search for "LexBot Playground". **Expected**: matches the title
   and at least one in-page heading.
4. Inspect the page footer. **Expected**: copy reads "© LexBot —
   sample-content demo. The 'firm' shown on this page is fictional."
5. Read the hero. **Expected**: the page is unambiguously framed as
   a demo within 5 seconds of skimming (SC-007).

## Verify No Functional Regressions (US4)

Walk through a complete conversation on the desktop panel:

1. Open the chatbot.
2. Greeting message appears (loaded from `/api/config`).
3. Type a question relevant to one of the practice areas (e.g.,
   "I was in a car accident, can you help?").
4. **Expected**: a typing indicator with a preflight phrase appears
   (e.g., "✨ Looking into your accident matter…"), then the
   assistant streams a response token-by-token.
5. If the SOP is configured: chips appear under the input. Click a
   chip.
6. **Expected**: the chip click submits a message; the conversation
   continues.
7. Eventually reach the contact-collection step.
8. **Expected**: the contact form appears in place of the input.
9. Submit the form.
10. **Expected**: the form returns success; the conversation
    completes.

If any step fails, the redesign has a regression — fix before
merging.

## Run the Tests

```sh
# Unit + integration tests for the widget package
pnpm --filter widget test

# All Vitest tests across packages (gate for merge)
pnpm test

# Headless Playwright smoke (chromium, no UI). The repo's "smoke"
# script aliases the api package's `e2e` (Playwright headless).
pnpm smoke

# Headed Playwright walkthrough (slow-mo, single window) — the
# eyes-on visual verification mode.
pnpm smoke:walk

# Full regression: Vitest across all packages, then headless e2e.
pnpm regression
```

The new `playground.spec.ts` Playwright test (run by `pnpm smoke` /
`pnpm regression`) exercises the Playground page at three viewport
presets and verifies the title, branding, panel sizing per breakpoint,
and a smoke conversation. If this spec is red after your changes, the
redesign contract is broken.

## Bundle-Size Check

```sh
pnpm --filter widget build
```

Inspect the printed gzipped sizes against the budgets:

- NPM widget bundle: ≤ 35KB gz
- CDN standalone bundle: ≤ 50KB gz

If the build fails the size check, either trim the redesign (remove
unused tokens, simplify CSS) or document the regression in the PR
description for review.

## Override the Palette (sanity check)

In any embedding page (or in the Playground main.tsx for a quick
test), wrap the widget in:

```tsx
<div style={{ ['--lc-primary-color' as any]: '#0F2447' }}>
  <ChatWidget apiKey="dev_test_key" />
</div>
```

The bubble, focused input ring, and user message background should
all switch to navy. The rest of the panel should still render
correctly. This validates the public override contract (FR / design-
tokens.md).

## Common Issues

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Panel is square on mobile but not full-screen | `dvh` not supported in your browser | Update browser; or check the `100vh` fallback chain |
| No glass effect | `backdrop-filter` unsupported / disabled in DevTools | Expected — verify the solid fallback surface is in use |
| Host page scroll position lost on close | `useScrollLock` not restoring | Check that `savedBodyStyle` captures the original values, including empty strings |
| Chatbot panel appears but slide-up animation doesn't run | `prefers-reduced-motion` is enabled | Expected — disable in OS settings to verify animation |
| "Smith & Associates" still appears on the page | `main.tsx` or `index.html` not yet updated | Re-run the rebrand task in tasks.md |

## Where the Pieces Live

| Concern | File |
|---------|------|
| Page title + favicon | `packages/widget/index.html` |
| Playground page tree | `packages/widget/src/main.tsx` |
| Playground page CSS | `packages/widget/src/styles/playground.css` |
| Panel shell (positioning + animation + glass) | `packages/widget/src/components/PanelShell.tsx` |
| Panel CSS | `packages/widget/src/styles/panel.css` |
| Breakpoint hook | `packages/widget/src/hooks/usePanelLayout.ts` |
| Scroll-lock hook | `packages/widget/src/hooks/useScrollLock.ts` |
| Reduced-motion hook | `packages/widget/src/hooks/useReducedMotion.ts` (existing, unchanged) |
| Chat orchestrator | `packages/widget/src/components/ChatPanel.tsx` |
| Bubble | `packages/widget/src/components/ChatBubble.tsx` |
| Composer (input + chips + form) | `packages/widget/src/components/Composer.tsx` |
| Message list | `packages/widget/src/components/MessageList.tsx` |
