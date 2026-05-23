# Feature Specification: Lead Classification

**Feature Branch**: `006-lead-classification`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Lead Classification from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary sources: §2.8 (Agent Architecture — lead capture tool description), §7.1 (purpose includes "classifies leads"), §7.4 (Tool: Lead Capture with inline classification — full interface and outcomes), §7.10 (Lead Data Extraction — primary path + heuristic fallback), §12.10 (Phase 5 deliverable + done-when). Supporting sources: §2.6 (`leads` and `notifications` schemas), §11.5 (consent timestamp persistence). Each functional requirement cites its source section. No requirements have been invented.

## Overview

Lead Classification is the system that captures structured intake data from chat conversations and persists it as classified leads in the database (§12.10 goal). It operates through two complementary mechanisms (§7.10):

1. **Primary path — LLM-driven capture via the `captureLead` tool** (§7.4). The LLM calls this tool as soon as it understands the visitor's legal matter; it determines classification (`urgent` / `normal` / `unqualified`) inline based on system-prompt criteria and supplies a rationale plus urgency factors.
2. **Fallback path — Heuristic-based partial lead extraction** (§7.4 partial-lead fallback paragraph, §7.10). After each chat turn, a regex-based extractor pulls any email / phone / name / case description from user messages and saves a partial lead with a heuristic classification, ensuring abandoned mid-conversation sessions still preserve whatever was shared.

The feature also creates a notification when a lead is classified `urgent` (§7.4 mechanism step 4, §12.10 build list).

This is Phase 5 per §12.5. It depends on `004-chat-api-agent` (the agent runtime where `captureLead` is wired in) and `001-foundation` (the database schema). It feeds Phase 6 dashboard pages (Leads list, Lead detail, Notifications) — those are downstream and out of scope here.

## User Scenarios & Testing *(mandatory)*

The "users" of Lead Classification are:

1. **The agent runtime (LLM tool caller)** — invokes `captureLead` mid-conversation when the legal matter is clear.
2. **The chat turn handler** — runs the heuristic fallback after each turn for sessions where the LLM has not (yet) called `captureLead`.
3. **The lawyer** (indirectly) — sees the resulting lead records and notifications in the dashboard.
4. **A Lex Bot engineer** — verifies the §12.10 done-when criteria by simulating an intake conversation and inspecting the database.

### User Story 1 — Visitor Has a Qualifying Conversation; LLM Captures a Classified Lead (Priority: P1)

A visitor describes their legal matter to the chatbot (e.g., "I was just arrested for DUI last night"). As soon as the LLM understands the matter, it calls `captureLead` with the extracted name, contact details (if any have been shared), case type, brief description, classification (`urgent`), classification rationale, and urgency factors. The tool writes a `leads` row, and because the classification is `urgent`, a `notifications` row is also created. The agent continues the conversation and recommends immediate contact per the `urgent` agent-action rule.

**Why this priority**: §7.4 names this as the primary path. §12.10 done-when includes "After 5+ messages in a qualifying conversation, a lead record is created" with all required fields. Without this, the system collects no leads — which is the product's entire reason to exist (§1.5).

**Independent Test**: Drive an intake conversation through the local API per §12.10 deliverable, then query the database and verify a `leads` row exists with the correct classification, rationale, and urgency factors, and a corresponding `notifications` row exists for urgent classifications.

**Acceptance Scenarios**:

1. **Given** a conversation in which the visitor has communicated a legal matter, **When** the LLM understands the matter, **Then** it calls `captureLead` without waiting for complete contact info — a brief description of the legal issue is sufficient (§7.4 mechanism step 1, tool description).
2. **Given** the LLM calls `captureLead` with `classification: 'urgent'`, **When** the tool executes, **Then** a `leads` row is written and a `notifications` row of `type = 'urgent_lead'` is created automatically (§7.4 mechanism step 4, §2.6 `notifications` schema).
3. **Given** the LLM calls `captureLead` with `classification: 'normal'`, **When** the tool executes, **Then** a `leads` row is written and no urgent notification is created (§7.4 outcomes table).
4. **Given** the LLM calls `captureLead` with `classification: 'unqualified'`, **When** the tool executes, **Then** a `leads` row is written for record-keeping (§7.4 outcomes table — "Store in DB; politely redirect").
5. **Given** the tool has executed, **When** the agent receives the result, **Then** the classification is returned to the agent so it can act on it (§7.4 execute comment 3: "Return classification for agent to act on").

---

### User Story 2 — Visitor Abandons a Conversation Mid-Way; Partial Lead Is Still Saved (Priority: P1)

A visitor begins a conversation, shares an email address and a brief description ("I think I have a wage claim"), but closes the tab before the LLM has called `captureLead`. After each chat turn, a regex-based heuristic extractor runs against the user's messages and writes a partial lead record with a heuristic classification so that whatever was shared is not lost.

**Why this priority**: §7.10 explicitly says "This ensures that even abandoned mid-conversation sessions preserve whatever information was shared." §12.10 done-when includes "Partial conversations still save partial data (abandoned sessions)." Lead-loss on abandonment is a core failure mode the spec is built to prevent.

**Independent Test**: Send 1–2 messages with shareable patterns (an email and a description), do not let the LLM call `captureLead`, and verify a partial lead row exists with whatever was extractable.

**Acceptance Scenarios**:

1. **Given** a chat turn has just completed, **When** the LLM did not call `captureLead` during that turn, **Then** a heuristic extraction MUST run against the user's messages (§7.10 fallback paragraph).
2. **Given** the heuristic extraction runs, **When** it finds an email, phone, or name pattern in the user's messages, **Then** those fields are saved on the partial lead row (§7.10 ("This extracts any email, phone, name, and case description from user messages")).
3. **Given** the heuristic extraction runs and the conversation contains both legal-matter keywords (e.g., DUI, assault, cocaine) AND urgency signals (today, arrested, detained, emergency, human representative), **When** classification is determined, **Then** the partial lead is classified as `urgent` (§7.10 heuristic table row 1).
4. **Given** the heuristic extraction runs and the conversation describes a legal matter without urgency signals, **When** classification is determined, **Then** the partial lead is classified as `normal` (§7.10 heuristic table row 2).
5. **Given** the heuristic extraction runs and no identifiable legal matter is present in the conversation, **When** classification is determined, **Then** the partial lead is classified as `unqualified` (§7.10 heuristic table row 3).

---

### User Story 3 — Lawyer Reviews a Captured Lead (Priority: P1)

After a captured lead exists in the database, the lawyer (via the dashboard, in a downstream feature) is able to read its full classification, rationale, urgency factors, and structured fields. From the lead-classification feature's perspective, this means the persisted record contains everything needed for review — name, contact info, case type, incident date, brief description, classification, classification rationale, urgency factors — and is queryable.

**Why this priority**: §12.10 done-when includes "Lead has: name, contact, case type, classification (urgent/normal/unqualified)" and "Classification rationale is stored and readable." Without these fields persisted, the dashboard's leads page cannot do its job.

**Independent Test**: After running an intake conversation, run the §12.10 deliverable SQL query and verify all the required fields are populated and human-readable.

**Acceptance Scenarios**:

1. **Given** an `urgent` lead has been captured, **When** the database row is read, **Then** all of these fields are present: `name` (nullable), `contact_email` (nullable), `contact_phone` (nullable), `case_type`, `incident_date` (nullable), `brief_description`, `classification`, `classification_rationale`, `urgency_factors_json`, `created_at`, `account_id`, `session_id` (§2.6 `leads` schema, §7.4 tool parameters).
2. **Given** any captured lead, **When** the database row is read, **Then** `classification_rationale` is non-empty and human-readable (§7.4 parameter `classificationRationale: z.string()`, §12.10 done-when).
3. **Given** any captured lead, **When** the database row is read, **Then** `status` is `'new'` by default (§2.6 `leads.status` default).

---

### User Story 4 — Out-of-Scope Visitor Is Recorded as Unqualified (Priority: P2)

A visitor asks about a topic outside the firm's configured practice areas (e.g., a tax-law question to a criminal-defense firm). The chatbot deflects per the configured out-of-scope response (Chat API + Agent feature) and the lead-classification feature records the visitor as `unqualified` with rationale.

**Why this priority**: §12.10 done-when explicitly includes "Unqualified leads (out-of-scope questions) are correctly classified." §7.4 outcomes table row 3 names the agent action: "Store in DB; politely redirect." Recording out-of-scope contacts is useful both for analytics and for not silently dropping potential client interest.

**Independent Test**: Drive a conversation that is clearly outside the firm's configured practice areas and verify a lead row is written with `classification = 'unqualified'`.

**Acceptance Scenarios**:

1. **Given** a question outside the firm's configured practice areas, **When** classification is determined (either by the LLM via `captureLead` or by the heuristic fallback's "no identifiable legal matter" rule), **Then** the lead is classified as `unqualified` (§7.4 outcomes table row 3, §7.10 heuristic table row 3).
2. **Given** an `unqualified` lead has been captured, **When** the row is read, **Then** the `classification` field is exactly `'unqualified'` (one of the three enum values from §7.4 and §2.6 schema comment).

---

### Edge Cases

- **`captureLead` called more than once in the same session**: §7.4 does not enumerate uniqueness rules. The mechanism describes the tool's call as something the LLM does "as soon as it understands the visitor's legal matter," which implies once per coherent matter. Repeat calls within the same session may be expected as the picture sharpens (e.g., contact info arrives later); how to deduplicate vs. update is captured in Assumptions.
- **`captureLead` called with no contact info**: §7.4 description: "do not wait for complete contact info." All four contact fields (`name`, `contactEmail`, `contactPhone`, `incidentDate`) are `z.string().nullable()` in the tool schema. The lead row is therefore valid with all four null.
- **Heuristic extraction runs but finds nothing**: §7.10 says heuristic runs after each chat turn; if nothing extractable is present and no legal matter is described, the classification is `unqualified` (§7.10 heuristic row 3). Whether to write a row at all in this case is captured in Assumptions.
- **Both paths produce a record for the same session**: §7.10 says heuristic runs only "If the LLM did not call `captureLead`." This implies the heuristic is suppressed once the LLM has captured the lead. Behavior captured in Assumptions for the timing-edge case.
- **`urgency_factors` empty for an `urgent` lead**: §7.4 schema requires `urgencyFactors: z.array(z.string())`; an empty array is technically schema-valid. However the `urgent` classification by definition rests on factors per §7.4 outcomes table; an empty array on `urgent` indicates a model error.
- **`classification_rationale` empty**: §7.4 schema requires `classificationRationale: z.string()`. An empty string is technically schema-valid but defeats §12.10 done-when ("Classification rationale is stored and readable"). A non-empty rationale is the binding requirement.
- **Lead written but notification creation fails**: §7.4 mechanism steps 3 and 4 are sequential ("Write lead record"; "Create notification if urgent"). The spec does not enumerate transactional behavior. Captured in Assumptions.
- **LLM hallucinates contact info that the visitor never provided**: §11.4 forbids fabrication. While that is enforced primarily at the agent layer, the lead row's `classification_rationale` should reflect the conversation. The fabrication-prevention rule from §7.11 / §11.4 belongs to the Chat API + Agent feature; this feature persists what the tool is given.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — `captureLead` Tool Surface (§7.4, §2.8)

- **FR-001**: The agent MUST be provided with a tool named `captureLead` whose role is described as: "Capture a qualified lead after understanding the legal matter. Call as soon as the legal issue is clear — do not wait for complete contact info." Source: §7.4 (`description` field).
- **FR-002**: The `captureLead` tool MUST accept the following parameters: `name` (string, nullable), `contactEmail` (string, nullable), `contactPhone` (string, nullable), `caseType` (string, nullable), `incidentDate` (string, nullable), `briefDescription` (string, required), `classification` (one of: `urgent`, `normal`, `unqualified`), `classificationRationale` (string, required), `urgencyFactors` (array of strings, required). Source: §7.4 parameter schema.
- **FR-003**: The LLM MUST be guided to call `captureLead` as soon as it understands the visitor's legal matter, without waiting for complete contact info — a brief description of the legal issue is sufficient. Source: §7.4 mechanism step 1, §7.10.
- **FR-004**: The classification value supplied by the LLM MUST be determined inline by the LLM based on the system prompt's classification criteria, not by a separate classifier tool. Source: §7.4 mechanism step 2 ("The LLM determines classification (urgent/normal/unqualified) based on system prompt criteria") and §7.4 purpose ("Replaces the originally specified separate classifier and intake manager tools — the LLM handles both responsibilities").

#### FR Group B — `captureLead` Execution Behavior (§7.4, §12.10, §2.6)

- **FR-005**: When the `captureLead` tool executes, it MUST write a lead record to the database. Source: §7.4 mechanism step 3, execute comment 1.
- **FR-006**: The persisted lead row MUST contain all of: `id`, `account_id`, `session_id`, `name`, `contact_email`, `contact_phone`, `case_type`, `incident_date`, `brief_description`, `classification`, `classification_rationale`, `urgency_factors_json`, `status`, `created_at` — using the exact column shape defined in the `leads` table schema. Source: §2.6 `leads` schema, §12.10 done-when ("Lead has: name, contact, case type, classification …").
- **FR-007**: The persisted lead row's `account_id` MUST be the account associated with the API key for the request, and `session_id` MUST be the active session ID. Source: §2.6 schema (`account_id` and `session_id` foreign keys).
- **FR-008**: The persisted lead row's `status` MUST default to `'new'`. Source: §2.6 (`leads.status` default).
- **FR-009**: The persisted lead row's `classification` MUST be exactly one of: `'urgent'`, `'normal'`, `'unqualified'`. Source: §2.6 schema comment, §7.4 enum, §12.10 done-when.
- **FR-010**: The persisted lead row's `classification_rationale` MUST be non-empty and human-readable. Source: §12.10 done-when ("Classification rationale is stored and readable").
- **FR-011**: The persisted lead row's `urgency_factors_json` MUST be the JSON-serialized form of the LLM-supplied `urgencyFactors` array. Source: §2.6 schema (`urgency_factors_json`), §7.4 parameter `urgencyFactors`.
- **FR-012**: When the `captureLead` tool executes with `classification = 'urgent'`, a notification MUST be automatically created. Source: §7.4 mechanism step 4 ("For urgent leads, a notification is automatically created"), §12.10 build list ("Urgent lead notification creation").
- **FR-013**: The created urgent notification MUST be a row in the `notifications` table with `type = 'urgent_lead'`, the lead's `id` referenced via `notifications.lead_id`, the same `account_id`, an unread state (`read = false`), and a delivery channel of `dashboard`. Source: §2.6 `notifications` schema (defaults `read = false`, `delivery_channel = 'dashboard'`; `type` allowed values include `urgent_lead`).
- **FR-014**: The `captureLead` tool MUST return the classification (and other relevant data) to the agent so the agent can act on it. Source: §7.4 execute comment 3 ("Return classification for agent to act on").

#### FR Group C — Classification Outcomes & Agent Actions (§7.4)

- **FR-015**: The classification `urgent` MUST be reserved for leads matching the criteria: time-sensitive matter, statute of limitations, active danger, recent arrest, or user requests human help. Source: §7.4 outcomes table row 1.
- **FR-016**: The classification `normal` MUST be reserved for leads that are valid legal matters but not time-critical. Source: §7.4 outcomes table row 2.
- **FR-017**: The classification `unqualified` MUST be reserved for leads outside the firm's practice areas or with no actionable legal matter. Source: §7.4 outcomes table row 3.
- **FR-018**: For `urgent` leads, the agent action MUST be: prioritize in DB; create notification; recommend immediate contact. Source: §7.4 outcomes table row 1.
- **FR-019**: For `normal` leads, the agent action MUST be: store in DB; offer consultation scheduling. Source: §7.4 outcomes table row 2.
- **FR-020**: For `unqualified` leads, the agent action MUST be: store in DB; politely redirect. Source: §7.4 outcomes table row 3.

#### FR Group D — Heuristic Partial-Lead Fallback (§7.4, §7.10)

- **FR-021**: After every chat turn for a session, a heuristic-based partial lead extraction MUST run if the LLM did not call `captureLead` during that turn. Source: §7.4 ("If the LLM does not call `captureLead` during a conversation … a heuristic-based partial lead extraction runs after each chat turn"), §7.10 ("After each chat turn, a regex-based extraction runs").
- **FR-022**: The heuristic extractor MUST attempt to capture any of the following from the user's messages in the session: email pattern, phone pattern, name pattern, case description. Source: §7.10 ("This extracts any email, phone, name, and case description from user messages").
- **FR-023**: The heuristic extractor MUST classify the partial lead based on urgency-signal detection. The classification rules are: (a) `urgent` if the conversation contains both a legal-matter keyword (e.g., DUI, assault, cocaine) AND an urgency signal (today, arrested, detained, emergency, human representative); (b) `normal` if the conversation describes a legal matter without urgency signals; (c) `unqualified` if the conversation contains no identifiable legal matter. Source: §7.10 heuristic-classification bullet list, also reiterated in §7.4 partial-lead fallback paragraph.
- **FR-024**: The heuristic extractor MUST persist whatever was extracted as a partial lead row, even when only some fields are populated. Source: §7.10 ("This ensures that even abandoned mid-conversation sessions preserve whatever information was shared"), §12.10 done-when ("Partial conversations still save partial data (abandoned sessions)").
- **FR-025**: When the heuristic runs and the LLM has previously called `captureLead` in the same session, the heuristic MUST NOT create a duplicate lead row for that session. Source: §7.10 ("If the LLM did not call `captureLead`, this partial data is saved with a heuristic classification") — the heuristic save is conditional on the LLM not having captured.

#### FR Group E — Persistence & Schema Conformance (§2.6)

- **FR-026**: All lead rows (LLM-driven and heuristic-driven) MUST conform to the `leads` table schema in §2.6, including the foreign-key constraints (`account_id → accounts.id`, `session_id → sessions.id`). Source: §2.6.
- **FR-027**: All notification rows MUST conform to the `notifications` table schema in §2.6, including the foreign-key constraint to the lead (`notifications.lead_id → leads.id`). Source: §2.6.

#### FR Group F — Operational Surface (§12.10)

- **FR-028**: The Phase 5 deliverable MUST be exercisable by simulating a full intake conversation and inspecting the database; the `leads` table SQL query in §12.10 MUST surface the captured rows. Source: §12.10 deliverable.
- **FR-029**: After 5 or more messages in a qualifying conversation, a lead record MUST exist for that session. Source: §12.10 done-when ("After 5+ messages in a qualifying conversation, a lead record is created").
- **FR-030**: The `captureLead` tool path and the heuristic fallback path MUST both be covered by unit tests for: intake tracking, classification logic, and database writes. Source: §12.10 done-when ("Unit tests pass for: intake tracking, classification logic, DB writes").

### Key Entities

This feature is the primary writer of two persistent entities defined in §2.6 schema. It does not introduce new entities.

- **Lead**: A captured intake lead, bound to an `account_id` and `session_id`. Carries: `name` (nullable), `contact_email` (nullable), `contact_phone` (nullable), `case_type` (nullable), `incident_date` (nullable), `brief_description` (required), `classification` (`urgent` | `normal` | `unqualified`), `classification_rationale` (required, human-readable), `urgency_factors_json` (JSON-serialized array), `status` (default `'new'`: `'new'` | `'contacted'` | `'dismissed'`), `created_at`. Written by both the `captureLead` tool path and the heuristic fallback path. Source: §2.6 `leads` schema, §7.4 tool parameters.
- **Notification**: A dashboard alert. For this feature, the only `type` written is `'urgent_lead'`. Carries: `id`, `account_id`, `type`, `title`, `body`, `lead_id`, `read` (default `false`), `delivery_channel` (default `'dashboard'`), `delivered_at`, `created_at`. Written when a lead's classification is `'urgent'`. Source: §2.6 `notifications` schema, §7.4 mechanism step 4.

The `archived_data`, `accounts`, `api_keys`, `configurations`, and `sessions` entities are read-only (or unused) at this layer; they are owned by other features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After driving a qualifying intake conversation of 5+ messages through the local API, exactly one lead row exists for that session in the `leads` table. Source: §12.10 done-when ("After 5+ messages in a qualifying conversation, a lead record is created").
- **SC-002**: 100% of captured `urgent` leads have a corresponding `notifications` row of `type = 'urgent_lead'`. Source: §7.4 mechanism step 4.
- **SC-003**: 100% of captured leads have a non-empty, human-readable `classification_rationale`. Source: §12.10 done-when.
- **SC-004**: 100% of captured leads have `classification` exactly equal to one of `'urgent'`, `'normal'`, `'unqualified'`. Source: §2.6 schema, §7.4 enum.
- **SC-005**: 100% of captured leads carry the required core fields per §12.10 done-when: a name (or null), contact info (email/phone, possibly null), case type, classification. Source: §12.10 done-when ("Lead has: name, contact, case type, classification (urgent/normal/unqualified)").
- **SC-006**: An abandoned conversation in which the LLM did not call `captureLead` but in which the user shared at least one extractable pattern (email, phone, name, or a description) results in a partial lead row being persisted. Source: §12.10 done-when ("Partial conversations still save partial data (abandoned sessions)"), §7.10.
- **SC-007**: A conversation that contains both a legal-matter keyword AND an urgency signal AND in which the LLM did not call `captureLead` results in a partial lead classified `urgent`. Source: §7.10 heuristic table row 1.
- **SC-008**: A conversation outside the firm's configured practice areas results in an `unqualified` lead, whether captured by the LLM or by the heuristic fallback. Source: §12.10 done-when ("Unqualified leads (out-of-scope questions) are correctly classified"), §7.4 outcomes row 3, §7.10 heuristic row 3.
- **SC-009**: For sessions where the LLM has called `captureLead`, the heuristic fallback does not create a duplicate lead row. Source: §7.10 conditional fallback wording.
- **SC-010**: 100% of urgent-lead notifications carry a non-null `lead_id` referencing the captured lead, an unread state, and `delivery_channel = 'dashboard'`. Source: §2.6 `notifications` schema defaults, §7.4 mechanism step 4.
- **SC-011**: Unit tests exist and pass for: intake tracking, classification logic (both LLM-supplied and heuristic), and database writes. Source: §12.10 done-when.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Update-vs-insert on repeat `captureLead` calls within the same session**: §7.4 does not enumerate uniqueness/idempotency. A reasonable default is upsert-by-session-id: the most recent `captureLead` call updates the existing lead row for that session rather than creating duplicates. This is consistent with "as soon as the legal issue is clear" (§7.4) — the tool may be called multiple times as the picture sharpens.
- **Skip the heuristic write when nothing extractable was found**: §7.10 says the heuristic preserves "whatever information was shared." When the user has not shared any extractable contact info or any identifiable legal-matter description, persisting a row with all-null fields adds no value. A reasonable default is to skip persistence when the heuristic finds nothing actionable; this is consistent with the spec's purpose of preserving information rather than producing empty placeholders.
- **Notification atomicity with lead write**: §7.4 mechanism steps 3 and 4 describe lead write then notification create. The spec does not enumerate transactional behavior. A reasonable default is to write both in a single database transaction so a partial failure does not leave an `urgent` lead without its notification (or vice versa).
- **Heuristic keyword/signal lists**: §7.10 gives illustrative examples ("DUI, assault, cocaine, etc." and "today, arrested, detained, emergency, human representative"). The spec does not enumerate an exhaustive list. A reasonable default is to start with the §7.10 examples plus the §7.4 outcomes table criteria (statute of limitations, active danger, recent arrest, user requests human help) and refine as conversation-quality eval scripts run. The exact list is a tunable, not part of the binding requirement.
- **Heuristic regex patterns for email / phone / name**: §7.10 says regex-based extraction. The exact regexes are an implementation choice; common, reasonably-tight patterns for email and US-style phone, and conservative name-line heuristics, are acceptable.
- **Run-frequency of heuristic during streaming**: §7.10 says the heuristic runs "after each chat turn." The chat turn boundary is the point at which the LLM has finished streaming a response (or a tool call has completed). The heuristic runs once per turn boundary, not on every streamed token.
- **Notification `title` and `body` content**: §2.6 requires `title` and `body` to be non-null on `notifications`. The spec does not prescribe their exact content for `urgent_lead`. A short summary derived from the lead (e.g., title: "New urgent lead: [case_type] from [name or 'Anonymous']") is acceptable; this is the wording §8.7 references for dashboard display ("New urgent lead: [case type] from [name]").
- **Storage encoding for `urgency_factors_json`**: The schema column is `text`. JSON-serialized array (e.g., `["recent_incident","medical_treatment_ongoing"]`) is the obvious encoding, matching the §7.10 lead JSON example.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Lead Classification feature, even though they appear in adjacent spec sections.

- The Chat API endpoint, system-prompt composition, agent runtime, streaming, rate-limiting, prompt-injection sanitation, token logging — owned by feature `004-chat-api-agent` (§12.8).
- The classification *prompt* injected into the system prompt that guides the LLM's classification decision. The classification *behavior* is owned here (the schema, the persistence, the heuristic fallback); the *prompt text* is part of the system-prompt composition built in `004-chat-api-agent` (§7.8 row 1 base instructions, §7.4 mechanism step 2 references "system prompt criteria").
- Dashboard pages: Leads list, Lead detail, Lead chat-transcript renderer, mark-contacted/dismiss actions, internal notes, exports, deletion-with-archival flow — owned by Phase 6 / dashboard features (§8.5, §8.6, §1.10, §11.5).
- Notifications panel UI (bell icon, drawer, mark-read/mark-all-read) — owned by Phase 6 / dashboard features (§8.7). This feature only writes `notifications` rows.
- Notification delivery channels beyond `dashboard` (email, SMS, webhook) — explicitly post-MVP per §10 and §8.7 ("wiring these up is post-MVP").
- Consent timestamp persistence — §11.5 names this as a database write but assigns it broadly to "the database"; the consent-banner UI in the widget submits, the API persists. The Foundation defines the schema; the lead-classification feature does not own this surface.
- Token-usage logging per conversation — owned by `004-chat-api-agent` (§11.3).
- The `captureLead` tool *registration* in the agent's tools map — owned by `004-chat-api-agent` (§7.2 tools map). This feature provides the implementation; that feature wires it in.

## Dependencies

- **Internal — Upstream**: `001-foundation` for the `leads` and `notifications` schemas, the structured logger, and shared types. `004-chat-api-agent` for the agent runtime in which `captureLead` is registered, for the active session context (`session_id` and `account_id`), and for the per-turn handler that triggers the heuristic fallback.
- **Internal — Downstream**: Phase 6 dashboard reads `leads` and `notifications`. The Crawler CLI does not interact with this feature.
- **External**: Reachable Neon PostgreSQL database for writes.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific regex patterns for the heuristic extractor are mandated; §7.10 describes them only as "regex-based" with example keywords.
- No exhaustive list of legal-matter keywords or urgency signals is mandated; §7.10 enumerates examples but not a closed set.
- No specific prioritization mechanism for `urgent` leads in the database (e.g., a column, an index) is mandated. §7.4 outcomes row 1 says "Prioritize in DB" but the schema in §2.6 has no priority column. Prioritization is therefore expressed via the existing `classification` field; downstream queries can `ORDER BY` it. No new column is introduced here.
- No specific dedup-key for repeated `captureLead` calls is mandated; an upsert-by-session strategy is captured in Assumptions.
- No notification `title`/`body` template is mandated; §8.7 supplies an illustrative phrase.
- No specific `delivered_at` value for `dashboard`-channel notifications is mandated. Setting it at insert time vs. when the user opens the bell is not specified; either is consistent.
- No specific behavior for editing or deleting leads from the database is part of this feature; lead status mutations (mark-contacted, dismiss) and deletion-with-archival are in the dashboard layer.
- No specific cost or pricing tracking on a per-lead basis is mandated.
- No specific de-PII or redaction step before persistence is mandated; lead PII is the product, persisted to the `leads` table.
- The §11.5 consent-banner-then-collect rule lives in the chat widget; this feature does not gate writes on a consent flag because the spec does not enumerate that linkage.

If any of these are wanted, they belong in a separate feature, not in Lead Classification.
