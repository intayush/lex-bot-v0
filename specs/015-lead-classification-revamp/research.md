# Phase 0 Research: Lead Classification Revamp

**Date**: 2026-06-06

**Status**: Complete

**Inputs**: spec.md (clarified), plan.md (Technical Context + Constitution
Check), 014 survey, 015 integration-points survey.

This document resolves every NEEDS CLARIFICATION marker that would
otherwise block plan completion, and records the research findings that
informed Technical Context and Project Structure decisions.

## Open NEEDS CLARIFICATION → Resolved

The Technical Context section in plan.md contains zero NEEDS
CLARIFICATION markers. The clarification phase resolved the four
high-impact ambiguities:

- **Reasons inclusion rule** — pinned to `|weight| ≥ 5` (FR-010a).
- **Scorer failure mode** — pinned to capture-with-SPAM-fallback
  (FR-010b).
- **Terminology** — "classification" everywhere; "tier" purged
  (clarification Q3).
- **Fake-info handling** — pinned regex set; runs after persistence;
  no PII in logs (FR-010c, FR-010d).

The remaining lower-impact gaps from the clarification coverage report
(performance latency target, scalability beyond current volume,
accessibility) are addressed below as research items rather than
clarifications.

## Research Items

### R1: Where exactly do the 8 scoring questions slot in the SOP?

**Decision**: New scoring SOP steps occupy positions 5–14, shifting the
existing `when` step from position 5 to position 13 and `contact` from
position 6 to position 14.

**Detail** (10 new steps total):

| Position | Slug                         | chip_source     | counts_toward_threshold | score_weight chips? |
|----------|------------------------------|-----------------|-------------------------|---------------------|
| 5        | `request_type`               | `inline`        | false                   | no (metadata)       |
| 6        | `geographic_qualification`   | `inline`        | false                   | no (metadata)       |
| 7        | `accident_timing`            | `inline`        | false                   | yes                 |
| 8        | `injury`                     | `inline`        | false                   | yes                 |
| 9        | `medical_treatment`          | `inline`        | false                   | yes                 |
| 10       | `accident_role`              | `inline`        | false                   | yes                 |
| 11       | `insurance_activity`         | `inline`        | false                   | yes                 |
| 12       | `work_impact`                | `inline`        | false                   | yes                 |
| 13       | `attorney_status`            | `inline`        | false                   | yes                 |
| (renumbered) 14 | `when` (was 5)        | `inline`        | true                    | no                  |
| (renumbered) 15 | `contact` (was 6)     | `contact_form`  | true                    | no                  |

Positions 5–13 (the 9 new scoring + metadata steps) all have
`counts_toward_threshold: false` per FR-013, so the existing
`qualified_lead_threshold = 6` (= 6 default-marked steps that count)
continues to gate finalization correctly. The new steps must also be
flagged as **conditional**: they only render when the captured sub_type
has `scoring_config_json IS NOT NULL` AND its slug matches the step's
`applies_when_sub_type_slug` field (a new field on `sop_steps`, see R3).

**Rationale**: Position-based ordering is what the existing
`nextPendingStep` selector consumes; no advancer code change is needed
for placement. The Q8 contact question from xlsx (phone +10 / email +5)
is folded INTO the existing Step 6 (`contact`) — its weights apply to
the captured form data, not a separate chip step. This avoids asking a
redundant "what's your phone/email?" twice.

**Alternatives considered**:
- *Inline scoring inside Step 4 ("what happened?")* — rejected: would
  conflate free-text incident description with structured triage and
  break the chip rendering contract.
- *Separate "scoring phase" after SOP completes* — rejected during
  brainstorming (per INPUT.md): doubles conversational length and
  adds a two-stage interaction model.

### R2: How does a step "only fire for one sub_type" without an advancer code change?

**Decision**: Add a new optional column `sop_steps.applies_when_sub_type_slug TEXT NULL`. When set, the advancer's `nextPendingStep` selector skips the step unless the SOP state's captured `sub_type` matches the slug (or the step is already complete/skipped). When null (the default for the existing 6 steps), the step always fires.

**Implementation sketch** (in `packages/api/src/lib/sop/state-machine.ts`'s `nextPendingStep`):

```text
function nextPendingStep(state, sopConfig) {
  const capturedSubTypeSlug = state.steps.find(s => s.slug === 'sub_type')?.captured_value;
  for (const step of sopConfig.steps.sort by position) {
    if (step.applies_when_sub_type_slug && step.applies_when_sub_type_slug !== capturedSubTypeSlug) continue;
    if (state.steps.find(s => s.step_id === step.id)?.status === 'pending') return step;
  }
  return null;
}
```

**Rationale**: Single column add, single conditional in the selector. No state-machine logic change; no skip-condition JSON DSL needed (which was 010's deferred placeholder anyway). The new scoring steps for car_accident are seeded with `applies_when_sub_type_slug = 'car_accident'`; for any other sub_type, the same column would point at that sub_type's slug.

**Alternatives considered**:
- *JSON `skip_condition` DSL* (010's reserved column) — rejected: requires authoring an expression evaluator, way more surface area than the MVP needs. Defer to post-MVP if a multi-condition skip is ever needed.
- *Applying the step universally and skipping at runtime via the scoring engine* — rejected: would surface unanswerable scoring questions (e.g., "what medical treatment?") to non-personal-injury visitors, breaking UX.


### R3: What is the exact shape of `sub_types.scoring_config_json`?

**Decision**: A typed JSON column validated by a new
`scoringConfigSchema` Zod schema in `packages/shared/src/schemas/sop.ts`.

```text
ScoringConfig = {
  thresholds_self: {
    hot:  [number, number],   // [min, max] inclusive
    warm: [number, number],
    cold: [number, number],
    spam: [number, number],
  },
  thresholds_family_friend: {
    hot:  [number, number],
    warm: [number, number],
    spam: [number, number],
  },
  hard_overrides_enabled: {
    missing_contact: boolean,
    out_of_scope: boolean,
    no_injury_no_treatment: boolean,
    fake_info: boolean,
  },
  schema_version: 1,
}
```

The full JSON shape is captured in `contracts/scoring-config.md` with
validation rules: thresholds must be non-overlapping, contiguous, and
cover [0, 100]; `schema_version` is a forward-compatibility hatch for
the deferred Case-Value-Score / Urgency-Score decomposition.

**Rationale**: Single typed column on the existing `sub_types` table
(the row that already represents this scoring scope). NULL means "no
scoring config; use the LLM fallback classifier" per FR-022. Future
expansions (e.g., adding the xlsx-hinted Case Value sub-scores) bump
`schema_version`; the runtime can branch on it without breaking
existing rows.

**Alternatives considered**:
- *Separate `scoring_configs` table keyed by sub_type_id* — rejected:
  one-to-one with `sub_types`, no benefit, more migration surface.
- *JSON column on `sop_configurations` instead of `sub_types`* —
  rejected: would couple scoring to the published SOP version, but
  scoring is naturally per (case_type, sub_type) and SHOULD survive
  SOP version bumps unrelated to scoring.

### R4: What is the exact shape of an "inline chip with score weight"?

**Decision**: Extend the existing `chipSchema` in
`packages/shared/src/schemas/sop.ts` with one optional field:

```text
chipSchema = {
  label: z.string(),       // existing
  slug: z.string(),        // existing
  score_weight?: number,   // NEW — integer in [-50, +50]; default null
}
```

Chips authored on existing default steps (case_type, sub_type, where,
what, when, contact) leave `score_weight` undefined. Chips on the new
scoring steps carry an integer weight per the xlsx mapping. The
"I Don't Know" chip is always weight 0 per FR-016.

`packages/api/src/lib/sop/system-prompt-extension.ts` and the widget's
chip-rendering hook do NOT consume `score_weight` (it's invisible to
the visitor); only the scorer reads it.

**Rationale**: Single optional field; backward-compatible (no
migration needed for existing `inline_chips_json` rows; they parse
unchanged). Bounded range prevents pathological weights.

### R5: How does the legacy `leads.classification` migration run, and when?

**Decision**: A single SQL UPDATE inside the new Drizzle migration
(`0003_*.sql`):

```sql
UPDATE leads SET classification = 'HOT'  WHERE classification = 'urgent';
UPDATE leads SET classification = 'WARM' WHERE classification = 'normal';
UPDATE leads SET classification = 'SPAM' WHERE classification = 'unqualified';
```

The migration also alters the column's type-level constraint (in
Drizzle's TypeScript schema) from the old enum to the new enum.
Postgres has no enum constraint on the column today (it's `text`), so
no `CHECK` constraint or `ALTER TYPE` is involved at the DB level —
the value-space contract is enforced by the Zod schema in
`packages/shared/src/schemas/leads.ts` at every boundary.

The legacy classification rationale and urgency factors fields are
preserved unchanged (FR-032).

**Rationale**: One transaction, idempotent (re-running on already-
migrated data is a no-op since no row matches the old values), small
enough to inline in the migration without staging. Constitution IV
requires migrations to be idempotent against fresh Neon branches; this
satisfies that.

**Alternatives considered**:
- *Background remediation script (like 014's
  `ensure-default-sub-types`)* — rejected: this is a 1:1 value rewrite
  with no decision-making per row; migration-as-statement is correct.


### R6: How does the LLM `captureLead` tool emit the new 4-value enum for unconfigured sub_types?

**Decision**: Update three coordinated locations:

1. **Tool param Zod schema** (`packages/api/src/app/api/chat/route.ts:185–195`): change `classification: z.enum(['urgent', 'normal', 'unqualified'])` to `z.enum(['HOT', 'WARM', 'COLD', 'SPAM'])`.
2. **System-prompt rubric prose** (`packages/api/src/lib/system-prompt.ts:138–141`): replace the 3-line rubric with a 4-line rubric:
   - `HOT`: imminent legal urgency — recent arrest/charges, statute of limitations <30 days, active danger, immediate help needed.
   - `WARM`: legitimate matter, motivated prospect, no immediate time pressure.
   - `COLD`: legitimate matter, low motivation signals or unclear urgency.
   - `SPAM`: outside firm practice areas, no actionable legal issue, no contact info, or test/junk submission.
3. **Partial-lead heuristic classifier** (`packages/api/src/lib/partial-lead.ts:59–109` and its tests): update its return type from `'urgent' | 'normal' | 'unqualified'` to the 4-value enum; update the regex-driven branch logic so the strongest signal still maps to `HOT`, valid-but-unfocused to `WARM`, weak signal to `COLD`, and no-legal-matter / no-contact to `SPAM`.

For the configured car_accident sub_type, the LLM's emitted value is
**ignored**: the rule-based scorer's output is authoritative
(FR-001/FR-002). The chat-route's finalization handler decides which
value to persist based on whether the captured sub_type has scoring
config.

**Rationale**: All three surfaces share the same enum; updating one
without the others would create a runtime mismatch. The rubric prose
change is +0 tokens (3 lines for 4 lines is roughly token-neutral; net
delta is ≤ 30 tokens, well within Constitution VI's budget).

**Alternatives considered**:
- *Legacy enum at the LLM, mapped at write time* — rejected: would
  hide the new vocabulary from the system prompt where it's most
  visible, increase surprise for prompt-engineering work, and require
  a mapping helper at every captureLead call site.

### R7: When in the finalization path does `scoreLead` run, and what reads what?

**Decision**: `scoreLead` runs at the END of `captureLead` in
`packages/api/src/lib/leads.ts` AND at the end of
`updateLeadSOPState` (which is invoked when the contact form is
submitted via the SOP, separate from the LLM tool call). Both
finalization paths read the captured sub_type from `sop_state_snapshot`,
join `sub_types.scoring_config_json` for that sub_type, and pass the
typed inputs into `scoreLead`.

If the captured sub_type's `scoring_config_json` is NULL, the
classification falls through to the LLM-emitted value (or the
partial-lead-heuristic value); the new `lead_score` and
`score_reasons_json` columns are written as NULL.

If `scoring_config_json` is non-NULL but `scoreLead` throws,
FR-010b's safe-default applies: persist the lead with
`classification = 'SPAM'`, `lead_score = NULL`,
`score_reasons_json = '["scoring_error"]'`, and emit an ERROR-level
structured log entry.

**Rationale**: Both write paths need to apply the same scorer because
they're entered from different surfaces (LLM tool vs. SOP contact-form
submission). Centralising the call in two places (rather than a
post-write hook) keeps the contract auditable in one read of
`leads.ts`.

**Alternatives considered**:
- *Defer scoring to a background job* — rejected per the Complexity
  Tracking note in plan.md (the widget needs the new classification
  back on the same turn that finalizes; eventual consistency would
  break the dashboard's display latency contract).

### R8: What does the structured `lead_classified` log entry look like?

**Decision**: A `console.info` JSON line emitted immediately after
the leads-row write in `captureLead` and `updateLeadSOPState`, shaped
as:

```text
{
  event: "lead_classified",
  account_id: string,
  lead_id: string,
  session_id: string,
  classification: "HOT" | "WARM" | "COLD" | "SPAM",
  lead_score: number | null,
  reasons: string[],                    // array of phrase strings (NO PII)
  case_type_slug: string | null,
  sub_type_slug: string | null,
  hard_override_fired: string | null,   // "missing_contact" | "out_of_scope" | "no_injury_no_treatment" | "fake_info" | null
  scoring_path: "rule_based" | "llm_fallback" | "partial_lead_heuristic" | "scoring_error",
  request_type: "SELF" | "FRIEND_FAMILY" | null,
  geographic_qualification: "IN_SERVICE_AREA" | "OUTSIDE_SERVICE_AREA" | null,
  sop_version: number | null,
  ts: string,                            // ISO-8601
}
```

PII fields (name, contact_email, contact_phone) are NEVER included
per FR-010d / FR-034 / Constitution V.

The exact shape is captured in `contracts/lead-finalization-log.md`
with field-by-field semantics.

**Rationale**: A single JSON-shaped event keeps the log queryable by
session_id (Constitution VI explicit obligation §11.7) and by
classification path (`scoring_path` lets us compare rule-based vs LLM
classifications in production telemetry, which is the input for
SC-010's "false-HOT rate" metric).

**Alternatives considered**:
- *Multiple logger calls (one per field)* — rejected: defeats
  queryability; existing chat-route uses single `console.error`
  per event for the same reason.
- *Logging via a dedicated module* — out of scope for MVP; can be
  refactored when the codebase introduces a logger abstraction. For
  now `console.info(JSON.stringify(...))` is the path of least
  resistance and matches existing `console.error` usage.


### R9: The 8 scoring questions — exact chip-by-chip xlsx values

**Decision**: Source the chip labels and weights verbatim from
`lex-chat.xlsx` (the authoritative source of truth per spec
§Assumptions). The full mapping is captured in
`contracts/scoring-config.md` for plan-time reference and seeded into
`packages/api/src/db/seed-defaults/sop.ts` as the default
scoring_config + the 8 inline-chip arrays for car_accident.

**Summary** (for plan readers — full table in contract):

| Question (slug)              | Question text (visitor-facing)                          | Chip count | Weight range |
|------------------------------|---------------------------------------------------------|------------|--------------|
| `accident_timing`            | When did the accident happen?                           | 6          | 0–20         |
| `injury`                     | Were you (or they) injured?                             | 5          | -20 to +15   |
| `medical_treatment`          | What medical treatment was received?                    | 8          | -10 to +25   |
| `accident_role`              | Were you (or they) a:                                   | 4          | 0–10         |
| `insurance_activity`         | Has an insurance company contacted you (or them)?       | 6          | 0–15         |
| `work_impact`                | Has the accident affected your (or their) ability to work? | 5       | 0–15         |
| `attorney_status`            | Do you currently have a lawyer?                         | 5          | -20 to +20   |
| `request_type` (metadata)    | Are you asking for yourself or a friend/family member?  | 2          | 0 only       |
| `geographic_qualification` (metadata) | Did the accident happen in or near {firm service area}? | 2 | 0 only       |

The Q8 contact-info weights from xlsx (Phone +10 / Email +5) are
captured by inspecting the contact-form fields at finalization, NOT a
separate chip step.

**Rationale**: Pinning the weights at `contracts/` time means
implementation tasks (seed file write, integration tests) reference a
single audit-able source instead of re-reading the xlsx each time.
The xlsx is also archived in `lex-chat.xlsx` at the repo root.

### R10: Performance + observability targets

**Decision**:
- `scoreLead` p99 latency target: <50ms on Netlify Functions cold
  start. The function is pure, no I/O; this is comfortable for any
  reasonable inline-chip count (≤100 chips total per SOP).
- Total finalization-path overhead added by 015: <100ms on top of the
  baseline `captureLead` write. The only added I/O is one `SELECT
  scoring_config_json FROM sub_types WHERE id = ?` (already needed
  for the chip-rendering path; can be folded into the existing
  per-turn read).
- No SLA or alert thresholds added in MVP. The structured log
  (R8) is the observability surface; metrics/alerts are post-MVP per
  spec §Assumptions.

**Rationale**: Constitution VI mandates observability obligations but
not specific latency SLAs; we adopt latency targets sufficient to
guarantee no user-perceived regression, no more.

### R11: Out-of-scope items confirmed

These items appear in the spec as out-of-scope but are reconfirmed
here for future plan cross-references:

- Authoring new hard-override RULES from the dashboard (per-account
  rule editor / DSL) — fixed enum in MVP.
- Editing scoring questions or chip weights from the dashboard —
  read-only preview in MVP; engineering change for changes.
- The xlsx-hinted Case Value Score / Urgency Score decomposition —
  deferred; `schema_version: 1` provides forward-compat.
- A/B testing of scoring configurations — out of scope.
- Score recomputation when a sub_type's scoring_config changes —
  scoring is point-in-time at capture.
- Scoring configuration import/export — out of scope.

## Phase 0 Exit Status

✅ All NEEDS CLARIFICATION resolved (zero markers in plan.md or spec.md).

✅ All integration points (file:line) confirmed via the 015 survey
(plan §Project Structure references real paths).

✅ All decisions necessary to write Phase 1 contracts are recorded
above.

Ready for Phase 1 (data-model.md + contracts/ + quickstart.md).
