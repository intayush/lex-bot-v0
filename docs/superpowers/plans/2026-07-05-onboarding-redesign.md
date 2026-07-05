# Onboarding Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the tenant onboarding wizard to a 3-step flow (firm details → case-type matrix → attorneys with sub-type assignment), where the matrix selection drives a subset SOP v1, with silent autosave and smooth transitions.

**Architecture:** Extend `accounts` with a display-only `domain` column and `attorney_case_type_assignments` with a `sub_type_slug` column (migration `0011`). Teach `seedSopForAccount` to accept an optional case-type/sub-type selection so only chosen entries + their default branches are created. Reshape `wizardSubmissionSchema`, `buildDraftFromWizard`, and the onboarding route to the new inputs; rewrite the wizard page as a 3-step animated flow. Attorney sub-type assignment extends the existing attorney lib and routing (spec 024) with case-type fallback.

**Tech Stack:** TypeScript (strict), Next.js 15 App Router (Route Handlers only), Drizzle ORM (`neon-http` prod, `better-sqlite3` test), Zod (`packages/shared`), Vitest, React 19, bcryptjs, nanoid.

## Global Constraints

- TypeScript strict; Node 20+. No new npm packages.
- All cross-boundary data validated via Zod in `packages/shared`.
- Route Handlers only — no Server Actions.
- DB access via Drizzle. IDs = `text` + `nanoid()`. Timestamps = ISO-string `text` columns.
- Imports in `packages/api/src` are EXTENSIONLESS (moduleResolution: bundler) — Next webpack requires it. Never add `.js` to relative imports.
- Every new table/column MUST be mirrored in `packages/api/src/db/test-schema.ts` AND in each affected test's hand-written `CREATE TABLE` SQL.
- Next migration number is **`0011`** (0010 is the last applied).
- Domain field is DISPLAY-ONLY — no CORS/origin enforcement (constitution wildcard-CORS unchanged).
- All existing tests (748) must stay green after every task.
- Spec: `docs/superpowers/specs/2026-07-05-onboarding-redesign-design.md`.

---

## File Structure

**Migrations**
- Create: `packages/api/drizzle/0011_*.sql` (generated via `db:generate`)

**Schema**
- Modify: `packages/api/src/db/schema.ts` — `accounts.domain`; `attorneyCaseTypeAssignments.sub_type_slug` + revised unique index
- Modify: `packages/api/src/db/test-schema.ts` — mirror both

**Shared schemas**
- Modify: `packages/shared/src/schemas/admin.ts` — reshape `wizardSubmissionSchema`, `REQUIRED_WIZARD_SECTIONS`

**Seeding**
- Modify: `packages/api/src/db/seed.ts` — `seedSopForAccount(accountId, options?)` subset support

**Attorney lib + routing**
- Modify: `packages/api/src/lib/attorneys.ts` — sub-type-aware create + `getAttorneysForSubType`
- Modify: `packages/api/src/lib/attorney-routing.ts` — sub-type routing with case-type fallback

**Onboarding provisioning + route**
- Modify: `packages/api/src/lib/admin/tenant-provisioning.ts` — new `buildDraftFromWizard`, selection-aware `seedSopAndBranches`, attorney provisioning, required-section logic
- Modify: `packages/api/src/app/api/admin/tenants/[id]/onboarding/route.ts` — persist domain, seed selection, provision attorneys
- Modify: `packages/api/src/app/api/admin/tenants/route.ts` — store domain on register (optional)

**Wizard UI**
- Modify: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/page.tsx` — 3-step animated flow
- Create: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/case-matrix.tsx` — matrix step component
- Create: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/attorneys-step.tsx` — attorneys step component

**Data source for matrix**
- Modify: `packages/shared/src/index.ts` (+ new `packages/shared/src/constants/default-case-types.ts`) — expose the default case-type/sub-type matrix to the client (labels + slugs only)

---

## Task 1: Expose the default case-type matrix to the client

The wizard matrix needs the 6 case types × sub-types (slug + label) on the client. Today `DEFAULT_CASE_TYPES` lives in `packages/api/src/db/seed-defaults/sop.ts` (server-only, imports validation). Extract a plain data copy into `packages/shared` so both the client wizard and the server can read it.

**Files:**
- Create: `packages/shared/src/constants/default-case-types.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/constants/default-case-types.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CASE_TYPE_MATRIX: ReadonlyArray<{ slug: string; label: string; position: number; subTypes: ReadonlyArray<{ slug: string; label: string; position: number }> }>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/constants/default-case-types.test.ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CASE_TYPE_MATRIX } from './default-case-types.js';

describe('DEFAULT_CASE_TYPE_MATRIX', () => {
  it('has the 6 canonical case types', () => {
    expect(DEFAULT_CASE_TYPE_MATRIX.map((c) => c.slug)).toEqual([
      'dui', 'criminal_defense', 'personal_injury', 'family_law', 'drug_crime', 'estate_planning',
    ]);
  });
  it('personal_injury includes car_accident sub-type', () => {
    const pi = DEFAULT_CASE_TYPE_MATRIX.find((c) => c.slug === 'personal_injury')!;
    expect(pi.subTypes.map((s) => s.slug)).toContain('car_accident');
  });
  it('every case type has at least 3 sub-types', () => {
    for (const ct of DEFAULT_CASE_TYPE_MATRIX) {
      expect(ct.subTypes.length).toBeGreaterThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm vitest run src/constants/default-case-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the constant**

Create `packages/shared/src/constants/default-case-types.ts` with the full matrix (values copied verbatim from `seed-defaults/sop.ts`):

```typescript
/**
 * Client-safe copy of the default case-type/sub-type matrix used by the
 * onboarding wizard. Slugs/labels MUST match the server DEFAULT_CASE_TYPES in
 * packages/api/src/db/seed-defaults/sop.ts (kept in sync by the parity test in
 * packages/api).
 */
export interface MatrixSubType { slug: string; label: string; position: number }
export interface MatrixCaseType { slug: string; label: string; position: number; subTypes: readonly MatrixSubType[] }

export const DEFAULT_CASE_TYPE_MATRIX: readonly MatrixCaseType[] = [
  { slug: 'dui', label: 'DUI', position: 1, subTypes: [
    { slug: 'first_offense', label: 'First Offense', position: 1 },
    { slug: 'repeat_offense', label: 'Repeat Offense', position: 2 },
    { slug: 'dui_with_injury', label: 'DUI with Injury', position: 3 },
    { slug: 'dui_with_property', label: 'DUI with Property Damage', position: 4 },
  ] },
  { slug: 'criminal_defense', label: 'Criminal Defense', position: 2, subTypes: [
    { slug: 'theft', label: 'Theft', position: 1 },
    { slug: 'assault', label: 'Assault', position: 2 },
    { slug: 'fraud', label: 'Fraud', position: 3 },
    { slug: 'gun_charge', label: 'Gun Charge', position: 4 },
  ] },
  { slug: 'personal_injury', label: 'Personal Injury', position: 3, subTypes: [
    { slug: 'car_accident', label: 'Car Accident', position: 1 },
    { slug: 'slip_fall', label: 'Slip and Fall', position: 2 },
    { slug: 'medical_malpractice', label: 'Medical Malpractice', position: 3 },
    { slug: 'dog_bite', label: 'Dog Bite', position: 4 },
  ] },
  { slug: 'family_law', label: 'Family Law', position: 4, subTypes: [
    { slug: 'divorce', label: 'Divorce', position: 1 },
    { slug: 'custody', label: 'Custody', position: 2 },
    { slug: 'adoption', label: 'Adoption', position: 3 },
  ] },
  { slug: 'drug_crime', label: 'Drug Crime', position: 5, subTypes: [
    { slug: 'possession', label: 'Possession', position: 1 },
    { slug: 'distribution', label: 'Distribution', position: 2 },
    { slug: 'trafficking', label: 'Trafficking', position: 3 },
  ] },
  { slug: 'estate_planning', label: 'Estate Planning', position: 6, subTypes: [
    { slug: 'will', label: 'Will', position: 1 },
    { slug: 'trust', label: 'Trust', position: 2 },
    { slug: 'probate', label: 'Probate', position: 3 },
  ] },
];
```

- [ ] **Step 4: Export from the barrel**

In `packages/shared/src/index.ts`, add after the existing constant exports:

```typescript
export * from './constants/default-case-types.js';
```

- [ ] **Step 5: Run tests + build shared**

Run: `cd packages/shared && pnpm vitest run src/constants/default-case-types.test.ts && pnpm build`
Expected: PASS, build exits 0.

- [ ] **Step 6: Add a parity guard test in packages/api**

Create `packages/api/src/db/seed-defaults/matrix-parity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import { DEFAULT_CASE_TYPES } from './sop';

describe('matrix parity: shared matrix matches server DEFAULT_CASE_TYPES', () => {
  it('same case-type slugs in same order', () => {
    expect(DEFAULT_CASE_TYPE_MATRIX.map((c) => c.slug)).toEqual(DEFAULT_CASE_TYPES.map((c) => c.slug));
  });
  it('same sub-type slugs per case type', () => {
    for (const ct of DEFAULT_CASE_TYPES) {
      const m = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === ct.slug)!;
      expect(m.subTypes.map((s) => s.slug)).toEqual(ct.sub_types.map((s) => s.slug));
    }
  });
});
```

- [ ] **Step 7: Run parity test**

Run: `cd packages/api && pnpm vitest run src/db/seed-defaults/matrix-parity.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/constants/default-case-types.ts packages/shared/src/constants/default-case-types.test.ts packages/shared/src/index.ts packages/api/src/db/seed-defaults/matrix-parity.test.ts
git commit -m "feat(shared): expose default case-type matrix for onboarding wizard"
```

---

## Task 2: Schema — add `accounts.domain` and `attorney` sub-type assignment

**Files:**
- Modify: `packages/api/src/db/schema.ts`
- Modify: `packages/api/src/db/test-schema.ts`
- Create: `packages/api/drizzle/0011_*.sql` (generated)

**Interfaces:**
- Produces: `accounts.domain` (nullable text); `attorneyCaseTypeAssignments.sub_type_slug` (nullable text); unique index `(attorney_id, case_type_slug, sub_type_slug)`.

- [ ] **Step 1: Add `domain` to `accounts` in schema.ts**

In `packages/api/src/db/schema.ts`, inside the `accounts` `pgTable` column block, after `deleted_at`:

```typescript
  /** 027 onboarding-redesign: website domain where the widget is deployed. Display-only. */
  domain: text('domain'),
```

- [ ] **Step 2: Add `sub_type_slug` to assignments + revise unique index**

In `attorneyCaseTypeAssignments`, add the column after `case_type_slug`:

```typescript
  /** 027 onboarding-redesign: optional sub-type scope. NULL = whole case type. */
  sub_type_slug: text('sub_type_slug'),
```

Replace the unique index in that table's callback:

```typescript
], (table) => [
  uniqueIndex('attorney_assignment_unique').on(table.attorney_id, table.case_type_slug, table.sub_type_slug),
]);
```

- [ ] **Step 3: Mirror in test-schema.ts**

In `packages/api/src/db/test-schema.ts`, add to `accounts`:

```typescript
  domain: text('domain'),
```

And to `attorneyCaseTypeAssignments`:

```typescript
  sub_type_slug: text('sub_type_slug'),
```

(SQLite mirror needs no explicit unique index for tests.)

- [ ] **Step 4: Generate migration 0011**

Run: `cd packages/api && DATABASE_URL="postgres://test:test@localhost:5432/test" pnpm db:generate`
Expected: creates `drizzle/0011_*.sql` with `ALTER TABLE accounts ADD COLUMN domain`, `ALTER TABLE attorney_case_type_assignments ADD COLUMN sub_type_slug`, and a new unique index. Journal gains `idx: 11`.

- [ ] **Step 5: Verify the generated SQL**

Run: `cat packages/api/drizzle/0011_*.sql`
Expected: only additive `ADD COLUMN` + index statements; no drops of data columns.

- [ ] **Step 6: Typecheck + full suite**

Run: `cd packages/api && npx tsc --noEmit && pnpm vitest run`
Expected: tsc exit 0; all tests pass (existing `attorney_case_type_assignments` inserts in tests still valid since `sub_type_slug` is nullable). If any test's hand-written `CREATE TABLE attorney_case_type_assignments` INSERTs positionally, add the column there.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/db/schema.ts packages/api/src/db/test-schema.ts packages/api/drizzle/
git commit -m "feat(db): add accounts.domain + attorney sub_type_slug assignment (0011)"
```

---

## Task 3: Subset-aware `seedSopForAccount`

Teach the seeder to create only selected case types/sub-types when a selection is passed; default behavior (no selection) unchanged.

**Files:**
- Modify: `packages/api/src/db/seed.ts:36` (`seedSopForAccount`)
- Test: `packages/api/src/db/seed-subset.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_CASE_TYPES` (existing).
- Produces: `seedSopForAccount(accountId: string, options?: { selection?: Array<{ caseTypeSlug: string; subTypeSlugs: string[] }> }): Promise<void>`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/db/seed-subset.test.ts
vi.mock('./index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('./test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('./schema.js', async () => await import('./test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { seedSopForAccount } from './seed.js';
import { db, schema } from './index.js';

const { __sqlite: sqlite } = (await import('./index.js')) as unknown as { __sqlite: import('better-sqlite3').Database };

// Full DDL for sop_configurations, sop_steps, case_types, sub_types, goodbye_phrases,
// branches, branch_versions, accounts — copy from src/db/ensure-default-branches.test.ts
// (that file already CREATEs this exact set). Reuse its MIGRATION_SQL verbatim.
const MIGRATION_SQL = `/* paste the full CREATE TABLE block from ensure-default-branches.test.ts here */`;

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sqlite.exec(`INSERT INTO accounts (id, email, password_hash, firm_name, created_at) VALUES ('acct_1','a@f.com','h','F','2026-07-05T00:00:00.000Z')`);
});

describe('seedSopForAccount with selection', () => {
  it('creates only the selected case types and sub-types', async () => {
    await seedSopForAccount('acct_1', { selection: [
      { caseTypeSlug: 'personal_injury', subTypeSlugs: ['car_accident'] },
    ]});
    const cts = await db.select().from(schema.caseTypes).where(eq(schema.caseTypes.account_id, 'acct_1'));
    expect(cts.map((c) => c.slug)).toEqual(['personal_injury']);
    const cid = cts[0].id;
    const subs = await db.select().from(schema.subTypes).where(eq(schema.subTypes.case_type_id, cid));
    expect(subs.map((s) => s.slug)).toEqual(['car_accident']);
  });

  it('with no selection seeds all 6 default case types (unchanged behavior)', async () => {
    await seedSopForAccount('acct_1');
    const cts = await db.select().from(schema.caseTypes).where(eq(schema.caseTypes.account_id, 'acct_1'));
    expect(cts.length).toBe(6);
  });
});
```

Note for implementer: open `src/db/ensure-default-branches.test.ts`, copy its `MIGRATION_SQL` template literal verbatim into the placeholder above (it already defines the full SOP table set).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm vitest run src/db/seed-subset.test.ts`
Expected: FAIL — `seedSopForAccount` ignores the options arg / seeds all 6.

- [ ] **Step 3: Add the options param and filter logic**

In `packages/api/src/db/seed.ts`, change the signature and the case-type loop:

```typescript
export async function seedSopForAccount(
  accountId: string,
  options?: { selection?: Array<{ caseTypeSlug: string; subTypeSlugs: string[] }> },
): Promise<void> {
  // ... existing early-return idempotency guard unchanged ...

  const selection = options?.selection;
  const selectedCaseTypes = selection
    ? DEFAULT_CASE_TYPES
        .filter((ct) => selection.some((s) => s.caseTypeSlug === ct.slug))
        .map((ct) => {
          const chosen = selection.find((s) => s.caseTypeSlug === ct.slug)!;
          return { ...ct, sub_types: ct.sub_types.filter((st) => chosen.subTypeSlugs.includes(st.slug)) };
        })
    : DEFAULT_CASE_TYPES;

  for (const ct of selectedCaseTypes) {
    // ... existing insert loop, but iterate `selectedCaseTypes` instead of DEFAULT_CASE_TYPES ...
  }
  // ... existing goodbye phrases ...
  // Branch seeding: guard each default branch seed so it only runs when its
  // (caseType, subType) is in selectedCaseTypes. E.g. before seeding the
  // car_accident branch, check the personal_injury case type with car_accident
  // sub-type is present. When selection is undefined, seed all as before.
}
```

Implementer: locate the existing `for (const ct of DEFAULT_CASE_TYPES)` loop (~line 70) and the branch-seeding section (~line 150). Replace the loop variable with `selectedCaseTypes`. For branch seeds, wrap each in a presence check:

```typescript
function isSelected(caseTypeSlug: string, subTypeSlug: string): boolean {
  return selectedCaseTypes.some((ct) => ct.slug === caseTypeSlug && ct.sub_types.some((st) => st.slug === subTypeSlug));
}
// before car_accident branch seed:
if (isSelected('personal_injury', 'car_accident')) { /* existing car-accident branch insert */ }
// for DEFAULT_BRANCH_SEEDS loop, filter: DEFAULT_BRANCH_SEEDS.filter((b) => isSelected(b.case_type_slug, b.sub_type_slug))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/api && pnpm vitest run src/db/seed-subset.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite (ensure default path unbroken)**

Run: `cd packages/api && pnpm vitest run && npx tsc --noEmit`
Expected: all green (the existing seed/bootstrap tests exercise the no-selection path).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/seed.ts packages/api/src/db/seed-subset.test.ts
git commit -m "feat(db): subset-aware seedSopForAccount for onboarding selection"
```

---

## Task 4: Attorney lib — sub-type-aware create + lookup

**Files:**
- Modify: `packages/api/src/lib/attorneys.ts`
- Test: `packages/api/src/lib/attorneys-subtype.test.ts`

**Interfaces:**
- Produces:
  - `createAttorney(accountId, data)` where `data` gains `assignments?: Array<{ caseTypeSlug: string; subTypeSlug: string | null }>` (in addition to existing `case_type_slugs`).
  - `getAttorneysForSubType(accountId: string, caseTypeSlug: string, subTypeSlug: string): Promise<Array<{ id: string; name: string; email: string }>>` — returns attorneys assigned that sub-type, else (fallback) those assigned the whole case type.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/api/src/lib/attorneys-subtype.test.ts
vi.mock('../db/index.js', async () => {
  const Database = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const schema = await import('../db/test-schema.js');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, schema, __sqlite: sqlite };
});
vi.mock('../db/schema.js', async () => await import('../db/test-schema.js'));

import { describe, it, expect, beforeEach } from 'vitest';
import { createAttorney, getAttorneysForSubType } from './attorneys.js';
import { db, schema } from '../db/index.js';

const { __sqlite: sqlite } = (await import('../db/index.js')) as unknown as { __sqlite: import('better-sqlite3').Database };

const MIGRATION_SQL = `
CREATE TABLE accounts (id text PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL, firm_name text, created_at text NOT NULL, status text DEFAULT 'active' NOT NULL, onboarding_status text DEFAULT 'live' NOT NULL, deleted_at text, domain text);
CREATE TABLE attorneys (id text PRIMARY KEY, account_id text NOT NULL, name text NOT NULL, email text NOT NULL, mobile text, created_at text NOT NULL, updated_at text NOT NULL);
CREATE TABLE attorney_case_type_assignments (id text PRIMARY KEY, attorney_id text NOT NULL, account_id text NOT NULL, case_type_slug text NOT NULL, sub_type_slug text, created_at text NOT NULL);
`;

beforeEach(() => {
  for (const stmt of MIGRATION_SQL.split(';').filter((s) => s.trim())) sqlite.exec(stmt);
  sqlite.exec(`INSERT INTO accounts (id,email,password_hash,firm_name,created_at) VALUES ('a1','x@y.com','h','F','2026-07-05T00:00:00.000Z')`);
});

describe('sub-type attorney assignment', () => {
  it('routes to sub-type-assigned attorney', async () => {
    await createAttorney('a1', { name: 'Sub Lawyer', email: 's@f.com', assignments: [{ caseTypeSlug: 'personal_injury', subTypeSlug: 'car_accident' }] });
    const found = await getAttorneysForSubType('a1', 'personal_injury', 'car_accident');
    expect(found.map((a) => a.name)).toEqual(['Sub Lawyer']);
  });

  it('falls back to case-type-assigned attorney when no sub-type match', async () => {
    await createAttorney('a1', { name: 'Case Lawyer', email: 'c@f.com', assignments: [{ caseTypeSlug: 'personal_injury', subTypeSlug: null }] });
    const found = await getAttorneysForSubType('a1', 'personal_injury', 'slip_fall');
    expect(found.map((a) => a.name)).toEqual(['Case Lawyer']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/api && pnpm vitest run src/lib/attorneys-subtype.test.ts`
Expected: FAIL — `getAttorneysForSubType` not exported; `assignments` ignored.

- [ ] **Step 3: Extend `createAttorney` to accept assignments**

In `packages/api/src/lib/attorneys.ts`, widen the `createAttorney` data type and the insert:

```typescript
export async function createAttorney(
  accountId: string,
  data: {
    name: string; email: string; mobile?: string | null;
    case_type_slugs?: string[];
    assignments?: Array<{ caseTypeSlug: string; subTypeSlug: string | null }>;
  },
): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(schema.attorneys).values({ id, account_id: accountId, name: data.name, email: data.email, mobile: data.mobile ?? null, created_at: now, updated_at: now });

  // Normalize both inputs into assignment rows.
  const rows: Array<{ caseTypeSlug: string; subTypeSlug: string | null }> = [
    ...(data.assignments ?? []),
    ...((data.case_type_slugs ?? []).map((slug) => ({ caseTypeSlug: slug, subTypeSlug: null }))),
  ];
  if (rows.length > 0) {
    await db.insert(schema.attorneyCaseTypeAssignments).values(
      rows.map((r) => ({ id: nanoid(), attorney_id: id, account_id: accountId, case_type_slug: r.caseTypeSlug, sub_type_slug: r.subTypeSlug, created_at: now })),
    );
  }
  return id;
}
```

- [ ] **Step 4: Add `getAttorneysForSubType` with fallback**

Append to `packages/api/src/lib/attorneys.ts`:

```typescript
export async function getAttorneysForSubType(
  accountId: string, caseTypeSlug: string, subTypeSlug: string,
): Promise<Array<{ id: string; name: string; email: string }>> {
  // Prefer sub-type-scoped assignments.
  const subAssigned = await db
    .select({ attorney_id: schema.attorneyCaseTypeAssignments.attorney_id })
    .from(schema.attorneyCaseTypeAssignments)
    .where(and(
      eq(schema.attorneyCaseTypeAssignments.account_id, accountId),
      eq(schema.attorneyCaseTypeAssignments.case_type_slug, caseTypeSlug),
      eq(schema.attorneyCaseTypeAssignments.sub_type_slug, subTypeSlug),
    ));
  const ids = subAssigned.map((a) => a.attorney_id);
  if (ids.length === 0) {
    // Fallback: whole-case-type assignments (sub_type_slug IS NULL).
    const caseAssigned = await db
      .select({ attorney_id: schema.attorneyCaseTypeAssignments.attorney_id })
      .from(schema.attorneyCaseTypeAssignments)
      .where(and(
        eq(schema.attorneyCaseTypeAssignments.account_id, accountId),
        eq(schema.attorneyCaseTypeAssignments.case_type_slug, caseTypeSlug),
        isNull(schema.attorneyCaseTypeAssignments.sub_type_slug),
      ));
    ids.push(...caseAssigned.map((a) => a.attorney_id));
  }
  if (ids.length === 0) return [];
  const rows = await db.select({ id: schema.attorneys.id, name: schema.attorneys.name, email: schema.attorneys.email })
    .from(schema.attorneys)
    .where(and(eq(schema.attorneys.account_id, accountId), inArray(schema.attorneys.id, ids)));
  return rows;
}
```

Ensure `isNull` and `inArray` are imported from `drizzle-orm` at the top of the file (add to the existing import if missing).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && pnpm vitest run src/lib/attorneys-subtype.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `cd packages/api && pnpm vitest run && npx tsc --noEmit`
Expected: all green (existing attorney tests still pass — `assignments` is additive).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/lib/attorneys.ts packages/api/src/lib/attorneys-subtype.test.ts
git commit -m "feat(attorneys): sub-type assignment + getAttorneysForSubType with case-type fallback"
```

---

## Task 5: Route HOT leads by sub-type in attorney-routing

Wire the sub-type lookup into the routing dispatcher so HOT leads prefer sub-type-assigned attorneys.

**Files:**
- Modify: `packages/api/src/lib/attorney-routing.ts`
- Test: extend `packages/api/src/lib/attorney-routing.test.ts`

**Interfaces:**
- Consumes: `getAttorneysForSubType` (Task 4).

- [ ] **Step 1: Read the current routing lookup**

Run: `grep -n "getAttorneysForCaseType\|case_type\|sub_type" packages/api/src/lib/attorney-routing.ts`
Identify where the lead's case type is resolved to attorneys (the call to `getAttorneysForCaseType`).

- [ ] **Step 2: Write the failing test**

Add to `packages/api/src/lib/attorney-routing.test.ts` a case where a HOT lead has both a case type and a sub-type, an attorney is assigned the sub-type, and assert only that attorney receives the notification. (Follow the existing test's setup shape in that file — mock DB, insert attorney + sub-type assignment, insert a HOT lead with `case_type` and a sub-type in its branch snapshot, run the dispatcher, assert one `notifications` row with the sub-type attorney's `attorney_id`.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/api && pnpm vitest run src/lib/attorney-routing.test.ts`
Expected: FAIL — routing still uses case-type-only lookup.

- [ ] **Step 4: Switch the dispatcher to sub-type lookup with fallback**

Where routing resolves attorneys, when the lead has a resolvable sub-type slug (from the lead's branch snapshot / sop state), call `getAttorneysForSubType(accountId, caseTypeSlug, subTypeSlug)`; otherwise keep `getAttorneysForCaseType`. `getAttorneysForSubType` already falls back to case-type-level internally, so:

```typescript
const recipients = subTypeSlug
  ? await getAttorneysForSubType(accountId, caseTypeSlug, subTypeSlug)
  : await getAttorneysForCaseType(accountId, caseTypeSlug);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/api && pnpm vitest run src/lib/attorney-routing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/lib/attorney-routing.ts packages/api/src/lib/attorney-routing.test.ts
git commit -m "feat(routing): prefer sub-type-assigned attorneys for HOT leads"
```

---

## Task 6: Reshape `wizardSubmissionSchema`

**Files:**
- Modify: `packages/shared/src/schemas/admin.ts`
- Test: `packages/shared/src/schemas/admin.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `wizardSubmissionSchema` with `firmIdentity: { firmName, chatbotName, email, domain }`, `caseTypeSelection: Array<{ caseTypeSlug, subTypeSlugs: string[] }>`, `attorneys: Array<{ name, email, mobile?, subTypeAssignments: Array<{ caseTypeSlug, subTypeSlug }> }>`, `finish?: boolean`.
  - `REQUIRED_WIZARD_SECTIONS = ['firmIdentity', 'caseTypeSelection']`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/schemas/admin.test.ts
import { describe, it, expect } from 'vitest';
import { wizardSubmissionSchema, REQUIRED_WIZARD_SECTIONS } from './admin.js';

describe('wizardSubmissionSchema (redesigned)', () => {
  it('accepts firmIdentity with domain + email', () => {
    const r = wizardSubmissionSchema.safeParse({
      firmIdentity: { firmName: 'Acme', chatbotName: 'Ace', email: 'a@acme.law', domain: 'acme.law' },
      caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
      attorneys: [],
    });
    expect(r.success).toBe(true);
  });
  it('required sections are firmIdentity + caseTypeSelection', () => {
    expect(REQUIRED_WIZARD_SECTIONS).toEqual(['firmIdentity', 'caseTypeSelection']);
  });
  it('rejects an invalid email', () => {
    const r = wizardSubmissionSchema.safeParse({ firmIdentity: { firmName: 'A', chatbotName: 'B', email: 'nope', domain: 'x.com' } });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/shared && pnpm vitest run src/schemas/admin.test.ts`
Expected: FAIL — old shape (persona/contact/escalation).

- [ ] **Step 3: Rewrite the schema**

In `packages/shared/src/schemas/admin.ts`, replace `wizardSubmissionSchema` and `REQUIRED_WIZARD_SECTIONS`:

```typescript
export const wizardSubmissionSchema = z.object({
  firmIdentity: z.object({
    firmName: z.string().min(1),
    chatbotName: z.string().min(1),
    email: z.string().email(),
    domain: z.string().min(1),
  }).optional(),
  caseTypeSelection: z.array(z.object({
    caseTypeSlug: z.string().min(1),
    subTypeSlugs: z.array(z.string().min(1)).default([]),
  })).optional(),
  attorneys: z.array(z.object({
    name: z.string().min(1),
    email: z.string().email(),
    mobile: z.string().nullable().optional(),
    subTypeAssignments: z.array(z.object({
      caseTypeSlug: z.string().min(1),
      subTypeSlug: z.string().min(1),
    })).default([]),
  })).optional().default([]),
  finish: z.boolean().optional(),
});
export type WizardSubmission = z.infer<typeof wizardSubmissionSchema>;

export const REQUIRED_WIZARD_SECTIONS = ['firmIdentity', 'caseTypeSelection'] as const;
```

Remove the now-unused `officeHourSchema` if nothing else references it (grep first: `grep -rn officeHourSchema packages`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/shared && pnpm vitest run src/schemas/admin.test.ts && pnpm build`
Expected: PASS, build 0.

- [ ] **Step 5: Typecheck api (expect breakage in provisioning — fixed in Task 7)**

Run: `cd packages/api && npx tsc --noEmit`
Expected: errors ONLY in `tenant-provisioning.ts` / onboarding route referencing removed fields. Note them; Task 7 fixes them.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas/admin.ts packages/shared/src/schemas/admin.test.ts
git commit -m "feat(shared): reshape wizardSubmissionSchema for 3-step onboarding"
```

---

## Task 7: Rework provisioning — draft defaults, selection seeding, attorney provisioning

**Files:**
- Modify: `packages/api/src/lib/admin/tenant-provisioning.ts`
- Test: `packages/api/src/lib/admin/tenant-provisioning.test.ts` (update)

**Interfaces:**
- Consumes: `wizardSubmissionSchema` (Task 6), `seedSopForAccount` with selection (Task 3), `createAttorney` with `assignments` (Task 4).
- Produces:
  - `buildDraftFromWizard(sub, now)` → config object filling greeting/tone/escalation/contact from DEFAULTS, storing nothing that no longer exists in the wizard.
  - `missingRequiredSections(sub)` → flags `firmIdentity` and empty `caseTypeSelection`.
  - `saveOnboardingDraft(accountId, submission, now?)` unchanged signature; also persists `accounts.domain` when `firmIdentity.domain` present.
  - `seedSopAndBranches(accountId, selection?)` passes selection through to `seedSopForAccount`.
  - `provisionAttorneys(accountId, attorneys)` creates each attorney with sub-type assignments.

- [ ] **Step 1: Update the unit test**

Rewrite `packages/api/src/lib/admin/tenant-provisioning.test.ts` `buildDraftFromWizard` cases for the new shape:

```typescript
import { configurationSchema, type WizardSubmission } from '@legal-chatbot/shared';
import { buildDraftFromWizard, missingRequiredSections } from './tenant-provisioning.js';

const NOW = '2026-07-05T10:00:00.000Z';
const sub: WizardSubmission = {
  firmIdentity: { firmName: 'Acme Law', chatbotName: 'Ace', email: 'info@acme.law', domain: 'acme.law' },
  caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
  attorneys: [],
};

it('maps to a valid configuration with default greeting/tone/contact', () => {
  const draft = buildDraftFromWizard(sub, NOW);
  expect(configurationSchema.safeParse(draft).success).toBe(true);
  expect((draft.persona as { chatbot_name: string }).chatbot_name).toBe('Ace');
  expect((draft.persona as { tone: string }).tone).toBe('friendly'); // defaulted
  expect((draft.persona as { greeting_message: string }).greeting_message.length).toBeGreaterThan(0);
});

it('flags missing firmIdentity and empty caseTypeSelection', () => {
  expect(missingRequiredSections({ attorneys: [] })).toEqual(expect.arrayContaining(['firmIdentity', 'caseTypeSelection']));
  expect(missingRequiredSections({ ...sub, caseTypeSelection: [] })).toEqual(['caseTypeSelection']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/api && pnpm vitest run src/lib/admin/tenant-provisioning.test.ts`
Expected: FAIL (old shape / compile errors).

- [ ] **Step 3: Rewrite `buildDraftFromWizard`**

```typescript
const DEFAULT_GREETING = 'Hi! Thanks for reaching out. I can help answer questions and connect you with the right attorney. How can I help you today?';

export function buildDraftFromWizard(sub: WizardSubmission, now: string): Record<string, unknown> {
  const identity = sub.firmIdentity;
  return {
    version: 1,
    saved_at: now,
    persona: {
      firm_name: identity?.firmName ?? '',
      chatbot_name: identity?.chatbotName ?? 'Assistant',
      greeting_message: DEFAULT_GREETING,
      tone: 'friendly',
      language: 'English',
    },
    out_of_scope_response: "I'm not able to help with that area, but I'd recommend reaching out to an attorney who specializes in it.",
    boundaries: { never_say: [
      'Never provide specific legal advice or legal opinions',
      'Never promise case outcomes',
      'Never discuss fees or payment structures',
    ]},
    escalation: { triggers: [], message: '' },
    contact: { phone: '', email: identity?.email ?? 'unknown@example.com', office_hours: [], after_hours_message: '' },
    custom_instructions: '',
  };
}
```

- [ ] **Step 4: Rewrite `missingRequiredSections`**

```typescript
export function missingRequiredSections(sub: WizardSubmission): string[] {
  const missing: string[] = [];
  if (sub.firmIdentity == null) missing.push('firmIdentity');
  if (sub.caseTypeSelection == null || sub.caseTypeSelection.length === 0
      || sub.caseTypeSelection.every((c) => c.subTypeSlugs.length === 0)) {
    missing.push('caseTypeSelection');
  }
  return missing;
}
```

- [ ] **Step 5: Persist domain in `saveOnboardingDraft`**

After the config upsert in `saveOnboardingDraft`, add:

```typescript
if (submission.firmIdentity?.domain) {
  await db.update(schema.accounts)
    .set({ domain: submission.firmIdentity.domain })
    .where(eq(schema.accounts.id, accountId));
}
```

- [ ] **Step 6: Selection-aware `seedSopAndBranches` + `provisionAttorneys`**

```typescript
export async function seedSopAndBranches(
  accountId: string,
  selection?: Array<{ caseTypeSlug: string; subTypeSlugs: string[] }>,
): Promise<void> {
  const { seedSopForAccount } = await import('../../db/seed');
  const { ensureContactStepForAccount } = await import('../../db/ensure-contact-step');
  await seedSopForAccount(accountId, selection ? { selection } : undefined);
  await ensureContactStepForAccount(accountId);
  // Note: car-accident/default branch ensures are handled inside seedSopForAccount's
  // selection path; do not force-add branches for unselected sub-types.
}

export async function provisionAttorneys(
  accountId: string,
  attorneys: NonNullable<WizardSubmission['attorneys']>,
): Promise<void> {
  const { createAttorney } = await import('../../lib/attorneys');
  for (const a of attorneys) {
    await createAttorney(accountId, {
      name: a.name, email: a.email, mobile: a.mobile ?? null,
      assignments: a.subTypeAssignments.map((s) => ({ caseTypeSlug: s.caseTypeSlug, subTypeSlug: s.subTypeSlug })),
    });
  }
}
```

- [ ] **Step 7: Run unit tests to verify pass**

Run: `cd packages/api && pnpm vitest run src/lib/admin/tenant-provisioning.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/lib/admin/tenant-provisioning.ts packages/api/src/lib/admin/tenant-provisioning.test.ts
git commit -m "feat(onboarding): default-filled draft + selection seeding + attorney provisioning"
```

---

## Task 8: Update the onboarding route

**Files:**
- Modify: `packages/api/src/app/api/admin/tenants/[id]/onboarding/route.ts`
- Test: update `packages/api/src/app/api/admin/tenants/onboarding.test.ts`

**Interfaces:**
- Consumes: `saveOnboardingDraft`, `seedSopAndBranches(accountId, selection)`, `provisionAttorneys` (Task 7).

- [ ] **Step 1: Update the integration test**

In `onboarding.test.ts`, change the `fullWizard` fixture to the new shape and assert: on finish, `seedSopAndBranches` called with the selection, attorneys provisioned, `accounts.domain` set. Mock `seedSopAndBranches` and `provisionAttorneys` at the provisioning module boundary via `vi.hoisted` (as the existing test mocks `seedSopAndBranches`). Add a 422 case when `caseTypeSelection` is empty.

```typescript
const fullWizard = {
  firmIdentity: { firmName: 'Acme', chatbotName: 'Ace', email: 'a@acme.law', domain: 'acme.law' },
  caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
  attorneys: [{ name: 'Lawyer A', email: 'la@f.com', subTypeAssignments: [{ caseTypeSlug: 'dui', subTypeSlug: 'first_offense' }] }],
};
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/api && pnpm vitest run src/app/api/admin/tenants/onboarding.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update the route handler**

In the PUT handler, on `finish`:

```typescript
if (submission.finish) {
  if (!ready) {
    return NextResponse.json({ error: 'Required sections are missing', missing }, { status: 422 });
  }
  await seedSopAndBranches(accountId, submission.caseTypeSelection);
  if (submission.attorneys && submission.attorneys.length > 0) {
    await provisionAttorneys(accountId, submission.attorneys);
  }
  await recordAdminAction(guard.adminId, 'tenant.onboard', accountId);
  return NextResponse.json({ onboardingStatus: 'draft', draftReady: true });
}
```

Add `provisionAttorneys` to the imports from `tenant-provisioning`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/api && pnpm vitest run src/app/api/admin/tenants/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd packages/api && pnpm vitest run && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/app/api/admin/tenants/[id]/onboarding/route.ts packages/api/src/app/api/admin/tenants/onboarding.test.ts
git commit -m "feat(onboarding): route seeds selected case types + provisions attorneys"
```

---

## Task 9: Rewrite the wizard UI — 3 steps, animated, silent autosave

**Files:**
- Modify: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/page.tsx`
- Create: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/case-matrix.tsx`
- Create: `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/attorneys-step.tsx`

**Interfaces:**
- Consumes: `DEFAULT_CASE_TYPE_MATRIX` (Task 1), `wizardSubmissionSchema` shape (Task 6), `PUT/publish` endpoints.

- [ ] **Step 1: Build the case-matrix component**

Create `case-matrix.tsx` (client component). Renders `DEFAULT_CASE_TYPE_MATRIX` as a grid: each case type is a section with a "select all" case-type checkbox and its sub-types as checkboxes. Props: `value: Array<{ caseTypeSlug; subTypeSlugs }>`, `onChange(next)`. Ticking a sub-type adds it; a case type with ≥1 sub-type ticked appears in `value`.

```typescript
'use client';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';

export interface Selection { caseTypeSlug: string; subTypeSlugs: string[] }
export function CaseMatrix({ value, onChange }: { value: Selection[]; onChange: (v: Selection[]) => void }) {
  const subSelected = (ct: string, st: string) => value.find((v) => v.caseTypeSlug === ct)?.subTypeSlugs.includes(st) ?? false;
  function toggle(ct: string, st: string) {
    const existing = value.find((v) => v.caseTypeSlug === ct);
    let next: Selection[];
    if (!existing) next = [...value, { caseTypeSlug: ct, subTypeSlugs: [st] }];
    else {
      const has = existing.subTypeSlugs.includes(st);
      const subs = has ? existing.subTypeSlugs.filter((s) => s !== st) : [...existing.subTypeSlugs, st];
      next = subs.length === 0 ? value.filter((v) => v.caseTypeSlug !== ct) : value.map((v) => v.caseTypeSlug === ct ? { ...v, subTypeSlugs: subs } : v);
    }
    onChange(next);
  }
  return (
    <div className="space-y-4">
      {DEFAULT_CASE_TYPE_MATRIX.map((ct) => (
        <div key={ct.slug} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-semibold mb-2">{ct.label}</div>
          <div className="grid grid-cols-2 gap-2">
            {ct.subTypes.map((st) => (
              <label key={st.slug} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={subSelected(ct.slug, st.slug)} onChange={() => toggle(ct.slug, st.slug)} />
                {st.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build the attorneys-step component**

Create `attorneys-step.tsx` (client component). Props: `selection: Selection[]` (to know which sub-types are assignable), `value: Attorney[]`, `onChange`. Each attorney row: name, email, mobile inputs + a checkbox list of selected sub-types (flattened as `caseTypeSlug/subTypeSlug` with labels from the matrix). "Add attorney" appends a blank row.

```typescript
'use client';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import type { Selection } from './case-matrix';

export interface WizardAttorney { name: string; email: string; mobile: string; subTypeAssignments: { caseTypeSlug: string; subTypeSlug: string }[] }

export function AttorneysStep({ selection, value, onChange }: { selection: Selection[]; value: WizardAttorney[]; onChange: (v: WizardAttorney[]) => void }) {
  const label = (ct: string, st: string) => {
    const c = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === ct);
    return `${c?.label ?? ct} · ${c?.subTypes.find((s) => s.slug === st)?.label ?? st}`;
  };
  const flat = selection.flatMap((s) => s.subTypeSlugs.map((st) => ({ caseTypeSlug: s.caseTypeSlug, subTypeSlug: st })));
  function update(i: number, patch: Partial<WizardAttorney>) { onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a)); }
  function toggleAssign(i: number, ct: string, st: string) {
    const a = value[i];
    const has = a.subTypeAssignments.some((x) => x.caseTypeSlug === ct && x.subTypeSlug === st);
    const next = has ? a.subTypeAssignments.filter((x) => !(x.caseTypeSlug === ct && x.subTypeSlug === st)) : [...a.subTypeAssignments, { caseTypeSlug: ct, subTypeSlug: st }];
    update(i, { subTypeAssignments: next });
  }
  return (
    <div className="space-y-4">
      {value.map((a, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <input placeholder="Name" value={a.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input placeholder="Email" type="email" value={a.email} onChange={(e) => update(i, { email: e.target.value })} />
          <input placeholder="Mobile (optional)" value={a.mobile} onChange={(e) => update(i, { mobile: e.target.value })} />
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Assign to:</div>
          <div className="grid grid-cols-2 gap-1">
            {flat.map((f) => (
              <label key={`${f.caseTypeSlug}/${f.subTypeSlug}`} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={a.subTypeAssignments.some((x) => x.caseTypeSlug === f.caseTypeSlug && x.subTypeSlug === f.subTypeSlug)} onChange={() => toggleAssign(i, f.caseTypeSlug, f.subTypeSlug)} />
                {label(f.caseTypeSlug, f.subTypeSlug)}
              </label>
            ))}
          </div>
          <button className="btn" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>Remove</button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...value, { name: '', email: '', mobile: '', subTypeAssignments: [] }])}>+ Add attorney</button>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the wizard page (3 steps, autosave, transitions)**

Rewrite `page.tsx`: state `{ firmIdentity, caseTypeSelection, attorneys }`; `STEPS = ['Firm details','Case types','Attorneys']`. On step change, fire a background `PUT .../onboarding` with `finish:false` (no blocking UI). Wrap step content in a container with a CSS opacity/translate transition keyed on `step` (respect `prefers-reduced-motion` via a media query guard). Final step button "Finish & publish" sets a `publishing` spinner, PUTs `finish:true`, then POSTs publish, then redirects. Show inline validation only for required fields.

```typescript
'use client';
import { use, useState } from 'react';
import { CaseMatrix, type Selection } from './case-matrix';
import { AttorneysStep, type WizardAttorney } from './attorneys-step';

const STEPS = ['Firm details', 'Case types', 'Attorneys'] as const;

export default function OnboardingWizard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [step, setStep] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmIdentity, setFirm] = useState({ firmName: '', chatbotName: 'Assistant', email: '', domain: '' });
  const [caseTypeSelection, setSelection] = useState<Selection[]>([]);
  const [attorneys, setAttorneys] = useState<WizardAttorney[]>([]);

  function payload(finish: boolean) {
    return { firmIdentity, caseTypeSelection, attorneys: attorneys.map((a) => ({ ...a, mobile: a.mobile || null })), finish };
  }
  async function autosave() {
    // silent — ignore errors, no blocking UI
    try { await fetch(`/api/admin/tenants/${id}/onboarding`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(false)) }); } catch { /* noop */ }
  }
  function goTo(next: number) { void autosave(); setStep(next); }

  async function finishAndPublish() {
    setPublishing(true); setError(null);
    const res = await fetch(`/api/admin/tenants/${id}/onboarding`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(true)) });
    if (!res.ok) {
      const b = await res.json();
      setError((b.error ?? 'Could not finish') + (b.missing ? ` (missing: ${b.missing.join(', ')})` : ''));
      setPublishing(false); return;
    }
    const pub = await fetch(`/api/admin/tenants/${id}/publish`, { method: 'POST' });
    if (pub.ok) { window.location.href = `/admin/tenants/${id}`; }
    else { setError('Publish failed'); setPublishing(false); }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Onboarding</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      <div key={step} className="onboarding-step">
        {step === 0 && (
          <div className="space-y-4">
            <label>Law firm name<input value={firmIdentity.firmName} onChange={(e) => setFirm({ ...firmIdentity, firmName: e.target.value })} /></label>
            <label>Chatbot assistant name<input value={firmIdentity.chatbotName} onChange={(e) => setFirm({ ...firmIdentity, chatbotName: e.target.value })} /></label>
            <label>Email<input type="email" value={firmIdentity.email} onChange={(e) => setFirm({ ...firmIdentity, email: e.target.value })} /></label>
            <label>Deployment domain<input placeholder="acme.law" value={firmIdentity.domain} onChange={(e) => setFirm({ ...firmIdentity, domain: e.target.value })} /></label>
          </div>
        )}
        {step === 1 && <CaseMatrix value={caseTypeSelection} onChange={setSelection} />}
        {step === 2 && <AttorneysStep selection={caseTypeSelection} value={attorneys} onChange={setAttorneys} />}
      </div>
      {error && <p className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex items-center gap-3 mt-6">
        {step > 0 && <button className="btn" onClick={() => goTo(step - 1)}>Back</button>}
        {step < STEPS.length - 1 && <button className="btn" onClick={() => goTo(step + 1)}>Next</button>}
        {step === STEPS.length - 1 && <button className="btn btn-primary" disabled={publishing} onClick={finishAndPublish}>{publishing ? 'Publishing…' : 'Finish & publish'}</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the transition CSS**

Append to the dashboard/admin global stylesheet (find it: `grep -rl "onboarding-step\|@keyframes\|--color-border" packages/api/src/app/**/*.css` — use `packages/api/src/app/globals.css` or the existing admin css). Add:

```css
.onboarding-step { animation: onboarding-fade 220ms ease; }
@keyframes onboarding-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .onboarding-step { animation: none; } }
```

- [ ] **Step 5: Typecheck + build**

Run: `cd packages/api && npx tsc --noEmit && DATABASE_URL="postgres://test:test@localhost:5432/test" SESSION_SECRET="$(printf 'a%.0s' {1..32})" ADMIN_SESSION_SECRET="$(printf 'b%.0s' {1..32})" ENCRYPTION_KEY="$(printf '0%.0s' {1..64})" GOOGLE_GENERATIVE_AI_API_KEY=x ANTHROPIC_API_KEY=x OPENAI_API_KEY=x npx next build`
Expected: tsc 0; build compiles the onboarding route + new components.

- [ ] **Step 6: Commit**

```bash
git add "packages/api/src/app/admin/(console)/tenants/[id]/onboarding/"
git add packages/api/src/app/globals.css
git commit -m "feat(onboarding): 3-step animated wizard (firm details, case matrix, attorneys)"
```

---

## Task 10: Update E2E + full regression

**Files:**
- Modify: `packages/api/tests/e2e/admin-console.walk.spec.ts`

- [ ] **Step 1: Update the E2E onboarding payload to the new shape**

In the "super-admin: login → register → onboard → publish → live" test, replace the onboarding PUT body:

```typescript
data: {
  firmIdentity: { firmName: 'E2E Firm', chatbotName: 'Ace', email: uniqueEmail, domain: 'e2e.test' },
  caseTypeSelection: [{ caseTypeSlug: 'dui', subTypeSlugs: ['first_offense'] }],
  attorneys: [{ name: 'E2E Lawyer', email: `atty+${Date.now()}@f.test`, subTypeAssignments: [{ caseTypeSlug: 'dui', subTypeSlug: 'first_offense' }] }],
  finish: true,
},
```

- [ ] **Step 2: Full regression**

Run: `cd packages/api && pnpm vitest run && npx tsc --noEmit`
Expected: all tests pass, tsc 0.

- [ ] **Step 3: Verify shared builds**

Run: `cd packages/shared && pnpm build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/api/tests/e2e/admin-console.walk.spec.ts
git commit -m "test(e2e): update onboarding walkthrough for 3-step flow"
```

---

## Task 11: Apply migration 0011 to Neon + design-doc status

- [ ] **Step 1: Apply the migration**

Run: `cd packages/api && DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)" npx tsx src/db/migrate.ts`
Expected: `Drizzle migrations complete.` — only 0011 applies.

- [ ] **Step 2: Verify the new column/column exist**

Run a quick check (node esm) confirming `accounts.domain` and `attorney_case_type_assignments.sub_type_slug` exist in Neon (mirror the verification query used for 0010).

- [ ] **Step 3: Mark design doc implemented**

In `docs/superpowers/specs/2026-07-05-onboarding-redesign-design.md`, change **Status** to `Implemented (2026-07-05)`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-05-onboarding-redesign-design.md
git commit -m "docs: mark onboarding redesign implemented; migration 0011 applied"
```

---

## Self-Review

**Spec coverage:**
- Firm details (name/chatbot/email/domain) → Task 6 (schema), Task 9 (UI), Task 7 (domain persist). ✓
- Remove greeting/tone/escalation/contact questions → Task 6 (schema drops), Task 7 (defaults). ✓
- Smooth transitions + silent save → Task 9 (autosave + CSS). ✓
- Case-type matrix drives SOP v1 → Task 1 (matrix data), Task 3 (subset seed), Task 8 (route wires selection). ✓
- Attorneys + sub-type assignment → Task 2 (schema), Task 4 (lib), Task 5 (routing), Task 9 (UI), Task 7/8 (provisioning). ✓
- Domain display-only, no CORS → Task 2 (nullable column), no origin enforcement anywhere. ✓
- Attorney routing case-type fallback → Task 4 (`getAttorneysForSubType` internal fallback), Task 5. ✓

**Placeholder scan:** Task 5 Step 2 and Task 8 Step 1 describe test edits by pattern rather than full code because they extend large existing test files whose fixtures must be matched in place; each names exact assertions and the fixture shape. All code-producing steps include complete code.

**Type consistency:** `Selection` (`{caseTypeSlug, subTypeSlugs}`) is consistent across Tasks 1/6/9; `WizardAttorney.subTypeAssignments` (`{caseTypeSlug, subTypeSlug}`) matches the schema in Task 6 and provisioning in Task 7; `getAttorneysForSubType(accountId, caseTypeSlug, subTypeSlug)` signature identical in Tasks 4/5; `seedSopForAccount(accountId, { selection })` identical in Tasks 3/7.
