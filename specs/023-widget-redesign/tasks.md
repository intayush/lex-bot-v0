---
description: "Task list for 023-widget-redesign"
---

# Tasks: Widget Redesign

**Input**: Design documents from `/specs/023-widget-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/panel-visual-contract.md, contracts/undo-interaction-contract.md, quickstart.md

**Tests**: Constitution III applies — visual smoke tests via Playwright walk. No unit tests required for pure UI changes.

**Organization**: Tasks grouped by user story. US1 (visual shell) and US2 (undo) are both P1 and can be implemented independently. US3 (expand) is P2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: Maps to a user story from `spec.md` (US1, US2, US3)
- Every task lists exact file paths relative to repo root

## Path Conventions

This feature touches `packages/widget/src/` only. All paths are repo-root-relative.

---

## Phase 1: Setup

**Purpose**: Create shared assets and confirm branch. No visual changes yet.

- [X] T001 Confirm branch `023-widget-redesign` is checked out and working tree is clean: `git status`
- [X] T002 Create `packages/widget/src/assets/icons.tsx` exporting six inline SVG components: `RadioCircleIcon` (16×16 open circle), `UndoIcon` (14×14 counter-clockwise arrow), `ExpandIcon` (bracket-arrows outward), `CollapseIcon` (bracket-arrows inward), `RestartIcon` (↺ circular arrow), `CloseIcon` (×). Each is a React functional component accepting `className?: string` and `style?: React.CSSProperties`. All use `currentColor` for stroke/fill so they inherit button colour automatically.
- [X] T003 Run `pnpm --filter @legal-chatbot/widget typecheck` to confirm the baseline typechecks clean before any edits.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Update CSS design tokens and panel shell. Both US1 and US2 depend on the new token values. US3 depends on the `data-expanded` attribute forwarding in PanelShell.

- [X] T004 Edit `packages/widget/src/styles/panel.css`: update existing tokens and add new ones per `contracts/panel-visual-contract.md` §Design Tokens. Specific changes:
  - `--lc-background`: change from `#fcfaf5` to `#ffffff`
  - `--lc-surface`: change to `rgba(255,255,255,0.97)`
  - `--lc-surface-fallback`: change to `rgba(255,255,255,0.99)`
  - `--lc-message-bg-assistant`: change from `#f5f1e8` to `transparent`
  - `--lc-shadow`: change to `0 4px 24px rgba(0,0,0,0.12)`
  - `--lc-message-radius`: change from `16px` to `20px`
  - Add `--lc-panel-expanded-width: 700px`
  - Add `--lc-panel-expanded-height: min(860px, calc(100vh - 48px))`
  - Add `--lc-chip-radio-size: 16px`
  - Add `--lc-undo-icon-size: 28px`
  - Add `--lc-toolbar-icon-size: 36px`

- [X] T005 Edit `packages/widget/src/styles/panel.css`: add expanded panel CSS. In the desktop section (after `data-breakpoint='desktop'` rule), add:
  ```css
  .lc-panel {
    transition: width 300ms cubic-bezier(0.16,1,0.3,1),
                height 300ms cubic-bezier(0.16,1,0.3,1);
  }
  .lc-panel[data-breakpoint='desktop'][data-expanded='true'],
  .lc-panel[data-breakpoint='desktop-clamped'][data-expanded='true'] {
    width: var(--lc-panel-expanded-width);
    height: var(--lc-panel-expanded-height);
  }
  @media (max-width: 480px) {
    .lc-panel[data-expanded='true'] {
      width: 100vw !important;
      height: 100dvh !important;
      inset: 0 !important;
      border-radius: 0 !important;
    }
  }
  ```

- [X] T006 Edit `packages/widget/src/components/PanelShell.tsx`: add `isExpanded?: boolean` to the `PanelShellProps` interface. Pass `data-expanded={isExpanded ? 'true' : 'false'}` to the root `.lc-panel` div alongside the existing `data-breakpoint` and `data-phase` attributes.

**Checkpoint**: Panel CSS tokens and shell forwarding are in place. US1, US2, US3 can all begin.

---

## Phase 3: User Story 1 — Fresh modern panel visual (Priority: P1) 🎯 MVP

**Goal**: Complete visual refresh matching the reference designs — white panel, white message area, plain-text assistant messages, filled blue user bubbles, outlined chip pills, new toolbar, new launcher.

**Independent Test**: Open widget at `http://localhost:5173`. Confirm: white background, no colour header strip, three toolbar buttons top-right, chips as outlined pills with radio circle icon, bot messages as plain text, launcher as grey circle with green dot, "Need help?" tooltip. Run `quickstart.md` Steps 1–2.

### Implementation for User Story 1

#### Header redesign

- [X] T007 [US1] Edit `packages/widget/src/components/ChatPanel.tsx` header section (lines ~416–456): replace the solid-colour header div with a transparent/white header. The header should only contain:
  - The three toolbar buttons (restart, expand, close) in a row positioned `top: 16px, right: 16px` absolutely
  - No background colour, no padding-left heading text — the heading moves into `greetingNode`
  - Import `RestartIcon`, `ExpandIcon`, `CollapseIcon`, `CloseIcon` from `../assets/icons`
  - Toolbar button style: `width: var(--lc-toolbar-icon-size)`, `height: var(--lc-toolbar-icon-size)`, `border-radius: 50%`, `border: 1px solid #E5E7EB`, `background: transparent`, hover: `#F3F4F6`, `color: #6B7280`
  - Restart button calls the existing reset/restart handler (keep existing logic, restyle only)
  - Expand button: add `isExpanded` state (`useState(false)`) to `ChatPanelInner`; toggle on click; pass to `PanelShell` as `isExpanded` prop; swap icon between `ExpandIcon` and `CollapseIcon`
  - Close button calls existing `requestClose` (keep existing logic, restyle only)

- [X] T008 [US1] Edit `packages/widget/src/components/ChatPanel.tsx` `greetingNode` (lines ~369–388): move the greeting heading into the greeting node so it appears in the scroll area above the bot avatar. Change from the current assistant-bubble-styled div to a large bold heading:
  - `fontSize: '22px'`, `fontWeight: '700'`, `color: '#111827'`, `lineHeight: '1.3'`, `marginBottom: '16px'`
  - Keep the existing `messages.length === 0` guard (only show on empty conversation)

#### Message bubble restyling

- [X] T009 [US1] Edit `packages/widget/src/components/MessageList.tsx`: restyle message bubbles per `contracts/panel-visual-contract.md` §Message Bubbles:
  - **User messages**: keep filled blue pill but increase `border-radius` to `20px`, add `padding: '12px 20px'`; add timestamp div below bubble (`fontSize: '11px'`, `color: '#9CA3AF'`, `textAlign: 'right'`)
  - **Assistant messages**: remove `backgroundColor` (set to `'transparent'`), remove `border`, increase `fontSize` to `'16px'`, `lineHeight: '1.6'`; keep the bot avatar + timestamp pattern already in the component but restyle timestamp font to `'11px'`, `'#9CA3AF'`
  - Keep all data props and role logic unchanged

#### Chip restyling

- [X] T010 [US1] Edit `packages/widget/src/components/Chips.tsx`: restyle chip buttons to outlined blue pills per `contracts/panel-visual-contract.md` §Chips:
  - Import `RadioCircleIcon` from `../assets/icons`
  - Each chip button: `border: '2px solid var(--lc-primary-color, #4338ca)'`, `borderRadius: '24px'`, `background: 'transparent'`, `color: 'var(--lc-primary-color, #4338ca)'`, `padding: '12px 20px 12px 14px'`, `display: 'flex'`, `alignItems: 'center'`, `gap: '10px'`
  - Prepend `<RadioCircleIcon style={{ width: 'var(--lc-chip-radio-size)', height: 'var(--lc-chip-radio-size)', flexShrink: 0 }} />` before the label text
  - Hover/active: background becomes `var(--lc-primary-bg)`, color becomes `white`
  - Change chip container `flexDirection` to `'column'` so chips stack vertically (each on its own line), matching the reference design

#### Composer restyling

- [X] T011 [US1] Edit `packages/widget/src/components/Composer.tsx`: restyle input and send button per `contracts/panel-visual-contract.md` §Input Area:
  - Input: `border: '1.5px solid #E5E7EB'`, `borderRadius: '12px'`, `padding: '12px 14px'`, `fontSize: '14px'`, white background
  - Send button: change from rectangular to `36px × 36px` circle, keep `background: 'var(--lc-primary-bg)'`, add `borderRadius: '50%'`, remove text label (icon only — use a simple right-arrow SVG inline or `›` character)
  - Disclaimer text: `fontSize: '11px'`, `color: '#9CA3AF'`

#### Launcher restyling

- [X] T012 [US1] Edit `packages/widget/src/components/ChatBubble.tsx` (or `ChatWidget.tsx` launcher section): restyle launcher to match `new-design/chat-icon.png` per `contracts/panel-visual-contract.md` §Launcher Bubble:
  - Circular `56px` button, background `#F3F4F6`, `borderRadius: '50%'`, `border: 'none'`
  - Bot avatar SVG (existing ghost icon) `32×32`, `color: '#111827'` centred
  - Green online dot: `width: '10px'`, `height: '10px'`, `background: '#22C55E'`, `borderRadius: '50%'`, `position: 'absolute'`, `bottom: '2px'`, `right: '2px'`
  - "Need help?" tooltip: add `showTooltip` state to `ChatWidget` (`useState(true)`), `useEffect` to flip false after 5000ms, also flip false on bubble click. Tooltip renders as a positioned div to the left of bubble: white bg, `borderRadius: '8px'`, `boxShadow: '0 2px 8px rgba(0,0,0,0.12)'`, `padding: '8px 12px'`, `fontSize: '13px'`, `color: '#1F2937'`, `whiteSpace: 'nowrap'`

#### "Powered by" footer

- [X] T013 [US1] Edit `packages/widget/src/components/ChatPanel.tsx`: update the "Powered by" footer styling — `fontSize: '12px'`, `color: '#9CA3AF'`, `textAlign: 'center'`, `padding: '12px 16px'`, white background. Keep the existing footer JSX content, restyle only.

**Checkpoint**: US1 complete. Run `quickstart.md` Steps 1–2 to verify visual parity with reference designs.

---

## Phase 4: User Story 2 — Undo per user message (Priority: P1)

**Goal**: A small undo icon appears to the left of the most recent user message bubble. Clicking it pops the last `[user, assistant]` pair from the conversation.

**Independent Test**: Send one chip response. Confirm undo icon visible left of user bubble. Confirm icon is disabled during streaming. Click undo; confirm last turn is removed and greeting chips restore. Run `quickstart.md` Steps 3–4.

### Implementation for User Story 2

- [X] T014 [US2] Edit `packages/widget/src/components/ChatPanel.tsx`: add `handleUndo` function to `ChatPanelInner`. Import `setMessages` from the `useChat` destructure (add to line ~249). Implement:
  ```typescript
  function handleUndo() {
    setMessages((prev) => prev.length >= 2 ? prev.slice(0, -2) : prev);
  }
  ```
  Pass `onUndo={handleUndo}` and `isLoading={isLoading}` to `MessageList` (new props).

- [X] T015 [US2] Edit `packages/widget/src/components/MessageList.tsx`: add `onUndo?: () => void` and `isLoading?: boolean` to the `MessageListProps` interface. In the messages map (lines ~60–99), when rendering a **user** message that is the **last message overall** (`index === messages.length - 1`), render an undo button to its left per `contracts/undo-interaction-contract.md`:
  - Wrap the message bubble in a flex row: `display: 'flex'`, `alignItems: 'center'`, `gap: '8px'`, `justifyContent: 'flex-end'`
  - Undo button (left of bubble): `width: 'var(--lc-undo-icon-size)'`, `height: 'var(--lc-undo-icon-size)'`, `borderRadius: '50%'`, `border: 'none'`, `background: 'transparent'`, hover `background: '#F3F4F6'`, `color: '#9CA3AF'`, `cursor: isLoading ? 'not-allowed' : 'pointer'`, `opacity: isLoading ? 0.4 : 1`, `disabled={isLoading}`, `aria-label="Undo last response"`, `onClick={onUndo}`
  - Import `UndoIcon` from `../assets/icons`
  - Only render undo on user messages; only on the last message; never when `messages.length < 2`

**Checkpoint**: US2 complete. Undo icon visible and functional. No API calls made.

---

## Phase 5: User Story 3 — Expand / collapse animation (Priority: P2)

**Goal**: Toolbar expand button grows the panel smoothly to 700×860px; collapse shrinks it back. Full-screen on mobile.

**Independent Test**: Click expand button in toolbar. Confirm panel grows smoothly in ≤400ms, conversation still readable. Click collapse. Confirm panel shrinks smoothly. Run `quickstart.md` Steps 5–6.

### Implementation for User Story 3

- [X] T016 [US3] Edit `packages/widget/src/components/ChatPanel.tsx`: `isExpanded` state was added in T007. Wire the expand button (already added in T007) to toggle `isExpanded`. Pass `isExpanded` prop to `PanelShell` (already updated in T006). The icon swap (`ExpandIcon` ↔ `CollapseIcon`) is already done in T007 — verify it works with the state toggle.

- [X] T017 [US3] Verify `packages/widget/src/styles/panel.css` CSS from T005 correctly transitions. Test by opening the widget, clicking expand, and visually confirming the panel grows to ~700px wide. On viewports ≤480px confirm it goes full screen.

**Checkpoint**: US3 complete. All three user stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T018 [P] Run `pnpm --filter @legal-chatbot/widget typecheck` and fix any TypeScript errors from new `isExpanded`, `onUndo`, `isLoading` props and icon imports.
- [X] T019 [P] Run `pnpm --filter @legal-chatbot/api test` and confirm 653/653 pass (no API regressions — widget changes should not affect this).
- [X] T020 Execute `quickstart.md` all 6 steps manually. Confirm visual fidelity matches `new-design/initial-state.png` (Step 2) and `new-design/mid-chat.png` (Step 3). Record any deviations.
- [X] T021 [P] Verify the existing widget e2e walks still pass after the visual changes: `pnpm --filter @legal-chatbot/api e2e --grep "widget"`. The walks assert on SOP state headers and chip presence — they should be unaffected by visual-only changes to CSS and layout.
- [X] T022 [P] Check reduced-motion: in browser with `prefers-reduced-motion: reduce`, confirm the panel open/close and expand/collapse transitions are instant (≤0ms). The existing `@media (prefers-reduced-motion: reduce)` block in `panel.css` should already handle this — add the new `transition` to the same block.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1 (icons file must exist for T007 import). BLOCKS US1, US2, US3.
- **Phase 3 (US1)**: Depends on Phase 2 complete.
- **Phase 4 (US2)**: Depends on Phase 2 complete. Can run in parallel with US1 (different files).
- **Phase 5 (US3)**: Depends on T007 (expand state in ChatPanel). Can start after T007.
- **Phase 6 (Polish)**: Depends on Phases 3, 4, 5 complete.

### User Story Dependencies

- **US1 and US2** are fully independent after Phase 2:
  - US1 touches: ChatPanel (header, greeting, footer), MessageList (bubbles), Chips, Composer, ChatBubble
  - US2 touches: ChatPanel (handleUndo), MessageList (undo button)
  - MessageList is shared — T009 (US1) and T015 (US2) both edit it. Do T009 first, then T015.
- **US3** depends only on T007 (isExpanded state setup).

### Within Phase 3 (US1) — internal ordering

- T007 (header redesign, adds isExpanded state) → FIRST, gates T016
- T008 (greeting heading) — independent of T007, can run in parallel
- T009 (message bubbles) — must complete before T015 (US2 undo button shares this file)
- T010 (chip restyle) — fully independent
- T011 (composer restyle) — fully independent
- T012 (launcher restyle) — fully independent
- T013 (footer restyle) — fully independent

### Parallel Opportunities

- T008, T010, T011, T012, T013 — all touch different files; can run simultaneously after T007
- T014 (US2 ChatPanel) and T007+ (US1 other components) — different files, no dependency
- T018, T019, T021, T022 (Polish) — all independent checks

---

## Parallel Example: US1 components after T007

```bash
# Once T007 (header) is done, these can run in parallel:
Task: "Restyle greeting heading in ChatPanel.tsx (T008)"
Task: "Restyle chip buttons in Chips.tsx (T010)"
Task: "Restyle composer input in Composer.tsx (T011)"
Task: "Restyle launcher in ChatBubble.tsx (T012)"
Task: "Restyle footer in ChatPanel.tsx (T013)"
```

---

## Implementation Strategy

### MVP Scope

**MVP = US1 (Phase 1 + Phase 2 + Phase 3)** — the visual refresh alone ships the new look. US2 (undo) and US3 (expand) are additive.

### Incremental Delivery

1. Phase 1 (Setup) → icons file ready, typecheck clean
2. Phase 2 (Foundational) → CSS tokens updated, PanelShell forwards `data-expanded`
3. Phase 3 (US1) → new visual shell live — matches reference designs. **Ship-ready.**
4. Phase 4 (US2) → undo per message live
5. Phase 5 (US3) → expand/collapse live
6. Phase 6 (Polish) → all checks green

### Recommended Single-Developer Sequence

```text
T001 → T002 → T003              (Setup)
T004 → T005 → T006              (CSS tokens + PanelShell)
T007                             (Header redesign — gates US3)
T008 + T010 + T011 + T012 + T013 in parallel  (Rest of US1)
T009                             (Message bubbles — must be before T015)
T014 → T015                     (US2 undo)
T016 → T017                     (US3 expand)
T018 + T019 + T021 + T022        (Polish checks in parallel)
T020                             (Manual quickstart validation)
```

---

## Notes

- `[P]` tasks operate on different files with no incomplete-task dependencies.
- `[Story]` label is required on US1/US2/US3 tasks; Setup, Foundational, and Polish tasks omit it.
- All changes are in `packages/widget/src/` only. No API, no dashboard, no shared package changes.
- Reference designs are in `new-design/` — keep them open during implementation.
- The `useChat` `setMessages` function is available in `@ai-sdk/react` v1.x (already installed).
- Toolbar buttons already exist in ChatPanel (header X button) — T007 replaces the entire header section, don't lose the close/reset functionality.
