# Feature Specification: Platform Admin Console

**Feature Branch**: `027-platform-admin-console`

**Created**: 2026-07-05

**Status**: Draft

**Input**: User description: "Build a LexBot Platform Admin Console — an internal, super-admin-only web console for the SaaS operator team to register, onboard, configure, oversee, and manage the lifecycle of every law-firm tenant."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Super-admin sign-in and fleet overview (Priority: P1)

A platform operator signs in with dedicated super-admin credentials (distinct
from any law firm's login) and lands on a fleet overview listing every law-firm
tenant with health-at-a-glance: firm name, status (active/suspended),
onboarding status (draft/published/live), leads captured in the last 30 days,
estimated LLM spend, and last activity. The operator can drill into any tenant.

**Why this priority**: This is the foundational surface. Without a separate
super-admin identity and a cross-tenant list, none of the other capabilities
have a home. It is independently valuable: even alone it gives the operator the
first-ever bird's-eye view of the platform.

**Independent Test**: Seed two or more tenants with lead/session data, sign in
as a super-admin, and confirm the overview lists every tenant with correct
counts; confirm a law-firm login is denied access to the console.

**Acceptance Scenarios**:

1. **Given** a valid super-admin account, **When** the operator signs in, **Then** they see a fleet overview listing all tenants with status, onboarding status, 30-day lead count, estimated spend, and last activity.
2. **Given** a signed-in super-admin, **When** they select a tenant row, **Then** they are taken to that tenant's detail view.
3. **Given** a law-firm (non-super-admin) session, **When** it requests any console page or admin action, **Then** access is denied.
4. **Given** no active session, **When** an anonymous visitor requests a console page, **Then** they are redirected to super-admin sign-in.

---

### User Story 2 - Register and onboard a new tenant via guided wizard (Priority: P1)

A super-admin registers a brand-new law firm and completes a guided multi-step
wizard on the firm's behalf: firm identity → practice areas / case types →
persona & tone → contact information & office hours → escalation rules.
Registration creates the tenant and issues a widget API key shown exactly once.
Completing the wizard produces a DRAFT chatbot configuration and SOP workflow
(seeded from platform defaults as a starting point), which the super-admin then
publishes so the tenant goes live.

**Why this priority**: This is the core reason the console exists — turning
today's script-only, hardcoded-defaults account creation into an operator-driven
onboarding journey that yields a firm-specific, ready-to-serve chatbot.

**Independent Test**: As a super-admin, register a new firm, walk the wizard end
to end, publish, and confirm the tenant appears "live" with a working chatbot
configuration and SOP derived from the entered answers.

**Acceptance Scenarios**:

1. **Given** a super-admin on the fleet overview, **When** they register a new tenant with firm details, **Then** a new tenant is created, a widget API key is generated and displayed exactly once, and the tenant shows onboarding status "draft".
2. **Given** a newly registered tenant, **When** the super-admin completes all wizard steps and finishes, **Then** a draft chatbot configuration, SOP workflow, and default case-type branches are generated from the entered answers plus platform defaults.
3. **Given** a completed draft, **When** the super-admin publishes it, **Then** the tenant's onboarding status becomes "published"/"live" and the chatbot serves that configuration.
4. **Given** the wizard is partially completed, **When** the super-admin leaves and returns, **Then** progress is preserved and the tenant remains in "draft" until published.
5. **Given** required wizard fields are missing, **When** the super-admin attempts to finish, **Then** the system blocks completion and indicates what is missing.

---

### User Story 3 - Manage a tenant's LLM provider, model, and key (Priority: P2)

A super-admin selects the LLM provider (Google Gemini, Anthropic, or OpenAI)
and model for a tenant, and optionally supplies a per-tenant provider API key so
that tenant's usage bills to their own key. When no per-tenant configuration
exists, the tenant falls back to the platform default provider and model. The
tenant's chatbot then uses the resolved provider/model for live conversations.
Per-tenant keys are never displayed again after entry and never appear in logs.

**Why this priority**: Directly requested capability and a prerequisite for
accurate per-tenant cost attribution. It depends on a tenant existing (US1/US2)
so it is P2.

**Independent Test**: Set a tenant to a non-default provider/model, run a chat
against that tenant, and confirm the resolved provider/model is used and
recorded; unset it and confirm fallback to the platform default; confirm the
stored key is never returned in plaintext.

**Acceptance Scenarios**:

1. **Given** a tenant with no LLM configuration, **When** its chatbot handles a conversation, **Then** the platform default provider and model are used.
2. **Given** a super-admin sets a tenant's provider to Anthropic (or OpenAI or Gemini) and a model, **When** that tenant's chatbot handles a conversation, **Then** the selected provider and model are used and recorded against the tenant.
3. **Given** a super-admin enters a per-tenant provider API key, **When** the configuration is saved, **Then** the key is stored securely and never shown in plaintext again nor written to any log.
4. **Given** a per-tenant provider API key is present, **When** the tenant's chatbot handles a conversation, **Then** requests to the provider use the tenant's key rather than the platform key.
5. **Given** any provider is selected, **When** the chatbot runs, **Then** the existing agent safety bounds (tool-call recursion cap, context/token budget, per-session and per-key rate limits) still apply unchanged.

---

### User Story 4 - Per-tenant metrics (Priority: P2)

A super-admin views high-level metrics for a tenant, derived only from data the
platform already stores: (a) lead funnel & quality — conversations started,
leads captured, HOT/WARM/COLD/SPAM breakdown, and conversion rate; (b) usage &
cost — conversation volume over time, messages per conversation, token usage and
estimated spend attributed to the resolved provider/model; (c) attorney routing
outcomes — HOT leads routed / notification emails dispatched, and lawyer
follow-up actions taken.

**Why this priority**: A primary requested capability that makes the console an
oversight tool rather than just a provisioning tool. Depends on tenants and
their traffic existing, so P2.

**Independent Test**: Seed a tenant with sessions, leads of each classification,
token-usage records, and routing/action events; open its metrics and confirm the
funnel, usage/cost, and routing figures match the seeded data.

**Acceptance Scenarios**:

1. **Given** a tenant with recorded sessions and leads, **When** the super-admin opens its metrics, **Then** conversations started, leads captured, the HOT/WARM/COLD/SPAM breakdown, and conversion rate are shown accurately.
2. **Given** a tenant with recorded token usage, **When** the super-admin opens usage & cost, **Then** conversation volume over time, messages per conversation, token usage, and estimated spend are shown and attributed to the resolved provider/model.
3. **Given** a tenant with routed HOT leads and recorded follow-up actions, **When** the super-admin opens routing outcomes, **Then** HOT leads routed / emails dispatched and follow-up actions taken are shown.
4. **Given** a tenant with no traffic, **When** the super-admin opens its metrics, **Then** zeroed metrics are shown without error.

---

### User Story 5 - Read-only SOP flow visualization (Priority: P3)

A super-admin views a tenant's active SOP workflow as a read-only flow diagram:
the ordered steps, case types, sub-types, and the branch-specific questions for
each configured branch. Editing is not performed here — changes remain in the
firm-facing SOP editor.

**Why this priority**: Valuable for oversight and support but not required to
operate a tenant. It is a pure read view over existing data, so P3.

**Independent Test**: For a tenant with a published SOP and at least one
configured branch, open the visualization and confirm it renders the steps,
case types, sub-types, and branch questions matching the stored configuration.

**Acceptance Scenarios**:

1. **Given** a tenant with a published SOP, **When** the super-admin opens the SOP visualization, **Then** the ordered steps, case types, sub-types, and configured branches (with their questions) are rendered.
2. **Given** the visualization is open, **When** the super-admin looks for edit controls, **Then** none are present — the view is read-only.
3. **Given** a tenant whose SOP has no configured branches, **When** the visualization is opened, **Then** the default step flow is rendered without error.

---

### User Story 6 - Tenant lifecycle controls (Priority: P3)

A super-admin can suspend a tenant (disabling its widget API key so the chatbot
stops serving) and later reactivate it, rotate a tenant's widget API key (new
key shown exactly once), and soft-delete a tenant so its lead/PII data is
snapshotted to archival rather than hard-deleted. Every mutating action records
which super-admin performed it and when.

**Why this priority**: Important for real operations but the platform can launch
with create/onboard/configure first; lifecycle management can follow. P3.

**Independent Test**: Suspend a tenant and confirm its chatbot stops serving;
reactivate and confirm it serves again; rotate the key and confirm the old key
no longer works and the new one does; soft-delete and confirm an archival
snapshot exists and no lead data is hard-deleted; confirm each action recorded
the acting super-admin and timestamp.

**Acceptance Scenarios**:

1. **Given** an active tenant, **When** the super-admin suspends it, **Then** its widget API key is disabled and its chatbot stops serving requests.
2. **Given** a suspended tenant, **When** the super-admin reactivates it, **Then** its chatbot serves requests again.
3. **Given** a tenant, **When** the super-admin rotates its widget API key, **Then** a new key is generated and shown exactly once, and the previous key stops working.
4. **Given** a tenant, **When** the super-admin soft-deletes it, **Then** its lead/PII data is written to an archival snapshot and the tenant is removed from the active fleet without a hard data wipe.
5. **Given** any lifecycle action, **When** it completes, **Then** the acting super-admin identity and a timestamp are recorded.

---

### Edge Cases

- **Firm-scope isolation is preserved**: introducing cross-tenant super-admin access MUST NOT relax the existing rule that a law firm's own dashboard and chatbot only ever see that firm's data. A firm session must never gain super-admin capability.
- **Duplicate registration**: registering a firm whose email already exists is rejected with a clear message rather than creating a conflicting tenant.
- **Wizard abandonment**: a half-completed wizard leaves the tenant in "draft" and never serves a partial configuration to visitors.
- **Provider key invalid/unreachable**: if a tenant's configured provider key is rejected by the provider at chat time, the failure is handled gracefully and surfaced to the operator, without exposing the key.
- **Unset LLM config**: a tenant with no LLM configuration always resolves to the platform default rather than failing.
- **Suspended tenant traffic**: a chat request using a suspended/rotated (old) key is rejected as unauthorized.
- **Metrics with zero data**: metrics for a brand-new or idle tenant render as zeros, not errors.
- **Estimated spend when token usage is missing**: if some conversations lack recorded token usage, spend is estimated from available data and the gap is not silently presented as zero cost for the whole tenant.
- **Secret exposure**: neither per-tenant LLM keys nor freshly generated widget keys ever appear in logs, metrics, or API responses after their one-time display.

## Requirements *(mandatory)*

### Functional Requirements

**Identity & access (US1)**

- **FR-001**: The system MUST provide a super-admin role whose identity is stored separately from law-firm accounts and authenticated with its own credentials.
- **FR-002**: The system MUST deny every console page and every administrative action to any session that is not an authenticated super-admin, redirecting unauthenticated visitors to super-admin sign-in.
- **FR-003**: The system MUST NOT allow a law-firm login to acquire super-admin capability, and MUST preserve existing firm-scoped access so a firm only ever sees its own data.

**Fleet overview (US1)**

- **FR-004**: The system MUST present a fleet overview listing all tenants with, per tenant: firm name, status (active/suspended), onboarding status (draft/published/live), leads captured in the last 30 days, estimated LLM spend, and last activity timestamp.
- **FR-005**: Users MUST be able to open a detail view for any tenant from the overview.

**Registration & onboarding (US2)**

- **FR-006**: Super-admins MUST be able to register a new tenant, which creates the tenant account and provisions a widget API key displayed exactly once and never retrievable again in plaintext.
- **FR-007**: The system MUST reject registration when the firm's identifying email already belongs to an existing tenant, with a clear message.
- **FR-008**: The system MUST provide a guided multi-step onboarding wizard capturing at least: firm identity; practice areas / case types; persona & tone; contact information & office hours; escalation rules.
- **FR-009**: On wizard completion, the system MUST generate a DRAFT chatbot configuration, a DRAFT SOP workflow, and default case-type branches, derived from the entered answers combined with platform defaults, without introducing a separate/parallel configuration store (it MUST reuse the existing configuration + SOP structures and their versioning/publish model).
- **FR-010**: The system MUST allow the super-admin to publish the draft so the tenant transitions to live and its chatbot serves the published configuration.
- **FR-011**: The system MUST preserve wizard progress across sessions and keep the tenant in "draft" until explicitly published.
- **FR-012**: The system MUST prevent wizard completion while required fields are missing and indicate which are outstanding.

**LLM provider management (US3)**

- **FR-013**: Super-admins MUST be able to set, per tenant, an LLM provider chosen from Google Gemini, Anthropic, and OpenAI, and a model for that provider.
- **FR-014**: Super-admins MUST be able to optionally supply a per-tenant provider API key; when absent, the tenant MUST fall back to the platform default provider, model, and key.
- **FR-015**: The chatbot runtime MUST resolve the provider and model per tenant through a single resolution point (no scattered hardcoded model choices) and MUST fall back to the platform default (`gemini-2.5-flash`) when a tenant has no configuration.
- **FR-016**: Per-tenant provider API keys MUST be stored in a recoverable, encrypted-at-rest form (not a one-way hash), MUST never be written to logs, and MUST never be returned to any client in plaintext after entry.
- **FR-017**: All existing agent safety bounds — tool-call recursion cap (≤ 5), context/token budget, per-session message limit, and per-key daily conversation limit — MUST apply identically regardless of the resolved provider.

**Metrics (US4)**

- **FR-018**: The system MUST show per-tenant lead-funnel metrics: conversations started, leads captured, HOT/WARM/COLD/SPAM breakdown, and conversion rate.
- **FR-019**: The system MUST show per-tenant usage & cost metrics: conversation volume over time, messages per conversation, token usage, and estimated spend attributed to the resolved provider/model.
- **FR-020**: The system MUST show per-tenant attorney-routing outcomes: HOT leads routed / notification emails dispatched, and lawyer follow-up actions taken.
- **FR-021**: All metrics MUST be derived from data the platform already stores (sessions, leads, token-usage records, routing/action events); introducing any new tracking surface MUST be justified and MUST NOT record personal data into general-purpose logs.
- **FR-022**: Metrics MUST render without error for tenants that have zero traffic.

**SOP visualization (US5)**

- **FR-023**: The system MUST render a read-only visualization of a tenant's active SOP showing ordered steps, case types, sub-types, and each configured branch with its questions.
- **FR-024**: The SOP visualization MUST expose no editing controls; edits remain the firm-facing SOP editor's responsibility.

**Lifecycle (US6)**

- **FR-025**: Super-admins MUST be able to suspend a tenant (disabling its widget API key so its chatbot stops serving) and reactivate it.
- **FR-026**: Super-admins MUST be able to rotate a tenant's widget API key, showing the new key exactly once and invalidating the previous key.
- **FR-027**: Tenant deletion MUST be a soft-delete that writes an archival snapshot of the tenant's lead/PII data rather than performing a hard wipe.
- **FR-028**: The system MUST record the acting super-admin identity and a timestamp for every mutating administrative action (create, onboard/publish, LLM-config change, suspend/reactivate, key rotation, delete).

### Key Entities *(include if feature involves data)*

- **Super-admin**: A platform operator identity, separate from any law-firm account, with credentials and sign-in independent of firm logins.
- **Tenant (law firm)**: An existing account, extended with lifecycle status (active/suspended), onboarding status (draft/published/live), and a soft-delete marker. Owns its configuration, SOP, branches, API key(s), leads, sessions, and attorney roster.
- **Tenant LLM configuration**: Per-tenant selection of provider (Gemini/Anthropic/OpenAI), model, and an optional encrypted provider API key; absence means "use platform default".
- **Onboarding wizard submission**: The set of firm-provided answers (identity, case types, persona/tone, contact/hours, escalation) that seed the draft configuration and SOP.
- **Usage/cost record**: Per-conversation record of token usage plus the resolved provider and model, used to attribute spend per tenant and per provider.
- **Admin action record**: An attributable log of each mutating administrative action — who (super-admin), what, which tenant, and when.
- **Archival snapshot**: The retained copy of a soft-deleted tenant's lead/PII data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A super-admin can register a brand-new law firm, complete the onboarding wizard, publish its configuration, set its LLM provider, and see it live and serving chat — all within the console in a single sitting (target: under 15 minutes for a typical firm).
- **SC-002**: 100% of law-firm (non-super-admin) attempts to reach the console or any administrative action are denied.
- **SC-003**: The fleet overview reflects each tenant's status, 30-day lead count, estimated spend, and last activity that match the underlying data with zero discrepancies in verification.
- **SC-004**: A tenant configured with a non-default provider/model has 100% of its live conversations handled by the selected provider/model; a tenant with no configuration has 100% handled by the platform default.
- **SC-005**: Per-tenant provider API keys and freshly generated widget keys never appear in plaintext in any log, metric, or API response after their one-time display (verified by inspection and automated checks).
- **SC-006**: Per-tenant metrics (funnel, usage/cost, routing) match seeded/known data within expected rounding for estimated spend, and render without error for zero-traffic tenants.
- **SC-007**: Every mutating administrative action is attributable to a specific super-admin with a timestamp (100% coverage).
- **SC-008**: Introducing cross-tenant administration causes zero regressions in firm-scoped isolation — existing firm dashboard and chatbot behavior remains scoped to the firm's own data.

## Assumptions

- **Operator-driven, not self-serve**: tenants are registered and onboarded by the SaaS operator's super-admins; law firms do not self-register (self-serve signup is explicitly out of scope).
- **Single super-admin tier**: a flat super-admin role is sufficient; granular admin sub-roles/permissions are not required for this feature.
- **Reuse of existing structures**: the console reuses the existing account, configuration, SOP, branch, API-key, leads, sessions, and archival structures and their versioning/publish patterns rather than introducing parallel stores.
- **Provider set is fixed to three**: Google Gemini, Anthropic, and OpenAI are the supported providers; adding others is a future change.
- **Platform default provider/model**: the platform-wide default is `gemini-2.5-flash`, used as the fallback whenever a tenant has no LLM configuration.
- **Metrics from existing data**: token-usage recording already exists per the platform's cost-monitoring rules; a minimal additional usage record is introduced only if existing records are not queryable enough to attribute spend per tenant/provider.
- **Console placement**: the console is an internal surface of the existing platform application, guarded by the super-admin role, and shares its authentication/session mechanism.
- **Governance**: this feature is enabled by the project constitution v2.0.0 (multi-provider Required Stack, the Principle I Platform Admin Console carve-out, and Principle VIII on platform administration & tenant isolation). Implementation MUST comply with Principle VIII.

### Out of Scope

- Self-serve firm signup/registration by law firms themselves.
- Billing / invoicing / payment processing.
- Team roles or multiple user logins per firm.
- Editing a tenant's SOP or configuration from the console (view-only here; edits remain in the firm-facing editors).
- SOP step-level drop-off / abandonment analytics.
- Adding LLM providers beyond Gemini, Anthropic, and OpenAI.
