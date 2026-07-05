import { NextResponse, type NextRequest } from 'next/server';
import { getAdminSession } from '../../../../lib/admin-session';

/** 027-platform-admin-console — destroy the super-admin session. */
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  session.destroy();
  const url = new URL('/admin/login', req.nextUrl.origin);
  return NextResponse.redirect(url);
}
