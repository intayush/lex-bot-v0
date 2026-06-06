# Phase 0 Research: Multi-Branch SOP Workflow

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)
**Date**: 2026-06-06

## Purpose

This document resolves all open architectural questions before
Phase 1 (data model + contracts). The spec already had its 5
clarifications recorded ([spec.md §Clarifications](./spec.md#clarifications));
the items below cover the remaining engineering decisions that arise
from translating the spec to the existing codebase.

All decisions stay inside the existing tech stack (Constitution IV)
and add no new dependencies.

## R1. Branch storage shape: dedicated tables vs. JSON column on `sub_types`

**Decision**: Create dedicated `branches` and `branch_versions` tables.

**Rationale**:

- Spec 015 stored scoring config as JSON on `sub_types.scoring_config_json`.
  That worked for a single sub-type's questions, but cannot model the
  versioning + publish/draft + audit-log requirements (FR-017, FR-028).
- Each Branch needs a stable identity (UNIQUE on
  `(case_type_slug, sub_type_slug)` — FR-009) plus a history of versions
  (in-flight conversations pin to a starting version — FR-017 / FR-031).
  Version history is naturally a child table.
- The `branch_versions.questions_json` column holds the full payload
  (questions + chips + thresholds + toggles) per version, so a frozen
  snapshot is a single row read keyed by version_id at chat-runtime.
- The dashboard's Branches view is a single SQL JOIN
  (`branches LEFT JOIN branch_versions ON current_version_id`) for the
  list view, with lazy expand for editing.

**Alternatives considered**:

- *Keep JSON on `sub_types` and add a sibling JSON column for version
  history.* Rejected: violates Constitution II's "validate at every
  boundary" because querying any version requires deserializing a
  JSON-encoded array; UNIQUE keys on draft-version-id can't be enforced
  in SQL; admin audit-log queries become full-row scans.
- *One single `branches` table with all versions inline as a JSON array.*
  Rejected for the same reason; also makes "publish" non-atomic.
## R2. Migration path for existing spec 015 scoring config

**Decision**: One Drizzle migration (`0004_*.sql`) that creates the new
tables, copies existing `sub_types.scoring_config_json` into
`branches` + `branch_versions`, and **leaves `scoring_config_json` in
place** as a deprecated read-only column.

**Rationale**:

- Idempotent re-run safety: the UNIQUE
  `(case_type_slug, sub_type_slug)` index on `branches` makes the data
  copy a no-op on re-run (`INSERT ... ON CONFLICT DO NOTHING`).
- Backwards compatibility: any existing dashboard read path that still
  reads `sub_types.scoring_config_json` (e.g., a stale cache, a partial
  rollback) keeps rendering historical leads correctly. Drop comes in a
  follow-up cleanup migration once the new read path is confirmed
  green in production for ≥ 1 release cycle.
- Constitution VII (phased delivery): the migration runs at boot via
  `pnpm db:migrate`, no service restart pattern change.

**Alternatives considered**:

- *Drop `scoring_config_json` in the same migration.* Rejected: rollback
  becomes destructive; no escape hatch if the new code path has a bug.
## R3. Removing the `analyzeAndFollowUp` tool from the agent

**Decision**: Delete `packages/api/src/lib/sop/follow-up-tool.ts` and
its test file; remove the tool registration from
`packages/api/src/app/api/chat/route.ts`; add a structural test that
asserts the agent's tool registry contains exactly `searchContext` and
`captureLead`.

**Rationale**:

- Spec FR-035 mandates removal, not deactivation; Clarification Q3
  confirmed Option A (delete entirely).
- Constitution VI fixes the agent's tool count at exactly two in MVP.
  The structural test makes that constraint executable, so any future
  PR that re-introduces a third tool fails CI.
- The Vercel AI SDK's `tool()` registration pattern means once the
  tool is removed from the route handler, it disappears from the
  agent's accessible API — no other guard is needed.

**Alternatives considered**:

- *Keep the file with the export commented out.* Rejected: dead code,
  invites accidental re-import.
- *Move the file to a `__deprecated/` folder.* Rejected: same
  dead-code risk, plus muddies the package boundary.

**Implementation note**:

The advancer state machine (`packages/api/src/lib/sop/state-machine.ts`)
currently transitions `step5_when → step6_followup_ai` after Step 5.
This transition is replaced by `step5_when → step6_contact`; after
Step 6 satisfies, the advancer dispatches to `branch-advancer.ts` (if
a branch exists) or directly to finalize. ## R4. Step 6 (contact) implementation: reuse existing extraction

**Decision**: Step 6 is implemented as a single conversational turn
that reuses the existing `packages/api/src/lib/sop/contact-form.ts`
LLM-driven extraction. The satisfaction predicate is updated for the
partial-gate rule (≥ 1 of email/phone, name optional). No new UI
primitives.

**Rationale**:

- Clarification Q4 selected Option B (single free-text turn). The
  existing extraction already works against the negative-flow JSON's
  combined-input pattern ("My name is Ayush Singh, my email is …, my
  phone is …" → all three fields parsed correctly).
- Reusing the existing extractor means no new LLM tool surface, no
  prompt-budget impact, and no widget changes (Constitution IV).
- The satisfaction predicate change is small (~5 LOC) and entirely
  unit-testable in `contact-form.test.ts`.

**Alternatives considered**:

- *Three sequential turns (Option A).* Rejected by Q4 — too high
  friction.
- *Embedded structured form widget (Option C).* Rejected by Q4 —
  would require widget changes, deviates from the chat-only paradigm,
  exceeds Constitution IV widget bundle budget review threshold.

**Retry mechanic** (FR-002a):

A retry counter is added to the SOP state (`contact_retry_count: 0|1|2`).
On each Step 6 turn that returns no email AND no phone, the counter
increments and the assistant emits the next configured retry prompt.
On a third failure the SOP state machine transitions to
`terminated_no_contact`, no `captureLead` invocation occurs, and the
conversation stays open. ## R5. Sequence-safe skip-detection for volunteered contact

**Decision**: Extend the existing `skip-detector.ts` with a separate
"capture without complete" path: contact info detected in any visitor
turn is parsed and stashed into a new `pending_contact` field on the
SOP state. Step 6 is marked complete only when the advancer reaches
Step 6 in sequence (per spec 010 FR-019), at which point the
assistant emits a confirmation prompt that surfaces the stashed values.

**Rationale**:

- Clarification Q5 selected Option C (sequence-safe skip-detection).
- Spec 010 FR-019 already mandates sequence-safety for skip-detection;
  this decision keeps the pattern consistent across all six default
  steps.
- Decoupling "capture" from "mark complete" lets the visitor see the
  progress bar advance in the natural order (1/6, 2/6 …) even when
  they volunteered fields out of order — matches existing UX intuition.

**Confirmation prompt format**:

When Step 6 is reached and `pending_contact` is non-empty, the
assistant emits a configurable prompt with the captured values
interpolated:

> "I have you as {name} at {email_or_phone} — does that look right?
> If you'd like me to use a different email or phone, just say so."

If the visitor confirms (or stays silent / says "yes" / etc.), Step 6
satisfies with the stashed values. If the visitor corrects, the
extraction runs again on the correction and the loop continues.

**Alternatives considered**:

- *Aggressive auto-complete (Option B from Q5).* Rejected — surprises
  visitors who didn't realize they "submitted" contact.
- *No skip-detection for contact (Option A from Q5).* Rejected —
  ignores volunteered data, makes the agent feel obtuse to a visitor
  who already shared their email in turn 1.
## R6. Partial-branch scoring (mid-flow abandonment)

**Decision**: Introduce a `score-lead-partial.ts` helper that wraps the
existing pure `score-lead.ts` to handle abandoned-branch leads. It
accepts the captured chip subset (may be empty), runs the same scorer,
and writes the lead row with `branch_incomplete: true`.

**Rationale**:

- Clarification Q2 selected Option A (score whatever was captured).
- The existing `score-lead.ts` is already a pure function over a
  config + captured-chip array. It does not assume "all questions
  answered" — it sums only the chips it sees. Calling it on a partial
  array Just Works mathematically; the wrapper exists only to set the
  `branch_incomplete` flag and to centralize the partial-classification
  log event.
- This means zero changes to the spec 015 scorer code (no regression
  risk for the completed-branch path).

**Where partial scoring is invoked**:

1. **Session-end finalizer** (existing `packages/api/src/lib/session.ts`):
   when a session expires (TTL elapsed) AND the SOP state shows the
   conversation got past Step 6 but did not complete the branch, the
   finalizer calls `scoreLeadPartial(sopState, branch)` and writes the
   lead row.
2. **Explicit early-finalize**: not in MVP scope (no admin or visitor
   action triggers an early finalize while the conversation is live).

**Edge case — zero chips captured before abandonment**:

The visitor reached Step 6 (so contact is on file per FR-002b) but
abandoned before tapping any branch chip. `scoreLeadPartial` returns
`lead_score = 0` (the score function sums an empty chip set to zero,
which is its mathematical identity). Classification is determined by
the branch's lowest threshold band (typically COLD or SPAM). The lead
still has `branch_incomplete: true`. Lawyers triaging the dashboard
see this as "branch started but no answers" — actionable signal.

**Alternatives considered**:

- *Set `lead_score = null` for partial-branch leads (Option B from
  Q2).* Rejected — wastes the deterministic-scoring infrastructure
  spec 015 built; gives lawyers less triage signal.
## R7. Branch versioning and in-flight conversation pinning

**Decision**: Each chat session pins to a `branch_version_id` at the
moment the branch first activates (immediately after Step 6 satisfies
and the lookup returns a Branch). The pinned id is stored in the
session's SOP state JSON. All subsequent branch advancements load the
same version row, even if the admin publishes a new version mid-flow.

**Rationale**:

- FR-017 + FR-031 mandate that in-flight conversations continue with
  their starting version.
- Storing only the id (not a full snapshot) on the session keeps the
  session payload small; the version row is fetched once per turn from
  the cache (≤ 5 min TTL — Constitution V).
- At finalization, the full version payload is materialized into the
  `leads.branch_snapshot_json` column (FR-018), so historical lead
  rendering does not depend on the live `branch_versions` table — the
  branch can be deleted later without affecting historical leads.

**Cache strategy**:

`branch_versions` rows are immutable once inserted (versioning model:
edits create a new version row). The Constitution V "≤ 5 minute TTL"
cache rule applies to context-store reads, not to version rows. Since
version rows are immutable, an in-process LRU cache keyed by
`version_id` is safe and unbounded by TTL — only memory bound. The
existing API server's per-request memoization is sufficient.

**Alternatives considered**:

- *Snapshot the full version into the session JSON at activation
  time.* Rejected — duplicates data, bloats session storage,
  complicates the "edit and republish" path.
## R8. Branches admin tab UX placement

**Decision**: Add a third tab to the existing `/dashboard/sop` page,
labelled "Branches". The existing tabs (the SOP step editor and the
Case Types editor from spec 014) are unchanged.

**Rationale**:

- FR-019 says "Branches tab (or section) within the existing SOP
  editor page". A peer tab keeps related configuration co-located:
  admins editing case types and sub-types can immediately jump to the
  branches that depend on them.
- The existing dashboard tab strip pattern is already in place from
  spec 014; reusing it adds no new UI primitive.
- Constitution VII (phased delivery): SOP-related dashboard work has
  been incremental on the same page since spec 010. This continues the
  pattern.

**Branches list view**:

A grouped list. Each (case_type, sub_type) pair is a row, grouped by
case_type. Each row shows:

- The pair's labels.
- A status pill: `Configured · Active`, `Configured · Inactive`, or
  `Not configured`.
- A primary action: `Edit branch` / `View branch` / `Add branch`
  depending on status.
- A secondary action: `Delete` (only for configured pairs, with
  confirmation per FR-026).

**Branch editor (per pair)**:

Opens in a side panel or modal (matching existing dashboard patterns).
Sections:

1. Active toggle.
2. Ordered question list with drag handles (reorder per FR-022).
3. Per-question: text, optional preface, chips with per-chip weight
   numeric inputs, free-text-allowed checkbox.
4. Classification thresholds (Self table + Family/Friend table) — same
   shape as the spec 015 dashboard.
5. Hard-override toggle list — same shape as the spec 015 dashboard.
6. Save / Publish actions with confirmation.
7. Preview & Test integration — clicking "Preview" opens the existing
   chat preview pinned to this branch's draft version.

**Alternatives considered**:

- *Separate top-level dashboard route at `/dashboard/branches`.*
  Rejected — splits SOP configuration across two pages, breaks
  Constitution VII's incremental-on-the-same-page pattern.
## R9. Threshold migration for firms on the seeded default

**Decision**: At boot time, the existing
`packages/api/src/db/ensure-contact-step.ts` is extended with logic that
finds firms whose SOP threshold `N` matches the spec 010 default of `5`
AND whose SOP step list is the spec 010 default 5-step shape, and
updates them in place: insert a Step 6 (contact) at position 6 and bump
`N` to `6`. Firms with custom step lists or custom `N` values are NOT
touched (preserving their customizations per spec Assumption A).

**Rationale**:

- Spec Assumption: "Firms that have customized `N` to a non-default
  value … will have their value migrated by adding `+1` only if their
  original `N` matched the original default of `5`; custom values are
  preserved as-is."
- Idempotent: re-running checks the SOP shape against a fingerprint
  before touching anything.
- Boot-time function (not Drizzle migration) because this is per-firm
  configuration, not schema.

**Detection fingerprint**:

A firm's SOP is "seeded default" if its 5 steps match the spec 010
seed labels exactly (`case_type`, `sub_type`, `where`, `what`, `when`),
in that position order, AND `N === 5`. Any deviation → leave alone.

**Edge case — firm has already added a custom contact step**:

If a firm's SOP has a step labelled or slugged something like
"contact" anywhere in the list, the migration MUST NOT add a duplicate.
Detection: scan for any step whose slug starts with `contact` or whose
label contains "name" + "email" or "phone" patterns. On match, leave
alone and emit an INFO-level log "skipped contact-step migration for
firm X — custom contact step detected at position N".

**Alternatives considered**:

- *Force-update every firm to the new 6-step default.* Rejected —
  destroys firms' customizations.
## R10. Structured logging events

**Decision**: Add four new structured-log event types per FR-033:

| Event | Emitted when | Top-level fields (no PII) |
|---|---|---|
| `branch_started` | Branch's first question is presented | `firm_id`, `session_id`, `case_type_slug`, `sub_type_slug`, `branch_id`, `branch_version_id` |
| `branch_question_answered` | Visitor's input for a branch question is captured | + `question_id`, `chip_slugs[]` (array of selected chip slugs), `is_free_text` (bool, whether the visitor used free-text instead of chips) |
| `branch_completed` | Branch's last question is answered AND `captureLead` succeeds | + `lead_score`, `classification`, `reasons[]` (rule names only) |
| `branch_skipped` | Lookup returns no active branch and default-only path finalizes | + `reason` (`"no_branch_configured"` \| `"branch_inactive"` \| `"branch_zero_questions"`) |
| `branch_incomplete_finalized` | Session-end finalizer scores a partial branch (FR-011a) | + `lead_score`, `classification`, `reasons[]`, `chips_captured_count`, `chips_total_count` |

**PII rules** (Constitution V): No `name`, `contact_email`,
`contact_phone`, free-text content, or chip *labels* (labels can leak
PII context — "I have herniated discs" — even though a chip is
selectable). Only chip *slugs* (machine identifiers) are logged.
Same redaction discipline as spec 015 FR-034.

**Existing event reuse**: `sop_step_completed` and
`sop_step_skipped` (from spec 010) continue to fire for Steps 1–6 of
the default SOP. They do NOT fire for branch questions (branches use
the new event types). This keeps per-event semantics clean.

**Rationale**:

- Five distinct events let lawyers and operators see at a glance, in
  log search, where conversations end up: branch_completed vs
  branch_incomplete_finalized vs branch_skipped each map to a real
  business-meaningful state.
- Field set is small and stable — no nested objects beyond `chip_slugs`
  and `reasons`, so logs ship cleanly through the existing log pipeline.

**Alternatives considered**:

- *One generic `branch_event` with a `type` discriminator.* Rejected —
  log search and alerting work better with distinct event types.
## Summary of Decisions

| # | Decision | Spec FR(s) covered |
|---|---|---|
| R1 | Dedicated `branches` + `branch_versions` tables | FR-009, FR-013, FR-017 |
| R2 | One Drizzle migration; `scoring_config_json` deprecated, not dropped | FR-029 |
| R3 | Delete `analyzeAndFollowUp`; structural test for tool registry | FR-035 |
| R4 | Reuse existing contact-form extraction; partial-gate predicate | FR-002, Q4 |
| R5 | Sequence-safe skip-detection with `pending_contact` + confirmation prompt | FR-005a, Q5 |
| R6 | `score-lead-partial.ts` wrapper; existing scorer unchanged | FR-011a, Q2 |
| R7 | In-flight conversation pins to `branch_version_id`; immutable version rows | FR-017, FR-031 |
| R8 | Third tab on `/dashboard/sop` page; reuse existing tab strip | FR-019, FR-027 |
| R9 | Boot-time `ensureContactStep` migration with fingerprint detection | FR-004, Assumption (N migration) |
| R10 | Five new structured-log event types; chip slugs only, no labels | FR-033 |

**Result**: Zero outstanding `[NEEDS CLARIFICATION]` items. All
architecture decisions are in-stack (Constitution IV) and add no new
dependencies. Ready for Phase 1 (data-model + contracts).
