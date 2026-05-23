# Feature Specification: SOP Workflow

**Feature Branch**: `010-sop-workflow`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Chat assistant workflow optimized for capturing qualified leads — a default (configurable) Standard Operating Procedure (SOP) the chat assistant follows to capture the most essential details for lead qualification. Steps: case type (chips) → sub-type (chips) → where → what → when (chips, AI date inference) → AI-generated 2–5 follow-up questions OR finalize → assistant never bids goodbye unless user does. SOP is configurable. Visible thin shiny green progress bar at the top of the widget shows x/N progress to qualified-lead threshold (default = step 5; configurable)."

**Source of Truth**: This is a NEW feature that extends and refines existing intake behavior previously specified in `006-lead-classification` (heuristic + LLM-driven captureLead) and `004-chat-api-agent` (system prompt + intake-question handling per §7.5 of `product-spec-legal-chatbot.md`). It supersedes the configuration-form "qualifying questions" surface from `007-dashboard` Section C (§4.3 Section C of the product spec) for the runtime chat-flow purpose; the dashboard surface is replaced by a richer SOP editor (see FR Group J).

## Overview

The SOP Workflow is the standardized intake flow the chat assistant follows during every conversation with a potential client, optimized to capture the minimum essential information that qualifies a lead. It replaces the loose "ask qualifying questions naturally" approach (§7.5 of the product spec) with an explicit, ordered, configurable list of steps. Each step has a question template, optional chip selections sourced from the database, and skip-logic so the assistant doesn't re-ask information the user has already volunteered.

The default SOP is opinionated and ships pre-seeded:

1. **Greeting** (firm-styled).
2. **Case type** — selectable chips (DUI, drug crime, personal injury, …) from configurable database list.
3. **Sub-type** — selectable chips depending on the chosen case type, also configurable. Out-of-scope case types route to a configured deflection.
4. **Where did it happen?**
5. **What happened?**
6. **When did it happen?** — chips for common ranges; free-text accepted; AI infers calendar date from natural-language input ("last night" → an ISO date).
7. **AI-driven follow-up** — after the prior steps, the agent runs an analysis and generates 2–5 dynamic questions tailored to the matter; OR if information is already sufficient, finalizes the lead and tells the user how to be contacted.
8. **Conversational continuation** — assistant never bids goodbye unless the user does; otherwise re-prompts "how can I help?"

The user sees a thin shiny green progress bar at the top of the widget showing `x / N` progress, where N is the configurable count of SOP steps that mark qualified-lead completion (default: step 5, "When did it happen"). Once the threshold is reached the bar shows 100%; conversation continues open-ended afterward.

The SOP is **configurable per firm**: lawyers can reorder steps, add steps, remove steps, and edit chip lists from the dashboard.

The assistant **does not refuse off-SOP queries**: when the user asks something unrelated (e.g., "What are your office hours?"), the assistant answers within the existing guardrail boundaries, then resumes the next pending SOP step at the end of its response.

This is a behavior-and-data feature that touches the agent runtime (`004-chat-api-agent`), the chat widget UI (`005-chat-widget`), the lead classification logic (`006-lead-classification`), and the dashboard configuration form (`007-dashboard`).


## User Scenarios & Testing *(mandatory)*

### User Story 1 — Visitor Completes the Default SOP and Becomes a Qualified Lead (Priority: P1)

A visitor opens the chat widget, sees a friendly greeting, and is asked what type of case they need help with via chips. They tap "DUI"; the assistant follows up with sub-type chips ("First offense", "Repeat offense", "DUI with injury", …), they tap one. They answer where, what, and when in turn (with chip suggestions where applicable). The progress bar rises 1/5, 2/5, 3/5, 4/5, 5/5 as each step completes. After step 5 the agent runs analysis and asks 2–4 tailored follow-up questions. After enough information is gathered, the assistant tells the visitor "We have what we need; someone will reach out at the contact info you've provided." The conversation continues open-ended; if the visitor asks anything else, the assistant answers without re-running the SOP.

**Why this priority**: This IS the product. Every other feature exists to make this flow work. Without a deterministic SOP, the chatbot's lead-qualification value proposition (§1.5 of the product spec) is delivered inconsistently across visitors.

**Independent Test**: Open the widget on the seeded test app, drive the conversation through the default SOP, and verify (a) chips appear and are tappable, (b) the progress bar advances as steps complete, (c) Step 5 triggers the bar to 5/5, (d) Step 6 generates 2–5 follow-up questions, (e) finalization message is shown, (f) post-finalization conversation continues open-ended.

**Acceptance Scenarios**:

1. **Given** a fresh chat, **When** the assistant greets the visitor, **Then** Step 1 (case-type chips) is presented with the firm's configured default greeting prefix.
2. **Given** the visitor taps a case-type chip, **When** the chip's sub-types are configured, **Then** Step 2 displays the matching sub-type chips.
3. **Given** the visitor taps a case-type chip, **When** the chip is configured as out-of-scope for this firm, **Then** the assistant emits the configured out-of-scope deflection and the SOP terminates as `unqualified` (per `006-lead-classification` §7.4 outcomes).
4. **Given** Steps 3, 4, 5 are pending, **When** the assistant asks each in turn, **Then** the progress bar increments by one for each successfully captured answer.
5. **Given** Step 5 ("When") receives a natural-language answer like "last night", **When** the agent processes the input, **Then** the captured value is normalized to an ISO date relative to the conversation timestamp.
6. **Given** Step 5 is complete and the configured threshold is `5`, **When** the bar reaches 5/5, **Then** the bar visually fills to 100% and stays full for the remainder of the conversation.
7. **Given** all 5 default SOP steps are complete, **When** the agent runs Step 6 analysis, **Then** between 2 and 5 follow-up questions are asked OR a finalization message is emitted (when information is already sufficient).
8. **Given** the SOP is complete, **When** the visitor asks an unrelated question, **Then** the assistant answers within guardrails without re-running the SOP.

---

### User Story 2 — Visitor Volunteers Multiple SOP Answers in One Message (Priority: P1)

A visitor's first message reads: "Hi, I was hit by a driver running a red light at the corner of 5th and Main last week. I think I have a personal-injury case." The assistant detects that case type (personal injury), what happened (car accident), where (5th and Main), and when (last week) were all volunteered. It skips Steps 2–5's "Where/What/When" questions and asks only the remaining unanswered step (sub-type of personal injury) before continuing to Step 6.

**Why this priority**: A rigid SOP that re-asks already-answered questions feels robotic and loses leads. The user's description explicitly calls this out: "If the user ends up giving one or more information in the SOP in a single input itself, the assistant should be able to intelligently skip the questions that are answered."

**Independent Test**: Open the chat, paste a multi-detail opening message, and verify the assistant skips the answered steps. The progress bar should jump forward by the number of skipped steps.

**Acceptance Scenarios**:

1. **Given** a visitor message containing N implicit SOP answers, **When** the agent processes it, **Then** N steps are marked complete and the progress bar advances by N.
2. **Given** the assistant has skipped steps, **When** it issues its next prompt, **Then** the prompt is for the **next pending** step (in configured SOP order), not a re-ask of an already-answered step.
3. **Given** an implicit answer is ambiguous (e.g., "I had an accident" — case type unclear: personal injury vs. property damage), **When** the agent processes it, **Then** the corresponding SOP step is NOT marked complete; the agent asks a disambiguating question.

---

### User Story 3 — Visitor Asks Off-SOP Question Mid-Flow (Priority: P1)

Mid-SOP, after Step 2 (sub-type), the visitor asks "What are your office hours?" The assistant pauses the SOP, answers from the configured contact info (within guardrail boundaries), and then resumes by asking Step 3 ("Where did it happen?") at the end of its response.

**Why this priority**: The user description is explicit: "should also not refuse to answer any query that deviates the conversation from the SOP workflow. In such a case the assistant should answer the user query first ... and then ask the SOP question at the end." Without this behavior the bot feels rigid; visitors abandon.

**Independent Test**: Drive the chat into mid-SOP state, ask a configured-contact question (or any off-SOP question that the agent can answer from context), and verify the assistant answers the off-topic query AND ends with a re-prompt of the next SOP step.

**Acceptance Scenarios**:

1. **Given** SOP is mid-flow, **When** the visitor asks an off-SOP question answerable from the firm's configured context, **Then** the assistant responds with the answer followed by the next pending SOP step's question.
2. **Given** SOP is mid-flow, **When** the visitor asks an off-SOP question that violates a guardrail boundary (e.g., asks for legal advice, asks for fee structures not on the website), **Then** the assistant uses the configured deflection followed by the next pending SOP step's question.
3. **Given** the visitor's off-SOP question is itself a partial SOP answer (e.g., asks "Do you handle DUIs?" while in Step 2), **When** the agent processes it, **Then** Step 1 is marked complete with case_type=DUI AND Step 2 is asked next (sub-type), without re-asking Step 1.

---

### User Story 4 — Visitor Watches the Progress Bar and Completes (Priority: P1)

A visitor sees a thin shiny green progress bar at the very top of the chat panel. The bar shows `1/5`, `2/5`, `3/5`, `4/5`, `5/5` as the SOP advances. After the bar fills, the assistant continues with follow-up questions but the bar remains at 100%. The visitor is reassured the conversation has a defined endpoint and stays engaged.

**Why this priority**: Progress bars are a binding engagement-design pattern (call out from the user description). Without it, visitors don't know how long the intake takes and abandon at higher rates. The user description: "The purpose of providing this progressbar is to give the user a feedback about how many questions is the assistant going to ask in order to engage them to the completion of a classified lead for us."

**Independent Test**: Open the widget, observe the bar at the top of the panel. Drive the conversation step-by-step and verify the bar increments after each captured answer. After the threshold step, verify the bar is at 100% AND remains so even as further turns occur.

**Acceptance Scenarios**:

1. **Given** the chat panel is open, **When** the panel renders, **Then** the progress bar is visible at the top of the panel as a thin (≤ 4 px) green animated element with a `x/N` text label.
2. **Given** N steps are configured for qualified-lead completion (default 5), **When** the conversation begins, **Then** the bar reads `0/N` and is empty.
3. **Given** an SOP step is captured (whether by chip tap, free-text answer, or implicit-answer detection), **When** the agent acknowledges the capture, **Then** the bar smoothly animates to `(captured_count)/N`.
4. **Given** the bar reaches `N/N`, **When** the conversation continues, **Then** the bar stays at 100% for the rest of the session.
5. **Given** `prefers-reduced-motion: reduce` is set, **When** the bar advances, **Then** the bar updates without animation (no shimmer, no smooth fill).

---

### User Story 5 — Visitor Never Says Goodbye (Priority: P2)

A visitor finishes the SOP, gets an "all set, we'll be in touch" message, asks two more clarifying questions, and then doesn't respond for several minutes. The assistant's last turn is "Is there anything else I can help you with?" — never "Goodbye" or "Have a great day." Only when the visitor types something like "thanks, bye" does the assistant respond with a closing.

**Why this priority**: User description: "The assistant should never bid goodbye unless the user themselves say goodbye. It should always ask how I can help you if user hasn't said goodbye." Important UX call.

**Independent Test**: Complete the SOP, then exchange 2–3 more turns, then have the visitor abandon (no message). Verify the last assistant turn ends with an open-ended re-prompt, not a sign-off.

**Acceptance Scenarios**:

1. **Given** a turn that is not a goodbye, **When** the assistant responds, **Then** the response ends with an open re-prompt (e.g., "Is there anything else I can help you with?") OR the next SOP step's question.
2. **Given** the visitor sends a goodbye phrase ("bye", "thanks", "goodnight", configurable list), **When** the agent detects it, **Then** the assistant responds with a configured polite closing.

---

### User Story 6 — Lawyer Configures the SOP from the Dashboard (Priority: P1)

A lawyer opens the dashboard and navigates to "SOP Workflow." They see the default 5-step SOP, can drag steps to reorder, add a custom step (e.g., "What is your insurance status?"), edit the chip list for the case-type step (add "Workers' Comp", remove "Estate Planning"), and adjust the qualified-lead threshold from 5 to 4. They click Save → the SOP version increments. They click Publish → the next chat conversation uses the new SOP.

**Why this priority**: User description: "this workflow should be customizable at some level. For example a law firm should be able to change the order of these questions or add/remove a new step in the SOP workflow." Without configuration, the SOP is one-size-fits-all and won't fit different practice areas.

**Independent Test**: Open the dashboard, edit the SOP, save, publish; drive a new chat conversation; verify the new SOP order/content/threshold is in effect.

**Acceptance Scenarios**:

1. **Given** the lawyer is on the SOP configuration page, **When** the page renders, **Then** the current SOP is displayed as an ordered list with each step's question text, chip list (if applicable), and "skip-logic" options.
2. **Given** the lawyer reorders steps via drag-and-drop, **When** they click Save, **Then** a new configuration version is created (per `007-dashboard` versioning).
3. **Given** the lawyer adds a new step, **When** the form validates, **Then** required fields are: question text, position, optional chip list, marked-as-required flag.
4. **Given** the lawyer edits the qualified-lead-threshold field, **When** they save and publish, **Then** the next conversation's progress-bar denominator (`N`) reflects the new threshold.
5. **Given** the lawyer edits the chip list for the case-type step, **When** they save and publish, **Then** the next conversation's case-type chip selection reflects the new list.
6. **Given** the lawyer flags a case-type chip as "out-of-scope for this firm", **When** a visitor selects that chip in chat, **Then** the configured out-of-scope deflection is emitted and the SOP terminates as `unqualified`.

---

### Edge Cases

- **AI follow-up generates 0 questions**: Step 6 may decide the existing information is sufficient. In this case the assistant emits the finalization message directly; the bar is already at 100%.
- **AI follow-up fails (e.g., LLM error)**: the agent falls back to a static "We have your details and will be in touch" message; the bar is 100%; the lead is captured per `006-lead-classification` even if the analysis step erred.
- **Visitor types a partial chip option** (e.g., types "PI" when chips include "Personal Injury"): the agent attempts fuzzy match; on ambiguity, asks for clarification.
- **Visitor's "When" answer is in the future** ("next Tuesday"): the SOP captures the date but a downstream classification check may flag this; not the SOP's job to validate.
- **Visitor's "When" answer is unparseable** ("a while ago"): the SOP step is NOT marked complete; the agent asks a more specific follow-up ("Could you give me a rough date or week?").
- **Visitor selects a case-type chip whose sub-types are empty**: the SOP skips Step 2 and proceeds to Step 3.
- **Visitor refuses to answer a step** ("I'd rather not say"): the step is marked **skipped** (not complete); the SOP advances to the next step; the lead is captured with whatever is available; the threshold is calculated against `min(captured, N)` so the bar may never reach 100%.
- **All steps configured as "optional"**: the SOP can be completed entirely via inferred answers; the threshold is reached as soon as `N` distinct steps have captured values.
- **The lawyer's SOP has zero steps**: Foundation guard — the agent falls back to the legacy §7.5 system-prompt-driven flow with a warning logged.
- **Cross-conversation persistence**: if a visitor returns mid-SOP within the same browser session (per the `005-chat-widget` `sessionStorage` model), the SOP state resumes at the last pending step; the progress bar shows the correct prior progress.
- **Two SOP steps capture the same field** (e.g., a custom step and the default "When" step both ask for date): the earlier-captured value wins; the later step is skipped.

## Requirements *(mandatory)*

Each requirement is testable. Where the user description was specific, requirements use MUST. Where the description was illustrative, requirements use the most reasonable default and document it in Assumptions.

### Functional Requirements

#### FR Group A — Default SOP Definition

- **FR-001**: The system MUST ship with a default SOP consisting of 5 steps in this order: (1) case-type, (2) sub-type, (3) where, (4) what, (5) when.
- **FR-002**: Each SOP step MUST have: a unique step identifier, a position (integer order), a question text template, an optional chip-list reference, an optional skip-condition rule, a `required` flag (default true), and a `counts_toward_threshold` flag (default true for default steps).
- **FR-003**: The default SOP's qualified-lead threshold MUST be `5` (corresponding to step 5 "when did it happen"). Source: user description.
- **FR-004**: The default SOP MUST be installable via the Foundation seed mechanism (`pnpm db:seed`); fresh accounts inherit the default SOP on signup.
- **FR-005**: Step 6 (AI-generated follow-up) MUST be a system-defined step that runs AFTER all configured SOP steps complete; it is NOT itself a configurable SOP step in the same sense (its presence is mandatory; its prompt and parameters are configurable). Source: user description Step 6.
- **FR-006**: Step 7 (conversational continuation behavior) MUST be a system-defined post-SOP behavior, not a configurable SOP step. Source: user description Step 7.

#### FR Group B — Case-Type and Sub-Type Chips

- **FR-007**: Case types MUST be sourced from a database-backed configurable list. Each case type entry has: id, label (display text), slug (machine identifier), `is_in_scope` boolean (false → triggers out-of-scope deflection), and an ordered list of sub-types.
- **FR-008**: Sub-types MUST be per-case-type configurable lists. Each sub-type entry has: id, parent case_type id, label, slug.
- **FR-009**: The seeded defaults MUST include common law-firm case types (e.g., DUI, drug crime, personal injury, family law, criminal defense, estate planning) AND at least one realistic sub-type list for each (e.g., personal injury → car accident, slip and fall, medical malpractice, dog bite). Specific list size is implementation; minimum: 6 default case types each with ≥ 3 sub-types.
- **FR-010**: When a visitor selects a case-type chip with `is_in_scope = false`, the assistant MUST emit the firm's configured out-of-scope deflection message and terminate the SOP as `unqualified` (per `006-lead-classification` §7.4 outcomes table).
- **FR-011**: When a visitor selects a case-type chip whose sub-type list is empty, the SOP MUST skip Step 2 and proceed to Step 3.
- **FR-012**: Both chip selection and free-text input MUST be accepted at every step that has chips. Free-text inputs MUST be matched against chip labels (fuzzy/case-insensitive) before being treated as novel input.

#### FR Group C — Date Inference for "When"

- **FR-013**: Step 5 ("When did it happen?") MUST accept natural-language date expressions ("last night", "two weeks ago", "yesterday morning", an explicit date) and normalize the captured value to an ISO 8601 date relative to the conversation timestamp.
- **FR-014**: When the date input is unparseable (e.g., "a while ago"), Step 5 MUST NOT be marked complete; the agent MUST ask a clarifying question.
- **FR-015**: The "When" step MUST also accept chip selections for common ranges (e.g., "today", "yesterday", "this week", "last week", "this month", "earlier this year", "longer ago"). Specific chip list is configurable.

#### FR Group D — Skip Logic for Volunteered Information

- **FR-016**: When a visitor's input contains values that satisfy multiple SOP steps in a single message, the agent MUST mark each satisfied step as captured and advance the progress bar by the corresponding count.
- **FR-017**: Skip detection MUST run on every visitor message, not just the first one.
- **FR-018**: When a captured value is ambiguous (e.g., "I had an accident" — case type unclear), the corresponding step MUST NOT be marked complete; the agent MUST ask a disambiguating question that narrows the captured information.
- **FR-019**: Skip detection MUST NOT mark a step complete if doing so would skip a `required` step ahead of an earlier `required` step that is also pending. (Sequence safety: the SOP advances only when the earliest pending required step is also resolved.)

#### FR Group E — Off-SOP Question Handling

- **FR-020**: When the visitor's input is unrelated to the current pending SOP step (and is not a skip-detected SOP answer), the agent MUST answer the question first within configured guardrail boundaries, then ask the next pending SOP step at the end of the same response.
- **FR-021**: When the visitor's off-SOP question would violate a guardrail boundary, the agent MUST emit the configured deflection (per existing `004-chat-api-agent` behavior) followed by the next pending SOP step at the end.
- **FR-022**: Off-SOP responses MUST NOT advance the progress bar.
- **FR-023**: Off-SOP question handling MUST NOT skip pending SOP steps; the SOP resumes at the same step it was on.

#### FR Group F — AI Follow-Up (Step 6)

- **FR-024**: After all SOP steps complete (whether by direct answer, chip tap, or skip-detection), the agent MUST run an analysis pass that decides between two outcomes: (a) generate 2–5 follow-up questions tailored to the matter, OR (b) finalize directly when the captured information is sufficient.
- **FR-025**: When follow-up questions are generated, they MUST be asked one at a time (not as a list), with each answer advancing toward finalization but NOT advancing the progress bar (the bar is already at 100%).
- **FR-026**: The number of follow-up questions MUST be between 2 and 5 inclusive when generated.
- **FR-027**: When the agent decides to finalize, the assistant MUST emit a configured finalization message that includes the firm's contact info and a "we will be in touch" closing.
- **FR-028**: When the AI follow-up step fails (LLM error, timeout), the agent MUST fall back to direct finalization rather than blocking the conversation.

#### FR Group G — Conversational Continuation (Step 7)

- **FR-029**: The assistant MUST NOT emit a closing/goodbye message unless the visitor's input matches a configured goodbye-phrase pattern.
- **FR-030**: The default goodbye-phrase patterns MUST include at minimum: "bye", "goodbye", "thanks", "thank you", "good night", "see you", "that's all".
- **FR-031**: When no goodbye is detected, every assistant turn after SOP completion MUST end with an open-ended re-prompt (e.g., "Is there anything else I can help you with?").
- **FR-032**: When a goodbye is detected, the assistant MUST respond with the configured polite closing message.

#### FR Group H — Progress Bar UI

- **FR-033**: The chat panel MUST render a thin (≤ 4 px tall) green progress bar at the top of the panel chrome, above the messages area.
- **FR-034**: The bar MUST display a text label in the format `x/N` where `x` is the count of completed SOP steps that count toward the threshold and `N` is the configured threshold value.
- **FR-035**: The bar MUST animate smoothly when advancing (e.g., a 300 ms transition), with a subtle shimmer/shine effect to convey progress momentum.
- **FR-036**: The bar MUST respect `prefers-reduced-motion: reduce` — when set, transitions and shimmer are disabled; the bar updates instantly.
- **FR-037**: The bar MUST remain visible at 100% for the rest of the conversation after `x` reaches `N`; it MUST NOT disappear, reset, or change color.
- **FR-038**: The bar MUST appear ONLY when an SOP is configured for the firm AND has at least one threshold-counted step. When `N = 0`, the bar is hidden.
- **FR-039**: The bar's color and label color MUST inherit from the widget's CSS custom properties (per `005-chat-widget` theming contract); the default green MUST satisfy WCAG 2.1 AA contrast against the panel background.
- **FR-040**: The bar MUST NOT obstruct or interfere with the chat-panel header; it sits above or below the header in a fixed position depending on layout (mobile full-screen vs. desktop floating panel).

#### FR Group I — SOP State and Persistence

- **FR-041**: SOP state per session MUST be persisted server-side as part of the existing `sessions.messages_json` or as a new `sessions.sop_state_json` column. Specific column choice is implementation; the contract is that SOP state survives chat-history fetch/restore.
- **FR-042**: SOP state MUST include: ordered list of step ids, per-step status (`pending` | `complete` | `skipped`), per-step captured value (or null), the version of the SOP configuration in use, and the conversation timestamp anchor (for relative date inference in FR-013).
- **FR-043**: When a session is resumed across page navigations (per `005-chat-widget` `sessionStorage` model), the SOP state MUST be re-fetched and the progress bar MUST reflect the prior progress.
- **FR-044**: When the lawyer publishes a new SOP version mid-conversation, in-flight conversations MUST continue with the version they started with (existing active sessions are not interrupted, per `004-chat-api-agent` §4.2 behavior).

#### FR Group J — Dashboard Configuration

- **FR-045**: The dashboard MUST expose an SOP editor page at `/dashboard/sop` (or equivalent route).
- **FR-046**: The editor MUST display the current SOP as an ordered list with drag-and-drop reordering.
- **FR-047**: Each step in the editor MUST be editable: question text, chip-list (when applicable), `required` flag, `counts_toward_threshold` flag, skip-condition rule.
- **FR-048**: Lawyers MUST be able to ADD a custom step (insert at any position).
- **FR-049**: Lawyers MUST be able to REMOVE a step (default steps included; they may be re-added from a "restore default step" action).
- **FR-050**: Lawyers MUST be able to edit the qualified-lead threshold (`N`) — any positive integer ≤ count of `counts_toward_threshold` steps.
- **FR-051**: Lawyers MUST be able to edit the case-type chip list and its sub-type lists from a dedicated tab on the SOP editor page.
- **FR-052**: Lawyers MUST be able to mark a case-type chip as `is_in_scope = false` to trigger the out-of-scope deflection on selection (FR-010).
- **FR-053**: SOP changes MUST follow the existing `007-dashboard` configuration versioning model: Save creates a new version (`is_published = false`); Publish makes the latest the live SOP. Version history + rollback (per Phase 6 R8) applies to SOP versions.
- **FR-054**: The SOP editor MUST integrate with the existing Preview & Test chat (per `007-dashboard` §8.10): preview conversations use the unpublished SOP version.

#### FR Group K — Relationship to Existing §7.5 Intake-Question System

- **FR-055**: The SOP Workflow MUST replace the §7.5 system-prompt-driven "qualifying questions" flow as the runtime intake mechanism. Existing `004-chat-api-agent` system-prompt composition MUST be extended to include SOP state injection (current pending step, captured values, off-SOP guidance).
- **FR-056**: The legacy `qualifying_questions` field in the §4.4 configuration JSON MUST be deprecated in favor of the new SOP configuration. A migration path: existing `qualifying_questions` entries MUST be auto-converted into custom SOP steps on the first dashboard load after this feature ships.
- **FR-057**: The `006-lead-classification` `captureLead` tool MUST be invoked at SOP completion (or at out-of-scope termination); the SOP's captured values supply the tool's parameters (case type → caseType, free-text Where + What → briefDescription, normalized When → incidentDate).

#### FR Group L — Observability and Audit

- **FR-058**: The agent MUST emit structured-log events (per `001-foundation` log-event-contract) for every SOP transition: `sop_step_completed`, `sop_step_skipped`, `sop_step_inferred` (skip-detection match), `sop_off_topic_detour`, `sop_finalized`.
- **FR-059**: The captured SOP state at completion (or at session expiry) MUST be persisted on the lead record so the lawyer can review the visitor's intake answers in the dashboard's lead detail view.
- **FR-060**: SOP-state log payloads MUST follow the Foundation logger redaction list (no raw user message content at top level; only step ids, step labels, and pattern names).

### Key Entities

The SOP Workflow introduces several new persistent entities. Specific schema-level details (column types, indexes) are deferred to the planning phase; this section describes the conceptual model.

- **SOP Configuration**: A per-account ordered list of SOP steps + the qualified-lead threshold value. Versioned (each Save creates a new version; Publish marks one version live). Stored in a dedicated `sop_configurations` table (per `data-model.md`) parallel to the existing `configurations` rows.
- **SOP Step**: One step within an SOP configuration. Fields: id, parent SOP version, position, question text template, optional chip-list reference, `required` flag, `counts_toward_threshold` flag, skip-condition rule, optional `is_default` flag (for default vs. custom steps).
- **Case Type**: A configurable case-category record. Fields: id, label, slug, `is_in_scope` flag, ordered list of associated sub-types. Per-account; seeded with sensible defaults.
- **Sub-Type**: A child of a Case Type. Fields: id, parent case_type id, label, slug.
- **SOP State (per session)**: Runtime state attached to a `sessions` row. Fields: SOP version id in use, per-step status + captured value, conversation-timestamp anchor for date inference, last-pending-step pointer.
- **Goodbye Phrase**: A configurable list of regex-matchable strings that mark visitor closing intent. Per-account; seeded with sensible defaults.
- **Default-SOP Seed**: A read-only template used to populate fresh accounts. Maintained by the team (not editable per-account; lawyers customize their copy after seeding).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new chat conversations start with the firm's currently published SOP version, presenting Step 1's question and chips within 1 second of widget open.
- **SC-002**: When a visitor selects a chip in any SOP step, the next assistant turn arrives within the same latency budget as a free-text turn (no chip-specific delay).
- **SC-003**: For 100% of chip-selection inputs, the agent treats the chip's slug as the captured value (no LLM round-trip needed for canonical mapping).
- **SC-004**: For visitor inputs containing N implicit SOP answers, the progress bar advances by N in a single turn (no per-step loop visible to the visitor).
- **SC-005**: For 100% of off-SOP visitor questions, the agent's response answers the question first AND ends with a re-prompt of the next pending SOP step.
- **SC-006**: 100% of "When did it happen" answers like "last night", "yesterday", "two weeks ago", "Tuesday" are normalized to ISO 8601 dates relative to the conversation timestamp.
- **SC-007**: When the qualified-lead threshold is reached, the progress bar reaches 100% within 300 ms of the threshold-completing answer being captured.
- **SC-008**: Step 6 produces between 2 and 5 follow-up questions OR a finalization message in 100% of cases where prior SOP steps completed; never 0 questions and not-yet-finalized; never 6+ questions.
- **SC-009**: 100% of post-SOP assistant turns (after threshold reached) end with either an open re-prompt OR a goodbye-triggered closing — never with an unprompted goodbye.
- **SC-010**: When the lawyer reorders steps, adds a custom step, or changes the threshold, the next chat conversation reflects the change after the lawyer clicks Publish.
- **SC-011**: When the lawyer marks a case-type chip as out-of-scope, 100% of visitor selections of that chip emit the configured deflection and terminate the SOP as `unqualified`.
- **SC-012**: When a session is resumed across a page navigation (within the same browser tab), the progress bar reflects the prior progress within 500 ms of the chat panel re-opening.
- **SC-013**: For visitors using `prefers-reduced-motion: reduce`, the progress bar updates instantly with no shimmer animation.
- **SC-014**: 100% of leads captured via SOP completion include the captured Step 1–5 values in the `leads` row's `case_type`, `incident_date`, and `brief_description` (Where + What concatenated) fields.

## Assumptions

These reasonable defaults were adopted where the user description was silent or illustrative. Each assumption is consistent with the description and with prior feature specs.

- **Step 6 (AI follow-up) runs as an additional Vercel AI SDK tool call within the existing `004-chat-api-agent` runtime.** The `maxSteps: 5` cap from §7.2 still applies; the analysis tool counts as one of the five. No new model is introduced.
- **Date inference (FR-013) uses the same Gemini model already wired into the agent.** No new dependency. A future R-item may swap in a deterministic date parser if the model's accuracy is insufficient.
- **The default goodbye-phrase list is in English only.** Multi-language deflection patterns are post-MVP per §10.
- **The "thin shiny green progress bar" exact shade is a green that satisfies WCAG 2.1 AA contrast against the panel background;** specific hex value is implementation choice. Lawyers can override via the existing CSS custom properties (e.g., a new `--lc-progress-color`).
- **SOP state persistence (FR-041) lives on the `sessions` table.** Either as a new column (`sop_state_json`) or as an extension of `messages_json` — planning will decide. Either keeps SOP state co-located with the conversation it belongs to.
- **The "shimmer/shine" effect is a subtle linear-gradient animation,** not a heavy WebGL or CSS-mask animation. Implementation choice; widget bundle-size budget (`005-chat-widget` FR-034/FR-035) MUST be respected.
- **The default 6 case types and their sub-type lists** will be drafted by the team during planning; they should reflect the most common small/mid law-firm practice areas (DUI, criminal defense, personal injury, family law, estate planning, drug-related charges) and at least 3 sub-types each.
- **Case-type chips can be repositioned by lawyers** within the case-type list (drag-and-drop). The default order is alphabetical or driven by the team's curation.
- **A custom SOP step added by a lawyer can attach to ANY chip-list** — not only case-type/sub-type. For example, a lawyer might add a step "What is your insurance status?" with chip options "Insured / Uninsured / Not sure".
- **The `is_default` flag on SOP steps is informational** — it does not lock the step from edits; lawyers can edit any step. The flag's purpose is to power a "restore defaults" action (FR-049).

## Out of Scope (for this feature)

The following are explicitly **not** part of the SOP Workflow feature.

- **Multi-language SOP text and goodbye-phrase patterns**: post-MVP per §10 (multi-language support deferred system-wide).
- **Voice / spoken intake**: MVP is text-only.
- **Branching SOPs based on previous answers** (e.g., "if case_type=DUI, ask BAC level"): post-MVP. Default SOP is a flat ordered list with skip-detection only.
- **Live agent handoff mid-SOP**: post-MVP per §10 ("Conversation handoff" deferred).
- **A/B testing different SOPs per visitor segment**: post-MVP per §8.12.
- **Integration with external case-management tools (Clio, MyCase, etc.)**: post-MVP per §10 (CRM integrations deferred).
- **Real-time chat-handoff to a human after SOP completion**: not part of this feature; existing "escalation triggers" from §4.3 Section E remain available.
- **Step-level analytics dashboards** (drop-off rates per step, time-per-step): post-MVP per §8.12 advanced analytics deferral.
- **The §11.6 FAQ semantic cache** is unaffected by this feature: cache hits short-circuit the agent BEFORE SOP state is consulted; SOP state advances only when the agent runs.

## Dependencies

- **Internal — Upstream**:
  - `001-foundation`: shared types, schema baseline, structured logger.
  - `002-crawler-cli`: not a direct dependency, but the SOP's "off-SOP question handling" (FR-020) may invoke `searchContext` to answer firm-specific questions, which depends on the crawler having produced a context store.
  - `003-context-search`: `searchContext` is invoked when the agent answers off-SOP firm-specific questions.
  - `004-chat-api-agent`: agent runtime, system-prompt composition, tool wiring, session state. SOP state injection extends the system prompt.
  - `005-chat-widget`: progress-bar UI. CSS custom properties for theming. Renders chips alongside the input area.
  - `006-lead-classification`: `captureLead` tool is invoked at SOP completion (FR-057).
  - `007-dashboard`: SOP editor page (FR-045 to FR-054). Configuration versioning model.
- **Internal — Downstream**:
  - `008-hardening` (Phase 7): no direct dependency, but the per-session debug mode (R8) becomes useful for troubleshooting SOP transitions.
  - `009-deployment-release`: SOP and chip-list seeds are deployed alongside the API. The eval suite gains additional scenarios per the new behaviors.
- **External**: Reachable Gemini API for date inference (FR-013) and AI follow-up generation (FR-024). No new external services.

## Notes on Non-Invention

This specification describes only what the user described, plus the minimum reasonable defaults necessary to make every requirement testable. In particular:

- No specific data store, schema column type, or table name is mandated; planning will resolve.
- No specific UI animation duration beyond the FR-035 hint (300 ms transition example) is mandated; the contract is "smooth animation respecting `prefers-reduced-motion`."
- No specific AI prompt for Step 6 (follow-up generation) is mandated; the contract is "2–5 questions OR finalization."
- No specific number of default case types beyond "≥ 6 with ≥ 3 sub-types each" is mandated.
- No specific success metric for "qualification rate improvement" is mandated; the user description does not commit to a number, only to the SOP being a tool to drive qualification.

If any of these are wanted, they belong in a separate feature, not in SOP Workflow.
