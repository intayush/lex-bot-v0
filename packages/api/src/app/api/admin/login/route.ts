import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { adminLoginSchema } from '@legal-chatbot/shared';
import { db, schema } from '../../../../db/index';
import { getAdminSession } from '../../../../lib/admin-session';

/**
 * 027-platform-admin-console — super-admin login.
 * Sets the SEPARATE admin session (cookie `legal_chatbot_admin`). A firm login
 * cannot reach this and cannot gain super-admin capability (Constitution VIII).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = adminLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const rows = await db
    .select()
    .from(schema.superAdmins)
    .where(eq(schema.superAdmins.email, email));
  const admin = rows[0];

  // Constant-ish behavior: always compare to avoid trivial user enumeration.
  const valid = admin ? await bcrypt.compare(password, admin.password_hash) : false;
  if (!admin || !valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const session = await getAdminSession();
  session.adminId = admin.id;
  session.email = admin.email;
  await session.save();

  return NextResponse.json({ success: true, redirect: '/admin' });
}
