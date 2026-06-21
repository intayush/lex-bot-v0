# Quickstart — Widget Redesign

**Feature**: 023-widget-redesign

Visual validation of the redesigned widget against the reference designs in `new-design/`.

## Prerequisites

- `pnpm dev` running (API on :3000, widget on :5173)
- Dev DB seeded: `pnpm db:seed`
- Browser at `http://localhost:5173`

---

## Step 1 — Launcher appearance

Open `http://localhost:5173`. Before clicking anything:

**Expected**:
- Chat bubble: circular `56px`, grey background (`#F3F4F6`), ghost avatar, green dot bottom-right
- "Need help?" tooltip appears as a speech bubble to the left of the launcher
- Tooltip disappears after 5 seconds automatically

Compare against: `new-design/chat-icon.png`

---

## Step 2 — Panel opens with new visual

Click the launcher bubble.

**Expected**:
- Panel opens with a smooth slide-up animation (≤300ms)
- White background — no warm cream, no coloured header strip
- Large bold "How can we help you?" heading visible
- Bot avatar (ghost icon) + "a few seconds ago" timestamp below heading
- Chips render as **outlined blue pills with a radio-circle icon on the left** and label text
- Three toolbar buttons top-right: circular grey, icons for restart · expand · close
- No text input visible (chips are the only interaction on greeting screen)
- "Powered by [brand]" footer at the bottom

Compare against: `new-design/initial-state.png`

---

## Step 3 — Mid-conversation layout and undo

Click one of the chips (e.g. "DUI").

**Expected**:
- User response appears as a **filled blue rounded pill** (right-aligned), timestamp below
- A small grey undo `↩` icon is visible immediately to the left of the user bubble
- Bot follow-up question renders as **large plain text** (no bubble background), left-aligned
- Bot avatar + timestamp appear below the bot text
- Next chips appear below the bot message (within the scroll area)

Compare against: `new-design/mid-chat.png`

Click the undo `↩` icon next to the DUI bubble.

**Expected**:
- User "DUI" bubble and the bot's follow-up are both removed
- Chat returns to the greeting state with the original case-type chips
- Undo icon is no longer visible (no user messages remain)

---

## Step 4 — Undo disabled during streaming

Click a chip and immediately observe the undo button state.

**Expected**:
- While the assistant is responding (streaming indicator visible), the undo `↩` icon is greyed out and non-interactive

---

## Step 5 — Expand / collapse

With the panel open, click the expand icon (bracket-arrows) in the toolbar.

**Expected**:
- Panel grows smoothly to a larger size (wider and taller) — animation ≤400ms
- Conversation content reflows correctly in the wider panel
- Expand icon changes to a collapse icon (inward arrows)
- All chips, input, and toolbar remain accessible

Click the collapse icon.

**Expected**:
- Panel returns to its original size — animation ≤400ms
- Expand icon returns

---

## Step 6 — Mobile viewport

Open browser DevTools, set viewport to `375 × 812` (iPhone SE).

**Expected**:
- Panel fills the full viewport when open (existing mobile behaviour)
- Expand: panel fills 100% of viewport (full-screen mode)
- All chips and input remain accessible

---

## Troubleshooting

| Symptom | Likely cause |
|---------|-------------|
| Panel still shows warm cream background | CSS variable override not applied — check `--lc-background` in panel.css |
| Chips still rectangular | `Chips.tsx` not updated — check `border-radius: 24px` and radio-circle SVG |
| Undo icon missing | `MessageList.tsx` not updated to render undo per user message |
| Expand doesn't animate | `data-expanded` attribute missing from `.lc-panel` — check PanelShell |
| Tooltip never appears | `showTooltip` state not wired to ChatBubble |
