import { NextResponse } from 'next/server';
import { getAuthSession } from '../../../../lib/dashboard-session';

export async function POST() {
  const session = await getAuthSession();
  session.destroy();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'));
}
