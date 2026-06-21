# Contract: Panel Visual Design

**Feature**: 023-widget-redesign

Reference images: `new-design/initial-state.png`, `new-design/mid-chat.png`, `new-design/chat-icon.png`

---

## Design Tokens (panel.css changes)

| Token | Old value | New value | Notes |
|-------|-----------|-----------|-------|
| `--lc-background` | `#fcfaf5` | `#ffffff` | White panel background |
| `--lc-surface` | `rgba(252,250,245,0.72)` | `rgba(255,255,255,0.97)` | White glass |
| `--lc-surface-fallback` | `rgba(252,250,245,0.96)` | `rgba(255,255,255,0.99)` | |
| `--lc-message-bg-assistant` | `#f5f1e8` | `transparent` | No bubble for assistant |
| `--lc-shadow` | existing | `0 4px 24px rgba(0,0,0,0.12)` | Softer shadow |
| `--lc-panel-radius` | `20px` | `20px` | Unchanged |
| `--lc-message-radius` | `16px` | `20px` | Rounder user bubbles |

**New tokens**:
| Token | Value | Notes |
|-------|-------|-------|
| `--lc-panel-expanded-width` | `700px` | Desktop expanded width |
| `--lc-panel-expanded-height` | `min(860px, calc(100vh - 48px))` | Desktop expanded height |
| `--lc-chip-radio-size` | `16px` | Radio-circle icon size |
| `--lc-undo-icon-size` | `28px` | Undo button size |
| `--lc-toolbar-icon-size` | `36px` | Toolbar icon button size |

---

## Launcher Bubble (ChatBubble.tsx)

**Current**: Pill-shaped button with text/icon, colour from `--lc-primary-bg`.

**New design** (matching `chat-icon.png`):
- Circular button, `56px` diameter, grey background (`#F3F4F6`), no border
- Bot avatar SVG (existing ghost icon) centred, `32px × 32px`, black
- Green online dot: `10px` circle, `#22C55E`, positioned `bottom: 2px, right: 2px` absolutely within the button
- "Need help?" tooltip: speech bubble to the left, white background, `12px` text, `#1F2937`, `box-shadow: 0 2px 8px rgba(0,0,0,0.12)`, rounded `8px`, shown when `showTooltip === true`
- Below the bubble (not the tooltip): a small external-link icon `14px`, grey `#9CA3AF`, matching the reference

---

## Panel Shell

**Current**: Warm cream glass panel.

**New design**:
- Pure white background (`#ffffff`), no glass tint
- Rounded corners `20px` on all breakpoints ≥480px (existing)
- Drop shadow: `0 4px 24px rgba(0,0,0,0.12)` (softer than current)
- No coloured header strip — white throughout

---

## Toolbar (inside ChatPanel header area)

**New design** (matching top-right corner in reference):
- Positioned: `top: 16px, right: 16px`, `position: absolute` within the panel
- Three circular buttons in a row, `gap: 8px`:
  1. **Restart**: circular `36px`, grey border `1px solid #E5E7EB`, grey icon `#6B7280`, `↺` (reset)
  2. **Expand/Collapse**: same style, bracket-arrow icon (expand) or inward-arrow icon (collapse)
  3. **Close**: same style, `×` icon
- Background: `transparent`, hover: `#F3F4F6`
- No firm-colour branding in toolbar

---

## Message Bubbles

**User messages** (right-aligned, matching `mid-chat.png`):
- Background: `var(--lc-primary-bg, #4F46E5)` — filled blue pill
- Text: white `#ffffff`
- Border-radius: `20px` (full pill)
- Padding: `12px 20px`
- Max-width: `75%`
- Timestamp: below bubble, right-aligned, `11px`, `#9CA3AF`

**Assistant messages** (left-aligned, matching `mid-chat.png`):
- Background: `transparent` — **no bubble**
- Text: `#1F2937`, `16px`, `1.5` line-height — large plain text
- No border, no padding wrapper (flush to message area left edge)
- Bot avatar + timestamp: below the message text, `12px`, `#9CA3AF`

---

## Chips (Composer/Trailing slot)

**New design** (matching radio-button style in `initial-state.png`):
- Outlined pill: `border: 2px solid var(--lc-primary-color)`, `border-radius: 24px`
- Background: `transparent` (default), `var(--lc-primary-bg)` (on hover/active)
- Text colour: `var(--lc-primary-color)` (default), `white` (on hover/active)
- Left icon: 16×16px open-circle SVG (`stroke: currentColor`)
- Padding: `12px 20px 12px 14px` (extra left for icon)
- Gap between icon and label: `10px`
- Chips stack vertically (one per line), not horizontally, matching the reference

---

## Input Area (Composer)

**New design**:
- Input and send button integrated below the chip list within the scrollable area
- Input: `border: 1.5px solid #E5E7EB`, `border-radius: 12px`, `padding: 12px 14px`, white background, `14px` text
- Send button: right of input, `36px × 36px` circle, `var(--lc-primary-bg)` background, white arrow icon
- Disclaimer text: `11px`, `#9CA3AF`, centred, below input

---

## "Powered by" Footer

- Fixed at the bottom of the panel (outside the scroll area)
- `12px`, `#9CA3AF`, centred, `padding: 12px`
- Text: "Powered by [brand]" (existing attribution, restyled)

---

## Expanded Panel Dimensions

**Normal (desktop)**: `480px × 760px` (unchanged)
**Expanded (desktop)**: `700px × min(860px, calc(100vh - 48px))`
**Mobile expanded**: `100vw × 100dvh` (full screen)

Transition: `width 300ms, height 300ms` with `cubic-bezier(0.16, 1, 0.3, 1)`
