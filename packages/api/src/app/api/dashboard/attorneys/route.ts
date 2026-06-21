import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getAuthSession } from '../../../../lib/dashboard-session';
import { getAttorneys, createAttorney } from '../../../../lib/attorneys';
import { db, schema } from '../../../../db';

const createBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  mobile: z.string().nullable().optional(),
  case_type_slugs: z.array(z.string()).optional().default([]),
});

export async function GET() {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const attorneys = await getAttorneys(session.accountId);
  return NextResponse.json({ attorneys });
}

export async function POST(req: Request) {
  const session = await getAuthSession();
  if (!session.accountId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  // Validate all provided case_type_slugs exist for this account
  if (parsed.data.case_type_slugs.length > 0) {
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
    const id = await createAttorney(session.accountId, parsed.data);
    return NextResponse.json({ success: true, id }, { status: 201 });
  } catch (err) {
    // Unique constraint violation = duplicate email
    if (err instanceof Error && err.message.includes('unique')) {
      return NextResponse.json(
        { error: 'conflict', message: 'An attorney with this email already exists.' },
        { status: 409 },
      );
    }
    throw err;
  }
}
