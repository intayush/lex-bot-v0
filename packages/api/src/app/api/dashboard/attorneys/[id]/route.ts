import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getAuthSession } from '../../../../../lib/dashboard-session';
import { updateAttorney, deleteAttorney } from '../../../../../lib/attorneys';
import { db, schema } from '../../../../../db';

const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  mobile: z.string().nullable().optional(),
  case_type_slugs: z.array(z.string()).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await db
    .select({ id: schema.attorneys.id })
    .from(schema.attorneys)
    .where(and(eq(schema.attorneys.id, id), eq(schema.attorneys.account_id, session.accountId)))
    .limit(1);
  if (!existing[0]) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = updateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  // Validate case_type_slugs if provided
  if (parsed.data.case_type_slugs && parsed.data.case_type_slugs.length > 0) {
    const existingSlugs = await db
      .select({ slug: schema.caseTypes.slug })
      .from(schema.caseTypes)
      .where(eq(schema.caseTypes.account_id, session.accountId));
    const slugSet = new Set(existingSlugs.map((r) => r.slug));
    const unknown = parsed.data.case_type_slugs.filter((s) => !slugSet.has(s));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'bad_request', message: `Unknown case type slugs: ${unknown.join(', ')}` },
        { status: 400 },
      );
    }
  }

  try {
    await updateAttorney(session.accountId, id, parsed.data);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.includes('unique')) {
      return NextResponse.json(
        { error: 'conflict', message: 'An attorney with this email already exists.' },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;

  const existing = await db
    .select({ id: schema.attorneys.id })
    .from(schema.attorneys)
    .where(and(eq(schema.attorneys.id, id), eq(schema.attorneys.account_id, session.accountId)))
    .limit(1);
  if (!existing[0]) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  await deleteAttorney(session.accountId, id);
  return NextResponse.json({ success: true });
}
