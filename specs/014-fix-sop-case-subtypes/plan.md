# Implementation Plan: Fix SOP Case Sub-Type Chips

**Branch**: `014-fix-sop-case` | **Date**: 2026-05-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/014-fix-sop-case-subtypes/spec.md`

## Summary

Closes the gaps that caused a visitor to see case-type chips again on the
sub-type step ("What kind of DUI matter is this?" rendering DUI / Personal
Injury / Drug Crimes again). The data model, default seeds, and dashboard
case-types tab already exist (per spec 010); this feature delivers the
missing runtime, validation, and remediation layers so the visitor flow
matches the spec end-to-end.

Concretely the work is:

1. **Runtime auto-skip** (FR-003): when the captured `case_type`'s
   `sub_types` list is empty, the SOP advancer dispatches a `skip_step`
   action for the sub-type step and continues to step 3. Includes a
   coordinated change to threshold accounting so a skipped step does not
   strand the SOP below `qualified_lead_threshold` and prevent finalization.
2. **Question-text interpolation** (FR-006): server-side substitution of
   `{case_type}` → captured label inside the SOP block of the system prompt
   (and in the SOP-state header sent to the widget) so the visitor never
   sees the raw template token.
3. **Label snapshot on capture** (FR-022): extend the shared `SOPStateStep`
   with an optional `captured_label` populated by the chip matchers, so
   leads carry both the slug and the label-at-capture-time without changing
   the leads schema.
4. **Dashboard editor improvements** (FR-013, FR-015, FR-016): derive
   sub-type slugs deterministically from labels at "Add" time, add
   case-insensitive label-uniqueness validation (client + server +
   `diffCaseTypes`), and surface a warning indicator on case types whose
   sub-type list is empty.
5. **One-time existing-account remediation** (FR-011): a standalone
   `ensureDefaultSubTypesForAllAccounts` script (mirroring
   `ensure-contact-step.ts`) that fills in the default sub-types for any
   account whose case-type slug matches a default and whose sub-type list
   is empty. Customizations are never overwritten.
6. **Tests**: extend the existing skip-detector / advancer / state-machine
   unit suites; add a new walk spec covering Story 1 (visitor sees DUI
   sub-type chips after picking DUI) and Story 4 (zero-sub-types case type
   skips Step 2). Add unit coverage for the new validations and the
   remediation script's idempotency.

The defaults that the user requested ("create a list of some default sub
types within each case type configured right now in the system") are
already shipping in `seed-defaults/sop.ts:120–195` for all six default
case types (DUI, Criminal Defense, Personal Injury, Family Law, Drug
Crime, Estate Planning), each with 3–4 sub-types. No new seed values are
introduced; the remediation script just propagates the existing defaults
to accounts that were provisioned before they shipped.

Estimated implementation time: ~1 working day (plus walk-spec authoring).

## Technical Context

**Language/Version**: TypeScript strict on Node.js 20+ (ESM). All packages
in the existing pnpm + Turborepo workspace.

**Primary Dependencies** (all already in scope; no new deps):

- `drizzle-orm` + `@neondatabase/serverless` — read existing `case_types`
  / `sub_types` / `sop_steps` rows in the remediation script.
- `zod` — boundary validation for the new label-uniqueness rule on the
  POST `/api/dashboard/sop/case-types` body.
- `nanoid` — sub-type IDs in the remediation script.
- `@legal-chatbot/shared` — extend `SOPStateStep` schema with the
  optional `captured_label` field (FR-022).
- `next/server` + React — existing widget + dashboard surfaces, no new
  components.
- `iron-session` — existing dashboard auth (no change).

**Storage**: Neon PostgreSQL (production) + in-memory SQLite via
`better-sqlite3` (tests). **No new tables, no new columns.** The
`sub_types` table and the `case_types`→`sub_types` FK already exist
(`packages/api/src/db/schema.ts:158–182`). The label snapshot is added to
the in-state JSON shape (`SOPStateStep.captured_label`), which lives
inside `leads.sop_state_snapshot` and `chat_sessions.sop_state_json` —
both already `text` columns storing arbitrary JSON.

**Testing**:

- Vitest unit tests, colocated next to source:
  - `packages/api/src/lib/sop/advancer.test.ts` (extend) — empty-sub_types
    auto-skip + threshold accounting interaction.
  - `packages/api/src/lib/sop/state-machine.test.ts` (extend) — verify
    `applySkip` for the sub-type step preserves invariants.
  - `packages/api/src/lib/sop/skip-detector.test.ts` (extend) —
    `captured_label` populated on chip matches, including
    `inferCaseTypeFromSubType` path.
  - `packages/api/src/lib/sop/case-types-diff.test.ts` (extend) —
    label-uniqueness rejection, slug-from-label derivation correctness.
  - `packages/api/src/lib/sop/system-prompt-extension.test.ts` (extend)
    — `{case_type}` interpolation when a label is available, passthrough
    when not.
  - `packages/widget/src/hooks/computeActiveChips.test.ts` (extend or
    create) — empty-list returns `[]`, sub-type chips returned in the
    correct order.
  - `packages/api/src/db/ensure-default-sub-types.test.ts` (NEW) —
    idempotency, never overwrites customizations, only fills defaults.
- Playwright walk spec (NEW): `packages/api/tests/e2e/widget-sop-subtype-chips.walk.spec.ts` covering Story 1 happy path and Story 4 zero-sub-types skip.
- Playwright walk spec (extend): `packages/api/tests/e2e/sop-tabs.walk.spec.ts` — add coverage for slug-from-label derivation, label-uniqueness rejection, and empty-list warning indicator.

**Target Platform**: Same as upstream — Netlify Functions for API +
dashboard pages; modern evergreen browsers for the React widget and
dashboard. Constitution IV invariants inherited (no Server Actions, no
native binaries, CORS unchanged).

**Project Type**: Cross-cutting fix inside the existing monorepo. No new
workspace packages. Files touched:

- `packages/shared/src/schemas/sop.ts` — EXTEND `SOPStateStep` with
  optional `captured_label: string | null` field.
- `packages/api/src/lib/sop/skip-detector.ts` — populate `captured_label`
  in `matchCaseTypeChip`, `matchSubTypeChip`, and the
  `inferCaseTypeFromSubType` emission path.
- `packages/api/src/lib/sop/advancer.ts` — after captures land, detect a
  newly-completed `case_type` whose parent has zero sub-types and
  dispatch `skip_step` for the sub-type step. Coordinate threshold
  accounting (see Threshold Coordination, below).
- `packages/api/src/lib/sop/state-machine.ts` — minor: ensure
  `applySkip` increments `current_progress` when the skipped step has
  `counts_toward_threshold: true` (or, equivalently, treat skipped steps
  as fulfilled for finalization). See Threshold Coordination.
- `packages/api/src/lib/sop/system-prompt-extension.ts` — interpolate
  `{case_type}` → captured label inside the rendered SOP block.
- `packages/api/src/app/api/chat/route.ts` — surface the captured
  case-type **label** (not just slug) in the SOP-state response header
  so the widget can render the question text correctly without a second
  lookup. Optional: keep the slug too. (See Contracts.)
- `packages/api/src/lib/sop/case-types-diff.ts` — extend uniqueness
  validation to include case-insensitive label collisions per parent.
- `packages/api/src/app/api/dashboard/sop/case-types/route.ts` — extend
  Zod input schema with trimmed-non-empty label rule and the
  label-uniqueness server check (delegated to `case-types-diff.ts`).
- `packages/api/src/app/dashboard/sop/case-types-tab.tsx` — derive slug
  from label at sub-type "Add" time (single label input replaces the
  side-by-side slug+label inputs); show empty-list warning indicator on
  the case-type row when `sub_types.length === 0`; reject duplicate
  labels with an inline error.
- `packages/api/src/db/ensure-default-sub-types.ts` (NEW) — idempotent,
  per-account remediation that fills in default sub-types when the
  case-type slug matches a default and the sub-type list is empty.
- `packages/api/package.json` — add `db:ensure-default-sub-types` script
  invoking the new file via `tsx` (mirrors `db:seed` pattern).
- `packages/widget/src/hooks/computeActiveChips.ts` — no behavior change
  needed; existing logic already returns `[]` when `sub_types` is empty
  or `capturedCaseTypeSlug` doesn't resolve. Add JSDoc comment cross-
  referencing FR-003 for traceability.
- `packages/widget/src/components/ChatPanel.tsx` — no change required
  (existing `useMemo` already recomputes chips on every `sopState`
  change per FR-021).

**Performance Goals**: No measurable change. The auto-skip adds at most
one O(`steps`) lookup per visitor message. The remediation script is
out-of-band (one-time, manual). The interpolation is a single
`String.prototype.replaceAll` per system-prompt build (already cached
per turn). Bundle size: zero impact on widget (pure-render hook
unchanged); dashboard adds a small inline warning span.

**Constraints**: All Constitution IV/VI invariants preserved — no
filesystem writes, no native deps, no Server Actions, agent recursion
unchanged, token budget unchanged (interpolation does not increase
prompt size since `{case_type}` placeholder is replaced 1:1 by the
short label).

**Scale/Scope**: Single-account changes. The remediation script iterates
all accounts (today on the order of 10s; designed for 1000s). Each
account read is a small JOIN over `case_types` + `sub_types` already
covered by existing indexes (`accounts_idx`, `case_types_account_id_slug_unique`,
`sub_types_case_type_slug_unique`).


## Threshold Coordination

`qualified_lead_threshold` defaults to 6 (the count of default steps
including the contact form). Today, `applySkip` on a step does NOT count
toward `current_progress`, so if the sub-type step is skipped the SOP
plateaus at `current_progress = 5` with `threshold = 6`, never auto-
finalizes (`advancer.ts:autoFinalizeIfReady`), and the visitor never
reaches the "captured" state. Two acceptable resolutions, in order of
preference:

1. **Counted-skip** (preferred): treat a skipped step as a "completed"
   contribution toward `current_progress` when its
   `counts_toward_threshold` flag is `true`. Implemented in
   `state-machine.ts:applySkip`. Justification: from the visitor's
   perspective the step was answered (just not asked); from the
   product's perspective the lead is no less qualified than one whose
   sub-type was captured. This is the same accounting decision used for
   out-of-scope finalization (which short-circuits to `is_finalized`
   regardless of `current_progress`). Existing tests for `applySkip`
   need to be updated to assert the new progress increment.

2. **Threshold-decrement**: when `skip_step` fires, decrement
   `qualified_lead_threshold` by 1 (capped at the visible required step
   count). Slightly more invasive because `qualified_lead_threshold` is
   today an immutable property of the published SOP configuration; this
   would require carrying the "effective threshold" in `SOPState`.

This plan adopts option 1. The `counts_toward_threshold` flag is already
exposed on `sop_steps` (`schema.ts`) and on the seeded defaults
(`seed-defaults/sop.ts:34, 46`), so the change is local to
`state-machine.ts:applySkip` plus its tests. No schema migration.

## Constitution Check

| Principle | Applies? | Compliance |
|-----------|----------|------------|
| **I. MVP-First Discipline** | Yes — bug fix on existing 010 SOP feature. | ✅ Implements §10 SOP intake correctness; no new scope beyond the spec. No payment / CRM / multi-tenant-auth / nice-to-haves added. |
| **II. Type Safety & Schema-Validated Boundaries** | Yes — new `captured_label` field on `SOPStateStep`, new label-uniqueness validation, new POST body shape. | ✅ Field added to shared Zod schema (`packages/shared/src/schemas/sop.ts`) and consumed by both API and widget. Boundary validation extended in `case-types-diff.ts` and route-handler Zod input. No raw SQL. No type duplication. |
| **III. Test-First, Layered Testing** | Yes — production code changes. | ✅ Plan calls for failing tests authored first per surface: skip-detector unit (label snapshot), advancer unit (auto-skip + threshold), state-machine unit (`applySkip` progress), case-types-diff unit (label uniqueness), system-prompt-extension unit (interpolation), `ensure-default-sub-types` unit (idempotency), widget hook unit (empty-list), Playwright walk spec for Story 1 + Story 4. CI gates: `tsc --noEmit`, `eslint`, `vitest run`, `turbo build` all required. E2E walk on merge to `main`. |
| **IV. Serverless-Compatible & Stateless Server** | Yes — touches API package. | ✅ No Server Actions added (mutations stay in `POST /api/dashboard/sop/case-types`). No native deps. No filesystem writes. CORS unchanged. Widget bundle untouched (zero-byte impact). |
| **V. Privilege, Privacy, Data-Boundary** | Yes — touches lead snapshot and system prompt. | ✅ The `captured_label` snapshot stays inside `leads.sop_state_snapshot` (lawyer-owned PII space) and is not written to the lawyer's read-only context store. Captured label is just the public sub-type name (e.g., "Car Accident") — no PII added. System prompt continues to instruct the LLM never to reveal internals (§11.2). No new logging surfaces. |
| **VI. Bounded, Observable, Cost-Aware Agent** | Yes — system prompt content changes. | ✅ Interpolation reduces or preserves prompt size (replaces a 12-char placeholder with a ≤30-char label). No new tools. `maxSteps` unchanged. Token budget unchanged. Existing per-turn structured logging is preserved; the new auto-skip emits no additional log lines. |
| **VII. Phased Incremental Delivery** | Yes — operates inside Phase 5 (Lead Classification + DB) / Phase 7 (010 SOP) deliverables. | ✅ Bug fix that completes 010-sop-workflow's stated FRs (FR-007, FR-008, FR-009, FR-011, FR-051). Independently demoable: visitor walks SOP end-to-end with correct sub-type chips. Pre-existing test suite continues to pass. |

**Verdict**: All gates pass. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/014-fix-sop-case-subtypes/
├── plan.md              # This file
├── spec.md              # Feature spec (already authored)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (state-shape extension only)
├── quickstart.md        # Phase 1 output (manual verification steps)
├── contracts/
│   ├── sop-state-header.md       # Phase 1 — chat response header shape
│   └── case-types-api.md         # Phase 1 — POST /api/dashboard/sop/case-types body
├── checklists/
│   └── requirements.md  # Already passing
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
packages/
├── shared/
│   └── src/
│       └── schemas/
│           └── sop.ts                        # EXTEND: SOPStateStep adds captured_label
├── api/
│   ├── drizzle/                              # No new migration (state-shape change is JSON-resident)
│   ├── src/
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── chat/
│   │   │   │   │   └── route.ts              # EXTEND: header surfaces captured_case_type_label
│   │   │   │   └── dashboard/
│   │   │   │       └── sop/
│   │   │   │           └── case-types/
│   │   │   │               └── route.ts      # EXTEND: trimmed-label + label-uniqueness Zod
│   │   │   └── dashboard/
│   │   │       └── sop/
│   │   │           └── case-types-tab.tsx    # EDIT: slug-from-label, warning, label uniqueness
│   │   ├── db/
│   │   │   └── ensure-default-sub-types.ts   # NEW: idempotent remediation
│   │   └── lib/
│   │       └── sop/
│   │           ├── advancer.ts                       # EDIT: empty-sub_types auto-skip
│   │           ├── advancer.test.ts                  # EXTEND
│   │           ├── case-types-diff.ts                # EDIT: label uniqueness
│   │           ├── case-types-diff.test.ts           # EXTEND
│   │           ├── skip-detector.ts                  # EDIT: populate captured_label
│   │           ├── skip-detector.test.ts             # EXTEND
│   │           ├── state-machine.ts                  # EDIT: applySkip threshold accounting
│   │           ├── state-machine.test.ts             # EXTEND
│   │           ├── system-prompt-extension.ts        # EDIT: {case_type} interpolation
│   │           └── system-prompt-extension.test.ts   # EXTEND
│   ├── tests/
│   │   └── e2e/
│   │       ├── sop-tabs.walk.spec.ts                  # EXTEND
│   │       └── widget-sop-subtype-chips.walk.spec.ts  # NEW
│   └── package.json                                   # EDIT: add db:ensure-default-sub-types script
└── widget/
    └── src/
        └── hooks/
            ├── computeActiveChips.ts          # EDIT: JSDoc only (FR-003 cross-ref)
            └── computeActiveChips.test.ts     # EXTEND (or NEW if missing)
```

**Structure Decision**: This is a cross-cutting fix inside the existing
monorepo. No new workspace packages. The bulk of the work lands in
`packages/api/src/lib/sop/` (runtime + validation), with a one-line state-
shape change in `packages/shared/src/schemas/sop.ts` and a UI refinement
in `packages/api/src/app/dashboard/sop/case-types-tab.tsx`. Default seed
data is unchanged; remediation is a separate idempotent script following
the `ensure-contact-step.ts` precedent.

## Complexity Tracking

> No Constitution violations require justification.

