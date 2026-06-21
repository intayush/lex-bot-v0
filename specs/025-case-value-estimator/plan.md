# Implementation Plan: Case Value Estimator

**Branch**: `025-case-value-estimator` | **Date**: 2026-06-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/025-case-value-estimator/spec.md`

## Summary

Add a case value estimator to the branch configuration system. Lawyers define score-band-to-dollar-range mappings per branch (e.g. score 76–100 → $75K–$250K for Car Accident). When a lead is scored, its value range is resolved at read-time by matching the lead score against the active branch version's value bands and surfaced as a badge in the Leads dashboard. Configuration ships in four places: branch editor UI, CSV import, seed script, and a case-type-level on/off toggle.

**Architecture decision**: Case value config is stored in a new `case_value_config_json` column on `branch_versions` (versioned alongside questions/thresholds). The case-type-level toggle lives on `branches` as `is_case_value_enabled`. The lead value badge is **computed at read-time** — no new columns on the `leads` table. This keeps lead records immutable and ensures the badge always reflects the current published configuration.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 20+

**Primary Dependencies**: Next.js 15.3, Drizzle ORM, Zod, `@neondatabase/serverless`. No new npm packages.

**Storage**: Neon PostgreSQL.
- `branch_versions`: add `case_value_config_json` (nullable text, JSON-encoded `CaseValueConfig`)
- `branches`: add `is_case_value_enabled` (boolean, default false)

**Testing**: Vitest (unit). New unit tests cover: band matching logic, CSV parsing for case value columns, seed validation.

**Target Platform**: Netlify Functions running Next.js 15. Dashboard-only — widget untouched.

**Project Type**: pnpm + Turborepo monorepo. Touches `packages/api` and `packages/shared` (new Zod schema for `CaseValueConfig`).

**Performance Goals**: Lead badge resolution adds ≤1 DB query to the leads page load (one lookup per account for the active branch version map). Under 500ms total for 100 leads.

**Constraints**:
- `case_value_config_json` is nullable — existing branch versions are unaffected.
- Badge is derived at read-time from `branch_versions.case_value_config_json` — no writes to `leads`.
- Constitution VI: no agent tools modified, no `maxSteps` change.
- Seed validation runs at module load (existing pattern) — new seed data must pass Zod schemas.

**Scale/Scope**: `packages/api` (schema, seed, routes, UI) + `packages/shared` (new schema type). `packages/widget` untouched.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline (NON-NEGOTIABLE) | ✅ PASS | US1 (config) + US2 (badge) are the MVP. US3 (CSV) and US4 (seed) are additive P2 items. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | `CaseValueConfig` and `CaseValueBand` are new Zod schemas in `packages/shared`. All API routes validate via Zod. |
| III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE) | ✅ PASS | Unit tests for band-matching logic and CSV parsing. Seed data validated by existing Zod module-load guard. |
| IV. Serverless-Compatible & Stateless Server Architecture | ✅ PASS | No background jobs. Badge resolution is a synchronous DB query at page load. |
| V. Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE) | ✅ PASS | Case value config is scoped to `account_id` via branch ownership. Never exposed to widget or visitors. |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | No agent tools, `maxSteps`, or token budget changes. |
| VII. Phased Incremental Delivery | ✅ PASS | US1+US2 ship as MVP; US3+US4 follow. |

**Result**: PASS on all seven principles.

## Project Structure

### Documentation (this feature)

```text
specs/025-case-value-estimator/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── contracts/
│   ├── case-value-config-api.md
│   └── leads-api-extension.md
├── quickstart.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/shared/src/schemas/
└── branch.ts                           # EDIT: add CaseValueBand + CaseValueConfig Zod schemas + types

packages/api/src/
├── db/
│   ├── schema.ts                       # EDIT: add case_value_config_json to branch_versions; is_case_value_enabled to branches
│   ├── test-schema.ts                  # EDIT: mirror production schema
│   └── seed-defaults/
│       └── branches.ts                 # EDIT: add case value config to PI branches (car_accident, slip_fall, medical_malpractice, dog_bite)
├── lib/
│   ├── branch-csv.ts                   # EDIT: parse optional case value columns; extend template generation
│   └── case-value.ts                   # NEW: resolveCaseValueBadge(leadScore, caseValueConfig) → string | null
├── app/
│   ├── api/
│   │   └── dashboard/
│   │       └── branches/
│   │           └── [caseType]/
│   │               └── [subType]/
│   │                   └── handler.ts  # EDIT: include case_value_config in GET/save/publish/rollback
│   └── dashboard/
│       ├── sop/
│       │   └── branch-editor.tsx       # EDIT: add case value config section + is_case_value_enabled toggle
│       └── leads/
│           └── lead-table.tsx          # EDIT: add value badge column derived from lead score + branch config
└── drizzle/                            # NEW: migration for two new columns
```

## Complexity Tracking

> No Constitution violations. No new npm packages. Schema changes are purely additive (nullable column + boolean with default).

---

## Phase 0 — Research

See [research.md](./research.md).

**R1 — Storage location for case value config**
- Decision: `case_value_config_json` (nullable) on `branch_versions`. Versioned alongside questions/thresholds — rollback restores value config automatically. No new table needed.
- Alternative considered: separate `branch_case_value_bands` table — rejected (adds join complexity; versioning would require linking to branch_versions anyway; JSON column on the version row is the established pattern here).

**R2 — Case-type-level toggle**
- Decision: `is_case_value_enabled` boolean on `branches` table (default false). This is the per-account, per-case-type+sub-type on/off switch that enables/disables the badge. Separate from the per-version config so toggling off doesn't lose configured bands.
- Alternative: `is_case_value_enabled` inside the JSON config — rejected (toggles should be queryable without parsing JSON).

**R3 — Lead badge computation**
- Decision: Computed at read-time in the leads page server component. The leads query joins against the active branch version for each lead's case type. No `case_value_min/max` written to `leads`.
- Alternative: Write computed values to `leads` table on finalization — rejected (would go stale if config is updated; requires backfill; violates "leads are immutable records" principle).

**R4 — CSV case value columns**
- Decision: Add five optional columns at the document level (not per-row): `case_value_enabled`, `case_value_score_min`, `case_value_score_max`, `case_value_min_usd`, `case_value_max_usd`. Multiple bands represented by multiple rows with the same `case_value_score_min/max` group — actually, simpler: separate rows with band index. See contracts for exact format.
- Final decision: Case value bands in CSV are represented as separate rows after all question rows, with a special `question_position` value of `0` or a dedicated section marker. **Revised**: use additional columns appended to any row where `question_position = 1, chip_slug = _case_value_band_N`. This is too fragile. **Final**: add a completely separate CSV section with a `[CASE_VALUE]` header marker, parsed independently of question rows.

**R5 — Badge display format**
- Decision: Format as "$[X]K – $[Y]K" with K/M suffix for values ≥ 1000. Rendered as a small pill badge on the lead row, positioned after the classification badge. Color: green tint (#ECFDF5 / #059669) to signal opportunity value.

---

## Phase 1 — Design

### Data Model

See [data-model.md](./data-model.md).

New Zod schema in `packages/shared`:
- `CaseValueBand`: `{ score_min, score_max, value_min_usd, value_max_usd, position }`
- `CaseValueConfig`: `{ bands: CaseValueBand[] }`

Schema changes:
- `branch_versions.case_value_config_json` — nullable text, stores `CaseValueConfig | null`
- `branches.is_case_value_enabled` — boolean, default false

### Contracts

See `contracts/`:
- `contracts/case-value-config-api.md` — Branch API changes (GET includes config, save/publish accepts config)
- `contracts/leads-api-extension.md` — Leads page badge derivation logic

### Quickstart

See [quickstart.md](./quickstart.md). Steps: seed → open branches → verify config → capture lead → verify badge.

### Agent Context Update

`CLAUDE.md` updated to reference `specs/025-case-value-estimator/plan.md`.
