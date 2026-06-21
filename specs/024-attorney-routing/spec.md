# Feature Specification: Attorney Management & Hot Lead Email Routing

**Feature Branch**: `024-attorney-routing`

**Created**: 2026-06-21

**Status**: Draft

## User Scenarios & Testing

### User Story 1 — Lawyer manages the firm's attorney roster (Priority: P1)

A law firm administrator opens the Configuration page. They see a new "Attorneys" tab alongside the existing Persona, SOP Steps, and other configuration sections. From this tab they can view the full list of attorneys in the firm, each showing their name, email address, mobile number, and the case types they handle.

The administrator adds a new attorney by filling a form with the attorney's name, email, mobile number, and selecting one or more case types from the firm's existing case type catalog. They can also edit an existing attorney's details at any time, and remove an attorney who has left the firm.

**Why this priority**: The attorney roster must exist before the routing rules can fire. Without this data, no emails can be dispatched.

**Independent Test**: Log into the dashboard. Open Configuration → Attorneys tab. Add an attorney with name "Sarah Kim", email "sarah@firm.com", mobile "+14125550001", case types ["DUI", "Criminal Defense"]. Confirm the attorney appears in the list. Edit the name to "Sarah Kim Esq." and confirm the change persists. Delete the attorney and confirm they are removed.

**Acceptance Scenarios**:

1. **Given** no attorneys are configured, **When** the administrator opens the Attorneys tab, **Then** an empty state is shown with an "Add attorney" affordance.
2. **Given** the attorney form is open, **When** the administrator submits without an email address, **Then** the form rejects the submission with a clear error — email is required.
3. **Given** an attorney exists, **When** the administrator clicks Edit, **Then** the form pre-fills with the attorney's current details.
4. **Given** an attorney exists, **When** the administrator deletes them, **Then** a confirmation prompt appears before the delete completes.
5. **Given** an attorney is assigned to case types, **When** those case types are rendered in the form, **Then** they map directly to the firm's existing case type catalog (not free-text).

---

### User Story 2 — Attorney receives email when a hot lead matches their case type (Priority: P1)

When the chatbot captures a lead classified as HOT and the lead's case type matches one or more attorneys in the firm's roster, an email notification is automatically dispatched to each matching attorney. The email contains the lead's name, contact information, case type, and a brief description of their matter.

The email dispatch does not happen synchronously in the lead capture flow — it is triggered through a message queue so that the chatbot's response time is unaffected. The queue consumer reads the notification and sends the email.

**Why this priority**: Attorney notification is the primary business value — reducing time-to-contact for hot leads directly impacts conversion rates.

**Independent Test**: Configure attorney "Sarah Kim" with case type "DUI". Submit a DUI inquiry through the widget and complete the contact form with a HOT lead outcome. Within 30 seconds, Sarah Kim's email inbox receives a notification containing the visitor's name, contact info, and case details. Check that a second attorney assigned to "Personal Injury" does NOT receive an email for this DUI lead.

**Acceptance Scenarios**:

1. **Given** a HOT lead is captured with case type "DUI", **When** one or more attorneys are assigned to "DUI", **Then** each matching attorney receives an email notification within 60 seconds.
2. **Given** a HOT lead is captured, **When** no attorney is assigned to that case type, **Then** no routing email is sent (existing dashboard notification still fires normally).
3. **Given** a lead is classified as WARM, COLD, or SPAM, **When** the lead is captured, **Then** no attorney routing email is sent regardless of case type assignment.
4. **Given** a HOT lead fires, **When** the email dispatch fails (e.g. invalid email, delivery error), **Then** the failure is recorded and does not crash the lead capture flow or block the chatbot response.
5. **Given** the queue is temporarily unavailable, **When** a HOT lead fires, **Then** the lead is still captured in the database and the notification is retried when the queue recovers.

---

### Edge Cases

- What if an attorney has no case types assigned? They receive no routing emails until at least one case type is added.
- What if an attorney's email becomes invalid after configuration? The bounce is logged but the lead is still captured and the dashboard notification still fires.
- What if a HOT lead has a null or unrecognised case type? No attorney routing email is sent.
- What if two attorneys share the same email and both handle DUI? Both receive the email independently (no dedup by email address — by attorney record).
- What if a firm has no published configuration? The attorney tab is still accessible and functional; no routing fires until the SOP is active.

---

## Requirements

### Functional Requirements

**Attorney management (dashboard)**

- **FR-001**: The Configuration page MUST include an "Attorneys" tab accessible alongside existing configuration sections.
- **FR-002**: The Attorneys tab MUST display a list of all attorneys for the account, showing each attorney's name, email address, mobile number, and assigned case types.
- **FR-003**: A lawyer MUST be able to add a new attorney by providing: name (required), email address (required), mobile number (optional), and one or more case types from the account's existing catalog.
- **FR-004**: A lawyer MUST be able to edit any field of an existing attorney record.
- **FR-005**: A lawyer MUST be able to delete an attorney record. Deletion MUST require a confirmation step.
- **FR-006**: The email address field MUST be validated as a properly formatted email address before saving.
- **FR-007**: Case type selection MUST draw from the firm's existing case type catalog — attorneys cannot be assigned to case types that do not exist in the catalog.
- **FR-008**: An attorney MAY be assigned to zero or more case types. An attorney with no case types receives no routing emails.

**Lead routing**

- **FR-009**: When a lead is classified as HOT and its case type is known, the system MUST publish a routing notification to a message queue.
- **FR-010**: The routing notification MUST include: lead ID, session ID, account ID, lead case type, lead name, lead contact email, lead contact phone, lead brief description, and capture timestamp.
- **FR-011**: A queue consumer MUST process routing notifications and send one email per matching attorney (attorneys whose assigned case types include the lead's case type).
- **FR-012**: Routing emails are sent ONLY for HOT-classified leads. WARM, COLD, and SPAM leads do NOT trigger attorney routing emails.
- **FR-013**: The routing email MUST contain: attorney's name as salutation, lead's full name, contact email, contact phone, case type label, brief description of the matter, and a link or reference to the dashboard lead view.
- **FR-014**: Email dispatch failures MUST be logged with the lead ID and attorney ID. The failure MUST NOT prevent the lead from being recorded or the chatbot from responding.
- **FR-015**: If no attorneys are assigned to the lead's case type, the system MUST silently skip routing (no error, no email).
- **FR-016**: The queue-based architecture MUST ensure the chatbot response time is not affected by email dispatch — the notification is enqueued asynchronously and the response returns before email delivery.

### Key Entities

- **Attorney**: A person at the law firm who receives lead notifications. Has a name, email address (unique per account), optional mobile number, and a set of assigned case types. Scoped to an account.
- **AttorneyAssignment**: The relationship between an attorney and a case type they handle. An attorney can have many assignments; a case type can be handled by many attorneys.
- **RoutingNotification**: A queue message published when a HOT lead fires. Contains all lead context needed to generate the email. Consumed by the email worker.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A lawyer can add, edit, or delete an attorney from the dashboard in under 60 seconds.
- **SC-002**: A HOT lead email reaches a matching attorney's inbox within 60 seconds of the lead being captured under normal operating conditions.
- **SC-003**: Zero attorney routing emails are sent for WARM, COLD, or SPAM leads — verifiable by log inspection after 100 non-HOT leads.
- **SC-004**: Email dispatch failures do not degrade chatbot response time — the widget's done-event latency is unchanged when email delivery fails.
- **SC-005**: The attorney management UI correctly reflects the firm's case type catalog — attorneys can only be assigned to case types that exist in the account's published configuration.
- **SC-006**: 100% of HOT leads with a matching attorney assignment result in a routing notification being enqueued (verifiable via queue depth / message log).

---

## Assumptions

- Email delivery is handled by an external email service (e.g. transactional email provider). The spec does not prescribe which provider; the implementation selects an appropriate one.
- The message queue infrastructure is provisioned as part of the implementation. The spec does not prescribe queue technology (SQS, BullMQ, Redis Streams, etc.).
- Attorney records are scoped to an account. One firm's attorneys are never visible to another firm.
- The "case type" used for routing is the top-level case type slug captured by the SOP (e.g. "dui", "personal_injury"), not the sub-type. Routing at sub-type level is out of scope.
- Attorney email addresses must be unique within an account (two records cannot share the same email for the same firm).
- The feature touches `packages/api` (backend + dashboard UI) only. The widget and shared packages are not modified.
- Mobile number is stored for future SMS routing (out of scope now) but is not used for any notification in this feature.
- The existing `urgent_lead` dashboard notification (in-app) continues to fire unchanged. Attorney email routing is additive — it does not replace the existing notification.
- Retry policy for failed email delivery is handled by the queue consumer (e.g. exponential backoff, dead-letter queue). The retry specifics are an implementation concern.
