# Feature Specification: Chat API Latency Reduction

**Feature Branch**: `021-chat-api-latency`

**Created**: 2026-06-21

**Status**: Draft

**Input**: User description: "Remove the off-SOP detour detector and apply four contained optimizations to cut perceived chat-turn latency by ~200–300ms without changing user-visible behavior or the lead-capture contract."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Faster first-token feedback during intake (Priority: P1)

A visitor opens the chatbot and is led through the intake SOP. After each message they send, they should see the assistant begin replying noticeably sooner than today, and they should perceive the conversation as snappier across the entire intake. No visible behavior change in what the assistant says, which questions get asked, which leads are captured, or how the lead is classified.

**Why this priority**: Time-to-first-token is the single biggest driver of perceived quality for an intake chatbot. Visitors who feel the bot is slow abandon the conversation, so trimming the request-handler overhead converts directly into more completed intakes — the firm's primary business outcome.

**Independent Test**: Run a scripted intake against the chat API across the dominant SOP-driven traffic shape (greeting → case-type chip → sub-type chip → where → what → when → contact form) before and after the change. Measure P50 time-to-first-token and time-to-`done` event. Confirm both metrics drop by their target margins and that the captured lead row is byte-for-byte equivalent (same classification, score, reasons, contact fields, SOP snapshot).

**Acceptance Scenarios**:

1. **Given** a visitor mid-intake with one pending SOP step, **When** they send a free-text answer, **Then** the assistant's first streamed token arrives at least 150ms sooner at P50 than the current baseline, and the assistant's reply content is functionally equivalent to today's reply for the same input.
2. **Given** a visitor who has just completed Step 6 (contact form) and triggered branch dispatch, **When** the post-stream writes execute, **Then** the lead row, branch snapshot, classification, score, hard-override reasons, and `urgent_lead` notification (if applicable) are all written to the database with the same final values as today, even though some of those writes complete after the client sees the `done` event.
3. **Given** a visitor on their second turn of a conversation, **When** the chat API loads their session, **Then** the previous turn's messages and SOP state are present (no missing turn N-1 in the loaded history).

---

### User Story 2 - Side questions during intake still get answered (Priority: P1)

A visitor mid-intake interrupts the flow to ask a side question ("what are your office hours?", "do you handle motorcycle accidents?"). The assistant answers their question within the firm's guardrails, then returns to the pending SOP step. This is the same behavior visitors get today — the change is purely internal (removal of a redundant nudge in the system prompt).

**Why this priority**: Off-topic side questions are common during legal intake. If this behavior regresses, the bot either ignores the visitor's question (bad UX) or loses its place in the SOP (bad business outcome — leads get worse data). Same priority as P1 because a regression here erases the perceived-quality gains from User Story 1.

**Independent Test**: Run a scripted intake that injects a side question ("what are your hours?") between Step 2 and Step 3. Verify the assistant (a) answers the side question within firm guardrails, and (b) re-asks the pending Step 3 question in its reply. Compare against a baseline run from before the change.

**Acceptance Scenarios**:

1. **Given** a visitor mid-intake with a pending SOP step, **When** they send a message unrelated to the pending step (e.g., asks about office hours), **Then** the assistant's reply answers the side question first and ends by asking the pending step's question.
2. **Given** a visitor mid-intake answering the pending step using synonyms or paraphrased language ("a few weeks back" for a "when did it happen" question), **When** the SOP runtime captures the answer, **Then** the assistant moves on to the next pending step and does NOT re-ask the just-answered question.
3. **Given** an account that has just published a configuration change, **When** a visitor sends their next message, **Then** the assistant's reply reflects the new configuration (persona, practice areas, contact info, instructions) within the same cache-invalidation window the system already promises today — no longer.

---

### User Story 3 - Concurrent message sends don't corrupt session state (Priority: P2)

A visitor double-clicks the send button, or the widget retries on a flaky network. Two requests for the same session arrive nearly simultaneously. After both complete, the session row in the database contains all messages from both turns in the correct order, and the lead row reflects the final state — no lost writes, no overwritten turns.

**Why this priority**: Today's session-write path partially protects against this through a SELECT-then-write pattern that the optimization will replace. Confirming the replacement does not introduce a new race is essential before shipping, but the scenario is rarer than User Stories 1 and 2.

**Independent Test**: Use a test harness to fire two concurrent chat requests for the same session ID with different visitor messages. Wait for both to complete. Load the session row and confirm it contains both new visitor messages and both assistant replies in chronological order; load the lead row and confirm it reflects state derived from the second turn.

**Acceptance Scenarios**:

1. **Given** an active session, **When** two chat requests for that session arrive within a 100ms window, **Then** both visitor messages and both assistant replies appear in the session's stored message history in the order they were processed.
2. **Given** an active session that has just transitioned to SOP-finalized state in turn A while turn B (a goodbye message) is in flight, **When** both turns complete, **Then** the lead row's classification, score, and SOP snapshot reflect the later of the two updates (last-writer-wins is acceptable; lost writes are not).

---

### Edge Cases

- A visitor sends their very first message and the session row was just created in the same turn. The system must correctly append the visitor + assistant messages to the freshly-minted (currently empty) message history.
- A platform `waitUntil`-equivalent primitive is unavailable in some deployment target (local dev, certain self-hosted runtimes). The deferred-writes path must fall back to awaiting the chain inline rather than dropping writes on the floor.
- An account publishes a new configuration mid-conversation. The next chat turn for that account must see the new persona/practice-areas/instructions (the cached static prompt prefix must be invalidated at publish time).
- The `getSessionForSOP` call returns null for a forged or stale `x-session-id` header. The route mints a new session, and the message-append path must handle the freshly-created empty session correctly.
- The deferred post-stream write chain throws an error (e.g., a transient DB outage). The error must be logged with enough context to debug, and the visitor's stream must still complete cleanly.
- A visitor mid-intake answers the pending step using language with minimal keyword overlap to the question text. The assistant must NOT re-ask the same question — today's redundant "Detour required NOW" prompt block sometimes causes this regression and is being removed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST remove the dynamic off-SOP detour detector (the per-turn `isOffTopic` heuristic and its associated `### Detour required NOW` system-prompt block) from the chat request handler.
- **FR-002**: System MUST retain the existing static "off-SOP detour rule" in the SOP system prompt block so that side-question handling continues to work via model-side instruction-following.
- **FR-003**: System MUST remove the off-SOP detour detector's unit tests and its dedicated end-to-end walk (`widget-us3-off-sop-detour.walk.spec.ts`) along with the production code.
- **FR-004**: System MUST defer the non-critical post-stream write chain (lead SOP-state update, branch-finalization UPDATE, hard-override application, partial-lead save) so that completion of those writes is not gated on the client receiving the stream-`done` event.
- **FR-005**: System MUST use a platform-appropriate "defer until response close" primitive (e.g., the serverless platform's `waitUntil`) so that deferred writes are not silently dropped when the runtime suspends the worker after streaming completes.
- **FR-006**: System MUST keep the session write (appending the new visitor message + assistant reply + SOP state) on the critical path so that the next chat turn loads a complete history.
- **FR-007**: System MUST attach error logging to the deferred write chain so that transient failures are visible in operational logs.
- **FR-008**: System MUST eliminate the duplicate session SELECT inside the session-append code path, replacing it with either a database-side append or a route-supplied in-memory history.
- **FR-009**: Non-chat callers of the existing message-append helper MUST continue to work without modification (the change must not break the contact-form-driven append or any other writer of `messages_json`).
- **FR-010**: System MUST memoize the static portion of the assembled system prompt (persona, in-scope practice areas, boundaries, escalation, contact info, custom instructions, generic SOP/lead-capture instructions) keyed by account identity, configuration version, and preview-vs-published variant.
- **FR-011**: System MUST invalidate the cached static prompt prefix whenever the configuration cache is invalidated (i.e., on publish, save, and theme-save events) so that a freshly-published configuration takes effect within the same staleness window the configuration cache already promises.
- **FR-012**: System MUST NOT leak cached prompt content across accounts, configuration versions, or preview/published variants.
- **FR-013**: System MUST defer construction of the branch-orchestrator dependency object (and its associated chip-weight lookups) until the SOP runtime has reached its finalized state, so that pre-finalize turns do not pay for work that will not be used.
- **FR-014**: System MUST NOT change any user-visible behavior: same lead rows produced, same classifications and scores, same notifications fired, same SOP step capture sequence, same branch dispatch, same goodbye handling, same off-topic side-question handling.
- **FR-015**: System MUST NOT change the database schema; all changes are application-layer.
- **FR-016**: System MUST NOT modify the agent's available tools or the per-turn tool-call ceiling.

### Key Entities

- **Cached static prompt prefix**: An in-process, per-(account, config version, preview-variant) string holding the unchanging portion of the chat system prompt. Lifetime is bounded by the same TTL as the configuration cache it shadows. Invalidated synchronously when the underlying configuration changes.
- **Deferred post-stream write batch**: The group of database writes — lead SOP-state update, branch-finalization update, hard-override application, partial-lead save — that complete after the assistant's stream closes. Treated as eventually-consistent relative to the chat response, strongly-consistent relative to subsequent reads of the lead row.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: P50 time-to-first-token for a representative chat turn drops by at least 150ms compared to the current baseline, measured on the dominant SOP-driven traffic shape.
- **SC-002**: P50 time-to-stream-`done` event for a representative chat turn drops by at least 200ms compared to the current baseline on the same traffic shape.
- **SC-003**: For every chat turn run against the change, the resulting database state (sessions row, leads row, notifications row, partial-leads row) is byte-for-byte equivalent to the database state the unchanged code path produces for the same input, ignoring monotonically-increasing timestamps.
- **SC-004**: All existing end-to-end widget walks pass without modification, except the deliberately-removed off-SOP-detour walk.
- **SC-005**: A scripted concurrent double-send test against a single session produces a final session row containing all messages from both turns and a final lead row reflecting the later turn — no lost or overwritten data.
- **SC-006**: A published configuration change becomes visible in the next chat turn no later than it does today (the cached static prompt prefix invalidation does not introduce additional staleness).
- **SC-007**: A representative chat turn that triggers a side-question detour (visitor asks about office hours mid-intake) produces an assistant reply that both answers the side question and re-asks the pending SOP step, matching the behavior of the current baseline.
- **SC-008**: Logs from production traffic over the first 48 hours after rollout show zero new error classes attributable to the deferred-write chain (no orphaned leads, no missing notifications, no silent write drops).

## Assumptions

- The deployment target supports a platform-level "complete this work after the response is sent" primitive (Vercel `waitUntil`, Cloudflare `event.waitUntil`, or equivalent). If the deployment target lacks this primitive, the deferred-writes optimization falls back to awaiting inline.
- The dominant production traffic shape for performance measurement is an SOP-driven intake on a published configuration with no preview flag and no off-topic side-question on the measured turn.
- Modern Gemini Flash reliably follows the static "off-SOP detour rule" embedded in the SOP system prompt; the dynamic detour-now nudge is therefore redundant in current production conditions.
- The session-write path is the only consumer that requires read-after-write consistency on `sessions.messages_json` within a single chat turn; downstream lead-side reads can tolerate a brief eventually-consistent window.
- The contact-form submission path and any other non-chat writer of `sessions.messages_json` will continue to use the existing SELECT-then-write helper and is unaffected by the chat-route-specific optimization.
- The 60-second TTL on the configuration cache is the upper bound for acceptable prompt-prefix staleness; aligning prompt-prefix invalidation with the configuration cache's existing invalidation hooks is sufficient.
- Hard-override application is downgrade-only safety logic that does not need to be synchronous with the visitor's stream — the visitor never sees it, and the dashboard tolerates a sub-second eventually-consistent window after `done`.
- The branch orchestrator's gate logic correctly no-ops on pre-finalize turns; lazily constructing its dependency object is safe because the orchestrator is never called before finalization.
- No new infrastructure (Redis, durable queues, background workers) is required for any optimization in this feature.
