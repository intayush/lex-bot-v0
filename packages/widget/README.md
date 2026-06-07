# @legal-chatbot/widget

The embeddable chat widget for the Lex Bot legal-firm chatbot platform.
React-based; ships as both an NPM package (consumed via `import { ChatWidget }`)
and a CDN-distributed standalone bundle (`<script src=".../legal-chatbot.js">`).

## Loading state

When the visitor sends a message, the widget shows a typing indicator
in a chat-bubble below the conversation. The indicator's content has
two states:

1. **Dots state** (`● ● ●`): default while waiting for any agent
   response. Visible immediately after Send.
2. **Phrase state** (`✨ Looking into your DUI matter…`): a
   query-tailored loading message that swaps in once a parallel
   pre-call to `gemini-2.5-flash-lite` resolves (~250-500ms typical).
   See `specs/011-preflight-phrase/spec.md` for the design rationale.

Failure modes for the phrase preflight (network drop, timeout,
provider error) are silent — the dots state remains throughout.
The visitor never sees an error UI; the main `/api/chat` flow is
never blocked.

The bubble carries `role="status"` and `aria-live="polite"` so
screen readers announce both the dots state and the phrase swap.

## CSS Custom Properties

Public override tokens (preserved across spec 017 — embedding firms can
continue to override these):

| Property | Spec 017 default | Purpose |
|---|---|---|
| `--lc-primary-color` | `#4338ca` (warm indigo; was `#1a365d` navy) | Bubble, user-message bg, focused input ring, chip selected bg, primary button |
| `--lc-primary-text` | `#ffffff` | Text on primary-color surfaces |
| `--lc-background` | `#fcfaf5` (warm off-white; was pure white) | Panel solid background, fallback when backdrop-filter unsupported |
| `--lc-border-radius` | `20px` (was `12px`) | Panel corner radius (tablet/desktop) |
| `--lc-font-family` | system stack | Panel font family |

The progress bar continues to expose its own theme tokens; spec 017
adjusted their defaults to match the warm palette but kept the names:

| Property | Spec 017 default | Purpose |
|---|---|---|
| `--lc-progress-color` | `#4338ca` (was `#22c55e`) | Progress-bar fill |
| `--lc-progress-bg` | `rgba(31,27,22,0.06)` | Progress-bar track |
| `--lc-progress-label-color` | `#1f1b16` (was `#171717`) | Progress-bar label |

Set these on the `<html>` or `<body>` element (or any ancestor of the
widget root) to override:

```html
<style>
  :root {
    --lc-primary-color: #0F2447;  /* navy override */
    --lc-background: #ffffff;     /* if you want pure white */
  }
</style>
```

### Dark-background override caveat

If you override `--lc-background` to a dark color, you should also
override `--lc-text-primary` (default `#1f1b16` — warm charcoal) to a
light value. The widget does not auto-flip text colors; this is a
deliberate decision to keep CSS small and cascade-friendly.

### Spec 017 internal tokens (not public)

The redesigned widget exposes additional internal tokens
(`--lc-surface`, `--lc-surface-blur`, `--lc-shadow`,
`--lc-message-radius`, `--lc-text-primary`, `--lc-text-muted`,
`--lc-message-bg-assistant`, `--lc-border-subtle`, plus animation
tokens). These are NOT part of the override surface promised to
embedding customers and may change between minor versions. See
`specs/017-chatbot-redesign/contracts/design-tokens.md` for the
internal-token catalog.

### Browser support

The redesigned panel uses `backdrop-filter` for the glass effect and
`100dvh` for the mobile viewport. Both are supported in all evergreen
targets (Chrome 76+, Safari 15.4+, Firefox 103+, Edge 79+). Older
browsers receive an equally functional fallback: a near-solid panel
surface (no glass) and a `100vh` height with the same shadow + corner
radius.

## Usage

### NPM (React app)

```jsx
import { ChatWidget } from '@legal-chatbot/widget';

<ChatWidget apiKey="lc_live_xxxxxxxx" apiUrl="https://api.example.com/api/chat" />
```

### CDN (vanilla HTML)

```html
<script
  src="https://lex-bot-chatbot.netlify.app/cdn/legal-chatbot.js"
  data-api-key="lc_live_xxxxxxxx"
></script>
```

## Implementation map

The widget's behavior is described in spec docs under `specs/`:

- **005-chat-widget** — base chat panel, useChat integration, session
  resumption.
- **010-sop-workflow** — progress bar (`<ProgressBar>`), chip rendering
  (`<Chips>`), contact form (`<ContactForm>`), SOP-state hook
  (`useSOPState`).
- **011-preflight-phrase** — query-tailored loading status hook
  (`usePreflightPhrase`).
- **017-chatbot-redesign** — visual redesign: glassmorphism, mobile
  full-viewport takeover with slide-up animation, 480×760 desktop
  panel, LexBot Playground rebrand of the test page. Introduces
  `<PanelShell>`, `<MessageList>`, `<Composer>`, and the
  `usePanelLayout` / `useScrollLock` hooks.

## Bundle size

The widget bundle has a hard ceiling of 35 KB gzipped (NPM) / 50 KB
gzipped (CDN, with Preact). Bundle-size CI gate (Phase 8 R3 of
009-deployment-release) enforces this on every PR. The
preflight-phrase hook adds ~500 bytes of pure JS.
