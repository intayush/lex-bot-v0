# Feature Specification: Dashboard

**Feature Branch**: `007-dashboard`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Extract the functional requirements for Dashboard from 'product-spec-legal-chatbot.md'. Generate the isolated feature specification file. Do not invent new requirements; stick strictly to what is outlined in the document."

**Source of Truth**: All requirements in this document are extracted verbatim or paraphrased without addition from `product-spec-legal-chatbot.md` (v0.2, 2026-05-16). Primary sources: §4.1–§4.7 (the Lawyer Configuration Form rendered as a dashboard page), §8.1–§8.12 (the SaaS Dashboard component). Supporting sources: §1.10 (data ownership / deletion / archival), §11.5 (privacy-policy template, transcript export, deletion mechanism), §12.11 (Phase 6 deliverable + done-when), §2.6 (schema for `accounts`, `configurations`, `sessions`, `leads`, `archived_data`, `notifications`, `api_keys`). Each functional requirement cites its source section. No requirements have been invented.

## Overview

The Dashboard is the lawyer-facing web application — "the single control plane for everything that isn't the crawler CLI" (§8.1). It is where lawyers authenticate, configure their chatbot's persona and guardrails, view captured leads, monitor chatbot health, manage their API keys, install the widget, and preview configuration changes before publishing.

The Dashboard is composed of seven primary pages (§8.3): Overview, Chatbot Configuration (Guardrails Form), Leads, Widget Installation, Crawler Status, Preview & Test, and Notifications. Authentication is single-user-per-account email/password with secure HTTP-only cookies (§8.2). The Dashboard never invokes Next.js Server Actions; all mutations go through dedicated route handlers (§8.4 implementation note, §8.11 API layer row).

This is Phase 6 per §12.5. It depends on every prior phase: the Foundation database schema (`001-foundation`), captured leads from `006-lead-classification`, the runtime chat behavior of `004-chat-api-agent` (which the Preview page exercises with `is_preview` sessions), and the Crawler CLI's manifest output (`002-crawler-cli`) which the Crawler Status page surfaces.

## User Scenarios & Testing *(mandatory)*

The "users" of the Dashboard are:

1. **A lawyer** (or an authorized representative of the firm — single-user-per-account in MVP per §8.2) who logs in to configure their chatbot, review captured leads, manage API keys, and embed the widget on their site.
2. **A Lex Bot engineer** verifying the §12.11 done-when criteria during build.

### User Story 1 — Lawyer Logs In and Sees Their Captured Leads (Priority: P1)

The lawyer visits the dashboard URL, signs in with their email and password, and lands on the Leads page where every captured lead is listed with classification badges, name, case type, contact, and submission timestamp. They can filter, sort, search, and drill into any lead.

**Why this priority**: §1.5 names "respond fast enough" as the core problem; the lawyer must be able to see and act on captured leads to do that. §12.11 done-when explicitly includes "Login works with test credentials" and "Leads page shows all leads from Phase 5 testing." Without this flow, the value of the entire system is invisible to the lawyer.

**Independent Test**: Per §12.11 deliverable, open `http://localhost:3000/dashboard`, log in with the seeded credentials, and verify the Leads page displays the rows captured by Phase 5.

**Acceptance Scenarios**:

1. **Given** a registered account, **When** the lawyer enters valid email and password, **Then** they are signed in via session-based auth using secure HTTP-only cookies (§8.2).
2. **Given** the lawyer is signed in, **When** they open the Leads page, **Then** they see a table with columns: Status (with badge: `urgent` red / `normal` blue / `unqualified` gray), Name (or "Anonymous" if missing), Case Type, Contact (email or phone), Submitted (relative timestamp), and Actions (View details, Mark as contacted, Dismiss) (§8.5 columns).
3. **Given** the Leads page is displayed, **When** the lawyer applies a filter (classification, case type, or date range), sorts by any column, or searches across lead data, **Then** the table updates accordingly (§8.5 features).
4. **Given** the Leads page contains many leads, **When** scrolling reaches the end of a page, **Then** pagination shows 25 leads per page (§8.5 features).

---

### User Story 2 — Lawyer Reviews Lead Details and Marks Follow-Up Actions (Priority: P1)

The lawyer clicks a lead in the Leads table and sees a detail page with the lead's structured data, classification rationale, full chat transcript, and action buttons. They mark the lead as contacted, add an internal note, dismiss it, or export it.

**Why this priority**: §12.11 done-when includes "Lead detail shows the full chat transcript." §8.6 enumerates the lead-detail features. Without this drill-down, the captured rationale and transcript are invisible to the user.

**Independent Test**: Click any lead from the Leads page; verify the detail page shows all extracted structured data, the classification with rationale, the full chat transcript with highlighted qualifying-question moments and the classification-trigger marker, and the four actions.

**Acceptance Scenarios**:

1. **Given** a lead exists, **When** the lawyer clicks it, **Then** the detail page renders the Lead Information Panel showing all extracted structured data (name, contact, case type, timeline, etc.), the classification result with rationale, and the timestamp of the first and last message (§8.6 Lead Information Panel).
2. **Given** the lead-detail page is open, **When** the chat-transcript section renders, **Then** it displays the full conversation history rendered as a chat view, highlights where qualifying questions were answered, and marks the point where classification was triggered (§8.6 Chat Transcript).
3. **Given** the lead-detail page is open, **When** the lawyer takes any of the actions, **Then** the system supports: Mark as contacted, Add internal note, Dismiss (removes from active view, retains in DB), Export as PDF/JSON (§8.6 Actions).

---

### User Story 3 — Lawyer Edits Guardrails and Previews Before Publishing (Priority: P1)

The lawyer opens the Chatbot Configuration page and edits any of the seven form sections (Persona, Practice Areas, Qualifying Questions, Boundaries, Escalation, Contact, Custom Instructions). They click Save to create a new version, then preview the new config in the embedded sandboxed chat alongside the form. Once satisfied, they click Publish to make the configuration live.

**Why this priority**: §12.11 done-when includes "Guardrails form saves and creates a new version", "Preview chat uses the updated (unpublished) configuration", and "Publish button makes config live (next real conversation uses it)". §4.6 explicitly calls preview-then-publish the standard workflow. Without this, the lawyer either edits in production blind, or never edits at all.

**Independent Test**: Edit a value in any of the 7 sections, click Save, observe a new version row in `configurations`. Click into Preview and confirm the unpublished config is in effect. Click Publish and verify the next real conversation uses the new config.

**Acceptance Scenarios**:

1. **Given** the lawyer is on the Chatbot Configuration page, **When** the page renders, **Then** all seven form sections are present (Persona, Practice Areas, Qualifying Questions, Boundaries, Escalation, Contact, Custom Instructions) (§8.4, §4.3 sections A–G).
2. **Given** the lawyer changes a value and clicks Save, **When** the request completes, **Then** a new version row is created in the `configurations` table via `POST /api/dashboard/config` with `{ action: 'save', config: {...} }` (§8.4, §4.5).
3. **Given** an unpublished version exists, **When** the lawyer opens the Preview pane alongside the form, **Then** the embedded chat uses the unpublished configuration; conversations are tagged as `preview` and do not appear in the Leads page (§4.6, §8.10).
4. **Given** the lawyer clicks Publish, **When** the request completes, **Then** the latest version becomes the published configuration via `POST /api/dashboard/config` with `{ action: 'publish' }`, and the next real (non-preview) conversation uses it (§8.4, §4.7).
5. **Given** changes have been published, **When** an existing in-flight conversation continues, **Then** that active session is not interrupted; only the next conversation reflects the change (§4.2).
6. **Given** the lawyer wants to revert, **When** they open the version history view, **Then** they see all prior configurations with timestamps and a diff view, and can roll back to any previous version with one click (§4.5).

---

### User Story 4 — Lawyer Embeds the Widget on Their Site (Priority: P1)

The lawyer opens the Widget Installation page, copies the snippet pre-filled with their API key (with format selectable across Script Tag, React Component, and Next.js), and pastes it into their site. They click "Verify Installation" and see a green checkmark when the widget is responding from their configured domain.

**Why this priority**: §1.7 success metric: "a lawyer can install the widget … within 30 minutes." §8.8 enumerates the three-step install flow. Without this page, the lawyer cannot get the widget onto their site, and the system cannot capture leads.

**Independent Test**: Open the Widget Installation page, generate a key, copy the snippet, paste it into a test page, click Verify Installation, and confirm the green checkmark.

**Acceptance Scenarios**:

1. **Given** the Widget Installation page is open, **When** the API Key Management section renders, **Then** the lawyer can: view the current API key (masked, with a copy button), generate a new key, revoke the existing key with a confirmation warning, or rotate the key (generate new while the old remains valid for 24 hours) (§8.8 Step 1).
2. **Given** an API key exists, **When** the Installation Snippet section renders, **Then** the lawyer sees a pre-formatted code snippet with their API key pre-filled and tabs for Script Tag (HTML), React Component, and Next.js, with a copy-to-clipboard button (§8.8 Step 2).
3. **Given** the snippet has been embedded, **When** the lawyer clicks "Verify Installation", **Then** the system checks whether the widget is responding on their configured domain and displays a green checkmark on success or troubleshooting tips on failure (§8.8 Step 3).

---

### User Story 5 — Lawyer Sees Urgent-Lead Notifications (Priority: P2)

A new urgent lead arrives. A bell icon in the dashboard header shows an unread count badge. The lawyer clicks the bell, the notifications drawer slides out, and they see a notification "New urgent lead: [case type] from [name]" linking directly to the lead-detail page.

**Why this priority**: §8.7 mandates this surface for MVP ("MVP: only urgent lead notifications"). Without it, urgent leads are not surfaced as alerts and the responsiveness benefit is partly lost.

**Independent Test**: Drive a conversation that produces an urgent lead, then verify the bell shows an unread count, the drawer lists the notification, and clicking it navigates to the lead-detail view.

**Acceptance Scenarios**:

1. **Given** an urgent lead has been captured, **When** the dashboard header renders, **Then** a bell icon shows an unread count badge reflecting unread notifications (§8.7).
2. **Given** the lawyer clicks the bell, **When** the notifications drawer opens, **Then** it shows recent alerts (MVP: urgent lead notifications only, with the format "New urgent lead: [case type] from [name]") (§8.7).
3. **Given** a notification is shown, **When** the lawyer clicks it, **Then** they navigate to the corresponding lead-detail view (§8.7).
4. **Given** notifications exist, **When** the lawyer marks one or all as read, **Then** the unread state updates accordingly (§8.7).

---

### User Story 6 — Lawyer Confirms Their Crawler Output Is Reachable (Priority: P2)

The lawyer opens the Crawler Status page to confirm the API server can reach their context store, see how many pages are indexed, and find the CLI command to re-crawl. They can browse the manifest and run a sample retrieval test.

**Why this priority**: §8.9 mandates this page. The lawyer needs visibility into whether their published context is actually reachable (a misconfigured URL renders the chatbot context-less) and into when they last refreshed it. §12.11 done-when includes the Crawler Status page implicitly via "Manual browser verification of all pages."

**Independent Test**: Open the Crawler Status page; verify the four fields (Last crawl, Pages crawled, Context store URL, Health check) and the three actions (Re-crawl, View manifest, Test context retrieval).

**Acceptance Scenarios**:

1. **Given** the Crawler Status page is open, **When** it renders, **Then** the four fields are shown: Last crawl (timestamp of most recent successful crawl), Pages crawled (total count from manifest), Context store URL (base URL where files are hosted), Health check (green/red indicator — can the API reach the context store?) (§8.9 fields).
2. **Given** the lawyer clicks "Re-crawl", **When** the action handler runs, **Then** the page displays the CLI command to run on their machine (the dashboard does not execute the crawl since it runs on their machine) (§8.9 Actions).
3. **Given** the lawyer clicks "View manifest", **When** the manifest viewer opens, **Then** it shows the file list from `_manifest.json` (§8.9 Actions).
4. **Given** the lawyer clicks "Test context retrieval", **When** the action runs, **Then** a sample query is executed against their context store and the result is shown (§8.9 Actions).

---

### User Story 7 — Lawyer Resets Their Password (Priority: P2)

The lawyer forgets their password. They request a reset via email, receive the reset link, set a new password, and sign in.

**Why this priority**: §8.2 explicitly mandates "Password reset via email". Without it, account recovery is impossible and account loss is permanent.

**Independent Test**: Trigger a password-reset request for a known account; verify a reset email is dispatched and the reset link sets a new password.

**Acceptance Scenarios**:

1. **Given** an account exists, **When** the lawyer requests a password reset by email, **Then** the system sends a reset email enabling password reset (§8.2).

---

### Edge Cases

- **Lawyer signs in from an untrusted client**: §8.2 mandates secure HTTP-only cookies. The session cookie MUST NOT be readable by client JavaScript.
- **Concurrent edits to the same configuration**: §4.5 says each save creates a new version. Concurrent edits should each yield a separate version row; the most recent save is the next-publish candidate. The spec does not enumerate optimistic-locking behavior.
- **Publishing without saving first**: §8.4 lists Save and Publish as separate actions. Publish must always operate against an existing saved version; clicking Publish without first saving any change publishes the most recent saved version.
- **Lead is dismissed**: §8.6 says Dismiss "removes from active view, retains in DB." The Leads page filter must therefore have a default that excludes dismissed leads while a "include dismissed" view shows them again.
- **Preview session leakage into Leads**: §8.10 mandates preview conversations are tagged `preview` and "do not appear in the Leads page." This is enforced via `sessions.is_preview` (§2.6) and a Leads-page filter.
- **Lawyer revokes their only API key**: §8.8 Step 1 lists revoke "with confirmation warning." The widget on the lawyer's site will start receiving 401 responses (per §2.4 step 6) — the warning should make this consequence explicit.
- **Key rotation 24-hour overlap**: §8.8 Step 1 says rotation generates a new key and "old remains valid for 24 hours." Both keys must authenticate during this window.
- **Lawyer-initiated lead deletion**: §1.10 ("Lawyer retains ownership … can export or delete their visible data at any time via the dashboard") and §11.5 ("Provide a data deletion mechanism in the dashboard — deletes the lawyer-facing copy while archiving a retained copy"). The dashboard must offer this and write to `archived_data` (§2.6 schema). The deletion is part of the dashboard surface but the archival logic exists at the data layer.
- **Health check shows red**: §8.9 displays a red indicator if the API cannot reach the context store. This does not break the dashboard itself; it surfaces the issue and the user must run the crawler / fix the URL.

## Requirements *(mandatory)*

Each requirement cites the spec section it derives from. No requirement appears here that is not present in `product-spec-legal-chatbot.md`.

### Functional Requirements

#### FR Group A — Authentication (§8.2, §12.11)

- **FR-001**: The Dashboard MUST support email/password authentication for MVP. Source: §8.2.
- **FR-002**: Each account MUST be limited to a single user; team roles or multi-user access MUST NOT be supported in MVP. Source: §8.2.
- **FR-003**: Authenticated sessions MUST be implemented via session-based auth using secure HTTP-only cookies. Source: §8.2.
- **FR-004**: The Dashboard MUST provide a password-reset flow via email. Source: §8.2.
- **FR-005**: Login MUST work with valid account credentials and reject invalid ones. Source: §12.11 done-when ("Login works with test credentials").

#### FR Group B — Navigation & Page Surface (§8.3, §12.11)

- **FR-006**: The Dashboard MUST expose the following pages in its navigation: Overview (home), Chatbot Configuration (Guardrails Form), Leads, Widget Installation, Crawler Status, Preview & Test, Notifications. Source: §8.3.
- **FR-007**: Every page in §8.3 MUST be reachable from the dashboard's navigation surface and render correctly under manual browser verification. Source: §12.11 done-when ("Manual browser verification of all pages").

#### FR Group C — Guardrails Form Page (§4.3, §4.4, §8.4, §12.11)

- **FR-008**: The Chatbot Configuration page MUST render the full configuration form with all seven sections from §4.3: Persona (Section A), Practice Areas (Section B), Qualifying Questions (Section C), Boundaries (Section D), Escalation (Section E), Contact (Section F), Custom Instructions (Section G). Source: §8.4, §4.3.
- **FR-009**: Section A (Chatbot Persona) MUST capture: Firm name (Text), Chatbot name (Text), Greeting message (Textarea), Tone (Select: `formal` / `friendly` / `neutral`), Language (Select; default English). Source: §4.3 Section A.
- **FR-010**: Section B (Practice Area Scope) MUST capture: Active practice areas (multi-select checklist e.g., Personal Injury, Family Law, Criminal Defense, Estate Planning), Custom practice areas (repeatable text), Out-of-scope response (Textarea; default: "I'm not able to help with that area, but I can connect you with our team."). Source: §4.3 Section B.
- **FR-011**: Section C (Qualifying Questions) MUST capture: Intake questions (ordered repeatable list), Question order (drag-and-drop), Required vs. optional (toggle per question). Default qualifying questions MUST be pre-populated and editable: (1) "What type of legal matter do you need help with?", (2) "When did this issue first arise?", (3) "Have you spoken with another attorney about this matter?", (4) "What is your preferred method of contact?", (5) "What is your availability for a consultation?". Source: §4.3 Section C.
- **FR-012**: Section D (Response Boundaries) MUST capture "Never say" rules as repeatable text, pre-populated and editable with the defaults: "Never provide specific legal advice or legal opinions", "Never promise case outcomes or success rates", "Never discuss fee structures unless explicitly listed on the website", "Never disclose information about other clients", "Never recommend against seeking legal representation". Source: §4.3 Section D.
- **FR-013**: Section E (Escalation Triggers) MUST capture: Escalation conditions (repeatable text) and Escalation message (textarea), pre-populated and editable with the defaults: "User mentions active danger to themselves or others", "User describes an emergency requiring immediate legal action", "User expresses frustration with the chatbot and asks for a human", "User's matter falls outside all configured practice areas". Source: §4.3 Section E.
- **FR-014**: Section F (Contact Information) MUST capture: Phone number (Text), Email (Text), Office hours (structured day/time pairs), After-hours message (Textarea). Source: §4.3 Section F.
- **FR-015**: Section G (Custom Instructions) MUST capture a freeform large textarea for any behavioral instructions not covered above. Source: §4.3 Section G.
- **FR-016**: The Save button MUST submit `POST /api/dashboard/config` with body `{ action: 'save', config: {...} }` and create a new configuration version. Source: §8.4.
- **FR-017**: The Publish button MUST submit `POST /api/dashboard/config` with body `{ action: 'publish' }` and make the latest version live. Source: §8.4.
- **FR-018**: The Dashboard's mutation endpoints MUST be implemented as standard route handlers (not Next.js Server Actions) to avoid action-ID mismatch issues on serverless platforms like Netlify. Source: §8.4 implementation note, §8.11 row "API layer".
- **FR-019**: Saved configurations MUST be persisted as structured JSON conforming to §4.4's shape: `{ version, saved_at, persona, practice_areas, qualifying_questions, boundaries, escalation, contact, custom_instructions }`. Source: §4.4.
- **FR-020**: A preview chat panel MUST be shown alongside the form for testing changes before publishing. Source: §8.4 ("Preview chat panel alongside the form for testing changes before publishing"), §4.6.

#### FR Group D — Configuration Versioning & Rollback (§4.5)

- **FR-021**: Each Save MUST create a new configuration version with an auto-incrementing integer `version`. Source: §4.5.
- **FR-022**: All previous configuration versions MUST be retained in the database. Source: §4.5.
- **FR-023**: A version-history view MUST show all prior versions with timestamps and a diff view between them. Source: §4.5.
- **FR-024**: A one-click rollback action MUST allow reverting to any previous version. Source: §4.5.
- **FR-025**: Configuration changes MUST take effect on the next conversation; existing active sessions MUST NOT be interrupted. Source: §4.2.

#### FR Group E — Configuration Deployment (§4.7, §12.11)

- **FR-026**: The published configuration MUST be readable by the API server directly from the database at conversation start; no file transfer to the lawyer's server is required for guardrails to take effect. Source: §4.7 primary path.
- **FR-027**: Publishing a configuration MUST make the next real conversation use the new configuration. Source: §12.11 done-when ("Publish button makes config live (next real conversation uses it)").
- **FR-028**: The Dashboard MUST inform the lawyer that the secondary path — syncing the published configuration to the lawyer's context store as `_guardrails.md` and `config/` files — is performed via a CLI command (`npx legal-chatbot-sync --api-key … --output …`). Source: §4.7 secondary path. The Dashboard does not execute this CLI; it documents/exposes the command.

#### FR Group F — Leads Page (§8.5, §12.11)

- **FR-029**: The Leads page MUST render all captured leads in a table with the columns specified in §8.5: Status (badge `urgent` red / `normal` blue / `unqualified` gray), Name (or "Anonymous" when missing), Case Type, Contact (email or phone), Submitted (relative timestamp), Actions (View details, Mark as contacted, Dismiss). Source: §8.5.
- **FR-030**: The Leads page MUST support sorting by any column. Source: §8.5 features.
- **FR-031**: The Leads page MUST support filtering by classification, case type, and date range. Source: §8.5 features.
- **FR-032**: The Leads page MUST support search across all lead data. Source: §8.5 features.
- **FR-033**: The Leads page MUST support bulk actions: mark as contacted and export. Source: §8.5 features.
- **FR-034**: The Leads page MUST paginate results at 25 leads per page. Source: §8.5 features.
- **FR-035**: The Leads page MUST display all leads captured by Phase 5 (`006-lead-classification`). Source: §12.11 done-when.

#### FR Group G — Lead Detail View (§8.6, §12.11)

- **FR-036**: Clicking a lead MUST open the lead-detail page. Source: §8.6.
- **FR-037**: The lead-detail page's Lead Information Panel MUST display: all extracted structured data (name, contact, case type, timeline, etc.), the classification result with rationale, and the timestamp of the first and last message. Source: §8.6.
- **FR-038**: The lead-detail page's Chat Transcript MUST render the full conversation history as a chat view, highlight where qualifying questions were answered, and mark the point where classification was triggered. Source: §8.6, §12.11 done-when.
- **FR-039**: The lead-detail page MUST offer the actions: Mark as contacted, Add internal note, Dismiss (removes from active view, retains in DB), Export as PDF/JSON. Source: §8.6.

#### FR Group H — Notifications Panel (§8.7)

- **FR-040**: The dashboard header MUST display a bell icon with an unread count badge reflecting the unread notification count. Source: §8.7.
- **FR-041**: Clicking the bell MUST open a notification drawer that slides out and shows recent alerts. Source: §8.7.
- **FR-042**: For MVP, only urgent-lead notifications MUST be shown, formatted as: "New urgent lead: [case type] from [name]". Source: §8.7.
- **FR-043**: Each notification MUST link to the corresponding lead-detail view. Source: §8.7.
- **FR-044**: The user MUST be able to mark a notification as read and to mark all notifications as read. Source: §8.7.
- **FR-045**: The notification record schema MUST conform to the §8.7 architecture interface: `id`, `type` (`'urgent_lead' | 'escalation' | 'system'`), `title`, `body`, optional `lead_id`, `read`, `created_at`. Persistence is owned by `006-lead-classification` (write side); the Dashboard reads. Source: §8.7 architecture.

#### FR Group I — Widget Installation Page (§8.8)

- **FR-046**: The Widget Installation page MUST provide an API Key Management section that allows the lawyer to: view the current API key (masked, with copy button), generate a new key, revoke an existing key (with confirmation warning), and rotate the key (generating a new one while the old remains valid for 24 hours). Source: §8.8 Step 1.
- **FR-047**: The Widget Installation page MUST provide a pre-formatted installation snippet with the lawyer's API key pre-filled, with format tabs for Script Tag (HTML), React Component, and Next.js, and a copy-to-clipboard button. Source: §8.8 Step 2.
- **FR-048**: The Widget Installation page MUST provide a "Verify Installation" action that checks whether the widget is responding on the configured domain, with a green-checkmark success state and troubleshooting tips on failure. Source: §8.8 Step 3.

#### FR Group J — Crawler Status Page (§8.9)

- **FR-049**: The Crawler Status page MUST display the four status fields: Last crawl (timestamp of most recent successful crawl), Pages crawled (total count from manifest), Context store URL (base URL where files are hosted), Health check (green/red indicator: can the API reach the context store?). Source: §8.9 fields.
- **FR-050**: The Crawler Status page MUST offer a "Re-crawl" action that displays the CLI command for the lawyer to run on their machine; the dashboard MUST NOT execute the crawl itself. Source: §8.9 Actions.
- **FR-051**: The Crawler Status page MUST offer a "View manifest" action that shows the file list from `_manifest.json`. Source: §8.9 Actions.
- **FR-052**: The Crawler Status page MUST offer a "Test context retrieval" action that runs a sample query against the lawyer's context store. Source: §8.9 Actions.

#### FR Group K — Preview & Test Chat (§4.6, §8.10, §12.11)

- **FR-053**: The Preview & Test page MUST render the full chat widget inside the dashboard. Source: §8.10.
- **FR-054**: The Preview chat MUST use the current (unpublished) configuration so the lawyer can verify changes before publishing. Source: §8.10, §4.6, §12.11 done-when ("Preview chat uses the updated (unpublished) configuration").
- **FR-055**: Preview-mode conversations MUST be tagged as `preview` (i.e., `sessions.is_preview = true` per §2.6) and MUST NOT appear in the Leads page. Source: §8.10, §2.6 schema.
- **FR-056**: The Preview chat MUST provide a Reset button that clears the preview conversation and starts fresh. Source: §8.10.
- **FR-057**: Alongside the Preview chat, a debug panel MUST be shown displaying: which tools were called, which files were retrieved, and token usage per turn. Source: §8.10.

#### FR Group L — Data Ownership, Deletion, and Privacy (§1.10, §11.5)

- **FR-058**: The Dashboard MUST allow the lawyer to export their visible data at any time. Source: §1.10 ("They can export or delete their visible data at any time via the dashboard").
- **FR-059**: The Dashboard MUST allow the lawyer to delete their visible data at any time; deletion MUST remove the lawyer-facing copy while archiving a retained copy per §1.10 / §11.5. Source: §1.10, §11.5 ("Provide a data deletion mechanism in the dashboard — deletes the lawyer-facing copy while archiving a retained copy").
- **FR-060**: The Dashboard MUST surface a privacy policy template that lawyers can customize and link from the widget. Source: §11.5.
- **FR-061**: The Dashboard MUST be able to export chat transcripts on request. Source: §11.5 ("Ensure chat transcripts can be exported on request"). The lead-detail page's "Export as PDF/JSON" (§8.6) is one realization; transcript export from the Leads list (bulk export per §8.5) is another.

#### FR Group M — Tech-Stack Constraints (§8.11)

- **FR-062**: The Dashboard MUST be built on Next.js (React) with Tailwind CSS for styling. Source: §8.11.
- **FR-063**: State management MUST be via React Client Components with `fetch` calls to API routes. Source: §8.11.
- **FR-064**: All Dashboard mutations MUST go through Next.js Route Handlers; Server Actions MUST NOT be used. Source: §8.11 + §8.4 implementation note.
- **FR-065**: Database access MUST be via Drizzle ORM against Neon PostgreSQL. Source: §8.11, §2.6, §9.5.
- **FR-066**: Authentication MUST be implemented as custom email/password using bcryptjs for password hashing and iron-session for the encrypted session cookie. Source: §8.11.
- **FR-067**: The Dashboard MUST be deployable to Netlify via `@netlify/plugin-nextjs`. Source: §8.11.

### Key Entities

The Dashboard reads and (for some) writes the following persistent entities, all defined in §2.6 schema. It introduces no new entities.

- **Account (read/write)**: A lawyer's account row keyed by email, holding `password_hash` and `firm_name`. Created at signup; updated on profile changes; read on every authenticated request. Source: §2.6 `accounts`, §8.2.
- **API Key (read/write)**: Per-account keys with bcryptjs hash, optional `label`, `context_store_url`, `created_at`, `revoked_at`. Generated, viewed, revoked, and rotated from the Widget Installation page. Source: §2.6 `api_keys`, §8.8.
- **Configuration (read/write)**: Per-account versioned guardrails configurations carrying `version`, `config_json`, `is_published`, `created_at`. Written by Save (`is_published=false`) and Publish (`is_published=true`). Source: §2.6 `configurations`, §4.4, §4.5, §4.7, §8.4.
- **Session (read/write)**: Chat session rows. The Dashboard reads them for lead-detail transcript rendering and writes the `is_preview` flag for preview chats. Source: §2.6 `sessions`, §8.6, §8.10.
- **Lead (read/write)**: Captured leads. The Dashboard reads them for the Leads page and lead-detail; updates the `status` field via Mark as contacted / Dismiss; deletes them via the §1.10 / §11.5 deletion mechanism (with archival). Source: §2.6 `leads`, §8.5, §8.6, §1.10, §11.5.
- **Archived Data (write on deletion)**: Retained snapshots of deleted leads/sessions. Written by the deletion mechanism in the Dashboard. Source: §2.6 `archived_data`, §1.10, §11.5.
- **Notification (read/write)**: Notification rows. The Dashboard reads them for the bell/drawer; updates `read` to true via Mark as read / Mark all as read. Writes for `urgent_lead` are owned by `006-lead-classification`. Source: §2.6 `notifications`, §8.7.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A lawyer can open `http://localhost:3000/dashboard`, log in with valid credentials, and reach the Leads page. Source: §12.11 deliverable, done-when ("Login works with test credentials").
- **SC-002**: All leads captured in `006-lead-classification` are visible on the Leads page. Source: §12.11 done-when ("Leads page shows all leads from Phase 5 testing").
- **SC-003**: Clicking a lead opens a detail page that displays the full chat transcript. Source: §12.11 done-when ("Lead detail shows the full chat transcript").
- **SC-004**: Saving a change to the guardrails form creates a new row in the `configurations` table whose `version` is one greater than the previously most-recent. Source: §12.11 done-when ("Guardrails form saves and creates a new version"), §4.5.
- **SC-005**: The Preview & Test chat reflects the unpublished (latest saved) configuration. Source: §12.11 done-when ("Preview chat uses the updated (unpublished) configuration"), §8.10.
- **SC-006**: After clicking Publish, the next real (non-preview) conversation uses the newly published configuration. Source: §12.11 done-when ("Publish button makes config live (next real conversation uses it)").
- **SC-007**: All seven dashboard pages (Overview, Chatbot Configuration, Leads, Widget Installation, Crawler Status, Preview & Test, Notifications) render without errors under manual browser verification. Source: §12.11 done-when ("Manual browser verification of all pages"), §8.3.
- **SC-008**: The Leads table displays the six columns specified by §8.5 with the correct badge colors (`urgent` red, `normal` blue, `unqualified` gray) for 100% of rows.
- **SC-009**: The bell icon in the dashboard header displays an unread count equal to the count of unread `notifications` rows for the signed-in account. Source: §8.7.
- **SC-010**: The Crawler Status page Health check shows green when the configured `context_store_url` is reachable and red when it is not. Source: §8.9.
- **SC-011**: The Widget Installation page produces a snippet whose API key matches the active key for the signed-in account, in 100% of renders. Source: §8.8.
- **SC-012**: After rotating a key, both the old key and the new key successfully authenticate against the chat API for at least 24 hours; after 24 hours only the new key authenticates. Source: §8.8 Step 1.
- **SC-013**: A user-initiated lead deletion removes the row from the Leads page view and writes a corresponding row to `archived_data`. Source: §1.10, §11.5, §2.6 `archived_data`.
- **SC-014**: A version-history view shows every prior `configurations` row for the account with timestamps and a diff between adjacent versions. Source: §4.5.
- **SC-015**: A one-click rollback action sets the previously saved version's contents into a new `configurations` row (preserving history) and offers Publish on it. Source: §4.5.
- **SC-016**: Preview conversations never appear in the Leads page (i.e., no `leads` row references a `sessions` row whose `is_preview = true`). Source: §8.10, §2.6.

## Assumptions

These are reasonable defaults adopted where the spec does not explicitly prescribe a detail. Each is consistent with — and never contradicts — the spec.

- **Account creation flow**: §8.2 mandates email/password auth and password reset by email but does not enumerate signup. A standard signup flow (email + password + optional firm name) creating an `accounts` row is assumed. Self-service vs. admin-provisioning is not specified; either is consistent.
- **Optimistic locking on configuration edits**: §4.5 says each save creates a new version. The spec does not enumerate concurrent-edit conflict handling. A "last save wins, both versions retained" approach is consistent because every save creates a new row.
- **Bulk export format**: §8.5 lists "Bulk actions (mark as contacted, export)" without specifying the format. CSV or JSON for bulk; PDF/JSON per-lead from the detail page (§8.6). The exact format for bulk export is an implementation detail.
- **Internal note storage**: §8.6 lists "Add internal note" as a lead-detail action but the §2.6 schema for `leads` does not have a notes column. A reasonable default is to store notes in a text column added via migration, or a related table. The spec is silent on storage shape; this is a small schema extension that implementations may choose.
- **Diff-view representation**: §4.5 says "diff view." The exact rendering (line-diff, side-by-side, structured field-level) is an implementation detail.
- **Health check probe**: §8.9 says "can the API reach the context store?" The probe HTTP status, frequency, and caching are implementation details.
- **Verify-installation probe**: §8.8 Step 3 says "checks if the widget is responding on their configured domain." The probe shape is not specified; a reasonable default is to attempt a chat init against the configured key and inspect the response, or to fetch a known asset from the widget's bundle.
- **Quick-reply config endpoint (`/api/config`)**: §6.5 references a `/api/config` endpoint that supplies practice areas to the widget. The Dashboard's published configuration is the source. The endpoint itself is a thin read-only API in front of the published `configurations` row. Where it lives in the dashboard package vs. a shared API package is implementation detail.
- **Reset-link expiry**: §8.2 mandates email-based password reset but does not state token expiry. A short-lived token (e.g., 1 hour) is the safe default.
- **Notifications drawer max items**: §8.7 says "recent alerts" without enumerating a count. A reasonable cap (e.g., latest 50) plus pagination or "show all" link is acceptable.

## Out of Scope (for this feature)

The following items are explicitly **not** part of the Dashboard feature, even though they appear in adjacent spec sections.

- All MVP-deferred items from §8.12: analytics and charts (conversation volume, conversion rates), team management and role-based access, billing and subscription management, white-labeling / custom domains for the dashboard, webhook integrations for lead notifications, bulk import/export of configurations, A/B testing of chatbot configurations.
- All MVP-deferred items from §10: multi-tenant / team management, billing, CRM integrations, advanced analytics, notification channels beyond `dashboard`, multi-language auto-detection, custom widget builder, conversation handoff (live agent takeover), user-configurable LLM provider.
- Lead capture, classification, partial-lead heuristic — owned by `006-lead-classification`.
- The `searchContext` and `captureLead` tool implementations — owned by `003-context-search` and `006-lead-classification`.
- The Chat API endpoint (`POST /api/chat`), agent runtime, system-prompt composition, rate limiting, prompt-injection sanitation — owned by `004-chat-api-agent`.
- The Crawler CLI itself (`npx legal-chatbot-crawl`) — owned by `002-crawler-cli`. The Crawler Status page only surfaces its outputs (manifest data) and tells the lawyer how to run it.
- The `legal-chatbot-sync` CLI — separate from the Crawler. The Dashboard documents how to invoke it; it does not execute it (§4.7).
- The Chat Widget itself (the embedded JS library) — owned by `005-chat-widget`. The Widget Installation page tells the lawyer how to install it; the Preview chat reuses the same widget code.
- Cost-monitoring dashboard, daily-budget cap, FAQ semantic cache — Phase 7 hardening per the roadmap (§11.3, §11.6).
- Conversation-quality eval scripts — owned by deployment / release process (§9.8).
- Consent banner UI — lives in the chat widget (§11.5 + §6.x); the Dashboard surfaces the privacy policy template that the widget links to.

## Dependencies

- **External**: Reachable Neon PostgreSQL database (`DATABASE_URL`). Email provider for password-reset emails (the spec does not mandate one).
- **Internal — Upstream**: `001-foundation` for the schema, env loader, structured logging, and shared types. `002-crawler-cli` for the manifest format the Crawler Status page surfaces. `003-context-search` for the "Test context retrieval" action behind §8.9. `004-chat-api-agent` for the runtime that consumes published configurations and supplies token-usage / tool-call data displayed in the Preview debug panel. `005-chat-widget` (the widget code reused inside the dashboard for Preview & Test). `006-lead-classification` as the writer of the `leads` and `notifications` rows the Dashboard reads.
- **Internal — Downstream**: None. The Dashboard is the user-facing terminus of the feature stack.

## Notes on Non-Invention

This specification deliberately omits any requirement not present in `product-spec-legal-chatbot.md`. In particular:

- No specific signup-page copy, branding, or marketing surface is mandated.
- No specific email-provider choice (SendGrid, AWS SES, etc.) is mandated; §8.2 only says "Password reset via email."
- No specific PDF generation library or JSON export shape for §8.6's per-lead export is mandated.
- No CSV export shape for §8.5 bulk export is mandated.
- No multi-factor authentication is mandated; §8.2 names only email/password.
- No SSO is mandated; §8.2 says SSO and team invitations are post-MVP.
- No specific user-settings page is mandated (e.g., change password from inside dashboard) beyond the explicit reset-by-email flow.
- No audit log for configuration changes beyond the version history is mandated.
- No specific Tailwind theme tokens or design system is mandated; §8.11 names Tailwind only.
- No specific keyboard-shortcut surface is mandated for the Dashboard.
- No specific date/time formatting or localization is mandated; relative timestamps ("Submitted") are required by §8.5 but the rest are implementation detail.
- No specific server-side or client-side caching strategy for the Leads page is mandated.

If any of these are wanted, they belong in a separate feature, not in Dashboard.
