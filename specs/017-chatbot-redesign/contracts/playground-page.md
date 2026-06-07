# Contract: LexBot Playground Page

The Playground is the rebranded test page rendered by `pnpm --filter
widget dev` (and shipped as the `index.html` of the widget package's
demo build). It is a developer / stakeholder demo surface, NOT a
public marketing page.

## File Locations

- `packages/widget/index.html` — page title and `<head>`
- `packages/widget/src/main.tsx` — the React tree for the playground
- `packages/widget/src/styles/playground.css` — page-level styles

## Required Page Title

`<title>LexBot Playground</title>` in `packages/widget/index.html`.

## Required Page Sections (in order)

### 1. TopBar

A 64px sticky top bar.

- Left: "LexBot" wordmark — text-only, font-weight 600, font-size
  18px, color `var(--lc-primary-color)`, letter-spacing -0.01em.
- Right: a "Playground" pill — small rounded label, muted background,
  with a subtitle "demo / sample content" in muted text below it.

### 2. Hero

A full-width section, ~480px tall, with:

- H1: "Try LexBot on a sample legal-services site"
- Subhead (paragraph below H1): "This is a developer demo of the
  LexBot widget. The 'firm' below is fictional — chat with the bot
  in the corner to see it in action."

Styled with a subtle warm gradient background.

### 3. Demo Banner

A single horizontal banner, just above the practice-area cards:
"Sample content for the LexBot demo — the firm shown below is
fictional."

### 4. Practice Areas

3-card grid (Personal Injury, Family Law, Estate Planning), copy
preserved from the existing `main.tsx` cards. Cards use the new
warm palette (off-white card background, indigo headings, warm
charcoal body text).

### 5. CTA

A "Ready to Talk?" headline + a sample phone number — preserved
from the existing main.tsx but restyled.

### 6. Footer

`© LexBot — sample-content demo. The "firm" shown on this page is
fictional.`

### 7. ChatWidget

The chatbot widget mounts in the corner exactly as in production
embeds. `<ChatWidget apiKey="dev_test_key" />`. No Playground-only
overrides of widget behavior (FR-030).

## Forbidden Strings

The following strings MUST NOT appear anywhere in the rendered page
(verified by both a unit assertion and the Playwright spec):

- `Smith & Associates`
- `Smith and Associates`
- `Smith & Associates'` (with apostrophe)
- `123 Main Street`
- `Springfield, IL`
- `Springfield, Illinois`

## Required Strings

The following strings MUST appear in the rendered page:

- `LexBot Playground` (in title and TopBar / page heading)
- `LexBot` (as wordmark)
- `sample` (in either the demo banner or hero subhead — case
  insensitive — to clearly signal demo nature)
- `fictional` (in either the hero subhead or footer)

## Visual Requirements

- All page text MUST be set in `--lc-font-family` (system stack).
- The page MUST use the same `--lc-background` (warm off-white) as
  the panel, so the page-and-panel together feel coherent.
- The page MUST be readable at viewport widths from 320px to
  1920px without horizontal scroll.
- The chatbot bubble MUST always be visible in the bottom-right
  corner, regardless of page scroll position.

## Test Contract

`playground.spec.ts` (Playwright, in `packages/api/tests/e2e/`):

For each viewport preset in `[mobile (375x812), tablet (820x1180),
desktop (1440x900)]`:

1. Navigate to the widget dev URL.
2. Assert `document.title === 'LexBot Playground'`.
3. Assert the body text contains "LexBot Playground".
4. Assert the body text does NOT contain any of the forbidden
   strings listed above.
5. Click the chat bubble.
6. Assert the panel's bounding box matches expectations:
   - mobile: width = 375, height = 812 (within ±2px)
   - tablet: width = 420 (within ±2px), height ~ 1180
   - desktop: width = 480, height = 760 (within ±2px), and the
     panel's right edge is 24px from viewport's right edge
7. Type "Hello" into the input, press Enter.
8. Assert the user's message appears in the conversation list.
9. (smoke only — does not assert streaming-token specifics) After
   2s, assert at least one assistant token has been received OR
   the typing indicator is visible.
