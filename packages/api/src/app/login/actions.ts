'use server';

import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { accounts } from '../../db/schema';
import { getAuthSession } from '../../lib/dashboard-session';

export async function loginAction(_prevState: { error?: string } | null, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required' };
  }

  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email));

  const account = rows[0];

  if (!account) {
    return { error: 'Invalid email or password' };
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    return { error: 'Invalid email or password' };
  }

  const session = await getAuthSession();
  session.accountId = account.id;
  session.email = account.email;
  session.firmName = account.firm_name || '';
  await session.save();

  redirect('/dashboard/leads');
}
