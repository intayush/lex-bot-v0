# Contract: CDN Script Tag

**Owner**: Chat Widget (`005-chat-widget`)
**Distribution**: CDN (Netlify static site per §9.7)
**Source of Truth**: §6.2, §6.3, §6.11, §6.13.

## Embed

```html
<script src="https://cdn.legalchatbot.com/widget/v1/legal-chatbot.js"
        data-api-key="lc_live_xxxxx"></script>
```

## Data Attributes

| Attribute | Required | Notes |
|---|---|---|
| `data-api-key` | yes | The lawyer's API key (mirrors NPM `apiKey` prop) |
| `data-api-url` | no | Override default chat endpoint |
| `data-position` | no | `bottom-right` \| `bottom-left` |

The CDN script does NOT support theming via data attributes —
theming is via CSS custom properties on the host page.

## Auto-Mount Behavior

On script load:

1. Wait for `DOMContentLoaded` (or run immediately if already
   complete).
2. Find the `<script>` element with `data-api-key` (search via
   `document.currentScript` first; fall back to a query
   `script[data-api-key]`).
3. Read `data-api-key`, `data-api-url`, `data-position`.
4. Create a sentinel `<div id="legal-chatbot-root">` at the end
   of `<body>` (idempotent — if it exists, reuse).
5. Render `<LegalChatbot>` (the Preact-shimmed version) into the
   sentinel.
6. Dispatch `legalchatbot:ready` `CustomEvent` on `document` so
   host pages can detect readiness.

## DOM Events Emitted (per §6.13)

```javascript
document.addEventListener('legalchatbot:ready',     (e) => {});
document.addEventListener('legalchatbot:open',      (e) => {});
document.addEventListener('legalchatbot:closed',    (e) => {});
document.addEventListener('legalchatbot:message',   (e) => { /* e.detail = { role, content } */ });
document.addEventListener('legalchatbot:lead',      (e) => { /* e.detail = { classification, leadId } */ });
document.addEventListener('legalchatbot:escalation',(e) => {});
```

Both prop callbacks (in NPM mode) and DOM events (in CDN mode)
fire from the same internal pipeline. The CDN-only emission
flow is "DOM events only" because there are no React refs or
prop callbacks available to a `<script>` tag.

## Bundle Composition

The CDN bundle is a self-contained UMD file that includes:

- Preact + `@preact/compat`
- All widget components
- `useChat` from `@ai-sdk/react` (compatible under `@preact/compat`)
- The `@legal-chatbot/shared` types (transitively)

It DOES NOT include React. Host pages without React still work.

## Size Budget

The CDN artifact MUST be ≤ 50 KB gzipped (FR-035, SC-010).
Enforced by `size-limit` in CI (R8).

## Idempotency

If the script is loaded twice (e.g., included in two places),
the second load detects the existing sentinel and skips re-mount.
A console warning is logged in dev builds.

## CSP Compatibility

The bundle does not use `eval`, `new Function()`, or other CSP
violators. Inline styles are scoped to Shadow DOM but still
require the host page to allow `style-src 'unsafe-inline'` for
the bubble (which lives in light DOM). This is documented in the
quickstart.

