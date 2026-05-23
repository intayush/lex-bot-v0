# Quickstart: Chat Widget

**Date**: 2026-05-23
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This quickstart shows the engineer + lawyer experience after the
Chat Widget feature is fully implemented. It validates the §12.9
done-when checklist.

## Prerequisites

- Foundation, Crawler, Context Search, Chat API + Agent all
  complete.
- Local dev testbed running (`pnpm dev`): widget on
  `http://localhost:5173`, API on `http://localhost:3000`,
  context store at `http://localhost:5173/chatbot-context/`.

## §12.9 Deliverable Walkthrough

```
Open http://localhost:5173 in a browser
  └─→ click chat bubble (bottom-right)
        └─→ type a question and Enter
              └─→ see streamed response
```

Expected outcomes:

| §12.9 done-when | What to look for |
|---|---|
| Widget renders as a floating bubble on the test app | Visible bubble in the bottom-right corner of the demo page |
| Clicking bubble opens the chat panel | Panel slides up (mobile) / appears in corner (desktop); first interaction lazy-loads the panel |
| Typing a question and sending shows the streaming response | Tokens stream in real-time; typing indicator appears while streaming |
| Conversation persists across page navigations (same tab) | Navigate to another path on `localhost:5173`, reopen widget, prior messages visible |
| Mobile view (Chrome DevTools responsive mode) shows full-screen chat | Switch to iPhone SE size; panel covers full viewport |
| Desktop view shows floating panel in corner | Switch back to desktop; panel returns to corner |
| Quick-reply chips appear based on practice areas | First-open shows greeting + chips populated from `/api/config` |
| Visual verification in browser (no automated test — UI correctness) | Manual; use the demo site at `http://localhost:5173` |

## Verify Persistent Disclaimer (R4, FR-050)

Open the chat panel; scroll to the bottom of the messages area.
Above the input field, in small muted text, the line reads:

> *"I am an AI assistant, not a lawyer. Nothing I say constitutes legal advice."*

This text MUST appear regardless of configuration.

## Verify Consent Banner (R5, FR-051)

Clear sessionStorage:

```js
sessionStorage.clear();
```

Reload the page; click the chat bubble. The consent banner appears
above the messages with:

- Body text mentioning data processing.
- "Privacy policy" link (opens in new tab).
- "Continue" button.

Click "Continue"; the banner dismisses. Reload (within the same
tab) — banner does NOT reappear (consent persisted in
`sessionStorage`).

## Verify Accessibility (R6)

### Keyboard navigation (FR-027)

- Tab: cycles through interactive elements (bubble, input, send,
  close, chips).
- Enter: submits input.
- Shift+Enter: inserts newline (R10).
- Escape: closes the panel.

### Focus trap (FR-030)

With the panel open, Tab repeatedly. Focus cycles within the
panel and never escapes to the host page.

### ARIA announcements (FR-029)

Open Chrome DevTools Accessibility tab. The `<Messages>`
container has `role="log"` and `aria-live="polite"`. New
assistant messages are announced by screen readers.

### prefers-reduced-motion (FR-032)

Set `prefers-reduced-motion: reduce` in DevTools → Rendering
panel. Reload. The typing indicator is static (no animation);
panel slide-in is instant.

### Touch targets (FR-033)

In responsive mode at iPhone SE size, click each interactive
element and verify Lighthouse's accessibility audit reports
no "tap targets too small" issues. Bubble, send button, close
button, quick-reply chips all measure at least 44×44 CSS pixels.

## Verify Offline & Error Handling (R7)

### Offline (FR-042, FR-043)

Open DevTools → Network → toggle "Offline". Try to send a
message:

- A "Reconnecting..." indicator appears above the input.
- The message is queued locally.

Re-enable the network; the queued message sends and streaming
resumes.

### 10-second connectivity (FR-044)

Use DevTools → Network → "Slow 3G" or block requests to
`/api/chat`. Send a message. After 10 seconds, the widget shows:

> "I'm having trouble connecting. Please try again in a moment or
> call us at (555) 123-4567."

(Phone number from `/api/config`.)

### Rate-limit (FR-046)

Drive the session past 50 messages (or use a tool to simulate
429). The widget shows:

> "Please wait a moment before sending another message."

## Verify CSS Scoping (R9, FR-036)

In DevTools → Elements, locate the chat panel. Notice it lives
inside a Shadow DOM root. Add a host-page CSS rule like:

```css
* { color: red !important; }
```

The host page's other text turns red, but the widget's panel
is unaffected (Shadow DOM isolates the panel's styles).

## Verify Theming (R-theming, FR-021)

Add to the host page's `<style>`:

```css
:root {
  --lc-primary-color: #ff6600;
  --lc-bubble-user: #ff6600;
  --lc-font-family: "Comic Sans MS", cursive;
}
```

Reload. The bubble trigger and user message bubbles are now
orange; widget text uses Comic Sans. CSS custom properties
crossed the Shadow DOM boundary.

## Verify Bundle Sizes (R8, FR-034, FR-035)

```bash
pnpm --filter @legal-chatbot/widget build
pnpm --filter @legal-chatbot/widget size
```

Expected output:

```
NPM bundle: 28.4 KB (limit: 35 KB) ✓
CDN bundle: 42.7 KB (limit: 50 KB) ✓
```

(Numbers illustrative.) CI fails the build if either limit is
exceeded (FR-037 stage 6 in the Constitution).

## Verify CDN Script Tag (R2, FR-002, FR-003, FR-004)

Build the CDN bundle:

```bash
pnpm --filter @legal-chatbot/widget build:cdn
```

Create a static HTML test file at
`/tmp/cdn-test.html`:

```html
<!DOCTYPE html>
<html>
  <head><title>CDN Test</title></head>
  <body>
    <h1>Static site</h1>
    <script src="http://localhost:5173/dist/cdn/legal-chatbot.js"
            data-api-key="dev_test_key"></script>
  </body>
</html>
```

(Or use a tiny static server pointing at the built bundle.) Open
the file. The widget appears WITHOUT React being on the page.
Confirm by inspecting `window.React` is `undefined`.

## Verify Analytics Events (R3, FR-047 to FR-049)

In DevTools console, register listeners:

```js
['open', 'closed', 'message', 'lead', 'escalation'].forEach((evt) => {
  document.addEventListener(`legalchatbot:${evt}`, (e) =>
    console.log(`legalchatbot:${evt}`, e.detail)
  );
});
```

Open the chat (logs `legalchatbot:open`), send a message
(logs `legalchatbot:message`), wait for the agent to capture a
lead (logs `legalchatbot:lead`), close (logs `legalchatbot:closed`).

## Run the Full Test Suite

```bash
pnpm --filter @legal-chatbot/widget test
```

Expected: all component tests, hook tests, and `widget-config`
tests pass.

## Out of Scope for This Quickstart

- Embedding on a real production site — Phase 8
  (`009-deployment-release`) publishes the CDN.
- Lead capture / classification — Phase 5
  (`006-lead-classification`) — exercised here only via the
  emitted `legalchatbot:lead` event.
- Cost monitoring dashboard — Phase 7 (`008-hardening`).

