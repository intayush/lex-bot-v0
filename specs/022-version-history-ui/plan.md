# Implementation Plan: Version History UI

**Branch**: `022-version-history-ui` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-version-history-ui/spec.md`

## Summary

Add version history panels to the Configuration and SOP dashboard pages so lawyers can browse all saved versions, give them human-readable labels, and restore any past version as a new draft. The SOP backend already has a `GET /api/dashboard/sop` history response and a `POST action: 'rollback'` handler — only the UI is missing for SOP. Config needs both a new `GET` history endpoint and a restore action added to its `POST` handler. A single Drizzle migration adds a `label` column to both `configurations` and `sop_configurations` and adds the missing unique constraint on `(account_id, version)` to `configurations`.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js 20+

**Primary Dependencies**: Next.js 15.3 (App Router, Server + Client Components), Drizzle ORM (`drizzle-orm/neon-http`), `@neondatabase/serverless`, React 19

**Storage**: Neon serverless PostgreSQL. Two tables modified: `configurations` (add `label` column + unique constraint), `sop_configurations` (add `label` column). Child table `sopSteps` is duplicated during SOP restore — already done by the existing `action: 'rollback'` handler.

**Testing**: Vitest (unit + integration), Playwright (e2e walks). New unit tests cover the config restore route handler and the label-update endpoint. E2e walk covers the full restore flow for both config and SOP.

**Target Platform**: Netlify Functions running Next.js 15. Dashboard pages only — widget is untouched.

**Project Type**: pnpm + Turborepo monorepo. This feature touches `packages/api` only.

**Performance Goals**: Version history list renders within 500ms. Restore operation completes within 3 seconds (SC-003).

**Constraints**: Append-only versioning — restoring must never overwrite historical rows (FR-014). Labels are optional and mutable without creating a new version. The `configurations` unique constraint on `(account_id, version)` must be added safely (no existing duplicates in production; seed always starts fresh).

**Scale/Scope**: Dashboard-only; no widget changes. Config and SOP version histories are independent. Maximum ~100 versions per account in practice.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. MVP-First Discipline (NON-NEGOTIABLE) | ✅ PASS | Both P1 user stories (US1 config restore, US2 SOP restore) are the minimum viable scope. US3 (labels) is P2 and deferred until US1+US2 are green. The SOP backend is already 80% done — this is low-risk incremental work. |
| II. Type Safety & Schema-Validated Boundaries | ✅ PASS | All new API routes use Zod for request validation. The new `label` column is `text nullable` — no schema-level constraint on content beyond the route-layer 80-char check. |
| III. Test-First, Layered Testing Strategy (NON-NEGOTIABLE) | ✅ PASS | Unit tests for config restore route (new logic); unit tests for label update route; one e2e walk covering the restore golden path for both config and SOP. Tests are written before implementation per Constitution III. |
| IV. Serverless-Compatible & Stateless Server Architecture | ✅ PASS | No background jobs, no server state. Restore is a single synchronous DB write (INSERT + child row duplication for SOP). Label update is a single UPDATE. Both are serverless-safe. |
| V. Privilege, Privacy, and Data-Boundary Integrity (NON-NEGOTIABLE) | ✅ PASS | All version history endpoints require dashboard auth session. `account_id` is always derived from the session, never from user input. No cross-account bleed possible. |
| VI. Bounded, Observable, Cost-Aware Agent | ✅ PASS | No agent tools added, removed, or modified. `maxSteps` unchanged. No LLM calls in version history flow. |
| VII. Phased Incremental Delivery | ✅ PASS | US1 (config restore) and US2 (SOP restore) are independently deliverable. US3 (labels) can ship after. |

**Result**: PASS on all seven principles.

## Project Structure

### Documentation (this feature)

```text
specs/022-version-history-ui/
├── plan.md              # This file
├── spec.md              # Spec
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── config-history-api.md
│   └── sop-history-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
packages/api/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   └── dashboard/
│   │   │       ├── config/
│   │   │       │   └── route.ts          # EDIT: add GET history + POST restore action
│   │   │       └── sop/
│   │   │           └── route.ts          # EDIT: expose label column in GET, add label update
│   │   └── dashboard/
│   │       ├── config/
│   │       │   ├── page.tsx              # EDIT: pass history to ConfigForm
│   │       │   ├── config-form.tsx       # EDIT: add VersionHistory panel
│   │       │   └── version-history.tsx   # NEW: shared VersionHistory client component
│   │       └── sop/
│   │           ├── page.tsx              # EDIT: pass history to SopEditor
│   │           └── sop-editor.tsx        # EDIT: add VersionHistory panel (tab or sidebar)
│   ├── db/
│   │   ├── schema.ts                     # EDIT: add label column + unique constraint
│   │   └── migrations/                   # NEW: migration adding label + constraint
│   └── lib/
│       └── config.ts                     # EDIT: expose getConfigHistory(accountId)
└── tests/
    └── e2e/
        └── config-version-restore.walk.spec.ts   # NEW: e2e walk for restore flow
```

**Structure Decision**: Dashboard-only change. All edits are inside `packages/api`. The new `VersionHistory` component is shared between config and SOP pages. The SOP restore backend path already exists (`action: 'rollback'`); config restore is the main new backend work.

## Complexity Tracking

> No Constitution Check violations.

---

## Phase 0 — Research

See [research.md](./research.md) for the full write-up. Key decisions:

- **R1**: Config restore reuses the same `SELECT config_json → INSERT new row` pattern as SOP rollback. No new abstraction needed.
- **R2**: Labels are a nullable `text` column on both `configurations` and `sop_configurations`. No separate label table. Label is mutable in-place (UPDATE) without incrementing version.
- **R3**: `configurations` needs `uniqueIndex('configurations_account_version_unique')` added. No existing duplicates in the Neon dev DB (seed always deletes and re-inserts from version 1).
- **R4**: SOP restore (`action: 'rollback'`) already duplicates `sopSteps`. Case types, goodbye phrases, and branches are account-scoped and do NOT need duplication.
- **R5**: The config GET route does not exist yet. A new `GET /api/dashboard/config` handler returns `{ versions: ConfigVersionSummary[] }`.
- **R6**: UI pattern: a collapsible "Version History" sidebar panel below the editor form, matching the existing page's 3-column layout. Version list rows: version number, label, date, status badge, Restore button.

---

## Phase 1 — Design

### Data Model

See [data-model.md](./data-model.md). Two existing tables gain one new column each:

| Table | New column | Type | Notes |
|-------|-----------|------|-------|
| `configurations` | `label` | `text nullable` | Human-readable name, max 80 chars enforced at route layer |
| `configurations` | — | unique index | `(account_id, version)` — matches existing SOP constraint |
| `sop_configurations` | `label` | `text nullable` | Same semantics as config label |

No new tables. Migration is additive (nullable column + unique index) — safe to apply without downtime.

### Contracts

See `contracts/` — two short contract docs:

- `contracts/config-history-api.md` — GET `/api/dashboard/config` response shape; POST `action: 'restore'` request/response; PATCH `/api/dashboard/config/label` request/response.
- `contracts/sop-history-api.md` — GET `/api/dashboard/sop` updated shape (adds `label` to each history entry); PATCH `/api/dashboard/sop/label` contract.

### Quickstart

See [quickstart.md](./quickstart.md). Validation steps: seed DB, save 3 config versions, verify history list, click Restore, confirm new draft, publish, confirm new entry in history.

### Agent Context Update

`CLAUDE.md` between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers updated to point to `specs/022-version-history-ui/plan.md`.
