# /speckit.specify Input — Lead Classification Revamp

This document is the seed prompt that was passed to `/speckit.specify`
to produce `spec.md`. Kept in the spec directory for traceability.

## Source documents

- `lead-classification-revamp.md` (repo root) — design narrative
- `lead-classification-cr.md` (repo root) — refinements
- `lex-chat.xlsx` (repo root) — authoritative score mapping for
  Personal Injury / Car Accident

## Prompt

```
We need to revamp lead classification. Today, classification is a 3-bucket
LLM judgment ('urgent' | 'normal' | 'unqualified') emitted once at lead
capture by the chat agent's captureLead tool. It produces inconsistent
results, gives lawyers no insight into WHY a lead was scored that way,
and is not configurable.

Replace it with a deterministic, rule-based 4-tier scoring system that
runs server-side at SOP finalization, produces a numeric lead_score, a
tier (HOT / WARM / COLD / SPAM), a reasons array explaining the score,
and two pieces of separate metadata (request type, geographic
qualification) that are captured for routing but never scored.

----------------------------------------------------------------------
SOURCES OF TRUTH (resolve conflicts in this order)
----------------------------------------------------------------------

1. `lex-chat.xlsx` — authoritative score mapping for Personal Injury /
   Car Accident. The xlsx defines: 8 scoring questions (Q1 timing,
   Q2 injury, Q3 treatment, Q4 role, Q5 insurance, Q6 work impact,
   Q7 lawyer, Q8 contact info), each chip's exact point value, the
   "I Don't Know" option (=0) on most questions, the Self vs
   Family/Friend tier table, and the 4-tier thresholds.

2. `lead-classification-revamp.md` — design narrative and rationale.
   Use for question wording, hard-override rules, separate metadata
   (Request Type, Geographic Qualification), example HOT/WARM walks.
   Where it disagrees with the xlsx on score values, the xlsx wins.

3. `lead-classification-cr.md` — additive refinements only. Adopt:
   the reasons[] output array (so the scored output explains WHY it
   scored that way). The Driver weight and Lawyer weight changes in
   cr.md are SUPERSEDED by the xlsx values.

Explicit conflicts already resolved (xlsx wins each):
- Q4 Role: Cyclist option is OMITTED (xlsx has only Passenger,
  Pedestrian, Driver, I Don't Know).
- Q5 Liability question ("who was responsible?") is OMITTED. The
  xlsx has 8 questions, not 9.
- Q7 Lawyer: No=+20, Spoke=+15, Want-to-change=+10, Yes=-20,
  I Don't Know=0.
- Q8 Contact: Phone=+10, Email=+5, Missing=0 (max +15, not +10).
- "I Don't Know" =0 is offered on Q1, Q2, Q3, Q4, Q5, Q6, Q7.
- Family/Friend tier table differs from Self: 76-100 HOT,
  26-75 WARM, 0-25 SPAM (no COLD bucket for Family/Friend).
- Self tier table: 76-100 HOT, 51-75 WARM, 26-50 COLD, 0-25 SPAM.

----------------------------------------------------------------------
MVP SCOPE
----------------------------------------------------------------------

The scoring engine activates ONLY when the captured (case_type,
sub_type) pair is (personal_injury, car_accident). For all other
sub_types in MVP, the system continues to use an LLM-supplied tier
(see Coexistence below).

The architecture MUST be extensible to add scoring configuration for
any (case_type, sub_type) pair without further code changes —
admins should be able to author scoring questions, weights, hard-
override rules, and tier thresholds for new sub_types via the
existing SOP dashboard. MVP delivers the runtime + the wiring to
read per-sub_type config; it ships scoring config only for car
accident. Other sub_types having no config is the explicit "default
empty" case.

----------------------------------------------------------------------
INTEGRATION WITH EXISTING SYSTEM
----------------------------------------------------------------------

Build on top of spec 010 (SOP Workflow) and spec 014 (Sub-Type
Chips) — both already shipped or shipping in this branch.

- The 8 scoring questions are added as ADDITIONAL SOP steps that
  activate only when the captured sub_type matches a configured
  sub_type. The existing chip / state-machine / advancer pipeline
  is reused. The existing 6 default steps (case_type, sub_type,
  where, what, when, contact) stay; the scoring questions slot in
  AFTER step 4 ("what happened") and BEFORE step 5 ("when").
- The new scoring questions have `counts_toward_threshold = false`
  (they do not block finalization) so the existing
  `qualified_lead_threshold = 6` continues to gate finalization.
- Each scoring question is a step with `chip_source = 'inline'` and
  `inline_chips_json` carrying chips that ALSO carry a
  `score_weight: number` field. A new shared Zod schema validates
  the `inline_chips_json` shape at write time on POST
  /api/dashboard/sop/case-types and at read time on the chat route.
- Hard-override rules and tier thresholds live as a Zod-validated
  JSON column on the `sub_types` row (call it
  `scoring_config_json`). The hard-override LIST is a fixed enum
  in MVP; admins toggle which rules apply per sub_type but cannot
  author new rules. A second
  `scoring_config_json.tier_thresholds_family_friend` carries the
  alternate Family/Friend bounds.
- The "Request Type" and "Geographic Qualification" questions are
  ALSO new SOP steps but with `score_weight: 0` and
  `counts_toward_threshold: false`. They write to dedicated
  `leads.request_type` and `leads.geographic_qualification` columns.

----------------------------------------------------------------------
DATA MODEL CHANGES
----------------------------------------------------------------------

`leads` table:
- REPLACE the existing `classification` column's enum semantics:
  was 'urgent' | 'normal' | 'unqualified', becomes
  'HOT' | 'WARM' | 'COLD' | 'SPAM'. Migration maps:
  urgent -> HOT, normal -> WARM, unqualified -> SPAM.
- ADD `lead_score: integer NOT NULL DEFAULT 0`.
- ADD `score_reasons_json: text NULL`.
- ADD `request_type: text NULL`.
- ADD `geographic_qualification: text NULL`.
- ADD `geographic_qualification_details_json: text NULL`.

`sub_types` table:
- ADD `scoring_config_json: text NULL` — Zod-validated JSON.
  NULL means "no scoring config; LLM produces tier as-is".

`sop_steps` schema:
- The existing `inline_chips_json` shape is extended (via Zod) to
  allow each chip to carry an optional `score_weight: number`
  field. No DDL change.

----------------------------------------------------------------------
CLASSIFICATION ENUM REPLACEMENT
----------------------------------------------------------------------

The existing `urgent`/`normal`/`unqualified` enum is REPLACED with
the 4-tier `HOT`/`WARM`/`COLD`/`SPAM` enum. This is a breaking
change to the shared schema, the captureLead persistence, the
system-prompt rubric, the dashboard color map + filter chips, the
captureLead LLM tool definition, the partial-lead heuristic
fallback, and requires a one-time data migration.

----------------------------------------------------------------------
SCORING ENGINE BEHAVIOR
----------------------------------------------------------------------

Pure function `scoreLead(sopState, scoringConfig) → ScoredLead` that
returns: { lead_score, tier, reasons, hard_override_fired,
request_type, geographic_qualification }.

Algorithm:
1. If sub_type has no scoring_config_json: return tier as-is from
   the LLM-supplied value, score=0, reasons=[].
2. Otherwise, sum the score_weight of each captured chip. Cap at
   100; floor at 0.
3. Map sum to tier using the appropriate thresholds (Self vs
   Family/Friend, decided by captured request_type).
4. Apply hard-overrides last in fixed order: missing_contact >
   out_of_scope > no_injury_no_treatment > fake_info. Overrides
   can ONLY downgrade to SPAM.
5. Build reasons[] from chips whose |weight| ≥ 5; append
   hard-override rule names.

The "fake info" detector heuristics: phone digits-only shorter
than 7, email matches /^test@|@(test|example)\./i, name matches
/^(test|asdf|fake|x{2,})/i.

The scorer runs at SOP finalization, reads the sop_state_snapshot
and the sub_types row's scoring_config_json, writes the resulting
fields onto the lead row in a single update.

A structured log line is emitted at finalization with
{ accountId, leadId, sub_type_slug, sop_version, lead_score,
  tier, reasons, hard_override_fired }.

----------------------------------------------------------------------
DASHBOARD SURFACE
----------------------------------------------------------------------

Add a "Scoring" sub-section to each sub_type's row in the existing
Case Types tab. Show tier thresholds (Self + Family/Friend),
hard-override toggles (4 checkboxes), and a read-only preview of
scoring questions + chip weights.

Update the leads dashboard:
- Color map for 4 tiers (HOT=red, WARM=orange, COLD=blue, SPAM=gray).
- Filter chips for 4 tiers + 'all'.
- A "Score" column with placeholder for unscored leads.
- A "Reasons" cell rendering reasons[] inline.

----------------------------------------------------------------------
SEED DATA (CAR ACCIDENT)
----------------------------------------------------------------------

On fresh seed, populate personal_injury / car_accident sub_type's
scoring_config_json with the xlsx-derived defaults (8 scoring
steps, all chip weights, both tier-threshold tables, all 4
hard-overrides enabled). Provide a remediation script
db:ensure-car-accident-scoring for existing accounts.

----------------------------------------------------------------------
EXPLICIT OUT-OF-SCOPE FOR MVP
----------------------------------------------------------------------

- Per-account configurable hard-override RULE AUTHORING.
- The xlsx-hinted Case Value / Urgency Score decomposition.
- Per-account override of tier thresholds beyond scoring_config_json.
- Scoring config for any sub_type other than car_accident.
- Scoring config import/export.
- A/B testing of scoring configs.
- Score recomputation for existing leads when scoring_config_json
  changes (scoring is point-in-time at capture).

----------------------------------------------------------------------
TESTABILITY (CONSTITUTION III)
----------------------------------------------------------------------

The pure scoreLead function is unit-testable. Each hard-override
is a pure function. The xlsx's HOT and WARM walks become test
fixtures. Dashboard edits round-trip through Zod validation.
A Playwright walk spec covers visitor flow tap Personal Injury →
Car Accident → 8 scoring questions → contact form → finalize →
assert tier and reasons match expected.

----------------------------------------------------------------------
USER STORIES (suggested priorities)
----------------------------------------------------------------------

US1 (P1, MVP) — Visitor walks SOP with car-accident scoring
US2 (P1) — Lawyer sees tier/score/reasons in dashboard
US3 (P1) — Admin views and edits scoring config
US4 (P2) — Hard-override rules downgrade SPAM correctly
US5 (P2) — Family-vs-Self tier table is honored
US6 (P3) — Existing leads migrated cleanly
US7 (P3) — Sub_types without scoring config fall through
```
