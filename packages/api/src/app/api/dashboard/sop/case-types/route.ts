/**
 * Dashboard Case-Types Route Handler (`/api/dashboard/sop/case-types`).
 *
 * Implements:
 *   GET  → return account's case-types with nested sub-types (sorted by position).
 *   POST { action: 'save', case_types[] }
 *        → diff against existing rows, apply inserts/updates/deletes
 *          (cascade-deletes sub-types).
 *
 * Transactionality note: `neon-http` driver does not support transactions.
 * Operations are sequential. Failure mode: a partial write leaves the
 * account's case-types in an inconsistent intermediate state. The
 * dashboard always reads-then-writes the full list, so the next
 * successful save reconciles. This matches the existing dashboard
 * config-route pattern.
 *
 * Source of truth: contracts/sop-config-routes-contract.md.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { eq, inArray, asc } from 'drizzle-orm';
import { db, schema } from '../../../../../db';
import { getAuthSession } from '../../../../../lib/dashboard-session';
import { getCaseTypes } from '../../../../../lib/sop-config';
import { diffCaseTypes, type CaseTypeRow, type SubTypeRow } from '../../../../../lib/sop/case-types-diff';

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const subTypeIncomingSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  position: z.number().int().positive(),
});

const caseTypeIncomingSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1).max(100),
  position: z.number().int().positive(),
  is_in_scope: z.boolean(),
  sub_types: z.array(subTypeIncomingSchema),
});

const caseTypesActionSchema = z.object({
  action: z.literal('save'),
  case_types: z.array(caseTypeIncomingSchema),
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const caseTypes = await getCaseTypes(session.accountId);
  return NextResponse.json({ case_types: caseTypes });
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const accountId = session.accountId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request', message: 'Invalid JSON body.' }, { status: 400 });
  }
  const parsed = caseTypesActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 },
    );
  }

  // Read existing rows.
  const existingCaseTypes = await db
    .select()
    .from(schema.caseTypes)
    .where(eq(schema.caseTypes.account_id, accountId))
    .orderBy(asc(schema.caseTypes.position));

  const existingCaseTypeIds = existingCaseTypes.map((ct) => ct.id);
  const existingSubTypes = existingCaseTypeIds.length === 0
    ? []
    : await db
        .select()
        .from(schema.subTypes)
        .where(inArray(schema.subTypes.case_type_id, existingCaseTypeIds));

  // Compute diff.
  let plan;
  try {
    plan = diffCaseTypes({
      existing: existingCaseTypes.map<CaseTypeRow>((ct) => ({
        id: ct.id,
        slug: ct.slug,
        label: ct.label,
        position: ct.position,
        is_in_scope: ct.is_in_scope,
      })),
      existingSubTypes: existingSubTypes.map<SubTypeRow>((st) => ({
        id: st.id,
        case_type_id: st.case_type_id,
        slug: st.slug,
        label: st.label,
        position: st.position,
      })),
      incoming: parsed.data.case_types,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'bad_request', message: err instanceof Error ? err.message : 'diff failed' },
      { status: 400 },
    );
  }

  const nowIso = new Date().toISOString();

  // Apply deletes (sub-types first because of FK), then updates, then inserts.
  // Sub-type deletes happen before case-type deletes (FK from sub_types.case_type_id).
  if (plan.subTypeDeletes.length > 0) {
    await db
      .delete(schema.subTypes)
      .where(inArray(schema.subTypes.id, plan.subTypeDeletes.map((d) => d.id)));
  }
  if (plan.caseTypeDeletes.length > 0) {
    await db
      .delete(schema.caseTypes)
      .where(inArray(schema.caseTypes.id, plan.caseTypeDeletes.map((d) => d.id)));
  }

  // Updates.
  for (const u of plan.caseTypeUpdates) {
    await db
      .update(schema.caseTypes)
      .set({ label: u.label, position: u.position, is_in_scope: u.is_in_scope })
      .where(eq(schema.caseTypes.id, u.id));
  }
  for (const u of plan.subTypeUpdates) {
    await db
      .update(schema.subTypes)
      .set({ label: u.label, position: u.position })
      .where(eq(schema.subTypes.id, u.id));
  }

  // Inserts.
  const newCaseTypeIdsBySlug = new Map<string, string>();
  if (plan.caseTypeInserts.length > 0) {
    const rows = plan.caseTypeInserts.map((c) => {
      const id = nanoid();
      newCaseTypeIdsBySlug.set(c.slug, id);
      return {
        id,
        account_id: accountId,
        slug: c.slug,
        label: c.label,
        position: c.position,
        is_in_scope: c.is_in_scope,
        created_at: nowIso,
      };
    });
    await db.insert(schema.caseTypes).values(rows);
  }
  if (plan.subTypeInsertsForExistingParents.length > 0) {
    await db.insert(schema.subTypes).values(
      plan.subTypeInsertsForExistingParents.map((st) => ({
        id: nanoid(),
        case_type_id: st.case_type_id,
        slug: st.slug,
        label: st.label,
        position: st.position,
        created_at: nowIso,
      })),
    );
  }
  if (plan.subTypeInsertsForNewParents.length > 0) {
    await db.insert(schema.subTypes).values(
      plan.subTypeInsertsForNewParents.map((st) => {
        const parentId = newCaseTypeIdsBySlug.get(st.parent_slug);
        if (!parentId) {
          // Defensive — diff shouldn't emit a sub-type with a non-existent parent_slug.
          throw new Error(`Internal error: sub-type "${st.slug}" references missing parent slug "${st.parent_slug}".`);
        }
        return {
          id: nanoid(),
          case_type_id: parentId,
          slug: st.slug,
          label: st.label,
          position: st.position,
          created_at: nowIso,
        };
      }),
    );
  }

  return NextResponse.json({ success: true });
}
