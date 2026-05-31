# Feature Specification: Fix SOP Case Sub-Type Chips

**Feature Branch**: `014-fix-sop-case-subtypes`

**Created**: 2026-05-25

**Status**: Draft

**Input**: User description: "There seems to be a problem in the sop workflow. When i answer the first question (how can i assist you today) with a chip selection of case type. Then the next follow up question is 'what kind of [case type] case is this?' in which im again seeing the same case type chips (dui, personal injury, drug crimes). What i expected in the sop requirment was to be asked the sub category of case with lets say personal injury or dui. We need to have corresponding sub types for a given case type for example if i select dui to the question how can i assist you today then the next question should be showing chips like - car accident, medical malpractice, product liability, workplace accident etc. Create a list of some default sub types within each case types configured right now in the system and the law firm should be able to edit this list from the dashboard."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visitor sees correct sub-type chips after picking a case type (Priority: P1)

A prospective client opens the chat widget on a law firm's website. The assistant asks "What kind of legal matter can we help you with?" and shows case-type chips (e.g., DUI, Personal Injury, Drug Crime). The visitor taps **DUI**. The assistant follows up with "What kind of DUI matter is this?" and the chip row now shows **sub-type chips for DUI** — for example *First Offense*, *Repeat Offense*, *DUI with Injury*, *DUI with Property Damage*. The chip row never re-shows the original case-type list (DUI, Personal Injury, Drug Crime) at this step.

**Why this priority**: This is the core defect blocking SOP intake quality. Without correct sub-type chips the assistant cannot collect the case sub-type and lawyers receive incomplete leads. Every other improvement depends on this working.

**Independent Test**: Open the chat widget, tap any case-type chip, and verify the chip row that renders for the next question contains only sub-types belonging to that case type (verified by label and by parent association). Repeat for every default case type.

**Acceptance Scenarios**:

1. **Given** the SOP is on Step 1 (case type) and the firm has the default case types configured, **When** the visitor taps the **DUI** chip, **Then** the next chip row shows exactly the sub-type chips configured under DUI (and zero case-type chips).
2. **Given** the SOP is on Step 1 and the visitor taps **Personal Injury**, **When** the assistant asks the sub-type question, **Then** the chip row shows the Personal Injury sub-types (e.g., Car Accident, Slip and Fall, Medical Malpractice, Dog Bite) and never any case-type label.
3. **Given** the visitor types "DUI" as free text instead of tapping a chip, **When** the message is processed, **Then** the case-type step is captured as DUI and the next chip row shows DUI sub-types — the visitor must not see case-type chips again.
4. **Given** the visitor changes their mind ("actually, it's a personal injury case"), **When** the correction is applied, **Then** the previously captured DUI sub-type is cleared and the chip row updates to show Personal Injury sub-types.

---

### User Story 2 - Default sub-types ship for every case type (Priority: P1)

A law firm signs up and accepts the default SOP configuration. Without doing any setup work, every default case type has a meaningful starter list of sub-types so the SOP works end-to-end out of the box and the firm sees a useful intake from day one.

**Why this priority**: Without defaults, every new firm hits the bug the user reported (empty sub-type list → broken Step 2). Defaults make the product usable without any configuration and serve as worked examples the firm can edit.

**Independent Test**: Provision a fresh account, do not edit any SOP configuration, open the chat widget, and walk through Step 1 → Step 2 for every default case type. Each must show at least 3 sub-type chips with sensible labels for that practice area.

**Acceptance Scenarios**:

1. **Given** a freshly created law-firm account with no customizations, **When** the dashboard's case-types editor is opened, **Then** every default case type shows a non-empty ordered list of sub-types.
2. **Given** the visitor walks through the SOP for any default case type, **When** they reach Step 2, **Then** at least three sub-type chips render and each is unambiguous (no duplicate slugs, no case-type labels).
3. **Given** a firm has previously been seeded only with case types but no sub-types, **When** the system runs its remediation pass, **Then** the firm's case types are filled in with the default sub-types for any matching slug, while custom case types and any existing customizations are left untouched.

---

### User Story 3 - Lawyer edits sub-types from the dashboard (Priority: P1)

A law-firm administrator opens the SOP editor in their dashboard, navigates to the Case Types tab, expands a case type, and edits the sub-type list — adding, renaming, reordering, or removing sub-types. The changes are saved and visitors immediately see the new sub-type chips on Step 2 of the SOP.

**Why this priority**: The user explicitly requested this capability. Defaults are only useful if lawyers can adapt them to the practice areas they actually handle. Without an editing surface the defaults become technical debt the firm cannot fix themselves.

**Independent Test**: As a logged-in admin, expand a case type in the Case Types tab, add a new sub-type, reorder the list, rename one, delete one, and save. Reload the page and confirm the changes persisted. Open the visitor widget in another browser and verify the new sub-type list is what the visitor sees.

**Acceptance Scenarios**:

1. **Given** the admin is on the Case Types tab and a case type is expanded, **When** they add a new sub-type with a unique label and save, **Then** the sub-type appears at the end of the list and is offered as a chip in the visitor widget on the next session.
2. **Given** the admin reorders sub-types via drag or up/down controls, **When** they save, **Then** the new ordering is persisted and visitor chips render in that order.
3. **Given** the admin renames a sub-type, **When** they save, **Then** the displayed label updates everywhere (chips, captured-lead summary) without orphaning previously captured leads that referenced the old slug.
4. **Given** the admin removes a sub-type that some past leads selected, **When** they save, **Then** the removal is allowed and historical leads continue to display the original sub-type label they were captured with.
5. **Given** the admin tries to add a sub-type whose label collides (case-insensitive) with an existing sub-type under the same case type, **When** they save, **Then** the system rejects the change with a clear validation error and no data is mutated.

---

### User Story 4 - Visitor flow stays correct when a case type has no sub-types (Priority: P2)

A law firm has intentionally cleared the sub-type list for one case type (e.g., Estate Planning has only one realistic flow). When a visitor picks that case type, the SOP MUST NOT show an empty chip row, MUST NOT re-show case-type chips, and MUST advance smoothly to the next step.

**Why this priority**: Edge case that follows directly from Story 3. The dashboard allows zero-sub-type configurations; the runtime must handle them gracefully so admins are never punished for valid customizations.

**Independent Test**: As an admin, delete every sub-type for one case type and save. As a visitor, start a new SOP session, tap that case type, and confirm Step 2 is skipped (the assistant moves directly to Step 3) and no broken or stale chip row is visible.

**Acceptance Scenarios**:

1. **Given** a case type has zero sub-types configured, **When** the visitor selects that case type, **Then** the SOP marks the sub-type step as skipped and the next assistant message asks the question for Step 3.
2. **Given** the same scenario, **When** the chip row is rendered between turns, **Then** no chips are visible at the moment Step 2 would have been asked (the row collapses) and the previous turn's chips do not linger.
3. **Given** the admin re-adds at least one sub-type later, **When** a new visitor session starts, **Then** Step 2 is asked again and chips render as expected.

---

### Edge Cases

- **Case type with no sub-types**: SOP skips Step 2 cleanly (see User Story 4); never displays an empty chip row or stale case-type chips.
- **Visitor types free text that matches a sub-type label but not a case type**: System infers the parent case type from the sub-type, captures both Step 1 and Step 2 in one turn, and advances to Step 3.
- **Visitor changes case type mid-flow**: Previously captured sub-type is cleared (because it belonged to the old case type) and the assistant re-asks Step 2 with chips for the new case type.
- **Visitor types a case-type label after Step 1 is already captured (e.g., "DUI" again at Step 2)**: System treats it as out-of-context noise, not a re-capture, and continues asking the sub-type question. (Existing correction-signal behavior is preserved: only explicit phrases like "actually" or "I meant" trigger re-capture.)
- **Stale captured value**: If a prior session captured a sub-type slug that the firm has since deleted, historical lead records display the original captured label; future SOP runs use only the current published sub-type list.
- **Widget cache lag**: When the firm publishes new sub-types, in-flight visitor sessions that already loaded the old configuration may continue with the old list until the next page load; new sessions immediately see the new list.
- **Label collisions**: Adding a sub-type with the same label (case-insensitive) as an existing one under the same parent is rejected; collisions across different parents are allowed.
- **Reordering during a live session**: A reorder published mid-session does not change the order shown to that session; new sessions see the new order.
- **Visitor selects a sub-type chip whose parent case type is `is_in_scope=false`**: Existing out-of-scope handling applies — the lead is marked out of scope and the SOP terminates with the configured goodbye phrase. (No change in behavior.)

## Requirements *(mandatory)*

### Functional Requirements

#### Visitor-facing chip behavior

- **FR-001**: When the SOP's pending step is the sub-type step and a case type has been captured for the visitor, the system MUST render exactly the sub-type chips configured under the captured case type, in the configured order.
- **FR-002**: When the SOP's pending step is the sub-type step, the chip row MUST NOT contain any case-type labels or any chips that are not children of the captured case type.
- **FR-003**: When the captured case type has zero configured sub-types, the system MUST automatically mark the sub-type step as skipped and advance the SOP to the next step without rendering an empty or stale chip row.
- **FR-004**: When no case type has yet been captured, the system MUST NOT render sub-type chips. (Sub-type chips never render before Step 1 is captured.)
- **FR-005**: When the visitor changes their case type via an explicit correction (existing correction-signal flow), and a sub-type was previously captured, the system MUST clear the prior sub-type capture and re-ask Step 2 with chips for the new case type.
- **FR-006**: The visitor follow-up question text MUST reference the captured case type by its display label (e.g., "What kind of DUI matter is this?") and MUST NOT contain raw template placeholders such as `{case_type}`.
- **FR-007**: Tapping a sub-type chip MUST capture the sub-type's slug (not its display label) into the SOP state, so downstream lead records, reporting, and integrations receive a stable identifier.

#### Default sub-type data

- **FR-008**: Every default case type that ships with a fresh account MUST include at least three default sub-types, each with a unique slug within that case type and a human-readable label appropriate to that practice area.
- **FR-009**: Default sub-type lists MUST cover the existing default case types currently configured in the system (DUI, Criminal Defense, Personal Injury, Family Law, Drug Crime, Estate Planning) and any case type that is part of the shipped defaults.
- **FR-010**: A new account provisioned after this feature ships MUST receive the default sub-types automatically without any manual setup step.
- **FR-011**: For existing accounts whose case-type entries match the default slugs but whose sub-type lists are empty, the system MUST run a one-time remediation that populates the missing default sub-types. Existing accounts that have already customized sub-types MUST NOT be overwritten.

#### Dashboard editing surface

- **FR-012**: Law-firm administrators MUST be able to view, add, rename, reorder, and remove sub-types under any case type from the SOP editor in the dashboard.
- **FR-013**: The editor MUST validate that sub-type labels are non-empty after trimming whitespace and that each sub-type's label is unique (case-insensitive) within its parent case type.
- **FR-014**: Saving sub-type changes MUST be atomic per case-type: a save either applies all of that case type's sub-type changes or none of them, with a clear error message on failure.
- **FR-015**: The editor MUST surface a clear warning indicator on any case type whose sub-type list is empty, communicating that visitors who pick that case type will skip Step 2.
- **FR-016**: Sub-type slug values MUST be derived deterministically from the label on creation (lowercase, whitespace and special characters normalized to underscores) and MUST remain stable across renames so historical leads that reference the slug are not broken.
- **FR-017**: Removing a sub-type that has been captured by past leads MUST be allowed and MUST NOT mutate any historical lead records — existing leads continue to display the originally captured label.
- **FR-018**: Authorization for editing sub-types MUST follow the existing dashboard permission model used for editing case types — no new role is introduced.

#### State, capture, and integration

- **FR-019**: The captured case-type value sent from the server to the widget MUST always be the case type's slug (never the label), so the widget can deterministically resolve the sub-type list for that case type.
- **FR-020**: After Step 1 is captured, the next response from the assistant MUST include an updated SOP state header indicating that the sub-type step is now pending and identifying the captured case-type slug.
- **FR-021**: The widget MUST clear or replace the previous chip row whenever the pending SOP step changes, so chips from a prior step never persist visually into the next step.
- **FR-022**: Captured sub-type values MUST be included in lead records with both their slug and the human-readable label that was current at capture time (label snapshot), so downstream displays remain meaningful even after later edits or deletions.

### Key Entities *(include if feature involves data)*

- **Case Type**: A top-level practice area the firm handles (e.g., DUI). Has a label, a stable slug, an ordered position, an in-scope flag, and a list of Sub-Types. Already exists; this feature does not change its shape.
- **Sub-Type**: A child category of a Case Type (e.g., "First Offense" under DUI). Has a label, a stable slug unique within its parent, and an ordered position. Already exists in the data model; this feature ensures it is populated by default and editable from the dashboard, and that it drives the visitor chip row correctly.
- **SOP Step (sub-type step)**: The second SOP step whose chip source is bound to the Sub-Type list of the captured Case Type. Already exists; this feature corrects how its chips are computed and rendered.
- **Captured Case Type Slug**: The runtime value stored on the SOP state once Step 1 completes, used by the widget to look up the correct Sub-Type list. Must always be a slug, never a label.
- **Lead Record**: When a lead is captured, it includes both the sub-type slug and a snapshot of the sub-type label as it appeared at capture time, so historical reporting survives later edits.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the fix, 100% of visitor sessions that select a case type with at least one configured sub-type see sub-type chips on Step 2 (zero sessions see case-type chips re-rendered at Step 2).
- **SC-002**: 100% of newly provisioned law-firm accounts have at least three sub-types per default case type immediately after sign-up, with no manual configuration required.
- **SC-003**: At least 95% of leads captured after the fix include a non-empty sub-type value (compared with the pre-fix baseline where Step 2 chips were broken), measured over the first 30 days post-launch.
- **SC-004**: A law-firm administrator can add, reorder, rename, and remove sub-types for a case type and have those changes reflected in the visitor widget in under 60 seconds, end to end (excluding any in-flight visitor sessions that loaded the prior configuration).
- **SC-005**: Zero visitor-facing chip rows display an empty chip set when the SOP is mid-flow (the row either contains chips for the current step or is hidden cleanly when no chips apply).
- **SC-006**: For accounts in the existing-customer remediation pass (FR-011), 100% of case types that match a default slug have at least three sub-types after the migration, and zero customer customizations are overwritten.
- **SC-007**: Support tickets or in-app feedback referencing "the chatbot keeps showing the same options" or equivalent drop to zero in the 30 days following launch.

## Assumptions

- The existing data model already supports sub-types (table, schema, dashboard tab); the fix does not introduce new entities, only ensures defaults exist, the runtime renders chips correctly, and validation/UX gaps are closed.
- The list of "default case types currently configured" referenced by the user means the six defaults that ship today: DUI, Criminal Defense, Personal Injury, Family Law, Drug Crime, Estate Planning. Default sub-type labels for each are chosen as common, plain-language sub-categories appropriate for that practice area in the U.S. legal market and are intended as a starting point for firms to edit.
- The "law firm should be able to edit this list from the dashboard" capability already exists as a UI surface on the SOP editor's Case Types tab; this feature treats existing gaps (validation rules, empty-list warnings, save atomicity) as in-scope improvements but does not relocate or redesign the tab.
- Existing authorization, audit logging, and SOP publish/preview flows apply to sub-type edits without modification.
- The user's screenshot showing only "DUI, Personal Injury, Drug Crimes" reflects a configuration where some defaults were trimmed, or a remediation gap on a previously-seeded account; the spec covers both fresh provisioning and remediation.
- The visitor follow-up question text rendering ("What kind of DUI matter is this?") is produced by the assistant and is expected to substitute the captured case-type label for any placeholder; the chip row's correctness is independent of the question wording.
- Out-of-scope handling, goodbye phrases, qualified-lead threshold logic, and the contact-form step are unchanged by this feature.
- Mobile and desktop chat widget surfaces share the same chip-rendering logic; no platform-specific work is required.

## Dependencies

- Existing SOP runtime (skip detector, advancer, state machine) — no new components introduced; behavior corrected within them.
- Existing dashboard SOP editor and Case Types tab — extended with empty-list warning and validation refinements.
- Existing default-seed pipeline used by new-account provisioning — extended to ensure sub-types are always seeded alongside their parent case types.
- Database migration capability for the one-time existing-account remediation (FR-011).

## Out of Scope

- Adding more than three default sub-types per case type beyond what is sufficient for an out-of-the-box experience (firms are expected to customize).
- Localization of default sub-type labels into non-English languages.
- Bulk import/export of case types and sub-types from CSV or other formats.
- Per-state or per-jurisdiction sub-type variations.
- Analytics dashboards reporting on sub-type distribution (covered by existing lead reporting features once sub-types are reliably captured).
- Re-architecting the SOP step engine or chip-rendering pipeline beyond what is required to make sub-type chips render correctly.
