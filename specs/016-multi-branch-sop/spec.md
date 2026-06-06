# Feature Specification: Multi-Branch SOP Workflow

**Feature Branch**: `016-multi-branch-sop`

**Created**: 2026-06-06

**Status**: Draft

**Input**: User description: "After implementing 015-lead-classification-revamp, the Personal Injury → Car Accident scoring questions are leaking into other case types (e.g., Criminal Defense → Assault Charges). The SOP must become a multi-branch workflow: only sub-types that have an explicitly configured branch ask branch-specific scoring questions; all other sub-types finish the default flow and stay open for free-form follow-up. Also reorder the default SOP so When and Contact are captured before any branch-specific questions. Default SOP becomes: (1) case type → (2) sub-type → (3) where → (4) what → (5) when → (6) contact → (7) optional configured branch. Admins must be able to configure branches and per-question lead-score weights from the dashboard."

## Clarifications

### Session 2026-06-06

- Q: How should the system handle a visitor who refuses or skips Step 6 (contact)? → A: Partial gate — at minimum ONE of (email, phone) must be provided to proceed. Name is optional. Refusal of BOTH email and phone ends the SOP without capturing a lead; the conversation stays open. No configured branch may fire without at least one reachable contact.
- Q: How should a lead be classified when a visitor abandons mid-branch (after Step 6 contact capture)? → A: Score whatever branch chips were captured against the branch's configured thresholds. The lead carries a numeric `lead_score` (computed from partial answers), a `classification` derived from the thresholds applied to the partial score, a `reasons` array populated for the captured chips, AND a `branch_incomplete: true` flag visible to lawyers. The legacy classifier is NOT used for partial-branch leads.
- Q: What happens to the legacy `analyzeAndFollowUp` AI-follow-up tool that introduced the bug? → A: Remove `analyzeAndFollowUp` from the agent's tool registry entirely. The Vercel AI SDK runtime no longer sees the tool. Spec 010 FR-024 through FR-028 (the dynamic AI follow-up step) are formally superseded by this spec's deterministic branch model. No code path may re-register or invoke the tool.
- Q: What UX format should Step 6 (contact capture) use? → A: Single free-text conversational turn. The assistant asks "What's your name and how can we reach you?" and the visitor responds in natural language; the agent extracts name, email, and phone from that single response (the same extraction already works per the negative-flow JSON). No structured form widget is introduced. If extraction yields nothing for both email and phone, the FR-002a refusal/retry flow engages.
- Q: How should skip-detection handle contact info volunteered before Step 6 is reached in sequence? → A: Sequence-safe capture. Contact volunteered earlier in the conversation MUST be parsed and stored into the Step 6 fields (`name`, `contact_email`, `contact_phone`), but Step 6 MUST NOT be marked complete (and the progress bar MUST NOT advance to 6/6) until the runtime reaches Step 6 in sequence (Steps 1–5 all complete) per spec 010 FR-019. When Step 6 is reached, the assistant MUST confirm the captured contact ("I have you as Sarah at sarah@example.com — does that look right?") before treating Step 6 as satisfied; the visitor can correct or add missing fields at that point.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Unconfigured sub-type skips branch questions and stays open (Priority: P1)

A visitor reports an Assault Charges matter (Criminal Defense → Assault Charges). No branch is configured for that (case_type, sub_type) pair. The assistant walks the visitor through the six default steps in order — case type, sub-type, where, what, when, contact — captures the lead, emits the configured finalization message, and then stays open for any further questions the visitor wants to ask. At no point does the assistant ask car-accident-specific questions ("Were you a driver or passenger?", "Has insurance contacted you?", "Did this affect your ability to work?").

**Why this priority**: This is the regression introduced by 015 and the user's stated bug. Until this is fixed, every non-Car-Accident lead is contaminated with irrelevant questions, which damages trust and skews captured data.

**Independent Test**: Open the widget, choose Criminal Defense → Assault Charges, answer where / what / when / contact in order, and verify (a) no scoring chips for car-accident questions ever appear, (b) the lead is captured after contact is provided, (c) the assistant ends with an open-ended re-prompt and answers a follow-up free-form question without re-running the SOP.

**Acceptance Scenarios**:

1. **Given** a visitor selects a (case_type, sub_type) pair that has no branch configuration, **When** the SOP advances past Step 6 (contact), **Then** no branch-specific questions are presented and the lead is finalized using the default flow.
2. **Given** the visitor finalizes a lead for an unconfigured sub-type, **When** the assistant emits the finalization message, **Then** the conversation remains open and any subsequent visitor message is answered as an open-ended question (no SOP re-run).
3. **Given** the visitor switches sub-type mid-conversation from a configured branch to an unconfigured one, **When** the new sub-type is captured, **Then** any branch-specific answers from the abandoned branch are discarded and no further branch questions are asked.

---

### User Story 2 — Configured Car Accident branch fires after contact capture (Priority: P1)

A visitor reports a Personal Injury → Car Accident matter. After the six default steps complete, the assistant transitions into the Car Accident branch and asks the configured scoring questions one at a time (driver/passenger role, injuries, insurance contact, work impact, etc.). Each question's chip selection contributes its configured weight to the lead score. At branch completion, the lead is re-classified using the score, the finalization message is emitted, and the conversation stays open.

**Why this priority**: This is the only configured branch in MVP and the primary scoring path; the lead-score quality of the firm's most valuable case type depends on it firing correctly.

**Independent Test**: Walk a visitor through Personal Injury → Car Accident, complete all six default steps, and confirm (a) branch questions appear only after contact, (b) chip selections accumulate the documented weights, (c) the final lead carries a numeric score and a HOT/WARM/COLD/SPAM classification consistent with the score thresholds.

**Acceptance Scenarios**:

1. **Given** the captured (case_type, sub_type) is (Personal Injury, Car Accident), **When** the visitor completes Step 6 (contact), **Then** the branch's first scoring question is presented as the next assistant turn.
2. **Given** the visitor is mid-branch on Car Accident, **When** they tap a configured chip, **Then** that chip's configured weight is added to the running lead score and the next branch question is presented.
3. **Given** the visitor completes all branch questions, **When** the branch finishes, **Then** the lead is finalized with `lead_score` set, `classification` derived from the score thresholds, `reasons` populated, and the finalization message is emitted.
4. **Given** branch execution fails (configuration malformed, chip slug missing, runtime error), **When** the failure is detected, **Then** the lead is still captured per the safe-default behaviour established in 015 (`lead_score = null`, `classification = SPAM`, `reasons = ["scoring_error"]`) and the conversation stays open.

---

### User Story 3 — Reordered default SOP captures contact before branch (Priority: P1)

The default SOP runs in this order: case type → sub-type → where → what → when → contact. Contact (name + email + phone) is collected as the sixth default step, BEFORE any branch-specific scoring questions execute. This guarantees that even when a visitor abandons mid-branch, the firm has the lead's identity and reachable contact information.

**Why this priority**: Contact information is the single most valuable artefact of any chat; capturing it before the branch eliminates the risk that a visitor drops off during long branch flows (Car Accident has eight scoring questions in MVP) and leaves the firm without a way to follow up.

**Independent Test**: Begin a Car Accident conversation, advance to Step 6 (contact), provide name / email / phone, and confirm the lead row in the database has `name`, `contact_email`, and `contact_phone` populated BEFORE any branch question is asked. Then abandon the conversation mid-branch and verify the firm still has a usable lead record.

**Acceptance Scenarios**:

1. **Given** a fresh chat, **When** the visitor completes case type, sub-type, where, what, and when in order, **Then** Step 6 prompts for the visitor's name and contact details (email and phone) before any branch question.
2. **Given** Step 6 is complete and the captured (case_type, sub_type) has a configured branch, **When** the SOP advances, **Then** the branch's first question is presented next.
3. **Given** a visitor abandons the conversation mid-branch (after contact is captured), **When** the lead is reviewed in the dashboard, **Then** the lead carries name, email, phone, the captured default-step values, and a partial-branch indicator (no final score yet — score is derivable from whatever chips were captured but the lead is flagged as branch-incomplete).

---

### User Story 4 — Admin configures branches and per-question weights from the dashboard (Priority: P1)

A law-firm administrator opens the SOP dashboard, navigates to the Branches tab, and sees the list of (case_type, sub_type) pairs. For pairs that already have a branch configured, they can expand the row to view the branch's ordered question list and per-chip weight table. They can edit chip weights, edit the question text, reorder questions, add a new question (with chip list and per-chip weights), remove a question, and toggle the branch active/inactive. Saved edits create a new branch version (consistent with the existing dashboard versioning model) and apply to the next visitor session.

**Why this priority**: The user explicitly asked for admin-side configuration of branches and per-question lead scores. Without this, the multi-branch architecture is useful in code only; the firm cannot tune scoring without engineering work.

**Independent Test**: Log in as admin, open the SOP dashboard's Branches tab, expand the Personal Injury → Car Accident branch, change a chip's weight (e.g., "Driver" from 10 to 15), save, reload, and confirm the new weight persists. Walk a visitor through Car Accident with that chip selected and confirm the running lead score reflects the new weight.

**Acceptance Scenarios**:

1. **Given** the admin opens the Branches tab, **When** the page renders, **Then** they see all (case_type, sub_type) pairs with a clear "configured" / "not configured" indicator and an action to add a branch for any unconfigured pair.
2. **Given** the admin expands a configured branch, **When** the panel renders, **Then** they see the ordered list of questions, each question's chips, each chip's weight, the classification thresholds (Self and Family/Friend), and the hard-override toggles.
3. **Given** the admin edits a chip weight and clicks Save, **When** the save completes, **Then** a new branch version is created (`is_published = false`) and a Publish action makes it the live branch.
4. **Given** the admin adds a new question to a branch, **When** the question is saved with chip labels and per-chip weights, **Then** the next visitor session for that (case_type, sub_type) presents the new question in the configured order.
5. **Given** the admin toggles a branch to inactive, **When** the change is published, **Then** new visitor sessions for that (case_type, sub_type) skip the branch and use the default-only flow (effectively the unconfigured-branch behaviour).

---

### User Story 5 — Open-ended conversation continues after default-only finalization (Priority: P2)

A visitor finishes the default SOP for an unconfigured sub-type, receives the firm's finalization message, and then asks "What does Attorney Shrager charge for an initial consultation?" The assistant answers from the firm's configured information within guardrail boundaries, ends the turn with an open-ended re-prompt, and never re-asks the SOP. The conversation continues until the visitor types a goodbye phrase.

**Why this priority**: Open-ended continuation already exists for the configured-branch path (per spec 010 §G); P2 because it must continue to work uniformly for the unconfigured path now that branches diverge.

**Independent Test**: Complete an Assault Charges flow through Step 6, then ask three free-form follow-up questions in a row, and verify (a) each is answered within guardrails, (b) no SOP question is re-asked, (c) the assistant never volunteers a goodbye unless the visitor uses a goodbye phrase.

**Acceptance Scenarios**:

1. **Given** the lead is captured and the SOP is complete via the default-only path, **When** the visitor sends a follow-up message, **Then** the assistant answers within guardrail boundaries and ends with an open-ended re-prompt.
2. **Given** the visitor has finalized via the default-only path, **When** they send a goodbye phrase, **Then** the assistant emits the configured polite closing message.

---

### Edge Cases

- **Visitor selects a case-type chip whose sub-type list is empty**: the SOP skips Step 2 (sub-type) and proceeds to Step 3 (where), per spec 010 FR-011. The branch lookup uses (case_type, null); since no branch is configured for null sub-type, the default-only flow runs.
- **Visitor changes case_type or sub_type after Step 6 (contact)**: contact information is preserved on the lead record; previously captured branch answers (if any) are discarded; the SOP re-evaluates the branch lookup against the new (case_type, sub_type) pair and either fires the new branch or finalizes via the default-only path.
- **Branch configured but with zero questions**: treated as unconfigured (default-only flow runs and the lead finalizes after Step 6). The dashboard MUST surface a validation warning when an admin saves a branch with zero questions.
- **Multiple branches simultaneously configured**: each (case_type, sub_type) pair has at most one branch. Admin attempts to create a second branch for an already-configured pair MUST be rejected with a clear error.
- **Visitor abandons mid-branch after contact capture**: the lead is already in the database (captured at Step 6); chip selections made before abandonment are persisted as partial branch state. Per FR-011a, the partial chips ARE scored against the branch's configured thresholds: the lead carries a numeric `lead_score`, a `classification` derived from those thresholds applied to the partial score, a `reasons` array populated for the captured chips, AND a `branch_incomplete: true` flag visible to lawyers. The legacy classifier is NOT used for partial-branch leads.
- **Branch question references a chip slug that no longer exists in the case-type chip list**: the question is presented as free-text only (no chips); the visitor's free-text answer is captured but contributes zero to the score; a structured ERROR log is emitted naming the missing slug.
- **Admin publishes a branch change mid-conversation**: in-flight conversations continue with the branch version they started with (consistent with spec 010 FR-044). New conversations pick up the published version on next start.
- **Visitor asks an off-SOP question while inside a branch**: the assistant answers within guardrails and resumes by asking the next pending branch question (consistent with spec 010 FR-020 / FR-021 / FR-023, extended to branch steps).
- **Visitor refuses contact at Step 6**: per FR-002 / FR-002a, at least one of {email, phone} is required. The assistant retries up to twice with escalating language. If the visitor still refuses both after the second retry, the SOP terminates without `captureLead`; no lead is recorded; the conversation stays open. The assistant emits the configured polite acknowledgement (e.g., "Understood — I'm here if you need anything else.") and answers any further free-form questions within guardrails.
- **Visitor provides only one of {email, phone} at Step 6**: Step 6 is satisfied. The lead row carries the provided field and a null in the other. Any configured branch fires normally; the dashboard surfaces a "single-channel contact" indicator on the lead.
- **Visitor provides email/phone in a format that fails validation**: the assistant asks once for correction (without counting as a refusal retry); if the corrected input still fails validation OR the visitor refuses to correct, the field is treated as not-provided for the purpose of FR-002 satisfaction (the other channel must then be present, otherwise the FR-002a refusal flow engages).

## Requirements *(mandatory)*

### Functional Requirements

#### FR Group A — Default SOP Reorder

- **FR-001**: The default SOP MUST run in this order: (1) case type, (2) sub-type, (3) where, (4) what, (5) when, (6) contact. Branch-specific questions MUST run AFTER Step 6 and never before.
- **FR-002**: Step 6 (contact) MUST capture the visitor's name, email, and phone number via a single free-text conversational turn. The assistant prompt MUST be a configurable single question (default: "What's your name and how can we reach you?"). The visitor's response MUST be parsed by LLM-based extraction to populate the lead row's `name`, `contact_email`, and `contact_phone` fields. No structured form widget is introduced. Step 6 MUST be considered satisfied when extraction yields at least ONE of {email, phone}; name is optional. Whatever subset is provided MUST be persisted to the lead record before any branch question is asked.
- **FR-002a**: When the visitor's free-text response yields neither email nor phone (extraction returns nulls for both), the assistant MUST attempt up to two polite re-prompts that explain reachable contact is required to proceed (the exact retry text is configurable). On a third refusal (still no email and no phone after the second re-prompt), the SOP MUST terminate without invoking `captureLead`: no lead row is created, no branch is started, no finalization message is emitted. The assistant MUST emit a configured polite acknowledgement and the conversation MUST stay open for free-form follow-up.
- **FR-002b**: A configured Branch MUST NOT fire when Step 6 has not been satisfied per FR-002. The contact-before-branch invariant is absolute: every lead row created by this system MUST carry at least one of {`contact_email`, `contact_phone`}.
- **FR-003**: The default qualified-lead threshold (progress bar `N`) MUST be updated to `6` so the bar reaches 100% at contact capture, regardless of whether a branch follows.
- **FR-004**: The reorder MUST ship as part of the seeded default SOP (`pnpm db:seed`) AND as a one-time idempotent remediation that updates pre-existing accounts to the new step order, mirroring the precedent set by spec 014's default-sub-type backfill and spec 015's scoring-config backfill.
- **FR-005**: All step-skip-detection behaviour from spec 010 (FR-016 through FR-019) MUST continue to work against the new six-step order. Skip detection of multiple values in a single visitor message MUST advance the bar accordingly.
- **FR-005a**: Contact information (name, email, phone) volunteered before Step 6 is reached in sequence MUST be parsed and stored into the Step 6 fields (`name`, `contact_email`, `contact_phone`), but Step 6 MUST NOT be marked complete and the progress bar MUST NOT advance to 6/6 until the runtime reaches Step 6 in sequence (per spec 010 FR-019 sequence-safety rule). When Step 6 is reached and contact has already been captured via skip-detection, the assistant MUST emit a configurable confirmation prompt (default: "I have you as {name} at {email_or_phone} — does that look right?") that surfaces the captured values and lets the visitor correct or add missing fields. Step 6 is satisfied when the visitor confirms or supplies the missing field(s) such that at least one of {email, phone} is on file (per FR-002).

#### FR Group B — Multi-Branch Routing

- **FR-006**: The SOP runtime MUST treat any (case_type, sub_type) pair as having an optional configured branch. The branch lookup is performed AFTER Step 6 (contact) is captured, not earlier.
- **FR-007**: When the captured (case_type, sub_type) has no configured (or no active) branch, the runtime MUST finalize the lead using the default-only flow: capture-lead is invoked with the captured Step 1–6 values, the legacy four-value classifier supplies the classification, `lead_score` is set to `null`, and the finalization message is emitted.
- **FR-008**: When the captured (case_type, sub_type) has an active configured branch, the runtime MUST present the branch's first question as the next assistant turn after Step 6. Branch questions MUST be presented one at a time in their configured order.
- **FR-009**: A branch is uniquely identified by the (case_type_slug, sub_type_slug) pair. At most one active branch may exist per pair. Inactive (disabled) branches behave identically to no-branch (default-only flow).
- **FR-010**: When a visitor changes case_type or sub_type AFTER the branch has started, captured branch answers for the abandoned path MUST be discarded; the runtime re-evaluates the branch lookup against the new pair and either starts the new branch or finalizes via the default-only flow. Captured Step 1–6 default values are preserved (subject to the same correction rules from spec 010).
- **FR-011**: Branch execution MUST be resilient: configuration errors, missing chip slugs, and runtime exceptions during branch advancement MUST NOT block lead capture. The safe-default behaviour established in spec 015 FR-010b applies (`lead_score = null`, `classification = SPAM`, `reasons = ["scoring_error"]`, ERROR-level structured log).
- **FR-011a**: When a visitor abandons a configured branch mid-flow (session timeout, browser close, or explicit termination AFTER Step 6 has been satisfied per FR-002), the system MUST score whatever branch chips were captured against the branch's configured thresholds. The resulting lead row MUST carry: a numeric `lead_score` computed from the captured-chip subset, a `classification` derived from applying the branch's thresholds to that partial score, a `reasons` array populated for the captured chips, and a `branch_incomplete: true` flag (distinct from `branch_incomplete: false` for completed branches and from `lead_score = null` for unconfigured-branch leads). The legacy classifier MUST NOT be invoked for partial-branch leads.
- **FR-011b**: The `branch_incomplete` flag MUST be surfaced in the dashboard's lead list and lead detail views so lawyers can distinguish completed-branch leads, partial-branch leads, default-only leads, and scoring-error leads at a glance.
- **FR-012**: After branch completion (or after default-only finalization), the conversation MUST remain open per spec 010 FR Group G (no goodbye unless visitor uses a goodbye phrase, every assistant turn ends with an open-ended re-prompt).

#### FR Group C — Branch Configuration Model

- **FR-013**: A Branch entity MUST be persisted per (case_type_slug, sub_type_slug) pair, containing: ordered list of branch questions, each question's chip list, each chip's numeric weight, classification thresholds (Self table and Family/Friend table), hard-override toggles, an `is_active` flag, and version metadata (consistent with spec 010 FR-053 versioning model).
- **FR-014**: A Branch Question MUST contain: a stable question id, a position (integer order), question text, an optional preface/lead-in text, an ordered list of chips, and metadata indicating whether free-text input is allowed in addition to chips.
- **FR-015**: A Branch Chip MUST contain: a stable slug, a display label, and a numeric weight. Weights MAY be negative (penalties) or zero. The score contribution per question is the sum of selected chip weights (single-select questions sum to one chip's weight; multi-select questions sum across all selected chips).
- **FR-016**: The seeded default Branch for (Personal Injury, Car Accident) MUST be migrated forward from the spec 015 scoring configuration: same eight questions, same chips, same weights, same classification thresholds, same four hard-override rules enabled. No score regressions versus spec 015 are permitted for this branch.
- **FR-017**: Branch versioning MUST follow the existing dashboard model: Save creates a new version with `is_published = false`; Publish makes the latest the live version; in-flight conversations continue with the version they started.
- **FR-018**: When a Branch is deleted (not merely disabled), all historical lead records that reference that branch MUST retain their captured snapshot (frozen branch version + captured chip selections) so the dashboard can render the lead's history without a live branch reference.

#### FR Group D — Admin Dashboard for Branches

- **FR-019**: The dashboard MUST expose a Branches tab (or section) within the existing SOP editor page (`/dashboard/sop` per spec 010 FR-045).
- **FR-020**: The Branches view MUST list every (case_type, sub_type) pair from the firm's configured case-type chip lists, indicating for each pair whether a branch is configured, whether it is active, and a quick action to add / open / delete the branch.
- **FR-021**: Admins MUST be able to add a new branch for any (case_type, sub_type) pair that does not already have one. Adding a branch creates an empty branch (zero questions); the admin then adds questions one at a time.
- **FR-022**: Admins MUST be able to add, edit, reorder (drag-and-drop), and remove questions within a branch. Each question's text, chip list, per-chip weights, and free-text-allowed flag MUST be editable.
- **FR-023**: Admins MUST be able to edit per-chip lead-score weights with numeric inputs. The dashboard MUST surface validation that flags negative-weight totals that would push the maximum theoretical score below zero, and weight totals that would push the maximum theoretical score above 100 (the lead-score range remains 0–100 from spec 015 FR-001; out-of-range inputs are clamped at finalization but the editor warns the admin).
- **FR-024**: Admins MUST be able to edit classification thresholds (Self table and Family/Friend table) and toggle hard-override rules per branch, exactly as specified in spec 015 FR-018 / FR-019, but now scoped to the Branch entity.
- **FR-025**: Admins MUST be able to toggle a branch's `is_active` flag. An inactive branch is preserved (history and configuration intact) but is not used for new conversations.
- **FR-026**: Admins MUST be able to delete a branch entirely, with a confirmation dialog that warns about the historical lead-snapshot retention behaviour from FR-018.
- **FR-027**: The Branch editor MUST integrate with the existing Preview & Test chat (per spec 007 §8.10 and spec 010 FR-054): preview conversations use the unpublished branch version.
- **FR-028**: All Branch dashboard mutations MUST be persisted with the same audit-log model used by the SOP editor (per spec 007 versioning); each Save and Publish creates a record attributable to the admin user.

#### FR Group E — Migration & Compatibility

- **FR-029**: The pre-existing spec 015 scoring configuration for (Personal Injury, Car Accident) MUST be migrated to the new Branch model on first deploy. The migration MUST be idempotent and preserve all chip weights, thresholds, and hard-override toggles. Pre-existing leads tied to spec 015 scoring configuration MUST continue to render in the dashboard with their historical scores intact.
- **FR-030**: Pre-existing legacy SOP configurations (firms that have only the default 5-step SOP from spec 010) MUST be auto-migrated to the new 6-step order with `contact` inserted as Step 6. The migration MUST run on first dashboard load after deploy and MUST be idempotent.
- **FR-031**: The progress-bar contract from spec 010 FR Group E MUST continue to apply: the bar reaches 100% at the end of Step 6 (default `N = 6`); branch questions do not advance the bar.
- **FR-032**: The `captureLead` tool from spec 006 MUST continue to be invoked at finalization; for branches, finalization happens after the branch's last question (or after the default-only flow's Step 6). Captured branch chip selections MUST be passed to the scoring engine before `captureLead` is invoked, so the lead row carries the final score and classification.
- **FR-033**: The structured-log events from spec 010 FR Group I and spec 015 FR-034 MUST be extended with: `branch_started` (emitted when a branch's first question is presented), `branch_question_answered` (emitted on each chip selection or free-text capture), `branch_completed` (emitted when the branch finishes successfully), and `branch_skipped` (emitted when the lookup finds no active branch and the default-only flow finalizes). PII redaction rules from spec 015 FR-034 still apply.

#### FR Group F — Bug Fix Acceptance

- **FR-034**: System MUST NOT present any branch-specific question to a visitor whose captured (case_type, sub_type) pair has no active configured branch. (Direct fix for the negative SOP flow captured in `negative-sop-flow.json`.)
- **FR-035**: The `analyzeAndFollowUp` tool (and any equivalent generic AI-follow-up tool registered with the agent runtime) MUST be removed from the agent's tool registry as part of this feature. Spec 010 FR-024 through FR-028 (the generic dynamic AI follow-up step) are formally superseded by the multi-branch routing model in this spec. No code path may re-register or invoke an AI-generated follow-up tool; the assistant's behaviour after Step 6 is governed entirely by FR-007 (default-only finalization) or FR-008 (configured-branch execution). For sub-types without a configured branch, the lead finalizes directly per FR-007 — no AI-generated follow-up runs.

### Key Entities

- **Branch**: A configurable, ordered set of scoring questions tied to a single (case_type_slug, sub_type_slug) pair. Owns: question list, classification-threshold tables (Self and Family/Friend), hard-override toggles, an `is_active` flag, version metadata. At most one active Branch per (case_type, sub_type) pair.
- **Branch Question**: A single question presented to the visitor inside an active Branch. Owns: stable id, position, question text, optional preface, chip list reference, and a `free_text_allowed` flag. Replaces the spec 015 "scoring question" concept by widening it to per-branch instead of per-sub-type.
- **Branch Chip**: A selectable answer option within a Branch Question. Owns: stable slug, display label, numeric weight (signed integer, may be negative or zero). Score contribution = sum of selected chips' weights per question.
- **Default SOP (revised)**: The six-step default flow: case type → sub-type → where → what → when → contact. Threshold `N = 6`. Branch questions execute AFTER Step 6 and are not part of the default SOP.
- **Lead Branch Snapshot**: A frozen record on the lead row that captures, at finalization OR at session abandonment, the Branch version used, the per-question captured chip selections (which may be a partial subset for abandoned sessions), and the resulting score / classification / reasons. The snapshot also stores the `branch_incomplete` flag (true for partial-branch leads per FR-011a, false for completed-branch leads). This survives even if the live Branch is later edited or deleted.
- **Branch Lookup Result**: The outcome of routing a captured (case_type, sub_type) pair: either `{ branch: <Branch>, version: <int> }` or `{ branch: null }`. Drives whether the runtime enters branch execution or finalizes via the default-only flow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new leads captured for sub-types without a configured branch finalize using the default-only flow (no branch-specific question is ever presented). Verified by replaying the negative-SOP-flow scenario from `negative-sop-flow.json` and confirming the assistant never asks driver/passenger, insurance, or work-impact questions.
- **SC-002**: 100% of new leads captured for (Personal Injury, Car Accident) — including partial-branch leads — carry a numeric `lead_score` and a classification consistent with the configured thresholds. Completed-branch leads carry `branch_incomplete: false`; partial-branch leads carry `branch_incomplete: true`. Matches spec 015's measurable outcomes for the completed-branch case.
- **SC-003**: 100% of leads recorded by the system carry at least one of {`contact_email`, `contact_phone`} populated; no lead row is ever created without at least one reachable channel. (Contact-required invariant per FR-002 / FR-002a / FR-002b.)
- **SC-004**: An admin can configure a new Branch for an unconfigured (case_type, sub_type) pair (add at least one question, set chip weights, save, publish) entirely from the dashboard in under 5 minutes, with zero engineering involvement.
- **SC-005**: An admin can change a chip weight on the Car Accident branch and observe the new weight reflected in the next visitor session within one save-and-publish cycle.
- **SC-006**: Visitors completing the default-only flow finalize within the same time budget as the spec 010 baseline (the reorder adds Step 6 contact capture but removes the spec 015 inline scoring questions for unconfigured pairs, so net time is at most 30 seconds longer than spec 010 baseline for unconfigured pairs).
- **SC-007**: Visitors completing the Car Accident branch finalize within the same time budget established by spec 015 SC-009 (no more than 2 minutes longer than the spec 010 baseline).
- **SC-008**: Zero leads are blocked or dropped due to a Branch configuration error: in 100% of branch-execution-error cases the lead is captured with the spec 015 safe-default values and an ERROR-level structured log is emitted naming the failure cause.
- **SC-009**: 100% of in-flight conversations begun before a Branch publish event continue with their starting Branch version through to finalization (no mid-conversation version switches).
- **SC-010**: The dashboard's Branches view renders for a firm with 10 case types × 5 sub-types each (50 pairs) within 1 second on a standard broadband connection.

## Assumptions

- The user has confirmed Personal Injury → Car Accident is the only branch to be configured at MVP launch; all other (case_type, sub_type) pairs use the default-only flow.
- The contact-capture step (Step 6) reuses any existing contact-capture UX from spec 006 / spec 010 (free-text + email/phone validation). No new contact-form UX framework is introduced; the step is added to the default SOP step sequence.
- The progress-bar default `N` increments from `5` (per spec 010 FR-003) to `6` to reflect the new contact step. Firms that have customized `N` to a non-default value in the dashboard will have their value migrated by adding `+1` only if their original `N` matched the original default of `5`; custom values are preserved as-is.
- The spec 015 scoring configuration model is being subsumed by the Branch model; the migration in FR-029 is a structural rename + container change, not a data-loss event. The (Personal Injury, Car Accident) Car Accident branch ships pre-populated with the same eight questions, weights, thresholds, and toggles from spec 015 FR-035 / FR-036.
- The generic spec 010 Step 6 "AI-generated 2–5 follow-up questions" behaviour is being eliminated, not just narrowed: the `analyzeAndFollowUp` tool is removed from the agent's tool registry entirely (per FR-035). When no Branch is configured, no AI follow-up runs (the lead finalizes directly); when a Branch is configured, the Branch's deterministic question list runs INSTEAD OF any AI follow-up. This intentionally trades the spec 010 AI-generated dynamism for deterministic, admin-configurable per-branch flows and eliminates the regression where car-accident questions leaked into other case types.
- Existing skip-detection behaviour from spec 010 FR Group C continues to function for Steps 1–6 of the default SOP; skip-detection is NOT extended into branch questions in MVP (branch questions are presented one-at-a-time and require explicit chip taps).
- The Branch model and its dashboard surface reuse the existing dashboard versioning, audit-log, and Preview & Test infrastructure from spec 007 and spec 010; no new admin-side framework is introduced.
- Backwards compatibility: leads finalized BEFORE this feature ships continue to render in the dashboard with their historical classification / score / reasons; the migration in FR-029 does not retro-mutate historical leads.
