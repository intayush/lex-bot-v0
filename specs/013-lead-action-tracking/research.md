# Research: Lead Action Tracking

**Date**: 2026-05-24
**Plan**: [plan.md](./plan.md)
**Spec**: [spec.md](./spec.md)

This document captures the technical decisions for the Lead Action
Tracking feature. Each decision is grounded in the existing
007-dashboard / 010-sop-workflow patterns + the spec's Assumptions
section.

## R1 — Database column design

**Decision**: Add **two nullable columns** to the existing `leads` table:

- `follow_up_action: text | null` — one of `'contacted'`,
  `'call_no_answer'`, `'meeting_fixed'`, or `null` (default).
- `follow_up_action_changed_at: text | null` — ISO 8601 timestamp,
  set to the current time on every action change.

Both columns nullable. Default for newly-captured leads: both `null`.

**Rationale**:
- Adding columns to the existing `leads` table is the natural place
  per data-model.md "Lead is the canonical entity for a captured
  lead". A separate `lead_actions` table would be overkill for v1
  (we don't track history).
- Enum-style values stored as text rather than as a Postgres ENUM
  type because the existing schema convention uses `text` columns
  with app-layer validation (matches `classification`, `status`,
  `case_type` patterns from 006). Easier to migrate when v2 adds new
  options.
- Storing the slug form (`call_no_answer`) rather than the human label
  (`Call didn't answer`) on the wire/DB side. The shared Zod schema
  + a small `LEAD_ACTION_LABELS` map in the widget converts to the
  display label.

**Alternatives considered**:
- Postgres `ENUM` type: tighter typing but requires a separate ALTER
  TYPE migration to add values in v2; doesn't match existing schema
  convention.
- Single JSONB column with `{action, changed_at}`: more compact but
  harder to query/index; doesn't align with the existing
  one-column-per-field pattern.
- Separate `lead_actions` table with FK to `leads`: full audit log;
  out of scope (v1 only tracks the most recent action).

## R2 — Action vocabulary: storage form

**Decision**: Use snake_case slugs in the database + on the wire:

| Display label | Slug |
|---|---|
| Contacted | `contacted` |
| Call didn't answer | `call_no_answer` |
| Client meeting fixed | `meeting_fixed` |
| (no action yet) | `null` |

**Rationale**:
- Slugs are stable (won't change if the display copy is rephrased
  later). The display label can be tuned in the widget without a
  migration.
- Matches the existing repo convention from 010-sop-workflow's
  `case_types.slug` + `sub_types.slug` pattern.
- Snake-case is the SOP-step-slug convention; consistent with
  `pendingStepSlug` in 011's preflight.

**Alternatives considered**:
- Store the display label directly: brittle to copy changes; no clear
  benefit given the labels are short.
- camelCase or kebab-case: project convention is snake_case for
  database slugs.

## R3 — Route shape: POST vs PATCH

**Decision**: Single endpoint `POST /api/dashboard/leads/[id]/action`
with body `{ action: 'contacted' | 'call_no_answer' | 'meeting_fixed' | null }`.

**Rationale**:
- Matches the existing `POST /api/dashboard/config` and
  `POST /api/dashboard/sop` pattern (which use `action` in the body
  as a discriminator). For this feature there's only one operation
  (update), so we don't need a discriminator — but POST is the
  Constitution IV-correct verb (Route Handler, no Server Actions,
  same-origin from the dashboard).
- PATCH would be more REST-idiomatic but the project's pattern is
  POST-with-action-in-body. Following convention reduces surprise.
- Setting `action: null` clears the action (returns to "no action
  yet" state, per FR-003).

**Alternatives considered**:
- PATCH `/api/dashboard/leads/[id]` with a partial body: more
  REST-y; doesn't match repo convention.
- DELETE for clearing: ambiguous (does it delete the lead or just the
  action?); rejected.

## R4 — Authorization: 404 vs 403 on cross-account

**Decision**: When a user from account A attempts to update a lead
owned by account B, return **404 Not Found** (not 403 Forbidden).

**Rationale**:
- 403 leaks information: it tells an attacker "this lead exists, you
  just can't touch it". 404 is the privacy-preserving choice (the
  attacker can't distinguish "lead doesn't exist" from "lead exists
  but isn't yours").
- This is the OWASP-recommended pattern for multi-tenant authorization.
- Constitution V (Privacy) explicitly favors not leaking information.
- The existing `/api/dashboard/sop/route.ts` rollback handler
  (010 T060) follows the same pattern (`return 404` on missing /
  not-owned).

**Alternatives considered**:
- 403 Forbidden: classic REST; leaks lead existence. Rejected.
- 401 Unauthorized: wrong status; the user IS authenticated, just
  not authorized. Rejected.

## R5 — Picker UI pattern: dropdown vs button group vs modal

**Decision**: Inline `<select>` element + small "Save" button.
Picker lives directly on the lead detail page (no modal).

**Rationale**:
- Spec FR-003 + SC-001: change in fewer than 3 clicks. A modal would
  add an extra click (open + select + confirm + close).
- Native `<select>` is accessible by default (keyboard, screen reader)
  and matches the 010 `<step-form>` pattern (also uses native
  `<select>` for the chip_source dropdown).
- The picker has only 4 options (3 actions + null/clear); a button
  group is feasible UX but adds visual weight. `<select>` is more
  restrained.
- Save button is necessary because we don't want to write to the DB
  on every dropdown change (visitor might explore options); explicit
  Save = explicit intent.

**Alternatives considered**:
- Auto-save on selection change: avoids the Save button click, but
  causes unintended writes if the user is just exploring options.
  Rejected.
- Modal dialog with the three options as buttons + cancel: spec SC-001
  says "fewer than 3 clicks"; modal adds friction.
- Inline-edit in the table (no detail-page picker): explicit out of
  scope per the spec.

## R6 — Timestamp display format

**Decision**: Display the `follow_up_action_changed_at` timestamp in the
lawyer's local timezone, formatted as `"<Action> on <Month> <day>, <year>, <h>:<mm> <am/pm>"`
(e.g., `"Contacted on May 24, 2026, 2:14 PM"`).

**Rationale**:
- Lawyers typically work in their own timezone; UTC raw display is
  unfriendly.
- The existing dashboard `formatRelativeTime` helper in
  `lead-table.tsx` shows recent times relatively ("3h ago"); for the
  action timestamp, an absolute format is more useful because lawyers
  often want to know "when exactly did I contact this person".
- Use `new Date(iso).toLocaleString('en-US', {month: 'short', day:
  'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  hour12: true})` — built-in browser formatter; no new deps.

**Alternatives considered**:
- Relative time only ("Contacted 2h ago"): hides specific date when
  the action was days/weeks ago.
- Absolute UTC: technical, unfriendly.
- A library like `date-fns`: overkill for one timestamp; new dep.

## R7 — Table column placement

**Decision**: Add the new "Action" column to the `<LeadTable>` component
immediately after the existing "Status" column. New column shows the
action display label as a small badge OR an em-dash placeholder for
the null/no-action-yet state.

**Rationale**:
- "Action" sits next to "Status" semantically (both are
  workflow-state fields).
- The badge styling reuses the existing `statusStyles` pattern in
  `lead-table.tsx` (dot + colored text). New `actionStyles` map adds
  one entry per action slug.
- Em-dash (`—`) for the null state is lighter-weight than a colored
  badge and signals "no value here" without screaming "needs
  attention". The spec FR-006 says "visually distinguishable" —
  em-dash satisfies that without overstating.

**Alternatives considered**:
- New column as the last column: usability cost (needs scrolling on
  narrow viewports); rejected.
- "Needs attention" red badge for null: too aggressive; lawyers
  would feel guilty about every lead they haven't actioned yet (some
  leads are intentionally low-priority).
- Inline "Take action" button instead of badge: turns the table into
  an action surface; explicit out of scope.

## R8 — Migration safety

**Decision**: Apply the migration via the existing `pnpm
db:migrate` flow (Constitution VII). Both new columns are nullable
with no default — safe to add to the existing `leads` table without
backfilling.

**Rationale**:
- Nullable + no-default columns are zero-impact additions: existing
  rows get `NULL` for both fields automatically; new rows from the
  existing `captureLead` flow set neither field; the dashboard
  picker is the only writer.
- Neon serverless PostgreSQL applies `ALTER TABLE ADD COLUMN` in
  constant time for nullable columns (no rewrite).
- No backward-compatibility concerns: the new columns are unused by
  any existing read path.

**Alternatives considered**:
- Default the action to a sentinel value (e.g., `'no_action'`) on
  existing rows: redundant; null is the clear "no action" signal.
- Backfill with the lead's `created_at` as `follow_up_action_changed_at`:
  misleading (the "action change time" should reflect a real action,
  not creation time).

## R9 — Test strategy

**Decision**:

1. **Vitest unit tests** for `leadActionUpdateSchema` (the Zod schema):
   - Each action slug accepted; invalid slugs rejected; null accepted;
     missing field rejected.
2. **Vitest route tests** for the POST handler:
   - 200 happy path (auth ok, account match, valid body); 401 (no
     iron-session); 404 (lead not found OR cross-account); 400 (Zod
     failure).
3. **One Playwright walk spec** (`dashboard-lead-action.walk.spec.ts`):
   - Sign in to dashboard; navigate to a lead; pick an action; save;
     navigate back to leads list; assert the new column shows the
     selected action; assert the detail page on revisit shows the
     action + timestamp.

**Rationale**:
- Matches the established 010 + 011 testing pattern.
- The unit tests cover the cross-account 404 path (highest-stakes
  bug class).
- The walk spec validates the full UX without hardcoding LLM behavior
  (no LLM in this feature).

**Alternatives considered**:
- Skip the walk spec: relying on unit tests is risky for UX flows
  (the picker → save → table-update pipeline involves React state +
  Next.js cache + DB roundtrip).
- Mock the DB in the route tests: matches the 011 `route.test.ts`
  pattern (DI for `verifyApiKey` etc.). For 013 the route is simpler
  (iron-session is mocked via the DB fixture or via DI; following the
  010-style DI pattern).

## Summary

All decisions follow established 007/010/011 patterns. No new
infrastructure, no new external dependencies, no Constitution
principle violations.

Ready to proceed to Phase 1 (data-model.md, contracts/, quickstart.md).
