import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../../../../db';
import { accounts } from '../../../../db/schema';
import { getAuthSession } from '../../../../lib/dashboard-session';

export async function POST(req: Request) {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email));

  const account = rows[0];

  if (!account) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const session = await getAuthSession();
  session.accountId = account.id;
  session.email = account.email;
  session.firmName = account.firm_name || '';
  await session.save();

  return NextResponse.json({ success: true, redirect: '/dashboard/leads' });
}
