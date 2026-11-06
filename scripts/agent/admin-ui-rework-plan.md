# Admin UI Rework — 028

## Scope

**Scrap all UI files** under `packages/api/src/app/admin/` (~740 lines, 12 files).  
**Keep every backend route, lib, schema, test, and DB migration** untouched.

## What we're building

A modern enterprise admin console using:
- **Next 15 App Router** (Route Groups, Server Components, Client Islands)
- **Tailwind v4** (already configured)
- **shadcn/ui** (Radix-based accessible components, Tailwind v4 compatible)
- Existing custom CSS vars (`--color-accent`, `--color-surface`, etc.)

## Architecture

```
app/admin/
├── login/page.tsx               # Server component, links to existing /api/admin/login
├── (console)/
│   ├── layout.tsx               # Guard + sidebar (KEEP guard logic, REPLACE layout)
│   ├── sidebar.tsx              # New sidebar with nav links + active state
│   ├── page.tsx                 # Fleet overview (DataTable with search/sort/pagination)
│   ├── tenants/
│   │   ├── new/page.tsx         # Register tenant + one-time key reveal
│   │   └── [id]/
│   │       ├── page.tsx         # Tenant detail dashboard
│   │       ├── onboarding/
│   │       │   ├── page.tsx
│   │       │   ├── attorneys-step.tsx
│   │       │   └── case-matrix.tsx
│   │       ├── llm/page.tsx
│   │       ├── metrics/page.tsx
│   │       └── sop/page.tsx

components/admin/
├── data-table.tsx               # Reusable table with search/sort/pagination
├── stats-card.tsx               # Dashboard stats card
├── status-badge.tsx             # Tenant status badge
├── confirm-dialog.tsx           # Modal confirmation (replaces confirm())
├── toast.tsx                    # Toast notifications
├── page-header.tsx              # Page title + actions bar
├── loading-skeleton.tsx         # Loading states
└── empty-state.tsx              # Empty/error states
```

## Build order

| Step | What | Depends on |
|------|------|-----------|
| 1 | Install shadcn/ui, create component scaffold | Nothing |
| 2 | **Login page** — polished login, reuses existing auth | Step 1 |
| 3 | **Layout + sidebar** — guard copy, new sidebar design | Step 1 |
| 4 | **Fleet overview** — table with search/sort/pagination | Step 1, 3 |
| 5 | **Tenant detail** — data display + lifecycle actions | Step 1, 3 |
| 6 | **LLM config** — provider/model form | Step 1, 3 |
| 7 | **Metrics** — stats cards + chart | Step 1, 3 |
| 8 | **Register tenant** — form + key reveal | Step 1, 3 |
| 9 | **SOP view** — flow visualization | Step 1, 3 |
| 10 | **Onboarding wizard** — 3-step wizard | Step 1, 3 |