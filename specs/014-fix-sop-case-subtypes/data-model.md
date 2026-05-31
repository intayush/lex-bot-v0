# Phase 1 Data Model — 014 Fix SOP Case Sub-Type Chips

**Date**: 2026-05-25
**Branch**: `014-fix-sop-case`

This feature is principally a runtime + validation fix. **No new database
tables and no new database columns are introduced.** The only data-shape
change lives in the in-memory / JSON-serialized `SOPState`, which is
persisted today as `text` JSON in `chat_sessions.sop_state_json` and in
`leads.sop_state_snapshot`.

## Existing Entities (no change)

The following entities are referenced unchanged. Their schemas live in
`packages/api/src/db/schema.ts` and the corresponding Zod definitions in
`packages/shared/src/schemas/`.

### `case_types`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Account-scoped |
| `account_id` | text → `accounts.id` | FK |
| `slug` | text | Unique per account; format `^[a-z][a-z0-9_]*$` |
| `label` | text | Human-readable display name |
| `position` | integer | Ordering for chip row |
| `is_in_scope` | boolean | If false, picking this case type marks the lead out-of-scope |
| `created_at` | text | ISO 8601 |

Unchanged. Drives Step 1 chip rendering and the parent of `sub_types`.

### `sub_types`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | Account-scoped via parent |
| `case_type_id` | text → `case_types.id` | FK |
| `slug` | text | Unique per parent; format `^[a-z][a-z0-9_]*$` |
| `label` | text | Human-readable display name |
| `position` | integer | Ordering for chip row |
| `created_at` | text | ISO 8601 |

Unchanged. Drives Step 2 chip rendering. New validation rules in this
feature (label uniqueness, slug-from-label derivation) are enforced at
the application layer, not via new DB constraints.

### `sop_steps`

Step rows for the published SOP per account. The `case_type` and
`sub_type` steps are seeded as `is_default: true` with `chip_source:
'case_types'` and `'sub_types'` respectively. Unchanged here.

## State-Shape Extensions (in-memory only)

### `SOPStateStep` (Zod schema in `packages/shared/src/schemas/sop.ts`)

**Existing shape**:

```ts
{
  step_id: string;
  slug: string;
  position: number;
  status: 'pending' | 'complete' | 'skipped' | 'reset';
  captured_value: string | null;
  captured_at_iso: string | null;
  inferred: boolean;
}
```

**New optional field**:

| Field | Type | When set | Purpose |
|-------|------|----------|---------|
| `captured_label` | `string \| null` (optional, defaults to `null`) | Set by `matchCaseTypeChip`, `matchSubTypeChip`, and the `inferCaseTypeFromSubType` emission path in `skip-detector.ts` whenever a slug-bearing chip is matched. Left `null` for free-text captures (where there is no canonical label) and for steps with `chip_source === null`. | Preserves the human-readable label as it appeared at capture time so leads remain meaningful even after later renames or deletions (FR-022). |

**Backward compatibility**: the field is optional and defaults to `null`,
so existing serialized states (already in `chat_sessions.sop_state_json`
or `leads.sop_state_snapshot`) parse cleanly without migration. Any
SOPState produced by old code or replayed from the database simply has
`captured_label: null` for previously captured steps; rendering code
falls back to looking up the live label by slug when the snapshot label
is null (which preserves existing behavior).

### `SOPStateHeaderPayload` (chat-response header)

Extended with a single new field. Today (`packages/shared/src/schemas/sop.ts:213-227`):

```ts
{
  total_steps: number;
  current_progress: number;
  is_finalized: boolean;
  qualified_lead_threshold: number;
  pending_step_slug: string | null;
  captured_case_type_slug: string | null;
}
```

**New field**:

| Field | Type | When set | Purpose |
|-------|------|----------|---------|
| `captured_case_type_label` | `string \| null` | Mirrors `captured_case_type_slug`: set when the `case_type` step is `complete`. Computed server-side by joining the captured slug against the live `caseTypes` array. | Lets the widget render the question text correctly (FR-006) and the progress bar's "Picked: DUI" affordances without a second client-side lookup. |

**Backward compatibility**: optional new field; widgets that don't read
it ignore it. Older widget bundles continue to work.

## Validation Rules (application-layer)

Implemented in `packages/api/src/lib/sop/case-types-diff.ts` (server-side
authoritative) and in `packages/api/src/app/dashboard/sop/case-types-tab.tsx`
(client-side mirroring for UX).

### Sub-type input (FR-013, FR-016)

- **Label**: trimmed; non-empty after trim; `≤ 80 chars`.
- **Slug**: derived from the trimmed label using the rule: lowercase →
  ASCII-fold → replace non-`[a-z0-9]` runs with `_` → strip leading
  digits → assert against `^[a-z][a-z0-9_]*$`. If derivation fails, the
  add is rejected with a user-facing error; the admin must edit the
  label to produce a valid slug.
- **Slug uniqueness** (per parent): existing rule, unchanged.
- **Label uniqueness** (per parent): NEW — case-insensitive comparison
  against all other sub-types under the same parent. Comparison uses
  Unicode `toLocaleLowerCase('en-US')` followed by trim.
- **Slug stability on rename**: editing a sub-type's label does NOT
  re-derive the slug. The slug is locked at create time so historical
  leads referencing it stay resolvable. Renaming is a label-only edit.

### Case-type input

Same rules apply at the case-type level for symmetry, though the spec
does not explicitly require them — they fall out of the same validation
helper. No new behavior change for case types beyond what the existing
schema already requires.

## State Transitions

### Auto-skip on empty sub-types (FR-003)

```text
[case_type captured]
        │
        ▼
 advanceForVisitorMessage applies capture
        │
        ▼
 NEW: lookup ct = caseTypes.find(slug === captured)
        │
        ▼
 ct.sub_types.length === 0 ?
        │
   yes ─┴─ no
   │      │
   │      └──► no change; sub_type step remains pending
   │
   ▼
 dispatch { type: 'skip_step', step_id: <sub_type step id> }
        │
        ▼
 applySkip:
   • set status = 'skipped'
   • IF counts_toward_threshold: increment current_progress
        │
        ▼
 autoFinalizeIfReady (existing) — fires if thresholds now satisfied
```

Skip is dispatched only when the case_type step transitioned from
pending→complete in the same advancer turn; it is not retroactively
applied if sub_types is cleared mid-session for an already-pending
sub-type step (out of scope per spec edge cases).

### Capture with label snapshot

```text
chip tap arrives ("DUI")
        │
        ▼
matchCaseTypeChip: lower === ct.slug || lower === ct.label.toLowerCase()
        │
        ▼
 NEW: emit captured_label: ct.label
       (was: emitted only captured_value: ct.slug)
        │
        ▼
state machine writes both fields onto the SOP state step
```

Same shape applies in `matchSubTypeChip` (st.label) and in the
`inferCaseTypeFromSubType` path (looks up ct.label after resolving the
parent).

## Out-of-Scope Data Model Concerns

- **Lead schema**: no changes. The label snapshot rides inside
  `sop_state_snapshot` JSON.
- **Lead reporting / dashboard sub-type column**: out of scope for this
  feature (would benefit from the snapshot but is its own work).
- **Multi-language sub-type labels**: out of scope (spec assumption).
- **Per-jurisdiction sub-type variations**: out of scope (spec
  assumption).
- **Bulk import/export of case-types/sub-types**: out of scope (spec
  assumption).
