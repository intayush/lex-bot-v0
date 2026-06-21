# Data Model: Version History UI

**Feature**: 022-version-history-ui · **Date**: 2026-06-21

No new tables. Two existing tables gain one nullable column each, and `configurations` gains a unique constraint.

---

## Schema changes

### `configurations` table

**Add column**: `label text` (nullable, default null)

```sql
ALTER TABLE configurations ADD COLUMN label text;
```

**Add unique index**:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS configurations_account_version_unique
  ON configurations (account_id, version);
```

**Full column set after migration**:

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | text | NOT NULL | PK, nanoid |
| account_id | text | NOT NULL | FK → accounts.id |
| version | integer | NOT NULL | Incremented per save |
| config_json | text | NOT NULL | Full config blob |
| is_published | boolean | NOT NULL | At most one true per account |
| created_at | text | NOT NULL | ISO timestamp |
| **label** | **text** | **YES** | **New — human-readable name ≤80 chars** |

---

### `sop_configurations` table

**Add column**: `label text` (nullable, default null)

```sql
ALTER TABLE sop_configurations ADD COLUMN label text;
```

Unique constraint `sop_configurations_account_version_unique` already exists — no change needed.

**Full column set after migration**:

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | text | NOT NULL | PK, nanoid |
| account_id | text | NOT NULL | FK → accounts.id |
| version | integer | NOT NULL | Incremented per save |
| qualified_lead_threshold | integer | NOT NULL | Default 5 |
| is_published | boolean | NOT NULL | At most one true per account |
| derived_from_legacy | boolean | NOT NULL | Migration flag |
| created_at | text | NOT NULL | ISO timestamp |
| **label** | **text** | **YES** | **New — human-readable name ≤80 chars** |

---

## In-memory shapes (API layer)

### ConfigVersionSummary

Returned by `GET /api/dashboard/config` and used to populate the version history list.

```typescript
interface ConfigVersionSummary {
  id: string;
  version: number;
  label: string | null;
  is_published: boolean;
  created_at: string; // ISO 8601
}
```

### SopVersionSummary

Already returned by `GET /api/dashboard/sop` in the `history` array. Gains `label` after migration.

```typescript
interface SopVersionSummary {
  id: string;
  version: number;
  label: string | null;        // NEW
  is_published: boolean;
  created_at: string;          // ISO 8601
  step_count: number;          // Derived: count of sopSteps for this config id
}
```

---

## No new tables

| Considered | Rejected because |
|---|---|
| `version_labels` table | Label is simple metadata on the version row; a join for every list fetch is unnecessary overhead |
| Label history log | Only the current label matters; past label values have no user value |

---

## Migration safety

- Both changes are additive (nullable column + index on existing data).
- No existing rows are modified.
- The unique index on `configurations(account_id, version)` is safe because the route layer already enforces monotonic version increments — no existing duplicates can exist in practice.
- Drizzle migration uses `IF NOT EXISTS` guard on the unique index.
