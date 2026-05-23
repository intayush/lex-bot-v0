# Feature Specification: Hardening

**Feature Branch**: `008-hardening`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Hardening from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary source: §11 "Additional Recommendations" (specifically the items that were not already absorbed as binding requirements into earlier feature specs `001`–`007`). Supporting source: §1.10 "Compliance" (data retention and minimization). Each functional requirement cites its source section. No requirements have been invented.

## Overview

The Hardening feature implements the operational, observability, cost-control, and compliance layers that §11 of the product spec lists as recommendations beyond the core build (Phases 0–6). It bridges the gap between "the system works" and "the system is operable in production."

This feature is **strictly scoped to §11 items not already required by earlier feature specs**. Where a §11 recommendation was already absorbed into a binding requirement of an earlier feature, that requirement is *not* duplicated here:

- §11.1 Rate Limiting → already binding in `004-chat-api-agent` (FR-043 to FR-046). **Not duplicated here.**
- §11.2 Prompt-Injection Protection (input sanitization, system-prompt non-disclosure rule, log/flag injection attempts) → already binding in `004-chat-api-agent` (FR-047 to FR-049). The §11.2 recommendation that *remains here* is the optional "lightweight classifier that detects manipulation attempts before they reach the LLM" — phrased as "Consider…" in the source.
- §11.3 Cost Monitoring → only the per-conversation token-usage logging is binding in `004-chat-api-agent` (FR-050, FR-051). The remaining items (dashboard cumulative spend display, configurable spend alerts, daily budget cap that disables the chatbot with a friendly message) are **owned here**.
- §11.4 Legal Disclaimer → the persistent widget disclaimer is binding in `005-chat-widget` (FR-050) and the system-prompt non-disclosure rule is binding in `004-chat-api-agent` (FR-024). The remaining §11.4 items (terms-of-service acceptance, liability-counsel touchpoint) are **owned here**.
- §11.5 GDPR / Privacy Compliance → consent banner UI is in `005-chat-widget` (FR-051); deletion + archival + privacy-policy template surface + transcript export are in `007-dashboard` (FR-058 to FR-061). The remaining §11.5 items (consent timestamp persistence in the database, privacy-policy and ToS data-retention disclosure language, GDPR Article 17 justification language) are **owned here**.
- §11.6 Caching Layer (FAQ semantic cache) → entirely deferred. **Owned here.**
- §11.7 Observability → the structured-JSON logger that captures every conversation event is binding in the Foundation (`001-foundation` FR-031 to FR-035) and the emission of those events is binding in `004-chat-api-agent` (FR-054). The §11.7 recommendation that *remains here* is the per-session debug mode that can be toggled for troubleshooting.
- §11.8 User Testing with Real Lawyers → process recommendation; **owned here** as a release-gate scenario.

This is Phase 7 of the build roadmap. It can run in parallel with Phase 6 dashboard work or after, but every item must be present before any "production" claim.

## User Scenarios & Testing *(mandatory)*

The "users" of Hardening are:

1. **The lawyer** — sees cost dashboards and spend alerts, accepts terms of service at signup, and reads/links the privacy policy.
2. **A potential client visiting the lawyer's website** — has their consent timestamp recorded after agreeing to the consent banner; sees a friendly disabled-message if the firm has hit its daily budget cap.
3. **A Lex Bot engineer** — toggles per-session debug mode to troubleshoot specific conversations; relies on the semantic-similarity cache to keep LLM costs predictable for FAQ-heavy firms.
4. **Compliance/legal counsel** — reviews the data-retention language in the ToS and privacy policy template.

### User Story 1 — Lawyer Monitors Their Daily Spend (Priority: P1)

The lawyer opens the dashboard's cost view and sees the cumulative LLM spend for the day, the week, and the month, computed from the per-conversation token-usage records that are already being written by the Chat API. They can configure spend alerts (e.g., "notify me if daily cost exceeds $50") and see an indicator of how close they are to any daily budget cap they've configured.

**Why this priority**: §11.3 names cost monitoring as a P1 hardening item: "LLM API costs can spike unexpectedly." Without visible spend, surprise bills become possible. The token-usage logging that feeds this view is already binding (FR-050 in `004-chat-api-agent`); this feature surfaces it.

**Independent Test**: After running several test conversations, open the cost view and verify cumulative spend is displayed in approximate dollars based on per-token pricing, that an alert can be configured at a chosen daily threshold, and that the alert fires when the threshold is crossed.

**Acceptance Scenarios**:

1. **Given** at least one conversation has logged token usage, **When** the lawyer opens the cost-monitoring view, **Then** approximate cumulative spend (based on per-token pricing) is displayed (§11.3 bullet 2).
2. **Given** the lawyer configures a daily spend alert (e.g., "notify me if daily cost exceeds $50"), **When** the daily cumulative spend crosses that threshold, **Then** the lawyer is notified (§11.3 bullet 3).
3. **Given** the lawyer has configured a daily budget cap, **When** the cap is exceeded, **Then** the chatbot is disabled with a friendly message until the next day (§11.3 bullet 4).

---

### User Story 2 — Visitor Hits the Daily Budget Cap (Priority: P1)

A visitor on the firm's website attempts to chat after the firm has exceeded its configured daily budget cap. Instead of an LLM call (which would charge against the lawyer's account), the widget displays a friendly disabled-message.

**Why this priority**: §11.3 specifies "implementing a daily budget cap that disables the chatbot (with a friendly message) if exceeded" as a cost-control mechanism. Without it, a runaway-cost scenario can persist for the entire day.

**Independent Test**: Configure a daily budget of an amount the test conversation will exceed, then attempt a new chat and verify the widget shows the disabled-message and no LLM call is made.

**Acceptance Scenarios**:

1. **Given** the lawyer's daily budget cap has been exceeded, **When** a new visitor attempts to chat, **Then** the widget displays a friendly disabled-message and no LLM call is made (§11.3 bullet 4).
2. **Given** the daily budget has not been exceeded, **When** a visitor chats, **Then** the chatbot operates normally (§11.3 implicit corollary).

---

### User Story 3 — Visitor Provides Consent Whose Timestamp Is Recorded (Priority: P1)

After the visitor agrees to the consent banner displayed by the chat widget (already binding in `005-chat-widget` FR-051), the agreement is persisted server-side: the consent timestamp and method are recorded against the session record.

**Why this priority**: §11.5 requires "Store a consent timestamp and method per session in the database." Without server-side persistence, the audit trail for GDPR-style "right to be informed" inquiries is missing.

**Independent Test**: Drive a chat through the widget that includes consent. Inspect the session in the database and verify a consent timestamp and method are recorded.

**Acceptance Scenarios**:

1. **Given** a visitor agrees to the consent banner before any personal data is collected, **When** the agreement is submitted, **Then** the consent timestamp and method are persisted against the session record (§11.5 bullet 2).
2. **Given** consent was previously recorded for the session, **When** subsequent personal-data fields are filled, **Then** they are bound to the recorded consent (§11.5 implicit corollary).

---

### User Story 4 — Lawyer Reviews Privacy and Retention Disclosures (Priority: P1)

The lawyer reviews the privacy policy template and the terms of service surfaced by the dashboard. Both clearly disclose the data retention policy from §1.10: "A copy of all conversation data and lead records is retained on our servers indefinitely, even after the lawyer deletes their copy" — and that this is justified for service improvement, abuse prevention, compliance auditing, and dispute resolution. The privacy policy and ToS also reference applicable data-protection regulations including GDPR Article 17 right-to-erasure exceptions.

**Why this priority**: §11.5 explicitly says: "The privacy policy and terms of service must clearly state that a copy of all data is retained on our servers even after user-initiated deletion. This must comply with applicable data protection regulations — consult legal counsel on retention justification language for GDPR Article 17 (right to erasure) exceptions." This is a compliance gate; it is not optional.

**Independent Test**: Read the privacy-policy template and ToS shipped with the dashboard and confirm both contain the §1.10 retention disclosure and a §11.5 reference to GDPR Article 17 retention-justification handling.

**Acceptance Scenarios**:

1. **Given** the privacy policy template is reviewed, **When** the data-retention section is read, **Then** it clearly states that a copy of all data is retained on the SaaS servers indefinitely even after lawyer-initiated deletion, with the §1.10 stated purposes (service improvement, abuse prevention, compliance auditing, dispute resolution) (§1.10, §11.5).
2. **Given** the terms of service is reviewed, **When** the data-retention section is read, **Then** it contains the same retention disclosure (§11.5).
3. **Given** the privacy policy is reviewed, **When** the GDPR section is read, **Then** it includes legal-counsel-vetted language addressing GDPR Article 17 (right to erasure) exceptions for the retained archived copy (§11.5).

---

### User Story 5 — Lawyer Accepts Terms of Service at Onboarding (Priority: P2)

At account creation (or first login after ToS update), the lawyer is presented with a terms-of-service document that explicitly acknowledges the chatbot's limitations (it is an AI assistant, not a lawyer; nothing it says constitutes legal advice; the SaaS retains an archived copy of conversations after deletion). The lawyer must accept before continuing.

**Why this priority**: §11.4 says: "Consider requiring lawyers to accept terms of service that acknowledge the chatbot's limitations." It is a "Consider" recommendation but a meaningful liability protection in a regulated domain. Marked P2 because the wording is recommendation-form.

**Independent Test**: Sign up with a new test account and verify the ToS is presented before access to the dashboard, that acceptance is recorded against the account, and that subsequent logins skip the prompt unless the ToS version changes.

**Acceptance Scenarios**:

1. **Given** a new account at signup, **When** the lawyer attempts to access the dashboard, **Then** they are presented with the ToS that explicitly acknowledges the chatbot's limitations (§11.4 bullet 3).
2. **Given** the lawyer clicks Accept, **When** the action is recorded, **Then** the acceptance timestamp and ToS version are persisted against the account (§11.4 implicit persistence requirement to make acceptance auditable).

---

### User Story 6 — Engineer Toggles Per-Session Debug Mode (Priority: P2)

A Lex Bot engineer is troubleshooting an unusual conversation reported by a lawyer. They toggle per-session debug mode for that specific session, replay the next turn (or instruct the lawyer to send another), and the structured logs include richer detail for that session — without flooding the global log stream.

**Why this priority**: §11.7 says: "Consider a debug mode that can be toggled per session for troubleshooting specific conversations." It is recommendation-form ("Consider") but eliminates a class of "we can't reproduce" debugging frustration.

**Independent Test**: Mark a known session as debug-enabled. Drive a turn on that session. Verify additional log detail (e.g., full system prompt, full tool-call payloads) appears in logs for that session only.

**Acceptance Scenarios**:

1. **Given** a session marked as debug-enabled, **When** a turn is processed for it, **Then** richer per-event log detail is emitted compared to a non-debug session (§11.7 last bullet).
2. **Given** a session not marked as debug-enabled, **When** a turn is processed, **Then** standard per-event log detail is emitted (§11.7 baseline event list).

---

### User Story 7 — Repeated FAQ Queries Are Served from Cache (Priority: P3)

A firm with predictable intake questions (e.g., "What kinds of cases do you handle?") sees a 30–50% reduction in LLM calls because semantically similar questions hit a cached response stored in the database with a TTL. When the context store changes, the cache is invalidated.

**Why this priority**: §11.6 names this as a hardening recommendation: "Cache responses to frequently asked questions (FAQ-type queries) based on semantic similarity." It is a cost/latency optimization. Marked P3 because the entire core loop already works without it; it is purely an efficiency win.

**Independent Test**: Issue two semantically similar FAQ-type queries. Verify the second is served from cache (no LLM call). Update the context store and verify the cache is invalidated.

**Acceptance Scenarios**:

1. **Given** an FAQ-type response has been cached, **When** a new user asks a question that closely matches a previously answered question, **Then** the cached response is served (§11.6 bullets 1, 3).
2. **Given** a cached response exists, **When** the context store changes (a new crawl or sync), **Then** the cache is invalidated (§11.6 bullet 2).
3. **Given** a cache TTL has elapsed, **When** the next matching question arrives, **Then** the response is regenerated and re-cached (§11.6 bullet 2 implicit).

---

### User Story 8 — Real-Lawyer User Testing Validates the System (Priority: P2)

Before the system is invested in heavily at the agent layer, the team runs the §11.8 user-testing protocol with 2–3 practicing lawyers (testing the guardrails form) and with non-technical users simulating prospective clients (testing the chat widget). Findings are recorded and feed back into the spec.

**Why this priority**: §11.8 is explicit and prescriptive: "Test the guardrails form with 2-3 practicing lawyers", "Test the chat widget with non-technical users", "Validate that the qualifying questions and escalation triggers match real intake workflows", "This testing should happen after the form is built but before investing heavily in the agent layer." It is a process gate, not a feature, but it is binding for a credible release.

**Independent Test**: Demonstrate that the protocol was executed: at least 2–3 practicing lawyers tested the guardrails form, non-technical users tested the chat widget, and findings are recorded in the repository (e.g., `docs/user-testing.md`).

**Acceptance Scenarios**:

1. **Given** the guardrails form is built, **When** 2–3 practicing lawyers test it, **Then** their points of confusion and feedback are recorded (§11.8 bullets 1, 2).
2. **Given** the chat widget is built, **When** non-technical users (simulating prospective clients) test it, **Then** their findings are recorded and inform iterations (§11.8 bullet 3).
3. **Given** the qualifying questions and escalation triggers are validated, **When** the firm's actual intake workflow is compared, **Then** matches and gaps are recorded (§11.8 bullet 4).

---

### Edge Cases

- **Optional prompt-injection classifier disabled**: §11.2 phrases this as "Consider" — the binding sanitation, system-prompt non-disclosure rule, and logging are already in place via `004-chat-api-agent`. If the classifier is not deployed, the spec's binding protections still apply.
- **Daily budget cap reset boundary**: §11.3 says "daily budget cap that disables the chatbot." The reset boundary (UTC midnight, account-local timezone, rolling 24-hour window) is not enumerated by the spec. Captured in Assumptions.
- **Spend-alert delivery**: §11.3 says "notify me." Delivery channel for spend alerts is not enumerated. The dashboard bell/notifications drawer is the in-product channel; email is mentioned only in §8.2 for password reset. Captured in Assumptions.
- **Cache invalidation timing on context-store change**: §11.6 says "invalidate when context store changes." How "context store changes" is detected (manifest hash change, sync CLI run, polling) is not enumerated. Captured in Assumptions.
- **GDPR Article 17 retention exceptions justification**: §11.5 explicitly says "consult legal counsel on retention justification language." This is an external-input dependency; the actual legal text comes from counsel.
- **Debug-mode log scope**: §11.7 says "per session." Debug mode applies only to the marked session; non-debug sessions retain standard logging.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`. Items already binding in earlier feature specs are deliberately not re-stated.

### Functional Requirements

#### FR Group A — Cost Monitoring Surface (§11.3)

- **FR-001**: The Dashboard MUST display approximate cumulative LLM spend, computed from the per-conversation token-usage records (logged by `004-chat-api-agent` per FR-050 of that spec) using per-token pricing. Source: §11.3 bullet 2 ("Display cumulative spend in the dashboard (approximate, based on per-token pricing)").
- **FR-002**: The Dashboard MUST allow the lawyer to configure spend alerts at chosen thresholds (e.g., a daily threshold). Source: §11.3 bullet 3 ("Set up configurable spend alerts (e.g., 'notify me if daily cost exceeds $50')").
- **FR-003**: When a configured spend-alert threshold is crossed, the lawyer MUST be notified. Source: §11.3 bullet 3.
- **FR-004**: The system MUST support a daily budget cap that, when exceeded, disables the chatbot until the next day. Source: §11.3 bullet 4 ("implementing a daily budget cap that disables the chatbot (with a friendly message) if exceeded").
- **FR-005**: When the chatbot is disabled by a daily budget cap, the widget MUST display a friendly message rather than initiate an LLM call. Source: §11.3 bullet 4 ("with a friendly message").

#### FR Group B — Consent Persistence (§11.5)

- **FR-006**: When a visitor agrees to the consent banner before any personal data collection, the system MUST persist a consent timestamp and the consent method against the session record. Source: §11.5 bullet 2 ("Store a consent timestamp and method per session in the database").

#### FR Group C — Privacy and Retention Disclosure Documents (§1.10, §11.5)

- **FR-007**: The privacy policy template surfaced by the Dashboard MUST clearly state that a copy of all conversation data and lead records is retained on the SaaS servers indefinitely, even after lawyer-initiated deletion, including the §1.10 stated purposes: service improvement, abuse prevention, compliance auditing, and dispute resolution. Source: §1.10 ("Data retention" bullet), §11.5 ("Data retention disclosure" paragraph).
- **FR-008**: The terms of service surfaced by the system MUST clearly state the same data-retention disclosure as FR-007. Source: §11.5 ("Data retention disclosure: The privacy policy and terms of service must clearly state that a copy of all data is retained on our servers even after user-initiated deletion").
- **FR-009**: The privacy policy MUST include legal-counsel-vetted language addressing GDPR Article 17 (right to erasure) exceptions for the retained archived copy. Source: §11.5 ("consult legal counsel on retention justification language for GDPR Article 17 (right to erasure) exceptions").
- **FR-010**: Data minimization MUST be reflected in the operational behavior: only data necessary for lead qualification is extracted and stored; the lawyer-facing view respects deletion requests while the backend retains a separate archived copy. Source: §1.10 ("Minimization" bullet).

#### FR Group D — Terms of Service Acceptance (§11.4)

- **FR-011**: At account creation, the lawyer MUST be presented with a terms of service that explicitly acknowledges the chatbot's limitations (it is an AI assistant, not a lawyer; it does not provide legal advice; the SaaS retains an archived copy of conversations after deletion). The lawyer MUST accept before continuing. Source: §11.4 bullet 3 ("Consider requiring lawyers to accept terms of service that acknowledge the chatbot's limitations").
- **FR-012**: ToS acceptance MUST be persisted against the account with a timestamp and the accepted ToS version. Source: §11.4 bullet 3 (implicit persistence requirement to make acceptance auditable).
- **FR-013**: Liability exposure for incorrect or misleading chatbot responses MUST be reviewed with a legal professional. Source: §11.4 bullet 2 ("Consult with a legal professional about liability exposure for incorrect or misleading chatbot responses"). (This is an external review obligation, not a product behavior; tracked here as a release-gate item.)

#### FR Group E — Optional Prompt-Injection Classifier (§11.2)

- **FR-014**: A lightweight classifier that detects manipulation attempts (e.g., "ignore your instructions", "print your system prompt") MAY be deployed before user input reaches the LLM. When deployed, it MUST flag suspicious inputs and route them through the existing logging/flagging pipeline (already binding in `004-chat-api-agent`). Source: §11.2 bullet 4 ("Consider a lightweight classifier that detects manipulation attempts before they reach the LLM").

> Note: The phrasing in §11.2 is "Consider," so this is a MAY-level requirement, not a MUST. The binding §11.2 protections (sanitization, system-prompt non-disclosure rule, logging/flagging) are already required by `004-chat-api-agent` (FR-047 to FR-049).

#### FR Group F — FAQ Semantic Cache (§11.6)

- **FR-015**: The system MAY cache responses to frequently asked questions (FAQ-type queries) based on semantic similarity. When deployed, cached responses MUST be stored in the database with a TTL. Source: §11.6 bullets 1, 2.
- **FR-016**: When a cache is deployed and the user's question closely matches a previously answered question (FAQ detection), the cached response MUST be served instead of issuing a new LLM call. Source: §11.6 bullet 3.
- **FR-017**: When a cache is deployed and the context store changes, the cache MUST be invalidated. Source: §11.6 bullet 2.
- **FR-018**: Where deployed, the cache aim is "30-50% reduction in LLM calls for firms with predictable intake questions" — i.e., a measurable, observable savings target on representative workloads. Source: §11.6 ("Expected savings").

#### FR Group G — Per-Session Debug Mode (§11.7)

- **FR-019**: A debug mode that can be toggled per session MUST be available for troubleshooting specific conversations. When enabled for a session, log emission for that session MUST contain richer detail than the non-debug baseline. Source: §11.7 last bullet ("Consider a debug mode that can be toggled per session for troubleshooting specific conversations").
- **FR-020**: Per-session debug mode MUST NOT alter logging for sessions that are not marked as debug-enabled. Source: §11.7 (per-session scope).

#### FR Group H — User-Testing Release Gate (§11.8)

- **FR-021**: Before the system is invested in heavily at the agent layer, the guardrails form MUST be tested with 2–3 practicing lawyers, with their points of confusion and feedback recorded. Source: §11.8 bullets 1, 2, and timing bullet ("This testing should happen after the form is built but before investing heavily in the agent layer").
- **FR-022**: The chat widget MUST be tested with non-technical users (simulating prospective clients) to verify the conversation flow feels natural; findings MUST be recorded. Source: §11.8 bullet 3.
- **FR-023**: The qualifying questions and escalation triggers MUST be validated against real firm intake workflows; matches and gaps MUST be recorded. Source: §11.8 bullet 4.

### Key Entities

This feature reads existing entities from §2.6 and adds operational/audit data. It introduces no fundamentally new persistent entity beyond what's already in the schema; new fields or auxiliary records are noted as such.

- **Token-usage record (read)**: Already written by `004-chat-api-agent` per FR-050 of that spec. Read by the cost-monitoring view to compute cumulative spend. Source: §11.3.
- **Spend-alert configuration (new auxiliary state)**: Per-account thresholds (e.g., "daily cost > $50") and a daily-budget cap value. Persisted against the account. Source: §11.3 bullets 3, 4.
- **Consent record (new column or auxiliary record)**: A consent timestamp and method per session. Either an additional column on `sessions` or a new lightweight table. Source: §11.5 bullet 2.
- **ToS acceptance record (new column or auxiliary record)**: A ToS-accepted-at timestamp and accepted-ToS-version per account. Source: §11.4 bullet 3.
- **FAQ semantic cache entry (new auxiliary record, optional)**: Persisted cached question/answer pairs keyed by semantic similarity, with a TTL and an invalidation trigger tied to context-store changes. Optional; deployed only when the cache is enabled. Source: §11.6.
- **Privacy policy template (artifact)**: A markdown or text artifact surfaced by the Dashboard, containing the §1.10 / §11.5 disclosures. Source: §11.5.
- **Terms of service template (artifact)**: A markdown or text artifact surfaced at signup, containing the §11.4 / §11.5 disclosures. Source: §11.4, §11.5.

The exact storage shape of these new auxiliary records (column-on-existing-table vs. new table) is implementation detail and captured in Assumptions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a representative day of conversations, the Dashboard's cost-monitoring view shows a cumulative-spend value that matches the sum of per-conversation token-usage records multiplied by the configured per-token price within rounding error. Source: §11.3 bullet 2.
- **SC-002**: When the lawyer configures a daily-spend alert threshold and the day's cumulative spend crosses it, the lawyer receives a notification within the same session of activity. Source: §11.3 bullet 3.
- **SC-003**: When the daily budget cap is exceeded, 100% of new chat attempts produce the friendly disabled-message and zero LLM calls are made for that account until the cap resets. Source: §11.3 bullet 4.
- **SC-004**: 100% of sessions that include personal-data collection have an associated consent timestamp and consent method recorded server-side. Source: §11.5 bullet 2.
- **SC-005**: The privacy policy template and the terms of service template both contain a clearly visible data-retention disclosure that includes the indefinite-retention statement and the §1.10 stated purposes. Source: §1.10, §11.5.
- **SC-006**: The privacy policy includes an explicit legal-counsel-reviewed treatment of GDPR Article 17 right-to-erasure exceptions for the retained archived copy. Source: §11.5.
- **SC-007**: 100% of newly created accounts encounter the ToS acceptance step before reaching the dashboard, and the acceptance timestamp + ToS version is persisted. Source: §11.4 bullet 3.
- **SC-008**: Where the FAQ semantic cache is deployed, on a representative FAQ-heavy workload the cache reduces LLM calls within the spec's expected savings range of 30–50%. Source: §11.6 ("Expected savings: 30-50% reduction in LLM calls for firms with predictable intake questions").
- **SC-009**: Where the FAQ semantic cache is deployed, a context-store change causes the cache to be invalidated; subsequent identical queries hit the LLM (and re-cache). Source: §11.6 bullet 2.
- **SC-010**: A session marked debug-enabled emits richer per-event log detail than a non-debug baseline session, and a non-debug session is unaffected. Source: §11.7 last bullet.
- **SC-011**: The §11.8 user-testing protocol has been executed: at least 2–3 practicing lawyers have tested the guardrails form, non-technical users have tested the chat widget, and findings are committed to the repository before the agent-layer investment proceeds. Source: §11.8.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Per-token price source**: §11.3 says "based on per-token pricing" but does not enumerate the price values. The Gemini provider's published per-token rates for the configured `gemini-2.5-flash` model (§2.7) are the natural default; rates are configuration that operators can update without code changes.
- **Daily reset boundary**: §11.3 says "daily" without specifying the boundary. UTC midnight is a reasonable, deterministic default that is easy to reason about; account-local timezone is also acceptable. The spec is silent.
- **Spend-alert delivery channel**: §11.3 says "notify me." The dashboard's existing in-product notifications drawer (§8.7) is the natural channel. Email delivery is mentioned only for password reset (§8.2). In-product notification is the default; email is post-MVP per §10's "Notification channels" deferral.
- **Storage shape of consent and ToS-acceptance metadata**: §11.5 / §11.4 do not enumerate whether to add columns to `sessions` / `accounts` or create new tables. Either is consistent. Adding columns is the simpler default; new tables enable a richer audit trail.
- **Cache invalidation trigger detection**: §11.6 says "invalidate when context store changes" without enumerating detection. Watching for crawler-CLI runs or sync-CLI runs (or a hash change in `_manifest.json`) is acceptable. The spec is silent.
- **Cache key shape**: §11.6 says "based on semantic similarity." Vector-embedding-based keys are the obvious approach but the spec does not require any specific embedding model. Implementation choice, not requirement.
- **Optional prompt-injection classifier deployment decision**: §11.2 phrases this as "Consider." Whether to deploy is a per-release decision; the binding §11.2 protections (sanitization, non-disclosure rule, logging) are always present.
- **User-testing artifact location**: §11.8 says findings should inform iteration but does not enumerate where to record them. A `docs/user-testing.md` (or similar) committed to the repository is the natural default.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Hardening feature, even though they appear in §11.

- **§11.1 Rate limits** — already binding in `004-chat-api-agent` (FR-043 to FR-046).
- **§11.2 Sanitization, system-prompt non-disclosure rule, log/flag injection attempts** — already binding in `004-chat-api-agent` (FR-047 to FR-049). Only the optional classifier (§11.2 bullet 4) is owned here.
- **§11.3 Per-conversation token-usage logging** — already binding in `004-chat-api-agent` (FR-050, FR-051). Only the cost-monitoring surface, alerts, and budget cap (§11.3 bullets 2, 3, 4) are owned here.
- **§11.4 Persistent widget disclaimer** — already binding in `005-chat-widget` (FR-050).
- **§11.4 System-prompt rule that the chatbot must not claim to be a lawyer / give legal advice** — already binding in `004-chat-api-agent` (FR-024).
- **§11.4 Disclaimer language as a non-removable default in the guardrails form** — already binding in `004-chat-api-agent` (FR-024) and rendered via the Dashboard (`007-dashboard`).
- **§11.5 Consent banner UI** — already binding in `005-chat-widget` (FR-051).
- **§11.5 Deletion mechanism, archival writes, transcript export, privacy-policy template surface** — already binding in `007-dashboard` (FR-058 to FR-061).
- **§11.7 Structured-JSON logger and event emission** — logger already binding in `001-foundation` (FR-031 to FR-035); event emission already binding in `004-chat-api-agent` (FR-054). Only the optional per-session debug mode (§11.7 last bullet) is owned here.
- **All §10 / §8.12 MVP-deferred items** — billing/Stripe, CRM integrations, advanced analytics dashboards, multi-language, A/B testing, live agent handoff, custom theme builder, BYO LLM provider.

## Dependencies

- **External (release-gate)**: Engagement with legal counsel for §11.4 bullet 2 (liability exposure review) and §11.5 (GDPR Article 17 retention-justification language).
- **External (operational)**: A per-token price reference for the Gemini provider used by §11.3 cumulative-spend display.
- **Internal — Upstream**: `001-foundation` (logger, schema baseline, env loader). `004-chat-api-agent` for the per-conversation token-usage records this feature consumes (§11.3 bullet 1) and for the prompt-injection logging pipeline this feature's optional classifier feeds. `005-chat-widget` for the consent banner UI whose acceptance this feature persists (§11.5 bullet 2). `007-dashboard` for the surfaces that present cost monitoring, alerts, ToS acceptance, and privacy/ToS templates.
- **Internal — Downstream**: None. Hardening is a quality/operational layer that does not unblock further feature work.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific embedding model, vector-similarity threshold, or vector-store technology is mandated for the FAQ semantic cache; §11.6 names only the behavior.
- No specific reset boundary for the "daily" budget is mandated.
- No specific spend-alert delivery channel is mandated beyond the in-product notification channel that already exists.
- No specific ToS or privacy-policy text is provided. §11.4 / §11.5 specify the required disclosures; the actual legal copy comes from counsel review.
- No specific consent-method enum or vocabulary is mandated; §11.5 says "method" without enumerating values.
- No specific per-token price table is hardcoded; pricing is operator-configured and based on the provider's published rates.
- No specific log-detail-additions list is mandated for debug mode; §11.7 says "richer detail" without enumerating fields.
- No specific quantitative threshold for "lightweight" classifier latency or accuracy is mandated; §11.2 says "lightweight" without elaboration.
- No specific user-testing methodology (think-aloud, task-list, A/B) or recording format is mandated; §11.8 names participants and topics.
- The post-MVP roadmap items in §10 / §8.12 (billing, CRM, multi-language, A/B testing, etc.) are explicitly out of scope per those sections — not adopted here.

If any of these are wanted, they belong in a separate feature, not in Hardening.
