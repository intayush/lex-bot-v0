import { nanoid } from 'nanoid';
import { eq, and } from 'drizzle-orm';
import { db, schema } from '../db';

export interface Attorney {
  id: string;
  account_id: string;
  name: string;
  email: string;
  mobile: string | null;
  case_type_slugs: string[];
  created_at: string;
  updated_at: string;
}

export async function getAttorneys(accountId: string): Promise<Attorney[]> {
  const rows = await db
    .select()
    .from(schema.attorneys)
    .where(eq(schema.attorneys.account_id, accountId));

  if (rows.length === 0) return [];

  const assignments = await db
    .select()
    .from(schema.attorneyCaseTypeAssignments)
    .where(eq(schema.attorneyCaseTypeAssignments.account_id, accountId));

  const slugsByAttorney = new Map<string, string[]>();
  for (const a of assignments) {
    const existing = slugsByAttorney.get(a.attorney_id) ?? [];
    existing.push(a.case_type_slug);
    slugsByAttorney.set(a.attorney_id, existing);
  }

  return rows.map((r) => ({
    id: r.id,
    account_id: r.account_id,
    name: r.name,
    email: r.email,
    mobile: r.mobile,
    case_type_slugs: slugsByAttorney.get(r.id) ?? [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function createAttorney(
  accountId: string,
  data: { name: string; email: string; mobile?: string | null; case_type_slugs?: string[] },
): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();

  await db.insert(schema.attorneys).values({
    id,
    account_id: accountId,
    name: data.name,
    email: data.email,
    mobile: data.mobile ?? null,
    created_at: now,
    updated_at: now,
  });

  if (data.case_type_slugs && data.case_type_slugs.length > 0) {
    await db.insert(schema.attorneyCaseTypeAssignments).values(
      data.case_type_slugs.map((slug) => ({
        id: nanoid(),
        attorney_id: id,
        account_id: accountId,
        case_type_slug: slug,
        created_at: now,
      })),
    );
  }

  return id;
}

export async function updateAttorney(
  accountId: string,
  attorneyId: string,
  data: { name?: string; email?: string; mobile?: string | null; case_type_slugs?: string[] },
): Promise<void> {
  const now = new Date().toISOString();

  const updates: Partial<typeof schema.attorneys.$inferInsert> = { updated_at: now };
  if (data.name !== undefined) updates.name = data.name;
  if (data.email !== undefined) updates.email = data.email;
  if ('mobile' in data) updates.mobile = data.mobile ?? null;

  await db
    .update(schema.attorneys)
    .set(updates)
    .where(and(eq(schema.attorneys.id, attorneyId), eq(schema.attorneys.account_id, accountId)));

  if (data.case_type_slugs !== undefined) {
    await db
      .delete(schema.attorneyCaseTypeAssignments)
      .where(eq(schema.attorneyCaseTypeAssignments.attorney_id, attorneyId));

    if (data.case_type_slugs.length > 0) {
      await db.insert(schema.attorneyCaseTypeAssignments).values(
        data.case_type_slugs.map((slug) => ({
          id: nanoid(),
          attorney_id: attorneyId,
          account_id: accountId,
          case_type_slug: slug,
          created_at: now,
        })),
      );
    }
  }
}

export async function deleteAttorney(accountId: string, attorneyId: string): Promise<void> {
  await db
    .delete(schema.attorneys)
    .where(and(eq(schema.attorneys.id, attorneyId), eq(schema.attorneys.account_id, accountId)));
}

export async function getAttorneysForCaseType(
  accountId: string,
  caseTypeSlug: string,
): Promise<Array<{ id: string; name: string; email: string }>> {
  const assignments = await db
    .select({ attorney_id: schema.attorneyCaseTypeAssignments.attorney_id })
    .from(schema.attorneyCaseTypeAssignments)
    .where(
      and(
        eq(schema.attorneyCaseTypeAssignments.account_id, accountId),
        eq(schema.attorneyCaseTypeAssignments.case_type_slug, caseTypeSlug),
      ),
    );

  if (assignments.length === 0) return [];

  const ids = assignments.map((a) => a.attorney_id);
  const rows = await db
    .select({ id: schema.attorneys.id, name: schema.attorneys.name, email: schema.attorneys.email })
    .from(schema.attorneys)
    .where(eq(schema.attorneys.account_id, accountId));

  return rows.filter((r) => ids.includes(r.id));
}
