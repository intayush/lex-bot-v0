# Onboarding Autosave — Follow-up Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Make onboarding truly persist partial progress and reload it on mount, delivering the design's "each step autosaves; progress survives across sessions" promise.

**Architecture:** Store the raw partial wizard submission as JSON in a new nullable `accounts.onboarding_draft_json` column (migration 0012). The PUT onboarding route gets a lenient partial-save path (finish:false → validate against a permissive `wizardDraftSchema`, persist raw JSON, never 400 on incomplete data) while the strict finish path is unchanged. A new GET returns the saved draft; the wizard hydrates from it on mount.

**Tech Stack:** TypeScript strict, Next.js Route Handlers, Drizzle, Zod (`packages/shared`), Vitest, React 19.

## Global Constraints

- Extensionless relative imports in `packages/api/src` (Next webpack). `packages/shared` uses `.js` suffixes.
- Every new column mirrored in `test-schema.ts` + affected test `CREATE TABLE`s.
- Next migration number is **`0012`** (0011 is last).
- `finish:true` behavior UNCHANGED (strict `wizardSubmissionSchema` + `missingRequiredSections` + seed + provision).
- All 758 existing tests stay green; `next build` must compile.
- Plan builds on branch `main` at commit 24078e4.

---

## Task 1: Add `accounts.onboarding_draft_json` (migration 0012)

**Files:** Modify `packages/api/src/db/schema.ts`, `packages/api/src/db/test-schema.ts`; generate `packages/api/drizzle/0012_*.sql`.

- [ ] Step 1: In `schema.ts` `accounts` table, after `domain: text('domain'),` add:
  ```typescript
  /** 027 onboarding-redesign: raw partial wizard submission for draft resume. JSON. */
  onboarding_draft_json: text('onboarding_draft_json'),
  ```
- [ ] Step 2: In `test-schema.ts` `accounts`, after `domain: text('domain'),` add the same line (nullable, no default).
- [ ] Step 3: Generate migration: `cd packages/api && DATABASE_URL="postgres://test:test@localhost:5432/test" pnpm db:generate`. Verify `0012_*.sql` is a single additive `ADD COLUMN onboarding_draft_json text` + journal idx 12.
- [ ] Step 4: The nullable column with no default means Drizzle emits it in accounts INSERTs. Fix any failing test fixture the same way `domain` was handled: append `, \`onboarding_draft_json\` text` after the `\`domain\` text` column in each hand-written `CREATE TABLE accounts`. Run `cd packages/api && pnpm vitest run` and patch every fixture that errors with "no column named onboarding_draft_json". 
- [ ] Step 5: `cd packages/api && npx tsc --noEmit` (exit 0) and `pnpm vitest run` (all green).
- [ ] Step 6: Commit `feat(db): add accounts.onboarding_draft_json for wizard draft resume (0012)`.

---

## Task 2: Lenient `wizardDraftSchema` in shared

**Files:** Modify `packages/shared/src/schemas/admin.ts`; Test `packages/shared/src/schemas/admin.test.ts`.

**Interfaces:** Produces `wizardDraftSchema` (all fields optional/permissive, no `.min`/`.email`) and `WizardDraft` type.

- [ ] Step 1: Add failing test in `admin.test.ts`:
  ```typescript
  it('wizardDraftSchema accepts empty/partial firm identity', () => {
    const r = wizardDraftSchema.safeParse({ firmIdentity: { firmName: '', email: '' }, caseTypeSelection: [], attorneys: [] });
    expect(r.success).toBe(true);
  });
  it('wizardDraftSchema accepts a totally empty object', () => {
    expect(wizardDraftSchema.safeParse({}).success).toBe(true);
  });
  ```
  (Add `wizardDraftSchema` to the existing import from `./admin.js`.)
- [ ] Step 2: `cd packages/shared && pnpm vitest run src/schemas/admin.test.ts` — fails (not exported).
- [ ] Step 3: Add to `admin.ts` after `wizardSubmissionSchema`:
  ```typescript
  /** Permissive shape for partial autosave (finish:false). Never rejects incomplete input. */
  export const wizardDraftSchema = z.object({
    firmIdentity: z.object({
      firmName: z.string().optional(),
      chatbotName: z.string().optional(),
      email: z.string().optional(),
      domain: z.string().optional(),
    }).partial().optional(),
    caseTypeSelection: z.array(z.object({
      caseTypeSlug: z.string(),
      subTypeSlugs: z.array(z.string()).default([]),
    })).optional(),
    attorneys: z.array(z.object({
      name: z.string().optional().default(''),
      email: z.string().optional().default(''),
      mobile: z.string().nullable().optional(),
      subTypeAssignments: z.array(z.object({ caseTypeSlug: z.string(), subTypeSlug: z.string() })).default([]),
    })).optional(),
  });
  export type WizardDraft = z.infer<typeof wizardDraftSchema>;
  ```
- [ ] Step 4: `cd packages/shared && pnpm vitest run src/schemas/admin.test.ts && pnpm build` — pass, build 0.
- [ ] Step 5: Commit `feat(shared): permissive wizardDraftSchema for partial onboarding autosave`.

---

## Task 3: Route — partial save + GET draft; provisioning helpers

**Files:** Modify `packages/api/src/lib/admin/tenant-provisioning.ts`, `packages/api/src/app/api/admin/tenants/[id]/onboarding/route.ts`; Test `packages/api/src/app/api/admin/tenants/onboarding.test.ts`.

**Interfaces:**
- Produces `saveWizardDraft(accountId, draft: WizardDraft, now?)`: persists `JSON.stringify(draft)` to `accounts.onboarding_draft_json`; also persists `accounts.domain` when `draft.firmIdentity?.domain` is a non-empty string.
- Produces `getWizardDraft(accountId): Promise<unknown | null>`: returns the parsed `onboarding_draft_json` or null.
- Route: `PUT` with `finish` falsy → lenient path (parse `wizardDraftSchema`, `saveWizardDraft`, return `{ onboardingStatus:'draft', saved:true }`, never 400 on incomplete). `PUT` with `finish:true` → UNCHANGED strict path. New `GET` → `{ draft }`.

- [ ] Step 1: In `tenant-provisioning.ts` add:
  ```typescript
  import type { WizardDraft } from '@legal-chatbot/shared';

  export async function saveWizardDraft(
    accountId: string, draft: WizardDraft, now: () => string = () => new Date().toISOString(),
  ): Promise<void> {
    void now;
    const updates: Record<string, unknown> = { onboarding_draft_json: JSON.stringify(draft) };
    const domain = draft.firmIdentity?.domain;
    if (domain && domain.length > 0) updates.domain = domain;
    await db.update(schema.accounts).set(updates).where(eq(schema.accounts.id, accountId));
  }

  export async function getWizardDraft(accountId: string): Promise<unknown | null> {
    const rows = await db.select({ json: schema.accounts.onboarding_draft_json })
      .from(schema.accounts).where(eq(schema.accounts.id, accountId));
    const json = rows[0]?.json;
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }
  ```
- [ ] Step 2: Update the route. Add imports `wizardDraftSchema` (from shared) and `saveWizardDraft, getWizardDraft` (from provisioning). Restructure `PUT`:
  ```typescript
  export async function PUT(req, { params }) {
    const guard = await requireSuperAdmin(); if (!guard.ok) return guard.response;
    const { id: accountId } = await params;
    const body = await req.json().catch(() => null);

    if (body?.finish === true) {
      const parsed = wizardSubmissionSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: 'Invalid submission' }, { status: 400 });
      const { ready, missing } = await saveOnboardingDraft(accountId, parsed.data);
      if (!ready) return NextResponse.json({ error: 'Required sections are missing', missing }, { status: 422 });
      await seedSopAndBranches(accountId, parsed.data.caseTypeSelection);
      if (parsed.data.attorneys && parsed.data.attorneys.length > 0) await provisionAttorneys(accountId, parsed.data.attorneys);
      await recordAdminAction(guard.adminId, 'tenant.onboard', accountId);
      return NextResponse.json({ onboardingStatus: 'draft', draftReady: true });
    }

    // Partial autosave — never rejects incomplete input.
    const draft = wizardDraftSchema.safeParse(body);
    if (!draft.success) return NextResponse.json({ error: 'Malformed draft' }, { status: 400 });
    await saveWizardDraft(accountId, draft.data);
    return NextResponse.json({ onboardingStatus: 'draft', saved: true });
  }

  export async function GET(_req, { params }) {
    const guard = await requireSuperAdmin(); if (!guard.ok) return guard.response;
    const { id } = await params;
    const draft = await getWizardDraft(id);
    return NextResponse.json({ draft });
  }
  ```
  Keep `saveOnboardingDraft` import (used by finish path). Import `wizardSubmissionSchema` remains.
- [ ] Step 3: In `onboarding.test.ts`, add tests: (a) a partial PUT `{ firmIdentity: { firmName: 'Acme' } }` (no finish) returns 200 `{ saved: true }` and does NOT call seedSopAndBranches; (b) GET after that partial save returns `{ draft: { firmIdentity: { firmName: 'Acme' }, ... } }`. Mock the provisioning module so `seedSopAndBranches`/`provisionAttorneys` are spies (already hoisted); assert they are NOT called on the partial path. The accounts test table already has `domain` + must have `onboarding_draft_json` (from Task 1) — add it if that fixture wasn't auto-patched.
- [ ] Step 4: `cd packages/api && pnpm vitest run src/app/api/admin/tenants/onboarding.test.ts` — pass.
- [ ] Step 5: `cd packages/api && npx tsc --noEmit && pnpm vitest run` — tsc 0, full suite green.
- [ ] Step 6: Commit `feat(onboarding): partial-progress autosave + GET draft resume`.

---

## Task 4: Wizard hydrates saved draft on mount + build

**Files:** Modify `packages/api/src/app/admin/(console)/tenants/[id]/onboarding/page.tsx`.

- [ ] Step 1: Add a mount effect that GETs the draft and hydrates state:
  ```typescript
  import { use, useState, useEffect } from 'react';
  // ...inside component, after the useState hooks:
  useEffect(() => {
    fetch(`/api/admin/tenants/${id}/onboarding`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        const draft = d?.draft;
        if (!draft) return;
        if (draft.firmIdentity) setFirm((f) => ({ ...f, ...draft.firmIdentity }));
        if (Array.isArray(draft.caseTypeSelection)) setSelection(draft.caseTypeSelection);
        if (Array.isArray(draft.attorneys)) setAttorneys(draft.attorneys.map((a) => ({ name: a.name ?? '', email: a.email ?? '', mobile: a.mobile ?? '', subTypeAssignments: a.subTypeAssignments ?? [] })));
      })
      .catch(() => {});
  }, [id]);
  ```
- [ ] Step 2: `cd packages/api && npx tsc --noEmit` — exit 0.
- [ ] Step 3: Build: `cd packages/api && DATABASE_URL="postgres://test:test@localhost:5432/test" SESSION_SECRET="$(printf 'a%.0s' {1..32})" ADMIN_SESSION_SECRET="$(printf 'b%.0s' {1..32})" ENCRYPTION_KEY="$(printf '0%.0s' {1..64})" GOOGLE_GENERATIVE_AI_API_KEY=x ANTHROPIC_API_KEY=x OPENAI_API_KEY=x npx next build` — compiles, onboarding route present.
- [ ] Step 4: Commit `feat(onboarding): hydrate wizard from saved draft on mount`.

---

## Task 5: Apply migration 0012 to Neon

- [ ] Step 1: `cd packages/api && DATABASE_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)" npx tsx src/db/migrate.ts` — only 0012 applies.
- [ ] Step 2: Verify `accounts.onboarding_draft_json` exists in Neon (information_schema query).
- [ ] Step 3: No commit needed (migration file already committed in Task 1).

---

## Self-Review

- Coverage: partial-save persistence (T1 column, T3 route+helpers), reload (T3 GET, T4 hydrate), lenient validation (T2). Finish path untouched (T3 preserves strict branch). ✓
- Type consistency: `WizardDraft` from T2 used in T3 `saveWizardDraft`; `getWizardDraft` returns `unknown|null` hydrated defensively in T4. ✓
- No placeholders; every code step has full code.
