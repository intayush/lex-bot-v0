# Onboarding Flow Redesign — Design

**Date:** 2026-07-05
**Branch:** `027-platform-admin-console` (refinement of the shipped feature)
**Status:** Implemented (2026-07-05). Migration 0011 applied to Neon
(accounts.domain + attorney sub_type_slug). All 11 plan tasks complete; 758
unit/integration tests green, next build compiles. Playwright E2E authored
(needs live server + seeded super-admin to run).

## Problem

The onboarding wizard shipped in 027 has a placeholder case-types step, asks
questions that should be defaults, and has an abrupt per-step "Saving…" state.
Feedback: streamline to the questions that matter, make the matrix actually
drive the SOP, add attorneys with sub-type assignment, and smooth transitions.

## New flow (3 steps, was 5)

1. **Firm details** — law firm name, chatbot assistant name, email, deployment domain.
2. **Case-type matrix** — grid of the 6 default case types × their sub-types;
   super-admin ticks what the firm handles → drives SOP v1.
3. **Attorneys** — add attorneys (name, email, mobile), assign each to selected
   sub-types → Finish & publish.

**Removed (become defaults, editable later in the firm dashboard):** greeting
message, tone, contact email, after-hours message, escalation message, and the
entire contact step.

## Decisions (locked in brainstorming)

- **Seed only selected** case types/sub-types (subset-driven SOP v1).
- **Domain stored on `accounts`, display-only** — no CORS/origin enforcement, so
  the constitution's wildcard-CORS rule is untouched.
- **Sub-type-level attorney assignment** — new `sub_type_slug` column.
- **Silent autosave + animated step transitions**; spinner only on final publish.
- **Attorney routing fallback:** a HOT lead routes to attorneys assigned its
  sub-type; if none, fall back to case-type-level assignment.

## Data model changes (migration `0011`)

- `accounts.domain` — nullable `text`. Display-only.
- `attorney_case_type_assignments.sub_type_slug` — nullable `text`. Unique index
  becomes `(attorney_id, case_type_slug, sub_type_slug)`. NULL = whole-case-type
  assignment (existing rows remain valid).
- Both mirrored in `test-schema.ts` + each affected test's `CREATE TABLE` SQL.

## Subset-driven SOP seeding

`seedSopForAccount(accountId, options?)` gains an optional
`options.selection: { caseTypeSlug, subTypeSlugs[] }[]`.
- With a selection: create only those case types + sub-types; seed scoring
  branches only for selected sub-types that have a default branch (e.g.
  `car_accident`).
- Without a selection: current behavior (all 6 case types / 21 sub-types) —
  unchanged for dev seed + `bootstrap-prod`.

## Wizard schema & provisioning

- `wizardSubmissionSchema` reshaped:
  - `firmIdentity` → `{ firmName, chatbotName, email, domain }`.
  - add `caseTypeSelection: { caseTypeSlug, subTypeSlugs[] }[]`.
  - add `attorneys: { name, email, mobile?, subTypeSlugs[] }[]`.
  - remove `persona`, `contact`, `escalation`.
- Required-to-finish: `firmIdentity` + ≥1 selected sub-type.
- `buildDraftFromWizard` fills greeting (genericized default), `tone: 'friendly'`,
  escalation, and contact from defaults; stores `email`/`domain`.

## Attorney provisioning at finish

After SOP seeding: create each attorney (reuse existing create logic) and insert
sub-type assignments. Spec-024 routing gains sub-type precision with case-type
fallback.

## UX: save & transitions

- Each step autosaves in the background via `PUT .../onboarding` (no blocking
  text). Steps fade/slide (CSS, respects `prefers-reduced-motion`).
- Only **Finish & publish** shows a spinner.

## Testing

- Unit: subset seeding (only selected created + correct branches),
  `buildDraftFromWizard` new shape/defaults, sub-type assignment insert.
- Integration: onboarding finish with a selection → correct case types /
  sub-types / attorneys exist; 422 when no sub-type selected.
- E2E: update the wizard walkthrough for the 3-step flow.
- Migration `0011` mirrored in `test-schema`; existing 748 tests stay green.

## Out of scope

- CORS/origin enforcement from the domain field.
- Editing case types/attorneys from the admin console outside onboarding
  (firm dashboard already handles ongoing edits).
- Multi-user-per-firm, billing (unchanged deferrals from 027).
