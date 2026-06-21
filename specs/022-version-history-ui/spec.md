# Feature Specification: Version History UI

**Feature Branch**: `022-version-history-ui`

**Created**: 2026-06-21

**Status**: Draft

## User Scenarios & Testing

### User Story 1 — Browse and restore a past configuration version (Priority: P1)

A lawyer has saved and published several versions of their firm configuration over time. They want to roll back to how their chatbot looked last month — before a recent persona change. They open the Configuration page, view the version history list, and click "Restore" on an older version. A new draft is created with that version's content and they can review it before publishing.

**Why this priority**: Restoring a version is the core value proposition. Without it the version list is read-only and of limited utility.

**Independent Test**: On an account with ≥2 saved configuration versions, navigate to the version history panel, click "Restore" on a non-current version, and confirm a new draft is created with the same content as the restored version.

**Acceptance Scenarios**:

1. **Given** a lawyer has at least two saved configuration versions, **When** they open the Configuration page, **Then** a version history list shows all saved versions ordered newest-first, each showing version number, label (if set), save date, and published status.
2. **Given** the version list is visible, **When** the lawyer clicks "Restore" on any version, **Then** a new draft is created with that version's content and the lawyer is taken to the configuration editor with the restored draft loaded.
3. **Given** a restored draft exists, **When** the lawyer reviews and publishes it, **Then** the live chatbot reflects the restored configuration and a new version entry appears in the history.

---

### User Story 2 — Browse and restore a past SOP version (Priority: P1)

A lawyer wants to review changes to their intake SOP workflow over time. They open the SOP editor, view the SOP version history, and can see each version's question count, creation date, and label. They restore a previous SOP version as a new draft.

**Why this priority**: SOP changes directly affect lead-qualification behaviour. Accidental SOP changes are at least as damaging as config changes, so SOP restore has equal priority.

**Independent Test**: On an account with ≥2 saved SOP versions, navigate to the SOP version history panel, click "Restore" on a non-current version, and confirm a new SOP draft is created with the restored steps.

**Acceptance Scenarios**:

1. **Given** a lawyer has at least two saved SOP versions, **When** they open the SOP page, **Then** a version history list shows all saved SOP versions ordered newest-first with version number, label, save date, step count, and published status.
2. **Given** the SOP version list is visible, **When** the lawyer clicks "Restore" on any version, **Then** a new SOP draft is created with that version's steps and the lawyer is taken to the SOP editor with the restored draft loaded.

---

### User Story 3 — Name a version for easy identification (Priority: P2)

A lawyer wants to tag the version they are about to save as "Summer 2026 Campaign" so they can find it quickly later. They enter a label either in a save dialog or inline on the version history list after the fact.

**Why this priority**: Labels improve usability of the version list but the feature is fully usable without them (version number + date is sufficient for identification).

**Independent Test**: On the Configuration page, save a new draft, enter a label "Test Label" either at save time or by editing inline on the version list, confirm the label appears in the version history list.

**Acceptance Scenarios**:

1. **Given** a lawyer is saving a draft, **When** an optional label field is present in the save flow, **Then** they can type a label (≤80 characters) and it is saved with the version.
2. **Given** a version in the history list has no label or the lawyer wants to change it, **When** they click the label cell, **Then** it becomes an editable text field; saving the edit persists the new label immediately without a page reload.
3. **Given** a label is set, **When** the version list is displayed, **Then** the label appears in the version row alongside the version number and date.

---

### Edge Cases

- What happens when an account has only one version? The version history panel shows that single entry with no "Restore" button (there is nothing to restore to).
- What happens when the restore action fails (network error)? The draft is not created and the lawyer sees an error message. The existing draft is unchanged.
- What if a label exceeds the character limit? The input trims or rejects input beyond 80 characters with a visible character counter.
- What if the lawyer restores a very old version whose SOP steps reference case-type slugs that no longer exist in the catalog? The draft is created as-is; the lawyer sees the content and can edit before publishing. No silent data loss.
- What happens if the lawyer clicks "Restore" while a draft is already pending? The restore creates a new additional draft (append-only versioning); the existing pending draft is not overwritten.

---

## Requirements

### Functional Requirements

**Configuration version history**

- **FR-001**: The configuration editor page MUST display a version history panel listing all saved versions for the account.
- **FR-002**: Each version entry MUST show: version number, label (empty if unset), creation date, and published status (Published / Draft).
- **FR-003**: The version list MUST be ordered newest-first.
- **FR-004**: Each version entry MUST include a "Restore" action that creates a new configuration draft with that version's content.
- **FR-005**: The "Restore" action MUST NOT be shown for the version that is already the current draft (the most recently saved version).
- **FR-006**: A lawyer MUST be able to set a label (up to 80 characters) on any configuration version at save time or by editing inline on the history list.
- **FR-007**: The label field MUST be optional; unlabelled versions display their version number and date only.
- **FR-008**: Editing a label inline MUST persist immediately on blur or Enter key without requiring a separate save action.

**SOP version history**

- **FR-009**: The SOP editor page MUST display a version history panel listing all saved SOP versions for the account.
- **FR-010**: Each SOP version entry MUST show: version number, label (empty if unset), creation date, step count, and published status.
- **FR-011**: Each SOP version entry MUST include a "Restore" action that creates a new SOP draft with that version's steps, case types, and goodbye phrases.
- **FR-012**: The "Restore" action for SOP MUST NOT be shown for the most recently saved version.
- **FR-013**: A lawyer MUST be able to set a label on any SOP version using the same inline editing pattern as configuration (FR-006–FR-008).

**Shared behaviour**

- **FR-014**: Restoring any version MUST result in a new version row being appended; it MUST NOT overwrite the historical version being restored.
- **FR-015**: After a successful restore, the lawyer MUST be taken to the editor with the restored draft loaded and ready to edit or publish.
- **FR-016**: The version history panel MUST be visible alongside the editor (not require navigating away).

### Key Entities

- **Configuration version**: A point-in-time snapshot of a firm's persona, contact info, and theme settings. Identified by account + version number. Has an optional human-readable label and a published flag.
- **SOP version**: A point-in-time snapshot of a firm's intake workflow — steps, qualified-lead threshold, case types, and goodbye phrases. Identified by account + version number. Has an optional label and a published flag.
- **Version label**: A short human-readable name (≤80 characters) attached to a version to aid identification. Optional; can be set or changed at any time without creating a new version.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A lawyer can identify and restore a previous configuration version in under 60 seconds from the configuration editor page.
- **SC-002**: A lawyer can identify and restore a previous SOP version in under 60 seconds from the SOP editor page.
- **SC-003**: After clicking "Restore", a new draft is available in the editor within 3 seconds under normal network conditions.
- **SC-004**: Version history lists correctly show all saved versions for an account with no missing or duplicated entries.
- **SC-005**: Inline label edits persist within 2 seconds of the lawyer committing the change (blur or Enter).
- **SC-006**: Restoring a version never modifies any historical version row — all prior versions remain unchanged after a restore operation.

---

## Assumptions

- Version history is a read-only audit of everything saved through the dashboard UI. Versions created by the seed/migration scripts are included.
- Labels are stored on the version row itself (not a separate table); no label history is needed — only the latest label for a version is stored.
- Version history is account-scoped: a lawyer only sees versions for their own account.
- Deleting individual historical versions is out of scope for this feature.
- Diff view (comparing two versions side-by-side) is out of scope for this feature.
- The maximum number of versions per account is not capped by this feature; the UI handles long lists with pagination or scroll as appropriate.
- Config and SOP versions are displayed separately because they version independently and have different fields.
- This feature touches `packages/api` (backend endpoints + dashboard UI) only; `packages/widget` is unaffected.
