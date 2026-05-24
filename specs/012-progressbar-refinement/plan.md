# Implementation Plan: ProgressBar Refinement

**Branch**: `012-progressbar-refinement` (planned) | **Date**: 2026-05-24 | **Spec**: [spec.md](./spec.md)

## Summary

Three small refinements to the existing `<ProgressBar>` widget component
(built in 010-sop-workflow Phase 6, US4):

1. Increase visual prominence — bar thickness 3px → 8px.
2. Reposition inside the chat content area (below the panel header bar,
   above the messages list) instead of above the header.
3. Prefix the visible label with `"Step - "` (e.g. `Step - 3/6`).

This is a presentational change; no new entities, no new routes, no
schema changes. The whole feature is 3-4 lines of JSX/CSS edits in two
files: `packages/widget/src/components/ProgressBar.tsx` and
`packages/widget/src/components/ChatPanel.tsx`. Estimated implementation
time: ~30 minutes including tests + walk verification.

The change builds on top of the existing data flow (`useSOPState` hook +
the per-turn `x-sop-state` response header) — neither needs adjustment.

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (existing
constraint). Module is ESM. Client-side runs in the React widget.

**Primary Dependencies**: All already in scope; no new deps.
- `react` (the widget) — `useState` / `useEffect` patterns unchanged.
- `@legal-chatbot/shared` — re-exports `SOPStateHeaderPayload` already
  in use by `useSOPState`.

**Storage**: N/A — purely presentational.

**Testing**:
- The 010-era ProgressBar component test file is `[~]` deferred (T048
  from 010-sop-workflow) pending widget Vitest+jsdom infrastructure.
  012 does NOT add Vitest+jsdom; the deferred test file from 010 will
  cover the new rendering rules when it eventually runs.
- One walk-tagged Playwright spec verifies the visible refinements
  end-to-end (`tests/e2e/widget-progressbar-refinement.walk.spec.ts`).
- Manual verification via `pnpm e2e:walk` against local dev + against
  production after deploy.

**Target Platform**: modern evergreen browsers (the widget). Constitution IV
invariants inherited.

**Project Type**: Cross-cutting feature inside the existing pnpm + Turborepo
monorepo. No new workspace packages. Code lands in:
- `packages/widget/src/components/ProgressBar.tsx` — height + label edits
- `packages/widget/src/components/ChatPanel.tsx` — move the ProgressBar
  rendering location

**Performance Goals**: No measurable change. Bundle size impact < 50 bytes
(label string + minor inline style tweak). The 010 bundle-size CI gate
(when 009 R3 lands) would catch any regression; today the budget is
manually verified.

**Constraints**:
- TS strict (Constitution II).
- Widget bundle ≤ 35 KB NPM gz / ≤ 50 KB CDN gz (Constitution IV /
  product-spec §6.10).
- `prefers-reduced-motion: reduce` MUST continue to disable the fill
  animation + shimmer (existing behavior; change does not touch the
  motion logic).
- ARIA: existing `role=progressbar` + `aria-valuenow` + `aria-valuemax`
  + verbose `aria-label` MUST be preserved verbatim. The visible
  `Step - X/Y` text remains `aria-hidden="true"` (decorative); the
  screen reader announces the verbose aria-label, not the new prefix.

**Scale/Scope**: One component edit + one parent-component reposition.
~3-4 lines of code change across two files.

## Constitution Check

| # | Principle | Applicability | Compliance |
|---|---|---|---|
| I | MVP-First Discipline | Refinement of an existing 010-sop-workflow MVP component; no scope creep beyond the change request. | ✅ PASS |
| II | Type Safety & Schema-Validated Boundaries | No boundary changes. Component props (`current`, `total`, `reducedMotion`) unchanged. | ✅ PASS |
| III | Test-First, Layered Testing | One new walk-tagged Playwright spec authored before the component edit. The deferred 010 ProgressBar component test (T048) remains `[~]`; this feature does not unblock or block it. | ✅ PASS |
| IV | Serverless-Compatible & Stateless | No server-side changes. Widget bundle stays within budget (change is < 50 bytes). | ✅ PASS |
| V | Privilege & Privacy | No new data collected; no new logging; no PII surfaces. | ✅ PASS |
| VI | Bounded, Observable, Cost-Aware Agent | No agent changes. | ✅ PASS |
| VII | Phased Incremental Delivery | This is a single-phase polish on top of 010. Independently revertible by reverting the two file changes. | ✅ PASS |

**Architectural Limits**:
- Widget bundle size budget (≤ 35 KB / ≤ 50 KB gz) inherited unchanged;
  bundle delta < 50 bytes.
- ARIA accessibility surface unchanged.
- No agent / route / DB / schema changes.

**Result**: All gates PASS. No Complexity Tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/012-progressbar-refinement/
├── plan.md
├── research.md
├── quickstart.md
├── contracts/
│   └── progressbar-refinement-supplement.md   # supplements 010's progress-bar-contract.md with the rev2 height + label format
└── tasks.md                # Phase 2 — created by /speckit.tasks
```

NOT generated for this feature:
- `data-model.md` — no new entities (per spec.md "Key Entities: No new entities").

### Source Code (touchpoints)

```text
packages/widget/src/components/
├── ProgressBar.tsx                      # ⚠ EDIT — height 3px → 8px; label
│                                          format "X/Y" → "Step - X/Y";
│                                          re-tune label `top` offset to clear
│                                          the thicker bar.
└── ChatPanel.tsx                        # ⚠ EDIT — move <ProgressBar> from
                                           before-the-header to after-the-header
                                           (one block move).

packages/api/tests/e2e/
└── widget-progressbar-refinement.walk.spec.ts  # ❌ NEW — Playwright walk-tagged spec
```

**Structure Decision**: All edits inside the existing `packages/widget`
directory. NO new files in widget; one new walk spec in api. Matches
the established 010/011 pattern.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

None. All gates PASS unconditionally.
