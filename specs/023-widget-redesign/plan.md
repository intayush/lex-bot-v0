# Implementation Plan: Widget Redesign

**Branch**: `023-widget-redesign` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/023-widget-redesign/spec.md`

## Summary

A pure visual overhaul of `packages/widget` — new white-panel aesthetic inspired by the reference designs in `new-design/`, an undo icon per user message bubble, and a smooth CSS-transition expand/collapse interaction. No changes to chat API calls, session management, SOP logic, or any backend data.

Three independent deliverables:
1. **US1** — Refreshed panel shell, chip style, launcher, and message bubble styling
2. **US2** — Undo icon per user bubble (client-side pop of last turn via `setMessages`)
3. **US3** — Expand/collapse panel animation via CSS transition and new toolbar state

## Technical Context

**Language/Version**: TypeScript (strict), React 19, CSS custom properties

**Primary Dependencies**: React 19, `@ai-sdk/react` (useChat + setMessages), CSS keyframes + transitions. No new npm packages.

**Storage**: Client-side only. `sessionStorage` for session ID and SOP state (unchanged). No backend changes.

**Testing**: Vitest (widget component tests), Playwright (e2e walks — visual smoke).

**Target Platform**: Browser (modern). Widget embeds via `<script>`. Targets viewport widths 320px–1440px.

**Project Type**: `packages/widget` only. `packages/api`, `packages/dashboard`, `packages/shared` untouched.

**Performance Goals**: Open animation ≤300ms, expand/collapse ≤400ms, undo restores state with no perceptible delay.

**Constraints**:
- No changes to prop contracts between ChatWidget, ChatPanel, PanelShell, MessageList, Composer (signature changes allowed; removing required props is not)
- No changes to useChat wiring, useSOPState, computeActiveChips, or session management
- Undo is client-side only: pop last `[user, assistant]` message pair via `setMessages` from useChat. No new API endpoint.

**Scale/Scope**: `packages/widget/src` only. All 6 component files + `panel.css` + one new icons file.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline (NON-NEGOTIABLE) | ✅ PASS | Pure visual change on a shipped feature. US1 is MVP. US2 and US3 are incremental. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | New props (isExpanded, onUndo) are typed. No new cross-boundary data shapes. |
| III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE) | ✅ PASS | Playwright walk verifies chip rendering, undo interaction, and expand state structurally. |
| IV. Serverless-Compatible & Stateless Server Architecture | ✅ PASS | All changes are client-side. No server component or API route touched. |
| V. Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE) | ✅ PASS | No data added/removed/rerouted. Undo pops in-memory React state only. |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | No agent tools, maxSteps, or token budget touched. |
| VII. Phased Incremental Delivery | ✅ PASS | US1 (shell) → US2 (undo) → US3 (expand) is a clean phased sequence. |

**Result**: PASS on all seven principles.

## Project Structure

### Documentation (this feature)

```text
specs/023-widget-redesign/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── contracts/
│   ├── panel-visual-contract.md
│   └── undo-interaction-contract.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/widget/src/
├── components/
│   ├── ChatWidget.tsx      # EDIT: pass isExpanded/onToggleExpand; restyle launcher wiring
│   ├── ChatPanel.tsx       # EDIT: add isExpanded state + toggle; undo handler; new header layout
│   ├── ChatBubble.tsx      # EDIT: restyle to ghost avatar on grey circle + green dot + tooltip
│   ├── PanelShell.tsx      # EDIT: forward data-expanded attribute to .lc-panel
│   ├── MessageList.tsx     # EDIT: add undo icon per user message; restyle assistant (no bubble bg)
│   ├── Composer.tsx        # EDIT: restyle input + button to match reference design
│   └── Chips.tsx           # EDIT: outlined blue pill with radio-circle SVG
├── styles/
│   └── panel.css           # EDIT: new tokens, expanded panel dimensions, undo styles, chip styles
└── assets/
    └── icons.tsx           # NEW: SVG icons (radio-circle, undo, expand, collapse, restart, close)
```

## Complexity Tracking

> No Constitution Check violations.

---

## Phase 0 — Research

See [research.md](./research.md).

**R1 — Panel styling approach**: Inline styles + CSS custom properties (existing pattern). No new framework.

**R2 — Expand/collapse animation**: CSS `transition` on `.lc-panel`, toggled by `data-expanded` attribute on PanelShell. New `--lc-panel-expanded-width` and `--lc-panel-expanded-height` variables. Follows the existing `data-breakpoint` / `data-phase` attribute pattern.

**R3 — Undo mechanics**: `useChat` from `@ai-sdk/react` exposes `setMessages`. Undo pops the last `[user, assistant]` pair. SOP state in sessionStorage already reflects the pre-last-turn state (it was written when the previous response arrived). Client-side only — server session retains full history; on refresh, history restores via the existing `/api/chat/history` mechanism.

**R4 — Chip radio-circle icon**: Inline SVG, 16×16px, open-circle matching the reference design.

**R5 — Launcher tooltip**: `useState(true)` that flips false after 5s via `setTimeout`. Not persisted to sessionStorage — re-appears on every page load.

---

## Phase 1 — Design

### Data Model (UI State)

See [data-model.md](./data-model.md). No DB changes. Two new in-memory React state values:

| State | Location | Type | Default | Description |
|-------|----------|------|---------|-------------|
| `isExpanded` | ChatPanel | `boolean` | `false` | Panel is in enlarged mode |
| `showTooltip` | ChatWidget | `boolean` | `true` | "Need help?" launcher tooltip visible |

### Contracts

See `contracts/`:

- `contracts/panel-visual-contract.md` — Design tokens, chip visual spec, launcher spec, message bubble spec, toolbar icon set
- `contracts/undo-interaction-contract.md` — Undo icon placement, trigger, disabled state, edge cases

### Quickstart

See [quickstart.md](./quickstart.md). Six manual validation steps covering: new visual appearance, chip style, undo flow, expand/collapse animation, mobile viewport, and accessibility.

### Agent Context Update

`CLAUDE.md` between `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` updated to reference `specs/023-widget-redesign/plan.md`.
