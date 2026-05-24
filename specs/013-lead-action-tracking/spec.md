# Feature Specification: Lead Action Tracking

**Feature Branch**: `013-lead-action-tracking` (planned)

**Created**: 2026-05-24

**Status**: Draft

**Input**: User description: "Feature: Column for action on lead? Description: In the dashboard when the law-firm user clicks on the lead then they should see an action button where they can select what action was taken on that lead. The action taken on the lead should also appear in the leads table. Options can be - Contacted / Call didn't answer? / Client meeting fixed"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lawyer Records Follow-Up Action on a Lead (Priority: P1)

A lawyer reviews a captured lead in the dashboard's lead-detail page, picks up the phone, and successfully reaches the prospective client. They want to record that they "Contacted" the lead so the rest of the team (and themselves on a later visit) can see at a glance which leads have been actioned and which still need attention.

**Why this priority**: This is the core value of the feature. The current dashboard tells lawyers WHO the leads are but not WHAT has been done about them. Without this, the lawyer manages follow-up tracking in their head or a separate spreadsheet — defeating the purpose of the lead-management dashboard.

**Independent Test**: Open the leads dashboard, click into a specific lead's detail page, see an action picker, choose "Contacted", save. Navigate back to the leads list — verify the chosen action is visible alongside that lead's row.

**Acceptance Scenarios**:

1. **Given** a freshly captured lead with no action recorded, **When** the lawyer opens the lead detail page, **Then** an action picker is visible showing "No action yet" or equivalent placeholder + the three action options (Contacted, Call didn't answer, Client meeting fixed).
2. **Given** the lawyer is on the lead detail page, **When** they select "Contacted" and confirm, **Then** the lead's recorded action becomes "Contacted" and is timestamped with the current time.
3. **Given** a lead has had an action recorded, **When** the lawyer returns to the leads list table, **Then** the table shows that action in a dedicated column for that row.
4. **Given** a lead has had an action recorded, **When** the lawyer opens the same lead's detail page later, **Then** the picker reflects the previously selected action and its timestamp.
5. **Given** the lawyer wants to update an action (e.g., they called back and got an answer this time), **When** they select a different option, **Then** the lead's recorded action updates and the timestamp updates to the current time.

---

### User Story 2 - Lawyer Scans the Lead List for Actionable Leads (Priority: P2)

A lawyer opens the leads dashboard at the start of their day. They want to scan the list and immediately see which leads still need first contact, which are pending a callback, and which have meetings scheduled — without clicking into each one.

**Why this priority**: This is the daily-workflow value of the feature. Story 1 (recording an action) is a prerequisite, but story 2 is what the lawyer actually does most often.

**Independent Test**: Open the leads list with multiple leads in different action states (some with no action, some Contacted, some "Call didn't answer", some "Client meeting fixed"). Visually scan the table — verify each row's action is clearly distinguishable.

**Acceptance Scenarios**:

1. **Given** the leads list contains leads in mixed action states, **When** the lawyer views the table, **Then** each row shows its action (or a "no action yet" indicator) in a column dedicated to it.
2. **Given** a lead has no recorded action, **When** the lawyer views its row in the table, **Then** the action column shows a clearly distinguishable empty/placeholder state (not blank cell, not error).
3. **Given** the lead-list table is wide enough to accommodate the new column, **When** the lawyer views the table on a desktop screen, **Then** the action column is visible without horizontal scrolling. (Mobile/narrow viewport behavior is out of scope for v1.)

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each lead MUST have an associated "follow-up action" field that is independent of the existing `classification` (urgent/normal/unqualified) and `status` (new) fields. The follow-up-action field is set by the lawyer manually; the existing classification + status fields remain unchanged in their existing roles.
- **FR-002**: The follow-up-action field MUST support exactly these initial values:
  - `Contacted`
  - `Call didn't answer`
  - `Client meeting fixed`
  - `null` / no action yet (default state for newly-captured leads)
- **FR-003**: The lead detail page (existing `/dashboard/leads/[id]` page) MUST display an action picker that lets the lawyer select one of the three values. The picker MUST also allow returning to the "no action yet" state if the lawyer recorded an action by mistake.
- **FR-004**: When the lawyer changes the action selection, the system MUST persist the new value AND record a timestamp of when it was changed. The timestamp MUST be visible to the lawyer somewhere on the detail page (e.g., "Contacted on May 24, 2026, 2:14 PM").
- **FR-005**: The leads list table (`/dashboard/leads` page) MUST show the action for each lead in a dedicated column. The column header MUST be labeled clearly (e.g., "Action").
- **FR-006**: Leads with no recorded action MUST show a visually distinguishable "no action yet" indicator in the action column (NOT a blank cell). The indicator should signal "needs attention" rather than "missing data".
- **FR-007**: The action selection MUST persist across page reloads and across visits by other users in the same firm/account. (The dashboard is currently single-user per account but the persistence requirement future-proofs against multi-user.)
- **FR-008**: The action is editable at any time. There is no immutable "action history" log requirement for v1 — only the most recent action + its timestamp are tracked.
- **FR-009**: The action change MUST be authenticated by the existing dashboard session (iron-session). Unauthenticated requests to update an action MUST be rejected with the same auth error path used by other dashboard mutations.
- **FR-010**: The action change MUST be authorized — only users belonging to the account that owns the lead can change that lead's action. A user from a different account attempting to update a lead they don't own MUST be rejected (the existing dashboard pattern already enforces this account-scoping).

### Key Entities

- **Lead** (existing entity): gains a `follow_up_action` field (one of the three values OR null) and a `follow_up_action_changed_at` timestamp field. All other Lead fields (name, email, phone, classification, status, sop_state_snapshot, etc.) are unchanged.

## Success Criteria *(mandatory)*

- **SC-001**: A lawyer can change a lead's action from the detail page in fewer than 3 clicks (open lead → click action picker → select option). No multi-step modal or save-button-elsewhere flow.
- **SC-002**: The leads list table shows the action column for every row. A lawyer scanning the table can identify which leads have no action yet versus which have been actioned within ~2 seconds of viewing the page.
- **SC-003**: 100% of action changes are persisted across page reloads. (No silent-failure path that displays the change in the picker but doesn't actually save.)
- **SC-004**: The timestamp displayed alongside the action accurately reflects the most recent change, formatted in the lawyer's local timezone.
- **SC-005**: Authorization is correct: a malicious user from account A attempting to change a lead in account B receives an authorization error and the lead is not modified.
- **SC-006**: The feature does not regress any existing leads-dashboard behavior (filter pills, classification badge, status badge, sort order).

## Assumptions

- "Call didn't answer?" is interpreted as the literal label `Call didn't answer` (the trailing question mark in the user's prompt was punctuation noting the user's own uncertainty about the name, not part of the value).
- The action field is **mutable** — lawyers can change it any time. (Common-sense follow-up workflow: a "Call didn't answer" lead can become "Contacted" on the next attempt.)
- A **timestamp** is captured on each change (FR-004). Standard CRM follow-up tracking practice; helps lawyers see "this lead has been waiting 3 days since the last contact attempt".
- Only the **most recent** action is tracked, not full history. v1 simplification; v2 could add an action history log if lawyers ask for it.
- The picker is **per-lead**, on the lead detail page (matches the user's request "when the law-firm user clicks on the lead"). NOT inline-editable from the leads table — that adds UX complexity (click target ambiguity, save coordination) that's not part of the request.
- The action options are **fixed** for v1 (the three values from the user's prompt). NOT user-configurable from the dashboard. v2 could add a configuration surface if firms want their own vocabulary.
- The leads dashboard is **per-account** (single firm per dashboard session today; FR-010 documents the account-scoping which is the existing 007-dashboard pattern).
- Timezone for the displayed timestamp is the **lawyer's browser local timezone**, formatted in standard human-readable form (e.g., "May 24, 2026, 2:14 PM"). Server-side persistence is in UTC ISO 8601 (existing convention from prior `created_at` columns).
- The "no action yet" indicator in the table is a muted/grey badge or em-dash placeholder — visually clearly distinguishable from the three actioned states.

## Out of Scope

- **Action history log**: v1 tracks only the most recent action + timestamp. Full audit log of every change is out of scope.
- **Inline editing from the table row**: action editing is only on the lead detail page.
- **Custom / firm-configurable action vocabulary**: the three options are fixed. Configurability is a future feature.
- **Bulk action updates** (e.g., "mark these 5 leads as Contacted"): out of scope.
- **Notifications when an action is recorded** (e.g., email the team when a meeting is fixed): out of scope.
- **Filtering the leads table by action**: while obvious adjacent UX, not part of the user's stated request. The existing classification-filter pills remain; an action-filter could be added in a follow-up.
- **Mobile/narrow viewport behavior**: the leads table currently doesn't have a mobile-optimized view; the new column inherits whatever the existing table does (likely horizontal scroll). Improving the table for mobile is its own feature.
