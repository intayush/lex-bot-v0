# Feature Specification: Remove Practice Areas — Consolidate on Case Types

**Feature Branch**: `019-remove-practice-areas`

**Created**: 2026-06-20

**Status**: Draft

**Input**: User description: "Remove the 'Practice Areas' section from the Configuration page and derive all its functionality from the SOP 'Case Types' section instead."

**Parent Context**: `010-sop-workflow`, `007-dashboard`. This feature consolidates two overlapping data surfaces. The SOP Case Types table already drives in-scope area determination at runtime when SOP is active; this feature makes that the single source of truth and removes the now-redundant Practice Areas section from the Configuration page.

## Overview

The Configuration page currently has a "Practice Areas" section where lawyers list which legal areas their firm handles and provide an out-of-scope deflection message. The SOP page has a "Case Types" section that fulfills the same purpose (each case type has an in-scope/out-of-scope flag) and already takes precedence in the chat runtime when SOP is active.

Maintaining two separate surfaces for the same data creates confusion: a lawyer editing "Case Types" on the SOP page may not realize they also need to keep "Practice Areas" on the Configuration page in sync. This feature removes the duplicate by:

1. Deleting the "Practice Areas" section from the Configuration page UI.
2. Promoting the out-of-scope deflection message to a standalone field on the Configuration page (not nested under Practice Areas).
3. Deriving the greeting-screen quick-reply chips in the chat widget directly from the in-scope case types instead of from the Practice Areas config.
4. Simplifying the chat runtime's in-scope area logic to always use Case Types, removing the legacy fallback.

Existing configuration data is preserved non-destructively — old Practice Areas values remain in the stored configuration but are no longer read by the UI or the chat runtime.

## Clarifications

### Session 2026-06-20

- Q: Should the `/api/config` response field carrying the greeting chip list keep the existing name `practice_areas` or be renamed to `in_scope_case_types`? → A: Rename to `in_scope_case_types`. All widget consumers updated as part of this feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Lawyer No Longer Sees Practice Areas on the Configuration Page (Priority: P1)

A lawyer opens the dashboard and navigates to the Configuration page. They see sections for Persona, Contact, Guardrails, Boundaries, Escalation, and the out-of-scope response — but no "Practice Areas" section. They understand that their in-scope case areas are managed entirely from the SOP → Case Types tab.

**Why this priority**: This is the visible change that ends the dual-maintenance confusion. Without removing the UI section the problem persists even if the runtime is updated.

**Independent Test**: Log in, navigate to Configuration. Verify no "Practice Areas" section, no active/custom checkboxes, and no list of practice area options appears anywhere on the page. The out-of-scope response text field IS present (moved to a standalone location).

**Acceptance Scenarios**:

1. **Given** a logged-in lawyer, **When** they open the Configuration page, **Then** no "Practice Areas" heading, checkbox list, or custom field inputs are visible.
2. **Given** an account that previously had Practice Areas data saved, **When** the lawyer opens Configuration, **Then** the page renders without error and the out-of-scope response text is pre-populated with the previously saved value.
3. **Given** a lawyer saves the Configuration form (without a Practice Areas section), **When** the save succeeds, **Then** the previously saved Practice Areas data in the stored configuration is not overwritten or corrupted.

---

### User Story 2 — Out-of-Scope Response Field Remains Editable (Priority: P1)

A lawyer needs to customize the message the chatbot sends when a visitor asks about a legal area the firm does not handle (e.g., "We don't handle tax cases — please consult a tax attorney"). This field must remain editable on the Configuration page, just not grouped under a "Practice Areas" heading.

**Why this priority**: The out-of-scope response is injected directly into the chat system prompt. Losing the ability to edit it would break a compliance-critical behavior (the bot must direct visitors away from out-of-scope topics appropriately).

**Independent Test**: Open Configuration, find the out-of-scope response text field (now standalone, not under Practice Areas), edit the text, save. Start a chat conversation and ask an out-of-scope question. Verify the chatbot uses the updated deflection text.

**Acceptance Scenarios**:

1. **Given** the Configuration page, **When** it renders, **Then** an "Out-of-scope response" text field is visible (outside any Practice Areas grouping) and is pre-populated with the firm's current value.
2. **Given** the lawyer edits and saves the out-of-scope response, **When** a visitor asks the chatbot about an out-of-scope legal area, **Then** the chatbot responds with the updated text.
3. **Given** a new account with no prior configuration, **When** the page renders, **Then** the out-of-scope response field shows a sensible default placeholder.

---

### User Story 3 — Greeting-Screen Quick Replies Come from Case Types (Priority: P1)

A visitor opens the chat widget. Before the SOP starts, the widget shows quick-reply chips on the greeting screen (e.g., "DUI", "Personal Injury", "Family Law"). These chips now reflect the firm's in-scope case types instead of the Practice Areas list. The chips appear in the same position order as the Case Types tab on the SOP page.

**Why this priority**: Fixes the root inconsistency in the visitor-facing UI — the greeting chips now match exactly what case types the firm has configured as in-scope in the SOP editor.

**Independent Test**: On the SOP → Case Types tab, mark "Estate Planning" as out-of-scope. Open the widget on the test app. Verify "Estate Planning" does NOT appear in the greeting quick-reply chips. Then mark it back in-scope and verify it appears again.

**Acceptance Scenarios**:

1. **Given** a firm has three in-scope case types (DUI, Personal Injury, Family Law) and two out-of-scope types, **When** a visitor opens the widget greeting screen, **Then** exactly three chips appear matching the in-scope labels, in position order.
2. **Given** a lawyer marks a previously in-scope case type as out-of-scope on the SOP page and publishes, **When** a visitor opens a new widget session, **Then** that case type chip no longer appears on the greeting screen.
3. **Given** all case types are marked out-of-scope, **When** a visitor opens the widget, **Then** no quick-reply chips appear (same behavior as the current empty practice_areas case).
4. **Given** the widget greeting screen, **When** a visitor taps a case-type chip, **Then** the message "I need help with [label]" is sent and the SOP advances normally.

---

### User Story 4 — Chat Runtime Always Uses Case Types for In-Scope Areas (Priority: P1)

The chatbot's system prompt always shows the "Practice Areas (In Scope)" block derived from Case Types (filtered to in-scope), regardless of whether the legacy Practice Areas config has any data. The legacy fallback is removed.

**Why this priority**: Eliminates the edge case where an account with no Case Types data accidentally falls back to stale Practice Areas values, producing inconsistent chatbot behavior.

**Independent Test**: Using a test account that has Practice Areas data in its stored config but no Case Types configured, observe the system prompt (via a debug/logging tool or the Preview chat). Verify the "Practice Areas (In Scope)" block is empty (or uses a sensible default) rather than falling back to the old Practice Areas strings.

**Acceptance Scenarios**:

1. **Given** an account with in-scope Case Types configured, **When** the chatbot constructs its system prompt, **Then** the "Practice Areas (In Scope)" block lists the in-scope case type labels in position order.
2. **Given** an account with no Case Types configured (edge case / legacy), **When** the chatbot constructs its system prompt, **Then** the "Practice Areas (In Scope)" block is empty — it does NOT fall back to old Practice Areas strings from the config.
3. **Given** a lawyer marks a case type as out-of-scope, **When** a visitor's next chat session starts, **Then** that label no longer appears in the system prompt's in-scope list.

---

### Edge Cases

- **Account with no Case Types at all**: The in-scope list in the system prompt is empty. The chatbot still operates but its "Practice Areas" block lists nothing — acceptable until the lawyer configures Case Types.
- **Widget loaded before Case Types are configured**: Quick-reply chips are absent. The widget renders without error and the SOP greeting still shows.
- **Simultaneous save race**: If a lawyer saves Configuration (moving the out-of-scope response) at the same time as another tab saves Case Types, the last write wins. No special handling needed beyond standard form save behavior.
- **Old config rows with `practice_areas` key**: These rows continue to exist in the datastore. The new Configuration save path writes the promoted `out_of_scope_response` field without touching the legacy `practice_areas` object — both can coexist in the stored JSON.
- **Out-of-scope response left blank**: The system prompt block still renders; the chatbot uses an empty string, which the LLM handles gracefully. A validation warning on the form is acceptable but not required for MVP.

## Requirements *(mandatory)*

### Functional Requirements

#### FR Group A — Configuration Page UI

- **FR-001**: The Configuration page MUST NOT render any "Practice Areas" section, including: the active practice areas checkbox list, the custom practice areas free-text inputs, and any heading or grouping labeled "Practice Areas."
- **FR-002**: The Configuration page MUST render an "Out-of-scope response" text field as a standalone form field (not nested under a Practice Areas group). Its position on the page is a design decision (assumption: placed in the Guardrails or Boundaries section, or as a new top-level field near Boundaries).
- **FR-003**: The out-of-scope response field MUST be pre-populated with the account's currently saved value on page load.
- **FR-004**: When the lawyer saves the Configuration form, the out-of-scope response value MUST be persisted and the previously saved Practice Areas data in the stored configuration MUST remain intact (non-destructive save).
- **FR-005**: The dashboard's configuration seed/default values for new accounts MUST include a sensible default out-of-scope response text (e.g., "We don't handle that type of matter — please consult a specialist.") in the promoted field location.

#### FR Group B — Widget Greeting Quick Replies

- **FR-006**: The `/api/config` endpoint MUST return the quick-reply chip list for the greeting screen derived from `case_types` where `is_in_scope = true`, ordered by `position`.
- **FR-007**: The quick-reply chip list MUST use the case type label (human-readable display name), not the machine slug, as the chip text.
- **FR-008**: The `/api/config` response field carrying the chip list MUST be renamed from `practice_areas` to `in_scope_case_types`. It MUST be populated from Case Types (filtered to `is_in_scope = true`, ordered by `position`) regardless of what the legacy config's `practice_areas` object contains. All widget consumers of this field (`ChatPanel.tsx`, widget prop types, widget tests) MUST be updated to use the new name.
- **FR-009**: When no case types are marked in-scope, the chip list returned MUST be an empty array (no chips rendered).
- **FR-010**: When a visitor taps a greeting chip, the widget MUST send the message "I need help with [label]" and start the SOP flow, identical to current behavior.

#### FR Group C — System Prompt (Chat Runtime)

- **FR-011**: The system prompt composer MUST derive the "Practice Areas (In Scope)" block exclusively from in-scope case types. The legacy fallback path that reads `config.practice_areas.active` and `config.practice_areas.custom` MUST be removed.
- **FR-012**: When no case types are in-scope, the "Practice Areas (In Scope)" block in the system prompt MUST be present but empty (no bullet items), rather than falling back to any legacy data.
- **FR-013**: The out-of-scope response text in the system prompt MUST continue to be sourced from the configuration's out-of-scope response field (now promoted to top level).

#### FR Group D — Configuration Schema & Data Compatibility

- **FR-014**: The configuration schema MUST add an `out_of_scope_response` field at the top level (or in the most appropriate existing group that is not `practice_areas`).
- **FR-015**: On reading a stored configuration that has only the old `practice_areas.out_of_scope_response` field (and no top-level `out_of_scope_response`), the system MUST migrate the value at read time — populate the promoted field from the nested one so existing accounts do not lose their deflection text.
- **FR-016**: The `practice_areas` sub-object in the configuration schema MUST be made optional/deprecated — it should still parse without error (for backwards compatibility of stored rows) but the UI MUST NOT write to it on new saves.
- **FR-017**: The dashboard seed data and any new-account defaults MUST write `out_of_scope_response` to the promoted location, not to `practice_areas.out_of_scope_response`.

### Key Entities

- **Configuration** (per account, versioned): Gains a promoted `out_of_scope_response` top-level (or group-level) field. The `practice_areas` sub-object becomes legacy-optional.
- **CaseType** (per account, live table): Unchanged data model. The `is_in_scope` flag and `position` field already exist and drive the new chip list and system prompt.
- **Widget config payload** (`/api/config` response): The chip-list field changes its data source from `practice_areas.active + custom` to `case_types.filter(is_in_scope).map(label)`. The field name is subject to the clarification in FR-008.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After this feature ships, 100% of new Configuration saves produce a stored config that contains the promoted `out_of_scope_response` field and has not modified any existing `practice_areas` data.
- **SC-002**: 100% of chat sessions for accounts with in-scope Case Types configured show a system prompt "Practice Areas (In Scope)" block derived solely from Case Types — verifiable by inspecting structured logs.
- **SC-003**: The greeting-screen quick-reply chips match the firm's in-scope Case Types in 100% of widget sessions — verifiable by end-to-end test comparing the chip list against the case_types table.
- **SC-004**: Zero accounts lose their out-of-scope response text as a result of the migration — verifiable by comparing stored values before and after the first save post-deploy for accounts that had data.
- **SC-005**: The Configuration page no longer contains any "Practice Areas" UI elements — verifiable by automated UI test or visual review.
- **SC-006**: Lawyers who previously relied on Practice Areas for quick-reply chips experience no visible disruption when their Case Types mirror their old Practice Areas list — the widget greeting screen continues to show the same chips.

## Assumptions

- **The out-of-scope response is promoted to the `guardrails` or `boundaries` config group, or as a standalone top-level field.** Exact placement is a design decision deferred to planning. The spec requires it is editable on the Configuration page and outside any `practice_areas` grouping.
- **The `/api/config` chip-list field is renamed from `practice_areas` to `in_scope_case_types`.** All widget consumers are updated as part of this feature. Old CDN-pinned widget versions that read `practice_areas` will receive `undefined` for that field after deploy; they will show no quick-reply chips on the greeting screen. This is an acceptable breaking change for old pinned bundles — the SOP flow itself is unaffected.
- **The read-time migration (FR-015) is sufficient for backwards compatibility.** No database migration script is required because existing config rows are JSON blobs; the schema migration is handled in code at read time.
- **Case Types are always configured before this feature ships for any active account.** Accounts with zero Case Types will see an empty chip list and an empty "Practice Areas" block in the system prompt — this is acceptable and is a pre-existing condition, not a regression.
- **The dashboard Preview Chat must also reflect the updated chip-list source.** When a lawyer uses Preview on the Configuration page, the preview widget must use in-scope Case Types for quick replies, not the legacy Practice Areas.
- **Existing widget installations (published via CDN or NPM) that pin an older widget version will continue to receive `practice_areas` in the API response.** The API field rename (if chosen in FR-008) must be additive or aliased to avoid breaking old bundles.

## Dependencies

- **Internal — Upstream**:
  - `007-dashboard`: Configuration page and its form/save infrastructure is the primary surface being modified.
  - `010-sop-workflow`: Case Types table (`case_types`, `sub_types`) is the data source driving the new behavior. The `getCaseTypes()` function already exists and is used by `/api/config`.
  - `005-chat-widget`: `ChatPanel.tsx` and `QuickReplies.tsx` consume the chip list from `/api/config`; the widget prop must be wired to the new data source.
- **Internal — Downstream**:
  - Any feature that reads `config.practice_areas.active` or `config.practice_areas.custom` at runtime must be audited and updated. Based on current investigation, only `system-prompt.ts` does this (and the legacy branch is being removed by this feature).

## Out of Scope

- **Migrating old Practice Areas values into Case Types**: Existing Practice Areas strings are NOT auto-converted into Case Type rows. Lawyers who want their old practice area labels available as SOP chips must re-enter them in the SOP → Case Types tab manually. This is acceptable because Case Types already exist and should already mirror what was in Practice Areas for active accounts.
- **Removing the `practice_areas` key from stored configuration rows**: Old JSON blobs are left as-is. Only the UI and runtime stop reading from them.
- **Changing the Case Types data model**: No new fields added to the `case_types` table. The existing `label`, `is_in_scope`, and `position` fields are sufficient.
- **Multi-language out-of-scope responses**: Post-MVP per constitution §10.
- **Analytics or audit trail for Practice Areas removal**: Not required.
