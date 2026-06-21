# Phase 0 — Research: Version History UI

**Feature**: 022-version-history-ui · **Date**: 2026-06-21

---

## R1 — Config restore backend pattern

**Decision**: Implement `POST /api/dashboard/config` with `action: 'restore'` that reads the target version's `config_json` and inserts a new row at `maxVersion + 1` with `is_published = false`.

**Rationale**: The SOP route already has `action: 'rollback'` (route.ts lines 229-294) that does exactly this for SOP. Config restore is structurally identical: SELECT the source row's JSON, INSERT a new row with incremented version. No child rows need duplication for config (unlike SOP's `sopSteps`) because the entire config lives in a single `config_json` blob.

**Alternatives considered**: Reusing the existing `action: 'save'` with the restored content passed as the body — rejected because it requires the client to fetch the old config first, making restore a two-round-trip operation. A dedicated `restore` action is one round-trip.

---

## R2 — Label storage

**Decision**: Add a nullable `text` column `label` directly to `configurations` and `sop_configurations`. Max 80 characters enforced at the route layer (Zod `.max(80).optional()`). Label updates use a dedicated `PATCH` endpoint that issues a targeted `UPDATE` without creating a new version.

**Rationale**: Labels are metadata on the version row, not a new version of content. Storing them inline avoids a join and keeps queries simple. A separate label history is not needed — only the current label matters.

**Alternatives considered**: Separate `version_labels` table — rejected as over-engineering for a simple metadata field. Using the save action to update labels — rejected because it would create a new version row every time a label is edited.

---

## R3 — `configurations` unique constraint

**Decision**: Add `uniqueIndex('configurations_account_version_unique').on(table.account_id, table.version)` via a Drizzle migration.

**Rationale**: `sop_configurations` already has this constraint (schema.ts line 174). Without it, the `configurations` table allows duplicate (account_id, version) pairs at the DB level — a latent data integrity gap. The `getMaxVersion()` + increment pattern at the route layer prevents duplicates in practice, but the DB constraint is the right safety net.

**Risk**: None on the Neon dev DB (seed always deletes and re-inserts from v1). In production, the `configurations` table is also append-only from v1 per account, so no existing duplicates. The migration adds the constraint with `IF NOT EXISTS` safety.

---

## R4 — SOP restore scope

**Decision**: SOP restore (`action: 'rollback'`) duplicates only `sopSteps`. Case types, goodbye phrases, and branches are NOT duplicated.

**Rationale**: `sop_steps` has `sop_configuration_id` as a foreign key — each step belongs to exactly one SOP version. To restore an old version, you need a new config row and new step rows pointing to it. The existing rollback handler (route.ts lines 274-290) already does this correctly.

`caseTypes`, `subTypes`, `goodbyePhrases`, and `branches` all FK to `account_id`, not to `sop_configuration_id`. They are account-scoped and shared across all SOP versions. Restoring an old SOP does not and should not change the current case-type catalog.

---

## R5 — Config GET history endpoint

**Decision**: Add a `GET /api/dashboard/config` handler that returns `{ versions: ConfigVersionSummary[] }` ordered by version DESC.

**Rationale**: The config route currently has no GET. The SOP GET already returns history. Config needs the same pattern. Each summary row: `{ id, version, label, is_published, created_at }` — enough to populate the history list per FR-002.

**Field selection**: `config_json` is NOT included in the list response (it can be large; the restore action fetches it separately server-side).

---

## R6 — UI placement

**Decision**: Add a collapsible "Version History" panel rendered below the editor form, inside the existing left column of the 3-column page layout. On small screens it stacks below the form.

**Rationale**: The config and SOP pages use a `lg:grid-cols-3` layout with the editor in `lg:col-span-2` and the preview pane in `lg:col-span-1`. Adding the history panel as a new section below the editor form keeps the preview pane intact and avoids redesigning the page layout.

**Component**: A single shared `VersionHistory` client component parameterised by type (`'config' | 'sop'`) to keep the UI DRY. It fetches its own data (SWR-style `useEffect` on mount) so it doesn't block the page's server-side render.

---

## Open questions remaining

None. All items resolved above. Ready to proceed to Phase 1 contracts and data model.
