# Phase 0 Research — 014 Fix SOP Case Sub-Type Chips

**Date**: 2026-05-25
**Branch**: `014-fix-sop-case`

This document captures the open questions raised while writing the spec
and the conclusions reached after reading the existing 010-sop-workflow
implementation. All `[NEEDS CLARIFICATION]` markers from `plan.md`'s
Technical Context are resolved here.

## R1 — Should the empty-sub_types auto-skip live in the runtime, the dashboard, or both?

**Decision**: Runtime only (advancer + state-machine). The dashboard surfaces a warning indicator (FR-015) but does not block saving an empty sub-type list — admins must remain free to configure case types without sub-types.

**Rationale**: Spec FR-003 frames the auto-skip as a runtime behavior. The dashboard cannot prevent empty lists because legitimate practice-area customizations may need them (e.g., a single-flow case type). The runtime layer is the only place that can guarantee the visitor never sees a broken Step 2.

**Alternatives considered**:

- *Dashboard-only "must have ≥1 sub-type" rule*: rejected because it overconstrains lawful customizations and shifts the failure mode from runtime (handled gracefully) to publish-time (admin gets blocked).
- *Widget-only fix (skip rendering an empty chip row)*: necessary but insufficient — the SOP `pending_step_slug` would still be `sub_type`, the assistant would still ask the question, and the visitor would have no way to answer it. The runtime must mark the step as skipped so the assistant moves on.

## R2 — How should `qualified_lead_threshold` interact with skipped steps?

**Decision**: A skipped step whose `counts_toward_threshold` flag is `true` increments `current_progress` by 1 inside `applySkip` (state-machine). Threshold itself is immutable per published SOP.

**Rationale**: Without this, an account with one zero-sub_types case type would never reach `current_progress >= threshold` for visitors who pick that case type, and `autoFinalizeIfReady` (advancer.ts:182–193) would never finalize the SOP — visitors would walk through every step but no lead would be captured. From the visitor's perspective the step *was* answered (just not asked); from the product's perspective, declining to ask a question shouldn't penalize the lead's qualified status.

**Alternatives considered**:

- *Carry an "effective threshold" in `SOPState` and decrement on skip*: more invasive (changes the state shape and serialization, requires UI to display the right denominator in the progress bar), and breaks the intuitive invariant that threshold is a property of the published SOP.
- *Leave progress accounting alone and add a finalize-on-skip short-circuit*: tempting but fragile — multiple skips could accumulate in unanticipated ways, and it removes the natural "all required steps satisfied" check from `autoFinalizeIfReady`.
- *Treat `is_required: false` as the configuration toggle*: irrelevant here; the sub-type step is `is_required: true` precisely because we *want* to ask it whenever sub-types exist. Forcing the lawyer to flip required when sub-types are empty would be brittle.

## R3 — Where should `{case_type}` interpolation happen?

**Decision**: Server-side, in `system-prompt-extension.ts`, at the point where `earliestPending.question_text` is rendered into the SOP block. Use the captured case-type label looked up from `caseTypes` by slug. Pass the captured label through to the widget in the SOP-state header (new field: `captured_case_type_label`) so any visitor-facing rendering can also interpolate without an extra lookup.

**Rationale**: The system prompt is the single string the LLM sees, so interpolating there is the most direct way to ensure the assistant speaks naturally ("What kind of DUI matter is this?") without a leaked `{case_type}` token. Surfacing the label in the response header is cheap (≤30 chars) and gives the widget room to do its own rendering without hitting the API again or duplicating the case-types list lookup.

**Alternatives considered**:

- *Widget-side interpolation only*: insufficient because the widget never displays `question_text` — the chat bubble shows LLM-generated stream text. The leak risk is the LLM forwarding the placeholder verbatim.
- *Interpolation at SOP step authoring time (write the captured label into the persisted question_text)*: rejected because question_text is a static SOP-config field shared across all visitor sessions; mutating it per-session would require a separate per-session field.
- *Skip interpolation; expand the system-prompt instructions to enforce substitution*: relying on the LLM to handle the placeholder is exactly the source of the inconsistent behavior we're fixing; explicit substitution is more reliable.

## R4 — Should the label snapshot for sub-types live on `SOPStateStep`, on the `leads` table, or both?

**Decision**: On `SOPStateStep` only (extend with optional `captured_label: string | null`). Leads inherit the snapshot via `leads.sop_state_snapshot` JSON.

**Rationale**: The `sop_state_snapshot` column already preserves the full SOP state at lead-capture time, so adding a single field to `SOPStateStep` is a zero-migration change that automatically gives leads a label snapshot for every step (not just sub-type). Mirroring the label into a dedicated `leads` column would require a SQL migration and double-bookkeeping.

**Alternatives considered**:

- *Dedicated `leads.sub_type_label` column*: rejected — adds a migration and a separate write path, doubles the source of truth, and only solves the sub-type case (other steps may benefit from labels later).
- *Compute label on-demand by joining the snapshot's slug against the live `sub_types` table*: rejected — fails when the sub-type has been deleted or renamed (the explicit FR-022 motivation).

## R5 — How is the existing-account remediation invoked?

**Decision**: A new file `packages/api/src/db/ensure-default-sub-types.ts` exporting `ensureDefaultSubTypesForAllAccounts()` and `ensureDefaultSubTypesForAccount(accountId)`, mirroring `ensure-contact-step.ts`. Invoked manually via a new `db:ensure-default-sub-types` script in `packages/api/package.json` (mirroring the existing `db:seed` and `db:migrate` scripts).

**Rationale**: This is exactly the pattern the codebase already uses (`ensure-contact-step.ts`) — idempotent, per-account, runnable manually after deploy. Keeping it out of the request path avoids per-request overhead and keeps the remediation auditable (a one-time logged run is easier to reason about than scattered lazy executions).

**Alternatives considered**:

- *Lazy on first dashboard read or first widget config fetch*: rejected — adds runtime overhead to every request, complicates observability ("when did this account get remediated?"), and risks racing concurrent requests during the first hit.
- *Pure SQL migration in `packages/api/drizzle/0003_*.sql`*: rejected — defaults are defined in TypeScript (`seed-defaults/sop.ts`) and would have to be duplicated as VALUES in SQL. Maintaining two sources of truth is a known smell in this repo (see Constitution II "shared types must not be duplicated").
- *Auto-invoke at server startup*: rejected — Netlify Functions don't have a stable "startup" hook (they're cold-started per request); a startup-style hook would just be an indirect form of lazy execution.

## R6 — Should sub-type slug derivation be enforced client-side, server-side, or both?

**Decision**: Client-side derivation at "Add" time (single label input replaces the side-by-side slug+label inputs); server-side `case-types-diff.ts` re-derives the slug from the trimmed label and asserts it matches the inbound slug to defend against tampering. The slug regex (`^[a-z][a-z0-9_]*$`) remains the canonical format check.

**Rationale**: Client-side derivation gives admins the cleanest UX (one input, the slug auto-fills and is shown read-only). Server-side reassertion enforces the deterministic relationship even if a custom client or direct API call passes mismatched values. Both layers must accept that *renames* are label-only — the slug is locked once created so historical leads aren't broken (FR-016).

**Alternatives considered**:

- *Client-only derivation*: rejected because dashboard POST bodies are not authenticated against client identity (any logged-in admin's request is accepted) — relying on client behavior for invariants is fragile.
- *Server-only derivation (ignore the client's slug field)*: rejected because the case-types diff API is a full-list update; the slug is the identity used to match incoming entries against existing ones (`case-types-diff.ts` matches by slug). Dropping the inbound slug would force a separate "rename API."

## R7 — Label-uniqueness scope: per parent or globally?

**Decision**: Per parent only. Two case types may legitimately share a sub-type label (e.g., "Other" under both DUI and Personal Injury), but a single case type cannot have two sub-types named "Other" (case-insensitive).

**Rationale**: Spec FR-013 explicitly scopes uniqueness to "within its parent case type." This matches the slug-uniqueness DB index (`uniqueIndex on (case_type_id, slug)`), so the new label rule is a strict sibling of the existing slug rule.

**Alternatives considered**:

- *Global uniqueness*: rejected as overconstrained — labels are short and collisions are common across distinct practice areas.
- *Account-scoped uniqueness*: same problem as global, plus it leaks parent identity into the label space.

## R8 — Walk-spec scope: how much do we cover end-to-end?

**Decision**: Two new walk specs.

1. `widget-sop-subtype-chips.walk.spec.ts` — happy path (Story 1 Acceptance 1): visitor opens widget, taps DUI chip, asserts the next chip row contains exactly the seeded DUI sub-type labels and zero case-type labels. A second test in the same spec exercises Story 4: configure a case type with zero sub-types via the dashboard, then walk the visitor flow and assert Step 2 is skipped (the assistant's next question matches Step 3's text and the chip row is empty).
2. `sop-tabs.walk.spec.ts` (extend existing) — admin enters a label, asserts slug is auto-derived and read-only; tries to add a duplicate label, asserts the inline error appears and no save fires; deletes all sub-types from a case type, asserts the warning indicator appears on the case-type row.

**Rationale**: Walk specs are the only layer that exercises the full visitor + dashboard surface, so they're the strongest defense against the original "stale chip row" symptom returning. Existing walk specs (`widget-us2-skip-detection.walk.spec.ts`, `sop-tabs.walk.spec.ts`) demonstrate the pattern; these new specs follow it.

**Alternatives considered**:

- *Single combined walk spec*: rejected — the visitor and admin journeys are independently demoable per spec User Stories, and combining them into one spec would couple their failure modes.
- *Skip the walk spec, rely on unit tests only*: rejected — unit tests can't catch the "stale chip row" UI regression where `computeActiveChips` returns `[]` correctly but the rendered DOM shows leftover chips. Only Playwright sees the actual rendered state.

## R9 — What happens to in-flight visitor sessions when sub-types are remediated?

**Decision**: No special handling. In-flight sessions that loaded the old `widgetConfig` continue with the old (empty) sub-type list until the next page load; they will hit the auto-skip path (R1) and proceed gracefully.

**Rationale**: This matches the spec's documented edge case ("Widget cache lag") and the existing 010 SOP behavior for any mid-session config change. The auto-skip path makes this a non-issue: even if the visitor's cached config has empty sub-types but the server's freshly loaded SOP state knows the case type has sub-types now, the chat-route's `caseTypes` source is fetched server-side per turn (`getCaseTypes(accountId)` in `route.ts:47`), so the server is always operating on the latest configuration. Worst case: the visitor's chip row is empty for one turn while the server skips Step 2 — acceptable and self-healing.

**Alternatives considered**:

- *Push a "reload your widget" notice via the chat response*: rejected — disruptive UX for what is already a rare edge case, and the auto-skip already makes the flow correct.
- *Refetch `widgetConfig` after every turn*: rejected — unnecessary network overhead; widget config rarely changes during a single visitor session.

## R10 — Does the LLM still need to be told about the sub-type list?

**Decision**: Yes, unchanged. The system-prompt extension already inlines the SOP block with the active steps and their pending status (`system-prompt-extension.ts`); no new content is needed. The `{case_type}` interpolation (R3) replaces the placeholder in step 2's `question_text` with the captured label so the LLM phrases the follow-up naturally.

**Rationale**: The chip computation is widget-side, but the LLM still needs to know what step it's on so it can craft an appropriate follow-up message (per the existing 010 SOP design). The spec doesn't change the LLM's role here — it just makes the system prompt more accurate by interpolating the label.

**Alternatives considered**:

- *Inline the sub-type chip labels into the system prompt so the LLM can read them*: rejected — the chips are a UI concern; the LLM doesn't need to enumerate them. It just needs to ask the right question.
