# legal-chatbot — Resume Recap

Generated read-only from git, specs/, and code. Last commit: **2026-07-06** (`b90e853`, on `main`, equal to `origin/main`). No stashes. Only branch besides main: `origin/017-chatbot-redesign`.

## 1. Purpose & stack
Embeddable AI intake / lead-qualification chatbot for law firms ("LexBot"). Widget on the firm's site → Next.js API (Gemini agent over firm knowledge + SOP step workflow) → leads + transcripts in Postgres → firm dashboard. (`README.md`, `product-spec-legal-chatbot.md`)

pnpm + turbo monorepo (`packages/`): `api` (Next 15, React 19, Tailwind 4, Drizzle 0.40, Neon serverless PG, iron-session, Vercel AI SDK v4 with google/anthropic/openai providers, Resend, bcryptjs, dnd-kit), `widget` (React/Vite), `shared` (Zod), `crawler` (Cheerio/Playwright), `dashboard` (dir exists; the live dashboard is inside `api/src/app/dashboard`). Tests: Vitest with in-memory SQLite mirror schema (`db/test-schema.ts`) + Playwright "walk" E2E. Deploy: Netlify (README), plus `vpc-setup/` (VPC/agent-deploy scripts, untracked). `CLAUDE.md` is just a Speckit pointer to `specs/027-platform-admin-console/plan.md`.

## 2. Feature / spec status
Task-checkbox state from `specs/*/tasks.md` (numbering is inconsistent: many early specs use other markers, so "tasks unchecked" is not reliable for them).

| Spec | Topic | Status |
|---|---|---|
| 001–009 | foundation, crawler, search, chat agent, widget, lead classification, dashboard, hardening, deployment | Shipped (tasks.md for 009: 95 unchecked boxes, but later work clearly built on it – stale checklist) |
| 010–016 | SOP workflow, preflight phrase, progress bar, lead action tracking, sub-type fix, classification revamp, multi-branch SOP | Shipped; checkbox lists stale (010: 24 open, 014: 38, 015: 66) |
| 017 | chatbot redesign | tasks 8 open; branch `origin/017-chatbot-redesign` still exists |
| 018–020 | remove multi-answer, remove practice areas, branch CSV import | Done (all boxes checked) |
| 021–025 | chat latency (3 open), version-history UI, widget redesign, attorney routing, case-value estimator | Shipped per git; no `[X]` markers |
| 026 | conversation rollback | **No `specs/026-*` dir**; design/plan only as *untracked* `docs/superpowers/{specs,plans}/2026-07-04-conversation-rollback*`. Code is committed (undo route, widget server-side undo, migration 0009). |
| **027** | **platform admin console** | **62/63 tasks checked.** Only open: **T062** (run quickstart scenarios 1–6 end-to-end – never executed, needed live Neon+server+keys). |
| (no spec) | Onboarding redesign (3-step wizard, sub-type attorney assignment, domain, autosave+resume, migrations 0011/0012) | Implemented, documented only in `docs/superpowers/{specs,plans}/2026-07-05-onboarding-redesign*`, `2026-07-06-onboarding-autosave.md` |

Recent history (all 2026-07-04→06): rollback → admin console (one big commit `7cc8970`, 97 files/7.5k lines) → onboarding redesign → onboarding autosave/resume (last).

## 3. Admin module — exact state
**Built (backend, solid):** separate super-admin iron-session (`lib/admin-session.ts`, cookie `legal_chatbot_admin`, `ADMIN_SESSION_SECRET`), `lib/admin-guard.ts` (`requireSuperAdmin`), audit log (`lib/admin/audit.ts`), AES-256-GCM key encryption (`lib/crypto.ts`), central env (`lib/env.ts`), provider resolver w/ Gemini fallback and 60s cache (`lib/llm/provider-resolver.ts`, now used in `api/chat/route.ts`), usage capture (`lib/usage.ts`, `usage_events`), pricing (`shared/constants/llm-pricing.ts`), fleet/metrics/sop-view aggregators (`lib/admin/{fleet,metrics,sop-view,tenant-provisioning,pricing}.ts`), tenant provisioning (`db/provision-tenant.ts`), `db/seed-super-admin.ts`. New tables `super_admins, account_llm_config, usage_events, admin_audit_log` + account columns (migration 0010; 0011 domain/sub-type assignment; 0012 `onboarding_draft_json`).
Routes under `packages/api/src/app/api/admin/`: `login`, `logout`, `tenants` (GET list/POST create), `tenants/[id]` (GET/DELETE soft-delete+archive), `/onboarding` (GET draft / PUT save|finish), `/publish`, `/llm-config` (GET/PUT), `/metrics`, `/sop-view`, `/status` (PATCH suspend/reactivate), `/rotate-key`. Tests alongside (login, tenants list/create/onboarding/lifecycle/llm-config/metrics, crypto, resolver, secret-leakage, sop-view). Shared Zod DTOs: `shared/src/schemas/{admin,llm-config}.ts`. Contracts in `specs/027-*/contracts/*.md`.

**UI that exists (tiny: ~740 lines total, `packages/api/src/app/admin/`):**
| File | Lines | What |
|---|---|---|
| `login/page.tsx` | 71 | login form (outside guarded group) |
| `(console)/layout.tsx`, `sidebar.tsx` | 24/48 | guard + sidebar |
| `(console)/page.tsx` | 58 | fleet table (firm/status/onboarding/leads 30d/spend/last activity) – plain text status, no filters/search/sort/pagination |
| `(console)/tenants/new/page.tsx` | 77 | register + one-time key |
| `(console)/tenants/[id]/page.tsx` | 80 | detail = header text line + 4 link buttons + suspend/rotate/delete; `confirm()` dialogs; no data beyond status |
| `…/onboarding/{page,case-matrix,attorneys-step}.tsx` | 80/36/42 | 3-step wizard w/ silent autosave & draft hydrate |
| `…/llm/page.tsx` | 88 | provider/model/key form |
| `…/metrics/page.tsx` | 54 | stat cards only, fixed 30d, no charts, no window selector (API supports `window`) |
| `…/sop/page.tsx` | 82 | read-only list of steps (not a diagram, despite T051 mention of FLOW.md/diagrams) |
Styling: inline `style={{color:'var(--color-…)'}}` + shared `.btn`/`.btn-primary` classes in `app/globals.css` (shared with the firm dashboard); **no component library, no shared admin components dir** (`packages/api/src/components` doesn't exist), no toasts/loading skeletons/error states (several pages `fetch` and ignore failures), full-page `window.location.href` navigation, mixed client-fetch vs server-component pages.

**Incomplete / unverified:**
- T062 quickstart never run; E2E `tests/e2e/admin-console.walk.spec.ts` authored but "skips" without a live server + seeded super-admin; never recorded as passing.
- Before the onboarding rework, the spec'd wizard was 5 steps (identity→case types→persona→contact→escalation) with a *placeholder* case-types step; redesign replaced it (persona/tone/greeting/etc. now defaults, "editable later in firm dashboard"). Spec 027 `spec.md`/`tasks.md` T033 are now out of date vs. the 3-step reality.
- Whether migrations 0010–0012 are applied to the target Neon DB: docs claim 0011 applied; 0012 status unknown. `db:migrate` was never run in the original build env.
- Metrics lack time-series ("usage/cost over time" in T047 is only totals); SOP "diagram" is a list.

**Evidence the UI was unsatisfactory (honest note):** there is *no written note* of your dissatisfaction in the repo (no issue, TODO, or doc says "rework"). Circumstantial evidence only: (a) the only UI feedback captured is in `docs/superpowers/specs/2026-07-05-onboarding-redesign-design.md` ("placeholder case-types step… abrupt per-step 'Saving…' state… streamline"), which led to patching the wizard within a day, (b) the UI is a thin scaffold written in one commit with inline styles, (c) T062/E2E manual verification was never done, (d) the untracked `new-design/` mockups (chat-icon, initial-state, mid-chat PNGs) and `.claude/worktrees/022-session-history-restore` show design exploration, though those relate to the widget, not admin. Treat the dissatisfaction as your recollection; the concrete weaknesses are those listed above.

## 4. Uncommitted / WIP
`git status` (nothing staged):
- Modified `.specify/*` (init-options, integration.json, registry, 3 bash scripts – the scripts are likely **mode-only changes**, `0` line diff).
- Untracked: `.claude/` (settings.local.json, skills, worktrees/022-session-history-restore), `.specify/extensions/agent-context/`, `.specify/integrations/claude.manifest.json`, `docs/superpowers/{plans,specs}/2026-07-04-conversation-rollback*` (should be committed), `new-design/` (mockups), `vpc-setup/` (deploy scripts + runbook), `packages/api/src/lib/sop/FLOW.md` and `sop/diagrams/*.svg` (referenced by T051 – never committed), `packages/api/src/db/debug-lead-scores.ts`, `packages/api/src/app/api/chat/undo/route.ts.bak` (delete), and **`cookie.txt` (contains a live-format iron-session cookie for localhost – delete; not gitignored)**.
No unpushed commits, no stashes.

## 5. Tech debt & rot risks
- **Dependencies use `^` ranges after months; lockfile pins old versions.** Expect drift in: Next 15.x (security patches – update), `ai` v4 / `@ai-sdk/*` 1.x (v5 is current; model IDs/pricing like `gemini-2.5-flash`, Claude/OpenAI allow-list in `shared/schemas/llm-config.ts` and `constants/llm-pricing.ts` may be deprecated/retired), Drizzle 0.40/drizzle-kit 0.30, Playwright 1.60, Tailwind 4.3, iron-session 8, Zod 3 (v4 out). Run `pnpm install && pnpm -r typecheck && pnpm -r test` first; `pnpm outdated`.
- Provider model allow-list + price map are hard-coded constants – likely stale.
- Two test schemas to maintain by hand (Postgres `schema.ts` vs SQLite `test-schema.ts` + per-test DDL) – easy to drift; every migration touched ~10 tests.
- Migrations: 0009 was regenerated once (journal fixes); verify journal vs. Neon state (`__drizzle_migrations`).
- Secrets/env: new required env vars (`ADMIN_SESSION_SECRET`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) fail-fast in `lib/env.ts`; confirm they exist in Netlify/.env. Losing `ENCRYPTION_KEY` makes stored tenant LLM keys unreadable; no rotation story.
- `packages/dashboard` dir vs dashboard inside api – check for dead code. Many `debug-*.ts` scripts in `src/db`.
- Stale spec checkboxes (009, 010, 014, 015, 017, 021) and missing spec dir for 026 / onboarding.
- Admin: `confirm()` + `window.location` + silent failures; no pagination (list limited?), no rate limiting on `/api/admin/login`, no CSRF beyond cookie settings, suspended tenants' chat only blocked via key revocation.
- Widget CORS is wildcard by constitution; `accounts.domain` is display-only.

## 6. Recommended admin UI rework
**Keep (contracts/back end – don't touch):** all `/api/admin/*` routes and their Zod DTOs in `shared/src/schemas/admin.ts` + `llm-config.ts`; auth (`admin-session`, `admin-guard`); `lib/admin/*` aggregators; migrations/tables; semantics: key shown once, `llm-config` GET returns `hasKey` never the key, soft-delete with archive, onboarding PUT `{firmIdentity, caseTypeSelection, attorneys, finish}` + GET `{draft}` and POST publish; metrics `?window=`. Existing route/unit tests are your regression net.
**Replace (all of `src/app/admin/**`, ~740 lines):**
1. Shell: layout/sidebar/login → real admin layout, breadcrumbs, tenant sub-nav (tabs: Overview, Onboarding, LLM, Metrics, SOP, Settings).
2. Fleet list → searchable/sortable/filterable table with status badges, pagination, empty/loading states.
3. Register tenant + one-time key reveal → reusable `SecretReveal` (copy, acknowledge) also used for rotate-key.
4. Tenant detail → real overview (status, key state, LLM summary, onboarding progress, recent audit entries – the audit log has no read endpoint yet) + lifecycle in a "danger zone" with proper modal confirms (type-to-confirm delete).
5. Onboarding wizard (page, case-matrix, attorneys-step) → keep the 3-step flow/contract; redo visuals, validation, per-field errors, save indicator, review step.
6. LLM config → form with validation against allow-list (served from shared), test-connection (new optional endpoint), write-only key UX.
7. Metrics → window selector (7/30/90d), charts for funnel/cost over time (needs time-bucketed endpoint addition).
8. SOP view → real flow diagram (reuse `lib/sop/diagrams/*.svg` + `FLOW.md`), still read-only.
**First steps:**
1. Housekeeping: commit/delete the untracked items (esp. remove `cookie.txt`, `.bak`); commit rollback docs.
2. `pnpm install`, typecheck, vitest, `next build`; update deps conservatively; verify migrations 0010–0012 on a dev Neon/branch; seed super-admin; finally run quickstart (T062) to baseline current behaviour and capture screenshots of each page.
3. Write the actual complaints into a new spec (e.g. `specs/028-admin-ui-rework/`: list screens, personas, acceptance) — this is the missing artifact; also bring 027 spec/tasks in line with the 3-step wizard.
4. Decide design system: Tailwind 4 is present; add shadcn/ui (Radix) + a small `components/admin/` kit rather than inline styles; don't reuse global `.btn` classes that also style the firm dashboard.
5. Build shell + fleet list first (vertical slice), then detail → onboarding → LLM → metrics → SOP, replacing page by page behind existing URLs; extend/replace `tests/e2e/admin-console.walk.spec.ts` with a Playwright path per screen.
6. Small backend additions only if needed: audit-log read endpoint, metrics time series, paginated/filterable tenants list.
