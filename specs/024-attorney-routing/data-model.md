# Data Model: Attorney Management & Hot Lead Email Routing

**Feature**: 024-attorney-routing · **Date**: 2026-06-21

---

## New Tables

### `attorneys`

Per-account attorney roster.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | text | NOT NULL | PK, nanoid |
| account_id | text | NOT NULL | FK → accounts.id |
| name | text | NOT NULL | Display name e.g. "Sarah Kim Esq." |
| email | text | NOT NULL | Validated email; unique per account |
| mobile | text | YES | Optional; stored for future SMS routing |
| created_at | text | NOT NULL | ISO 8601 |
| updated_at | text | NOT NULL | ISO 8601 |

**Constraints**:
- `UNIQUE (account_id, email)` — no duplicate emails within a firm

---

### `attorney_case_type_assignments`

Many-to-many join: which case types an attorney handles.

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| id | text | NOT NULL | PK, nanoid |
| attorney_id | text | NOT NULL | FK → attorneys.id (cascade delete) |
| account_id | text | NOT NULL | FK → accounts.id (for scoped queries without join) |
| case_type_slug | text | NOT NULL | Matches case_types.slug for the account |
| created_at | text | NOT NULL | ISO 8601 |

**Constraints**:
- `UNIQUE (attorney_id, case_type_slug)` — no duplicate assignment
- Cascade delete from `attorneys` (when attorney is deleted, their assignments are removed)

**Why `case_type_slug` not `case_type_id`**: The lead's `case_type` column already stores the slug string. Matching by slug avoids a join at routing time and is resilient to case_type row re-creation.

---

## Modified Tables

### `notifications` — add `attorney_id`

The existing `notifications` table serves as the email queue. A new nullable FK allows email-channel rows to reference the specific attorney the email is addressed to.

**New column**:

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| attorney_id | text | YES | FK → attorneys.id; null for dashboard-channel rows |

**Email queue row shape**:
```
type          = 'attorney_lead_routing'
delivery_channel = 'email'
delivered_at  = null   (pending)  OR  ISO timestamp (sent)
attorney_id   = '<attorney_id>'
lead_id       = '<lead_id>'
title         = 'New HOT lead: {case_type}'
body          = JSON-encoded email payload
```

---

## In-Memory Shapes (API Layer)

### `Attorney`

```typescript
interface Attorney {
  id: string;
  account_id: string;
  name: string;
  email: string;
  mobile: string | null;
  case_type_slugs: string[];   // derived from attorney_case_type_assignments
  created_at: string;
  updated_at: string;
}
```

### `RoutingNotificationPayload` (stored in `notifications.body`)

```typescript
interface RoutingNotificationPayload {
  lead_id: string;
  account_id: string;
  attorney_id: string;
  attorney_name: string;
  attorney_email: string;
  lead_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_case_type: string;        // slug e.g. "dui"
  lead_case_type_label: string;  // human-readable e.g. "DUI"
  lead_description: string | null;
  captured_at: string;
}
```

---

## Entity Relationships

```
accounts
  └── attorneys (1:N, scoped by account_id)
        └── attorney_case_type_assignments (1:N, cascade delete)

attorneys ←→ case_types (M:N via attorney_case_type_assignments, linked by case_type_slug)

leads
  └── notifications (1:N, via lead_id FK)
        └── attorneys (via attorney_id FK, nullable)
```

---

## Migration Safety

- Both new tables are additive.
- `notifications.attorney_id` is nullable — no existing rows are affected.
- `attorney_case_type_assignments` uses `ON DELETE CASCADE` from `attorneys` — clean deletion.
