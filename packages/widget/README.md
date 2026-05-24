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

The widget exposes the following CSS custom properties for theming
without rebuilding:

| Property | Default | Purpose |
|---|---|---|
| `--lc-progress-color` | `#2563EB` | Progress-bar fill color (010-sop-workflow) |
| `--lc-progress-bg` | `#E2E8F0` | Progress-bar track color |
| `--lc-progress-label-color` | `#64748B` | Progress-bar label text |
| `--lc-bubble-bot` | `#f0f4f8` | Background of the bot's message bubbles + the typing indicator |
| `--lc-primary-color` | `#1a365d` | Primary brand color (form submit buttons, active states) |
| `--lc-primary-text` | `#ffffff` | Text color on primary-colored elements |

Set these on the `<html>` or `<body>` element to override:

```html
<style>
  :root {
    --lc-progress-color: #ef4444;
    --lc-bubble-bot: #fef3c7;
  }
</style>
```

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

## Bundle size

The widget bundle has a hard ceiling of 35 KB gzipped (NPM) / 50 KB
gzipped (CDN, with Preact). Bundle-size CI gate (Phase 8 R3 of
009-deployment-release) enforces this on every PR. The
preflight-phrase hook adds ~500 bytes of pure JS.
