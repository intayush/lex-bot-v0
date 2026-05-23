# Contract: Theming via CSS Custom Properties

**Owner**: Chat Widget (`005-chat-widget`)
**Source of Truth**: §6.7, §6.10.

## Override Mechanism

Lawyers customize the widget's appearance by setting CSS custom
properties at any selector that includes the widget's host
element:

```css
:root {
  --lc-primary-color: #1a365d;
  --lc-primary-text: #ffffff;
  --lc-background: #f7fafc;
  --lc-font-family: "Georgia", serif;
  --lc-border-radius: 12px;
  --lc-bubble-user: #1a365d;
  --lc-bubble-bot: #edf2f7;
  --lc-position: bottom-right;
}
```

## Variables (per §6.7)

| Variable | Default | Used by |
|---|---|---|
| `--lc-primary-color` | `#1a365d` | Header bg, bubble trigger |
| `--lc-primary-text` | `#ffffff` | Text on primary backgrounds |
| `--lc-background` | `#ffffff` | Panel background |
| `--lc-font-family` | system stack | All widget text |
| `--lc-border-radius` | `12px` | Panel corners |
| `--lc-bubble-user` | `#1a365d` | User message bubble bg |
| `--lc-bubble-bot` | `#edf2f7` | Bot message bubble bg |
| `--lc-position` | `bottom-right` | Bubble + panel anchor (`bottom-right` \| `bottom-left`) |

## React `theme` Prop

Equivalent to setting CSS custom properties; props are mapped to
inline `style` overrides on the widget's host element:

```tsx
<LegalChatbot
  apiKey="..."
  theme={{ primaryColor: "#0a0a0a", fontFamily: "Inter" }}
/>
```

| Prop key | CSS variable |
|---|---|
| `primaryColor` | `--lc-primary-color` |
| `primaryText` | `--lc-primary-text` |
| `background` | `--lc-background` |
| `fontFamily` | `--lc-font-family` |
| `borderRadius` | `--lc-border-radius` |
| `bubbleUser` | `--lc-bubble-user` |
| `bubbleBot` | `--lc-bubble-bot` |
| `position` | `--lc-position` |

The `theme` prop is **shallow-merged** with defaults; missing
keys fall back to the CSS-variable defaults declared in the
widget's shadow stylesheet.

## Shadow DOM Boundary Crossing

Per R9, the chat panel renders inside a Shadow DOM. CSS custom
properties traverse the Shadow boundary, so host-page overrides
on `:root`, `body`, or any ancestor of the widget's host element
take effect inside the Shadow DOM.

## Specificity & !important

The widget's internal styles use **low specificity** (single
class names; no `!important`). Host pages that override custom
properties win. Host pages that try to override widget classes
directly (`.lc-...`) only affect the bubble (light DOM) — the
panel inside the Shadow DOM is opaque to outside selectors.

## Position Behavior

Setting `--lc-position: bottom-left` (or `position: 'bottom-left'`
prop) anchors:

- Bubble: bottom-left of the viewport.
- Panel (mobile/tablet/desktop): also bottom-left-rooted, with
  appropriate per-breakpoint dimensions.

No other values are accepted; unknown values fall back to
`bottom-right`.

## Dark Mode

Not directly supported by MVP — the spec is silent on dark-mode
overrides. Lawyers can achieve a dark theme by setting custom
property values (e.g., `--lc-background: #1a202c`). Auto-switching
based on `prefers-color-scheme` is post-MVP.

## Tests

- A test renders `<LegalChatbot theme={{ primaryColor: '#ff0000' }} />`
  and asserts the inline style applies.
- A test sets `--lc-primary-color: #00ff00` on `:root` and
  asserts the widget reflects it via `getComputedStyle`.

