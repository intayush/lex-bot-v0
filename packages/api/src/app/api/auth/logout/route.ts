import { NextResponse, type NextRequest } from 'next/server';
import { getAuthSession } from '../../../../lib/dashboard-session';

export async function POST(req: NextRequest) {
  const session = await getAuthSession();
  session.destroy();
  const url = new URL('/login', req.nextUrl.origin);
  return NextResponse.redirect(url);
}
