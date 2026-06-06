# Feature Specification: Lead Classification Revamp

**Feature Branch**: `015-lead-classification-revamp`

**Created**: 2026-06-06

**Status**: Draft

**Input**: User description: "Replace the existing 3-bucket LLM lead classification ('urgent' | 'normal' | 'unqualified') with a deterministic, rule-based 4-value scoring system (HOT / WARM / COLD / SPAM) that produces a numeric lead score, a classification, and a reasons array explaining the score. Capture two pieces of separate metadata (request type, geographic qualification) for routing without affecting the score. MVP scopes the rule-based engine to one sub-type — Personal Injury / Car Accident — using the score mappings defined in `lex-chat.xlsx`. The architecture must be extensible so admins can configure scoring for any (case_type, sub_type) pair from the existing dashboard. See `specs/015-lead-classification-revamp/INPUT.md` for the full prompt and binding constraints."

## Clarifications

### Session 2026-06-06

- Q: What inclusion rule defines which chip selections appear in a scored lead's reasons array? → A: A chip is included in the reasons array when the absolute value of its score weight is at least 5 (chips with weights in the inclusive range −4 to +4, including 0-weight "I Don't Know" chips, are excluded). Hard-override rules that fire are always appended after chip-derived reasons.
- Q: How should the system handle a scoring failure at finalization (scoreLead throws, scoring_config_json is malformed, captured chip slug missing from config, etc.)? → A: Capture the lead, set lead_score = null, classification = SPAM (safe-default), reasons = ["scoring_error"], emit an ERROR-level structured log entry. Visitor flow completes normally; lawyers see the lead with a visible "scoring failed" indicator. Never block finalization on a scoring error.
- Q: Should the new 4-value categorical label be called "tier" or "classification" in the system? → A: Use "classification" everywhere — persisted field, user-facing dashboard label, log keys, FR wording. The word "tier" is not used anywhere in the spec, the codebase, or the dashboard. The existing `leads.classification` field is reused; only its value space changes (from 3 legacy values to the 4 new values HOT / WARM / COLD / SPAM).
- Q: When does the "fake info" hard-override run, what gets logged, and is the heuristic set configurable? → A: The fake-info check runs AFTER the lead has been persisted (so lawyers retain visibility into spam attempts). The structured log entry names ONLY the rule that fired (`"fake_info"`); matched PII values (the offending name / phone / email) are NEVER written to logs to comply with Constitution V (Privilege, Privacy, Data-Boundary). The heuristic set is pinned in code (not admin-configurable in MVP) and consists of: phone with fewer than 7 digits, email matching `/^test@|@(test|example)\./i`, name matching `/^(test|asdf|fake|x{2,})/i`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor walks the SOP for a car-accident lead and receives a deterministic, explained classification (Priority: P1) 🎯 MVP

A prospective client opens the chat widget, picks **Personal Injury → Car Accident**, and answers the additional scoring questions the assistant presents (when did the accident happen, were you injured, what treatment did you receive, etc.). When the visitor submits the contact form, the lead is finalized with a numeric score (0–100), a four-value classification (HOT / WARM / COLD / SPAM), and a list of human-readable reasons that explain why the lead landed in that classification. The classification is the same every time the same answers are given.

**Why this priority**: This is the core capability the feature exists to deliver. Without it, every other improvement (dashboard surfacing, admin configurability, hard-overrides, family-vs-self differentiation) is meaningless. Lawyers cannot trust an inconsistent classifier, and the user has explicitly framed this as the most crucial feature in the app.

**Independent Test**: Walk a visitor through the chat from "What kind of legal matter can we help you with?" through tapping Personal Injury, tapping Car Accident, answering all eight scoring questions with chip selections, answering the request-type and geographic-qualification metadata questions, and submitting the contact form. After finalization, retrieve the captured lead and verify it carries a numeric score, a classification in {HOT, WARM, COLD, SPAM}, a non-empty reasons array, and the two metadata fields. Re-run the same walk with the same answers and confirm the resulting score, classification, and reasons are identical.

**Acceptance Scenarios**:

1. **Given** the visitor selects Personal Injury → Car Accident and answers all eight scoring questions with the highest-scoring options (recent accident, injured, ER visit, other driver at fault, insurance pressure, missed work, no lawyer, full contact info), **When** the lead is finalized, **Then** the lead's classification is HOT and the score is at the top of the HOT band.
2. **Given** the visitor selects Personal Injury → Car Accident and answers with mid-range options (accident a few months ago, injured, doctor visit, no insurance contact, no work impact, no lawyer, full contact info), **When** the lead is finalized, **Then** the lead's classification is WARM.
3. **Given** the visitor answers "I Don't Know" on every scoring question that offers it, **When** the lead is finalized, **Then** the unknown answers contribute zero to the score and the visitor is not blocked from finalizing the lead.
4. **Given** the visitor selects Personal Injury → Car Accident, **When** the SOP advances past "what happened?" (Step 4), **Then** the assistant presents the scoring questions before asking "when did this happen?" (Step 5) and before the contact form (Step 6).
5. **Given** two visitors give identical answers to every scoring question, **When** their leads are finalized in separate sessions, **Then** their scores, classifications, and reasons are identical.
6. **Given** the visitor selects a sub-type other than Car Accident (any other configured sub-type in MVP), **When** the lead is finalized, **Then** the system falls back to the existing classifier (no scoring questions are asked, no numeric score is computed) but the lead still receives a classification in {HOT, WARM, COLD, SPAM}.

---

### User Story 2 - Lawyer sees the new score, classification, and reasons in the dashboard (Priority: P1)

A law-firm administrator opens the leads dashboard and sees each lead row labelled with its classification (HOT / WARM / COLD / SPAM) using a colour scheme that distinguishes all four classifications, a numeric score column, and an inline explanation of why the lead scored that way. The administrator can filter the list by any of the four classifications. Classification and score are visible at a glance; reasons are visible on hover or expand.

**Why this priority**: A scoring engine that nobody can see has no value. Lawyers are the primary beneficiaries — they need to triage leads quickly, and the existing 3-bucket dashboard cannot represent the new fourth classification or the reasons array. Without this, lawyers cannot act on the scoring engine's output.

**Independent Test**: Log in as an admin, open the leads dashboard. Verify the colour map distinguishes four classifications, the filter chip set offers HOT / WARM / COLD / SPAM (in addition to "all"), each lead row shows a numeric score column (or a placeholder for legacy leads), and clicking/hovering a lead reveals the reasons array. Apply each filter and confirm only leads of that classification are shown.

**Acceptance Scenarios**:

1. **Given** the admin opens the leads dashboard with leads in all four classifications, **When** the page renders, **Then** each lead row displays its classification with a distinct colour for HOT, WARM, COLD, and SPAM.
2. **Given** the admin filters by "HOT", **When** the filter applies, **Then** only HOT leads are visible and the count badge matches.
3. **Given** the admin views a lead scored by the rule-based engine, **When** they expand or hover the lead's reasons cell, **Then** the reasons array is rendered as a readable list of short phrases.
4. **Given** the admin views a lead that pre-dates this feature (legacy classification), **When** the row renders, **Then** the score column shows a placeholder ("—" or equivalent) and the classification reflects the migrated value.

---

### User Story 3 - Admin configures scoring for a sub-type from the dashboard (Priority: P1)

A law-firm administrator opens the SOP dashboard's case-types editor, expands a sub-type that has scoring enabled (initially Personal Injury → Car Accident), and sees the scoring configuration: classification thresholds for "Self" and "Family/Friend" requesters, toggles for which hard-override SPAM rules apply, and a read-only preview of which scoring questions fire for this sub-type and what each chip is worth. Edits to the thresholds and toggles persist and are honoured by the next visitor session.

**Why this priority**: The user's explicit ask is that scoring be extensible — admins must be able to adjust weights and thresholds without engineering work. Without an admin surface, the system is no more configurable than a hard-coded constant.

**Independent Test**: Log in as admin, open the SOP dashboard's case-types tab, expand the Car Accident sub-type, change the HOT classification lower bound (e.g., from 76 to 80), save, reload the page, and confirm the new value persists. Walk a visitor through the SOP with a known answer set whose original classification was HOT-at-77; confirm the new finalized lead lands in WARM after the threshold change.

**Acceptance Scenarios**:

1. **Given** the admin expands a sub-type with scoring enabled, **When** the panel renders, **Then** they see the classification thresholds for both Self and Family/Friend, the four hard-override toggles, and a read-only preview of the scoring questions and chip weights.
2. **Given** the admin sets the four Self classification thresholds to ranges that do not cover 0–100 contiguously (e.g., gap or overlap), **When** they try to save, **Then** the change is rejected with a clear validation error and the previous configuration remains in effect.
3. **Given** the admin toggles off the "fake info" hard-override, **When** they save, **Then** subsequent leads matching the fake-info heuristic are NOT auto-downgraded to SPAM by that rule (other rules still apply).
4. **Given** the admin sets the Family/Friend HOT threshold to a different range than the Self HOT threshold, **When** a lead with `request_type = FRIEND_FAMILY` is scored, **Then** the Family/Friend thresholds are used and the resulting classification reflects them.
5. **Given** the admin views a sub-type that has no scoring configuration (e.g., DUI / First Offense in MVP), **When** the panel renders, **Then** it clearly indicates "no scoring configured" and the legacy classifier is used for those leads.

---

### User Story 4 - Hard-override SPAM rules protect lawyers from low-quality leads (Priority: P2)

A visitor with no contact info, obviously fake details, an out-of-scope matter, or no injury and no medical treatment cannot land as anything but SPAM, regardless of how their other answers score. The reasons array surfaces which rule fired so the lawyer can verify the auto-downgrade was correct.

**Why this priority**: The xlsx and design docs both make these hard-overrides non-negotiable for lawyer trust. Without them a malformed or test submission could surface as HOT and waste lawyer time. They are P2 (not P1) only because they are protective: missing them does not break the happy path, but ships the system in a state where bad actors can game the score.

**Independent Test**: Submit four leads that each trigger one of the four hard-overrides — (a) leave both phone and email blank, (b) submit name="Test User" + email="test@test", (c) pick a case type marked out-of-scope, (d) answer "No" to injury and "No Treatment" to medical treatment — but otherwise answer the scoring questions with HOT classification responses. Verify each lead is finalized as SPAM with the corresponding rule named in the reasons array.

**Acceptance Scenarios**:

1. **Given** a visitor submits the contact form with neither a phone number nor an email address, **When** the lead is finalized, **Then** the classification is SPAM and the reasons array contains a phrase identifying the missing-contact rule.
2. **Given** a visitor enters a phone with fewer than 7 digits, an email matching test/example patterns, or a name matching obvious filler patterns (and at least one such field is captured), **When** the lead is finalized, **Then** the classification is SPAM and the reasons array names the fake-info rule.
3. **Given** a visitor selects a case type the firm has marked out-of-scope, **When** the SOP would otherwise finalize the lead, **Then** the lead is captured but classified SPAM with the out-of-scope reason.
4. **Given** a visitor answers "No" to "Were you injured?" AND "No Treatment" to "What medical treatment was received?", **When** the lead is finalized, **Then** the classification is SPAM regardless of how the visitor answered the other six scoring questions.
5. **Given** multiple hard-override rules apply to the same lead, **When** the lead is finalized, **Then** the classification is still SPAM and the reasons array lists every rule that fired (in a fixed, predictable order).
6. **Given** an admin has disabled a specific hard-override rule for a sub-type, **When** a lead matches only that disabled rule, **Then** the lead is NOT downgraded to SPAM by that rule (it follows its computed classification).
7. **Given** a hard-override fires, **When** the lead is finalized, **Then** the override can ONLY downgrade the classification — it cannot upgrade a lead that scored low to a higher classification.

---

### User Story 5 - Family/Friend requesters use a different classification table than self requesters (Priority: P2)

When the visitor answers "Friend / Family Member" to the request-type question, the score is mapped to classifications using a different threshold table than for "Myself". Two leads with identical scores can land in different classifications depending on this single answer.

**Why this priority**: This is a real product decision encoded in the source xlsx (the Family/Friend table has only three classifications — HOT/WARM/SPAM, no COLD bucket — with shifted bounds). Honouring it correctly is required for the scoring engine to faithfully implement the source mapping. P2 because the bug surface is narrow; the same-classification outcome differs only for a band of scores.

**Independent Test**: Submit two leads with identical answers to all eight scoring questions but differing only on the request-type question (Self vs Friend/Family). Confirm the resulting classifications reflect the appropriate classification table for each request type.

**Acceptance Scenarios**:

1. **Given** a Self-requester with a score in the COLD band (26–50), **When** the lead is finalized, **Then** the classification is COLD.
2. **Given** a Family/Friend requester with the same numeric score, **When** the lead is finalized, **Then** the classification is WARM (because the Family/Friend table treats 26–75 as WARM).
3. **Given** a Family/Friend requester with a score below 26, **When** the lead is finalized, **Then** the classification is SPAM (no COLD bucket exists for Family/Friend).

---

### User Story 6 - Existing leads are migrated cleanly to the new classification scheme (Priority: P3)

Leads captured before this feature was deployed continue to display correctly in the dashboard with their classification mapped from the legacy classification (urgent → HOT, normal → WARM, unqualified → SPAM). No data is lost; the score column shows a placeholder for legacy leads since they were never scored numerically.

**Why this priority**: Migration correctness is a one-time event. Getting it wrong is recoverable but visible to lawyers. P3 because the migration affects the dashboard appearance only — the underlying data remains intact in any case.

**Independent Test**: Take a database snapshot with legacy leads in each of the three legacy classifications. Run the migration. Verify each legacy lead's classification is the expected mapped value, no leads are dropped, and no leads end up in COLD (which has no legacy counterpart).

**Acceptance Scenarios**:

1. **Given** a database with leads in all three legacy classifications, **When** the migration runs, **Then** every urgent → HOT, every normal → WARM, every unqualified → SPAM, and zero leads land in COLD.
2. **Given** the migration has run, **When** the leads dashboard is opened, **Then** every lead row displays its mapped classification with the new colour scheme and no row shows an unrecognised classification value.
3. **Given** the migration has run, **When** a legacy lead is viewed in detail, **Then** the score column shows a placeholder (no numeric score is fabricated) and the reasons cell is empty (no reasons are fabricated).

---

### User Story 7 - Sub-types without scoring config fall through cleanly (Priority: P3)

Sub-types other than Personal Injury → Car Accident continue to operate with the existing classifier in MVP. The visitor experience for those sub-types is unchanged; the scoring questions are not asked, no numeric score is produced, but the lead still receives a classification in the new four-value scheme so the dashboard renders consistently.

**Why this priority**: This is the contract between MVP and post-MVP: the architecture must support extending scoring to other sub-types later without changing this fallback path. P3 because no new behaviour is being added — existing flows continue to work.

**Independent Test**: Walk a visitor through a non-car-accident sub-type (e.g., DUI → First Offense). Confirm that no scoring questions are asked, the SOP still finalizes correctly, the captured lead has a classification in {HOT, WARM, COLD, SPAM} (supplied by the existing classifier with the new vocabulary), and the score column shows a placeholder.

**Acceptance Scenarios**:

1. **Given** a visitor selects a sub-type with no scoring configuration, **When** the SOP advances past Step 4, **Then** no additional scoring questions are presented and the SOP advances directly to Step 5 ("when did this happen?") as before.
2. **Given** a visitor finalizes a lead for a sub-type without scoring config, **When** the lead is captured, **Then** the lead's classification is set by the existing classifier using the four-value vocabulary and the score column is the placeholder value.
3. **Given** the system architecture, **When** scoring configuration is later added for a previously unconfigured sub-type (post-MVP), **Then** the same runtime that scores Car Accident leads in MVP scores the new sub-type's leads with no code change required — the runtime reads scoring configuration per sub-type and applies it uniformly.

---
### Edge Cases

- **Visitor abandons mid-scoring.** What happens if the visitor closes the chat after answering some scoring questions but before finalizing? The partial-lead heuristic must still produce a classification in the new four-value vocabulary. Partial leads are not scored numerically (score column = placeholder) but still receive a classification.
- **Visitor changes their mind about case type.** If the visitor first taps Personal Injury → Car Accident and answers two scoring questions, then corrects to a different case type, the previously captured scoring answers are discarded. The new path either asks scoring questions for the new sub-type (if configured) or falls through to the existing classifier.
- **Admin removes scoring config for a sub-type with leads in flight.** A live conversation that has already advanced into the scoring questions for Car Accident must be allowed to finalize using the configuration in effect when the visitor started. Admin changes do not retro-mutate in-flight conversations.
- **Score equals exactly the boundary value.** When a score lands on a classification boundary (e.g., 75), the lead must land in a single, predictable classification — boundaries are inclusive on the lower side of the higher classification (so a Self-classification score of 75 is WARM, 76 is HOT). This rule is consistent across both Self and Family/Friend tables.
- **Score sum exceeds 100.** The score is capped at 100. A lead that would otherwise score 120 is recorded as 100 with the same classification.
- **Score sum falls below 0.** Negative chip weights (e.g., "Yes, I have a lawyer" = -20) can drive a partial score below zero. Floor the final score at 0.
- **All scoring questions answered with "I Don't Know".** All chips contribute 0; the score is 0; the classification is SPAM (per the Self or Family/Friend table). The reasons array lists no positive contributors but may still be augmented by a hard-override (e.g., missing-contact).
- **Visitor enters out-of-service-area details.** If the geographic question's answer is "No", the follow-up city/state fields are captured but do not affect the score. The metadata is available for routing but never blocks finalization.
- **Hard-override-only SPAM with otherwise-perfect answers.** A lead answers all scoring questions with HOT classification responses but has no contact info. The lead is captured (so the lawyer can see the loss) but flagged SPAM with the missing-contact reason.
- **Legacy lead viewed alongside new leads.** Lawyer sorts the leads table by score: legacy leads (placeholder) sort consistently together (e.g., last) and the new column does not break sort order.
- **Concurrent admin edits.** Two admins edit the scoring config simultaneously; last-write-wins with a clear save-time conflict warning, consistent with the existing SOP editor's atomic-save semantics.
- **Scoring failure at finalization.** If the scoring engine throws, the captured chips reference slugs not present in the sub-type's scoring configuration, or the configuration JSON is malformed, the system MUST still capture the lead. The lead is recorded with `lead_score = null`, `classification = SPAM` (safe-default), and `reasons = ["scoring_error"]`; an ERROR-level structured log entry names the failure. Visitor flow is never blocked; lawyers see the lead with a "scoring failed" indicator and can investigate via the structured log.

## Requirements *(mandatory)*

### Functional Requirements

#### Scoring engine behaviour

- **FR-001**: System MUST compute a numeric lead score in the inclusive range 0–100 for any lead whose captured (case_type, sub_type) pair has a scoring configuration.
- **FR-002**: System MUST classify each scored lead into exactly one of four classifications: HOT, WARM, COLD, SPAM.
- **FR-003**: System MUST produce a non-empty array of human-readable reason phrases explaining the score whenever a lead is scored numerically.
- **FR-004**: System MUST be deterministic: identical captured answers MUST produce identical score, classification, and reasons across sessions, accounts, and time.
- **FR-005**: System MUST cap the final score at 100 (any sum greater than 100 is recorded as 100) and floor it at 0 (any sum less than 0 is recorded as 0).
- **FR-006**: System MUST support two separate classification-threshold tables per sub-type — one for "Self" requesters and one for "Family/Friend" requesters — and MUST select the table based on the captured request-type metadata.
- **FR-007**: System MUST evaluate a fixed set of hard-override SPAM rules (missing contact, out of scope, no injury and no treatment, fake info) AFTER the score-to-classification mapping; an override that fires MUST set the classification to SPAM and append a reason naming the rule.
- **FR-008**: System MUST evaluate hard-override rules in a fixed, deterministic order so the reasons array order is reproducible.
- **FR-009**: System MUST allow hard-overrides to ONLY downgrade a lead's classification to SPAM; overrides MUST NOT upgrade a lead from a lower classification to a higher classification.
- **FR-010**: System MUST honour per-sub-type admin toggles that disable individual hard-override rules; a disabled rule MUST NOT fire for that sub-type.
- **FR-010a**: When building the reasons array for a scored lead, the system MUST include a phrase for every scoring chip the visitor selected whose absolute score weight is at least 5 (i.e., weight ≤ −5 or weight ≥ +5), MUST exclude chips whose weight is in the inclusive range −4 to +4 (including 0-weight "I Don't Know" chips), and MUST append a phrase for every hard-override rule that fired (after the chip-derived phrases). Order within each group MUST be deterministic — chip phrases follow the order of the SOP scoring questions; hard-override phrases follow the fixed override evaluation order from FR-008.
- **FR-010b**: When the scoring engine fails at finalization (e.g., the scoring function throws, a captured chip slug is missing from the sub-type's scoring configuration, or the configuration JSON is malformed), the system MUST still capture the lead. The captured lead MUST carry `lead_score = null`, `classification = SPAM` as a safe default, and `reasons = ["scoring_error"]`. The system MUST emit an ERROR-level structured log entry naming the failure and MUST NOT block SOP finalization or the visitor's flow.
- **FR-010c**: The "fake info" hard-override MUST run AFTER the lead has been persisted to the leads store (so lawyers retain visibility into spam attempts even when the override fires). The check MUST inspect the captured name, phone, and email fields. The heuristic set is fixed in MVP (not admin-configurable) and consists of: a phone string with fewer than 7 digits when stripped of non-digit characters, an email matching the case-insensitive pattern `/^test@|@(test|example)\./i`, and a name matching the case-insensitive pattern `/^(test|asdf|fake|x{2,})/i`. A match on any of the three fields constitutes a "fake info" hit.
- **FR-010d**: When any hard-override fires, the system MUST emit a structured log entry that names the rule (e.g., `"fake_info"`, `"missing_contact"`, `"out_of_scope"`, `"no_injury_no_treatment"`) but MUST NOT include the matched PII values (name, phone, email contents) in the log entry. This applies to all hard-overrides, not just fake info, and is required by Constitution V (Privilege, Privacy, Data-Boundary).

#### Conversation flow

- **FR-011**: System MUST present the scoring questions for a configured sub-type only AFTER the captured (case_type, sub_type) is known and only when the captured sub-type matches the configured sub-type.
- **FR-012**: System MUST insert the scoring questions into the SOP between Step 4 ("what happened?") and Step 5 ("when did this happen?") so the contact form remains the final step.
- **FR-013**: System MUST NOT block SOP finalization on whether the scoring questions are answered; finalization continues to be gated by the existing required-step threshold.
- **FR-014**: System MUST capture the request-type metadata ("Myself" vs "Friend/Family Member") via a chip-based question that does not affect the score.
- **FR-015**: System MUST capture the geographic-qualification metadata ("In service area" vs "Outside service area") via a chip-based question that does not affect the score; when the answer is "Outside service area" the system MUST collect city and state as free-text follow-ups.
- **FR-016**: System MUST offer an "I Don't Know" option (contributing 0 to the score) on every scoring question that has multiple-choice answers, except where the question's correctness depends on a definitive answer.
- **FR-017**: When a visitor corrects their case-type or sub-type selection mid-conversation, the system MUST discard previously captured scoring answers for the abandoned path.

#### Configurability

- **FR-018**: Admins MUST be able to view, per sub-type, the scoring configuration: classification thresholds (Self), classification thresholds (Family/Friend), hard-override toggles, and a read-only preview of the scoring questions and per-chip weights.
- **FR-019**: Admins MUST be able to edit the classification thresholds and the hard-override toggles per sub-type and persist the change with a single save action.
- **FR-020**: System MUST validate that an admin's saved classification-threshold ranges are non-overlapping, contiguous, and cover the full 0–100 range for the Self table; the Family/Friend table MUST cover the same range with three classifications (HOT, WARM, SPAM).
- **FR-021**: System MUST reject saves whose validation fails with a clear, actionable error message and MUST NOT mutate the persisted configuration on rejection.
- **FR-022**: Admins MUST be able to remove scoring configuration from a sub-type (returning it to the legacy-classifier fallback path) without deleting the sub-type itself.
- **FR-023**: System MUST persist scoring configuration per sub-type so two sub-types under the same case type can have different scoring rules.
- **FR-024**: System MUST allow the scoring configuration data shape to be extended (e.g., new question types, new hard-override rules, alternate scoring schemas) without breaking existing configurations.

#### Dashboard surface

- **FR-025**: The leads dashboard MUST display every lead's classification with a colour distinct for each of the four classifications (HOT, WARM, COLD, SPAM).
- **FR-026**: The leads dashboard MUST offer filter controls for each of the four classifications plus an "all" filter.
- **FR-027**: The leads dashboard MUST display the numeric score for each lead that was scored numerically and a placeholder (e.g., "—") for leads scored by the fallback classifier or migrated from legacy.
- **FR-028**: The leads dashboard MUST surface the reasons array for each scored lead in a way that is visible without leaving the row (hover, expand, or inline list).
- **FR-029**: The leads dashboard MUST surface the request-type and geographic-qualification metadata so a lawyer can filter or sort by them.
- **FR-029a**: The leads dashboard MUST visibly distinguish leads whose finalization triggered a scoring error (lead_score = null, reasons = ["scoring_error"]) from both legacy leads and successfully scored leads — for example, with an explicit "scoring failed" indicator in the row — so lawyers can spot misconfigured or buggy scoring at a glance.

#### Migration & coexistence

- **FR-030**: System MUST replace the legacy 3-value classification vocabulary ('urgent' / 'normal' / 'unqualified') with the new 4-value vocabulary across every surface that reads or writes a lead's classification.
- **FR-031**: System MUST migrate every existing lead's legacy classification to the new classification value using a fixed mapping: urgent → HOT, normal → WARM, unqualified → SPAM. No legacy lead may end up in COLD (since no legacy counterpart exists).
- **FR-032**: System MUST preserve the legacy classification rationale and urgency factors fields on existing leads after migration; the migration MUST NOT discard data.
- **FR-033**: For sub-types that do NOT have a scoring configuration, the existing classifier MUST emit the new four-value vocabulary directly (the LLM rubric is updated to produce the new labels).
- **FR-034**: System MUST emit a structured log entry at every lead finalization that includes the lead's classification, score (if numeric), reasons (if any), captured sub-type slug, and which hard-override rule fired (if any). The log entry MUST NOT contain captured PII (name, phone digits, email address contents); only rule names and category-level metadata are permitted.

#### Seed data

- **FR-035**: System MUST ship default scoring configuration for the (Personal Injury, Car Accident) sub-type, including all eight scoring questions, every chip's weight, both classification-threshold tables, and all four hard-override rules enabled.
- **FR-036**: System MUST provide a one-time idempotent remediation that backfills the Car Accident scoring configuration for accounts provisioned before this feature shipped, mirroring the precedent set by spec 014's default-sub-type backfill.
- **FR-037**: System MUST NOT overwrite an admin's customisations when the remediation runs; the remediation MUST be safe to run more than once.

#### Boundary semantics

- **FR-038**: For a Self-requester, classification boundaries MUST be: SPAM = 0–25, COLD = 26–50, WARM = 51–75, HOT = 76–100 (all inclusive).
- **FR-039**: For a Family/Friend-requester, classification boundaries MUST be: SPAM = 0–25, WARM = 26–75, HOT = 76–100 (no COLD bucket; all inclusive).
- **FR-040**: System MUST resolve any apparent boundary ambiguity by treating the lower bound as inclusive and assigning the score to the highest classification whose range contains it.

### Key Entities

- **Lead Score**: A numeric value in 0–100 representing the case strength of a captured lead. Computed deterministically from the visitor's chip selections on the scoring questions. Capped at 100 and floored at 0. Only meaningful for sub-types that have a scoring configuration; absent (placeholder) for sub-types without one and for legacy migrated leads.

- **Classification**: A categorical label in {HOT, WARM, COLD, SPAM} representing the lead's quality. Derived from the lead score via the appropriate classification-threshold table (Self vs Family/Friend), then potentially downgraded to SPAM by hard-override rules. The single user-facing classification value displayed in the dashboard. Replaces the legacy `urgent` / `normal` / `unqualified` enum.

- **Reasons**: An ordered, human-readable list of short phrases (e.g., "Recent accident", "Emergency room treatment", "Other driver at fault") that explain why a lead landed in its classification. A scoring chip is included in the list if and only if the absolute value of its score weight is at least 5 (i.e., weight ≤ −5 or weight ≥ +5); chips with weights in the inclusive range −4 to +4 (including 0-weight "I Don't Know" chips) are excluded. Hard-override rule names are always appended after any chip-derived phrases. Empty for leads that were not scored numerically.

- **Request Type Metadata**: A captured but unscored value indicating whether the visitor is asking about their own matter (`SELF`) or someone else's (`FRIEND_FAMILY`). Selects which classification-threshold table applies. Stored alongside the lead for routing and filtering.

- **Geographic Qualification Metadata**: A captured but unscored value indicating whether the incident took place inside (`IN_SERVICE_AREA`) or outside (`OUTSIDE_SERVICE_AREA`) the firm's service area, plus optional free-text city and state when outside. Stored alongside the lead for routing and filtering.

- **Scoring Configuration (per sub-type)**: The bundle of admin-editable settings that govern scoring for a single sub-type: the Self classification-threshold table, the Family/Friend classification-threshold table, the set of enabled hard-override rules, and (read-only in MVP) the list of scoring questions with their chips and chip weights. A sub-type with no scoring configuration falls through to the legacy classifier.

- **Scoring Question**: A single question presented to the visitor whose chip-based answer contributes to the score. Each chip carries an integer weight. "I Don't Know" chips contribute 0. Multi-question scoring is purely additive in MVP.

- **Hard-Override Rule**: A named, fixed-function predicate that — when its condition is met — forces the lead's classification to SPAM and appends a corresponding reason. The rule set is fixed in MVP (missing-contact, out-of-scope, no-injury-no-treatment, fake-info); admins can toggle each rule on or off per sub-type but cannot author new rules in MVP.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For Personal Injury → Car Accident leads in MVP, the same captured chip selections produce the same classification on 100% of repeated runs (deterministic).
- **SC-002**: 100% of leads finalized for the configured sub-type carry a numeric score, a classification, and a non-empty reasons array.
- **SC-003**: 100% of leads matching any enabled hard-override rule are classified SPAM.
- **SC-004**: The leads dashboard displays the new four-value scheme on 100% of leads (legacy and new) with no row showing an unrecognised classification value.
- **SC-005**: A lawyer can identify why any given scored lead landed in its classification within 5 seconds of opening the leads dashboard, without leaving the leads list page.
- **SC-006**: An admin can change a classification threshold for a configured sub-type and observe the new threshold reflected in the next visitor session within one save-and-reload cycle.
- **SC-007**: Adjusting the classification thresholds or hard-override toggles for any sub-type that already has a scoring configuration requires zero engineering work — the admin completes the change entirely from the dashboard. (Authoring new scoring questions or chip weights is out of MVP scope and remains an engineering change.)
- **SC-008**: 100% of leads created before this feature was deployed are visible after migration with their classification mapped from the legacy classification.
- **SC-009**: Visitors completing the SOP for the configured sub-type take no more than 2 minutes longer to finalize than visitors completing the legacy SOP, end to end. (The eight scoring questions add chip-tap interactions; visitor disengagement risk is bounded.)
- **SC-010**: The lawyer-perceived false-HOT rate (HOT leads that the lawyer judges as not actually qualified) drops by at least 30% compared to the legacy LLM classifier baseline, measured over a sample of at least 50 finalized car-accident leads after launch.

## Assumptions

- The user has chosen Personal Injury → Car Accident as the only sub-type with scoring configuration in MVP. All other sub-types continue to use the existing classifier.
- The eight scoring questions, their chip labels, and their chip weights are taken from `lex-chat.xlsx` exactly as defined; the design narrative `lead-classification-revamp.md` and refinements `lead-classification-cr.md` provide rationale only and lose to the xlsx where they conflict.
- The Self classification table (HOT 76–100, WARM 51–75, COLD 26–50, SPAM 0–25) and Family/Friend classification table (HOT 76–100, WARM 26–75, SPAM 0–25) match the xlsx exactly.
- The hard-override rule set is fixed at four rules in MVP (missing-contact, out-of-scope, no-injury-no-treatment, fake-info). Authoring new rules is explicitly out of scope.
- Editing scoring questions and chip weights from the dashboard is out of scope for MVP; admins see them as a read-only preview. The xlsx-defined values ship as defaults; changes require an engineering change in MVP.
- The xlsx-hinted future decomposition (Case Value Score with Injury Severity / Liability / Lost Wages / Medical Treatment / Evidence sub-scores; separate Urgency Score) is explicitly deferred to a post-MVP iteration. The architecture must not preclude it.
- Score recomputation for already-finalized leads when an admin changes the scoring configuration is out of scope; scoring is point-in-time at capture.
- Scoring configuration import/export and A/B testing are out of scope.
- The existing SOP runtime (spec 010) and the sub-type chip rendering work (spec 014) are stable and can be built upon. The eight scoring questions reuse the existing chip / state-machine / advancer pipeline.
- The captured-label snapshot field added in spec 014 is available on every captured chip and is suitable as the source of human-readable reason phrases.
- The structured-log surface emitted at finalization is consumed only by the existing logging pipeline; no new alerting or external observability integration is required.
- Lawyers will be told the four-value vocabulary replaces the previous three-bucket vocabulary. No backward-compatible API surface for the legacy enum is required.
