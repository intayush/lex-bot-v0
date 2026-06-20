# Feature Specification: Forward-Only SOP Workflow

**Feature Branch**: `018-remove-multi-answer-volunteer`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "I want to remove the changes done as the part of the user story - User Story 2 — Visitor Volunteers Multiple SOP Answers in One Message (Priority: P1) done as a part of the feature 010-sop-workflow. The objective to get rid of it: 1. It is adding complexity to determine workflow state and capturing and mapping answers. 2. Instead of this we want to have a workflow which is always forward looking. 3. So now even if i asked the chatbot - 'What happened' and it answered me both what happened and when did it happen, it would still ask the 'when question' if it is coming next in the workflow. 4. Although the chatbot should keep asking the same question if the user didn't answer it before moving to the next. This 're-ask' will have an internally configured limit set to 3 as default."

**Parent Feature**: `010-sop-workflow`

## Overview

This feature removes the "Visitor Volunteers Multiple SOP Answers in One Message" behavior (User Story 2) that was introduced in `010-sop-workflow`. The goal is to simplify the SOP state machine by replacing answer-detection and skip-logic with a strictly forward-moving workflow.

Under the new model, the SOP always asks the next step in sequence — even if information matching that step was mentioned in a prior response. The chatbot never attempts to infer or back-fill earlier steps from unstructured input. The only backward motion permitted is re-asking the same pending step up to a configurable maximum number of times (default: 3) if the visitor has not yet provided a usable answer.

This change reduces complexity in workflow state management, eliminates the risk of incorrect skip-logic classifications, and makes conversational behavior more predictable for both visitors and developers.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Chatbot Always Asks the Next Pending SOP Step Regardless of Prior Mentions (Priority: P1)

A visitor's opening message reads: "Hi, I was hit by a driver running a red light at the corner of 5th and Main last week. I think I have a personal-injury case." The chatbot selects "personal injury" as the case type in Step 1, acknowledges the message, and still proceeds to ask Step 2 (sub-type) next. It does NOT skip Steps 3, 4, or 5 even though location, description, and date were volunteered. Each step is asked in configured order until completed.

**Why this priority**: This is the core behavioral change of the feature. Every other requirement depends on the SOP being unconditionally forward-moving.

**Independent Test**: Open the chat, submit a rich opening message that contains answers to Steps 1 through 5. Verify the assistant still asks each subsequent step in order. Verify the progress bar advances one step at a time.

**Acceptance Scenarios**:

1. **Given** a visitor message containing information that maps to multiple SOP steps, **When** the agent processes it, **Then** only the steps that the agent already asked for — in order — are considered captured; future steps remain pending.
2. **Given** Step 1 (case type) has been completed and Step 2 (sub-type) is next, **When** the visitor's earlier message also mentioned a date or location, **Then** the agent asks Step 2 and does NOT advance the bar past step 2.
3. **Given** any visitor turn, **When** the agent processes the response, **Then** the SOP always advances to the immediately next pending step; it never jumps ahead by more than one.

---

### User Story 2 — Chatbot Re-Asks an Unanswered Step Up to the Configured Limit (Priority: P1)

A visitor repeatedly sends messages that do not answer the current pending SOP step (e.g., they keep asking off-topic questions or their response doesn't contain a usable answer). The assistant re-asks the same pending step in each of its subsequent responses. After the configured re-ask limit (default: 3 re-asks), the step is treated as skipped and the SOP advances to the next pending step.

**Why this priority**: Without a re-ask mechanism, visitors who ignore or deflect a question would cause the SOP to stall indefinitely. The re-ask limit ensures the conversation always makes forward progress.

**Independent Test**: Set the re-ask limit to 3. Start a chat and respond to the pending step with non-answers three times. Verify on the fourth non-answer the step is marked skipped and the next step is asked.

**Acceptance Scenarios**:

1. **Given** the current pending SOP step is unanswered and the re-ask count is below the limit, **When** the assistant responds, **Then** the assistant re-asks the same step (its configured question text) at the end of its response.
2. **Given** the re-ask count for the current step reaches the configured limit, **When** the assistant prepares its next response, **Then** the current step is marked as `skipped`, the SOP advances to the next pending step, and the bar does NOT increment (skipped steps do not count toward threshold).
3. **Given** the re-ask limit is set to the default value, **When** no explicit configuration is provided, **Then** the re-ask limit is 3.
4. **Given** the visitor provides a usable answer to the pending step at any time before the re-ask limit is reached, **When** the agent processes the input, **Then** the step is marked `complete`, the re-ask counter resets, and the SOP advances to the next step normally.

---

### User Story 3 — Skip-Detection Code and Related FR Group D Logic Is Removed (Priority: P1)

All code, prompts, and data-model additions associated with the former User Story 2 (skip-detection, multi-answer inference, `sop_step_inferred` log events, FR-016 through FR-019) are deleted. The SOP state machine no longer attempts to detect volunteered information or apply skip-logic to future steps.

**Why this priority**: Removal is the primary deliverable. Leaving the old code in place alongside the new forward-only logic would create conflicting behaviors and negate the simplification goal.

**Independent Test**: Code search confirms no active code paths that attempt to infer skip-detection or back-fill SOP steps from unstructured visitor messages. Structured-log events no longer include `sop_step_inferred`. Tests that specifically validate FR-016 through FR-019 are deleted.

**Acceptance Scenarios**:

1. **Given** a visitor message contains information matching a future SOP step, **When** the agent processes it, **Then** no future step is marked `complete` or `skipped` proactively; all future steps remain `pending`.
2. **Given** the agent's response log for a forward-only conversation, **When** the SOP transitions occur, **Then** the log contains `sop_step_completed` and `sop_step_skipped` events only; `sop_step_inferred` events are absent.
3. **Given** the acceptance scenarios from the former FR-016 and FR-018 (skip-detection requirements), **When** a visitor sends a rich multi-detail message, **Then** those scenarios no longer hold — the agent does NOT skip future steps.

---

### Edge Cases

- **Visitor provides a partial answer that cannot be resolved**: treated as an unanswered turn; the re-ask counter increments. The same question is repeated.
- **Visitor answers a step on a second or third re-ask attempt**: the step is marked `complete` immediately; the re-ask counter resets; no re-ask "debt" is carried to the next step.
- **Re-ask limit is configured to 0**: not permitted. A value of 0 would immediately skip every unanswered step; the system MUST enforce a minimum of 1.
- **Visitor asks an off-SOP question while a re-ask is pending**: the off-SOP question is answered first (per `010-sop-workflow` FR-020 / User Story 3, which is unchanged), and the same pending step is re-asked at the end of the response. The re-ask counter increments.
- **SOP step is marked `required = false`**: even non-required steps are re-asked up to the configured limit before being skipped. The distinction between required and optional steps remains relevant only for lead classification completeness — not for re-ask behavior.
- **All steps in the SOP hit the re-ask limit**: the SOP completes in `unqualified` state; the lead is captured with whatever values were recorded; the progress bar shows however many steps were captured (may never reach 100%).
- **Re-ask limit is changed via dashboard mid-conversation**: in-flight conversations retain the re-ask limit that was in effect when the SOP version was started (consistent with the SOP version freeze rule from `010-sop-workflow` FR-044).

## Requirements *(mandatory)*

### Functional Requirements

#### FR Group A — Forward-Only Progression

- **FR-001**: The SOP state machine MUST advance steps exclusively in configured order; no step may be marked `complete` or `skipped` proactively based on content from prior unasked-for turns.
- **FR-002**: On every visitor turn, the agent MUST evaluate only the current pending step for completion, not future pending steps.
- **FR-003**: The agent MUST NOT attempt to extract, infer, or match visitor message content against SOP steps that have not yet been presented to the visitor.
- **FR-004**: All skip-detection code paths introduced by the former User Story 2 (`010-sop-workflow` FR-016 through FR-019) MUST be removed.
- **FR-005**: The `sop_step_inferred` structured-log event type MUST be removed from the log-event contract.

#### FR Group B — Re-Ask Behavior

- **FR-006**: When the visitor's response to the current pending SOP step does not yield a usable answer (no capture), the agent MUST re-ask the same step at the end of its next response.
- **FR-007**: The re-ask counter for a step MUST increment by 1 for each assistant turn in which the same step is re-asked.
- **FR-008**: When the re-ask counter for a step reaches the configured re-ask limit, the step MUST be marked `skipped` and the SOP MUST advance to the next pending step.
- **FR-009**: The re-ask limit MUST be an internally configurable value (not exposed to the lawyer dashboard in this feature); the default value MUST be 3.
- **FR-010**: The re-ask limit MUST have a minimum permitted value of 1; any configured value below 1 MUST be rejected at startup with a clear error.
- **FR-011**: The re-ask counter MUST reset to 0 when a step transitions to `complete`.
- **FR-012**: Off-SOP question handling (per `010-sop-workflow` FR-020 through FR-023) is unchanged; when an off-SOP question is received while a re-ask is pending, the pending step is re-asked at the end of the same response AND the re-ask counter increments.
- **FR-013**: Steps marked `skipped` due to exhausting the re-ask limit MUST NOT increment the progress bar (consistent with the existing `skipped` behavior from `010-sop-workflow`).

#### FR Group C — SOP State Model

- **FR-014**: The per-step SOP state MUST record the re-ask count for each step alongside its existing `status`, `captured_value`, and `position` fields.
- **FR-015**: The re-ask count field MUST be initialized to 0 when a step is first entered (i.e., when it becomes the current pending step).
- **FR-016**: The SOP state data model introduced in `010-sop-workflow` FR-042 MUST be extended to include the re-ask count per step; this extension MUST be backwards-compatible with existing persisted sessions (sessions without a re-ask count field default to 0 on read).

#### FR Group D — Removal Scope

- **FR-017**: All tests that exclusively validate the former FR-016 through FR-019 skip-detection behavior MUST be deleted.
- **FR-018**: The progress bar advance-by-N-per-turn behavior described in `010-sop-workflow` SC-004 MUST be retired; the bar advances by exactly 1 per captured step.
- **FR-019**: Acceptance scenarios from the former User Story 2 MUST be removed from the test suite; no new code should re-implement them.

### Key Entities

- **SOP State (per session)**: Extended from `010-sop-workflow`. Adds a `reask_count` integer field per step entry. Initialized to 0; increments on each re-ask; resets to 0 on step completion.
- **Re-Ask Limit Config**: An internal constant (not a database-backed per-account setting in this feature). Default value: 3. Minimum permitted value: 1.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of conversations, the SOP progresses exactly one step per captured answer; the progress bar never advances by more than 1 per visitor turn.
- **SC-002**: When a step is not answered within the configured re-ask limit (default 3), the step transitions to `skipped` on the next assistant turn 100% of the time.
- **SC-003**: 100% of structured-log event streams for post-deployment conversations contain zero `sop_step_inferred` events.
- **SC-004**: After removing skip-detection logic, the number of agent decision paths for SOP progression decreases measurably — verified by code review (fewer conditional branches in SOP step evaluation).
- **SC-005**: Re-ask limit default (3) is exercised end-to-end in at least one automated test that confirms the step is skipped on the fourth unanswered turn.
- **SC-006**: The re-ask counter resets to 0 on step completion in 100% of test cases that validate step completion after one or more re-asks.

## Assumptions

- **Re-ask limit is an internal constant, not dashboard-configurable.** The user description says "internally configured limit set to 3 as default." This feature does not add a dashboard setting for the re-ask limit; a future feature may promote it to a per-account setting.
- **"Usable answer" determination is unchanged from `010-sop-workflow`.** The existing logic that decides whether a step is `complete` (chip tap, free-text answer that maps to the step's field, parseable date for the "When" step) continues to operate. This feature changes only what happens when that logic does NOT produce a completion.
- **The re-ask wording uses the original step question text.** The agent re-asks by repeating the configured question text for the pending step — no special "I asked you this before" phrasing is introduced. A future enhancement may add a polite re-ask prefix.
- **Existing SOP steps that were skipped via the old skip-detection (in live sessions at the time of deployment) are unaffected.** Sessions that completed or are in-flight before this feature ships retain their state. Only new sessions (and new steps entered after deployment) use the new re-ask model.
- **Forward-only means future steps only.** The rule that prevents proactive skip-detection applies strictly to steps that have not yet been presented to the visitor. Once a step becomes current (pending), the agent evaluates the visitor's answer for that step normally.

## Out of Scope

- **Exposing the re-ask limit to the lawyer dashboard**: post-feature. The internal default of 3 covers MVP needs.
- **Custom re-ask phrasing** (e.g., "I noticed you didn't answer my question — could you clarify…"): post-feature. Current scope re-asks with the original step question only.
- **Retroactive back-filling from conversation history**: not permitted under this model, even if the visitor explicitly provides a past-step answer mid-flow (e.g., "Oh, to answer your earlier question about the location…"). The agent acknowledges the information but does NOT retroactively mark a prior skipped/pending step as complete.
- **Changes to User Story 3 (off-SOP question handling), User Stories 4–6, or any other `010-sop-workflow` behavior** not listed in FR Group A–D above.

## Dependencies

- **Internal — Upstream**:
  - `010-sop-workflow`: the parent feature whose User Story 2 is being removed. The SOP state model, FR Group A–K (excluding the removed FR-016 through FR-019), and all other user stories remain in place.
  - `001-foundation`: structured logger log-event contract (FR-005 removes `sop_step_inferred`).
- **Internal — Downstream**:
  - No downstream features are known to depend on the skip-detection behavior introduced in `010-sop-workflow` User Story 2.
