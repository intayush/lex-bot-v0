import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../../../db';
import { configurations } from '../../../../../db/schema';
import { getAuthSession } from '../../../../../lib/dashboard-session';

const bodySchema = z.object({
  version_id: z.string().min(1),
  label: z.string().max(80).nullable(),
});

/**
 * PATCH /api/dashboard/config/label
 *
 * Updates the label on a specific configuration version in-place.
 * Does not create a new version — label is mutable metadata only.
 */
export async function PATCH(req: Request) {
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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'bad_request', message: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const result = await db
    .update(configurations)
    .set({ label: parsed.data.label })
    .where(and(
      eq(configurations.id, parsed.data.version_id),
      eq(configurations.account_id, session.accountId),
    ))
    .returning({ id: configurations.id });

  if (result.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
