/**
 * 027-platform-admin-console — super-admin authorization guard.
 *
 * Every `/api/admin/*` handler (except login/logout) MUST call
 * `requireSuperAdmin()` first. Returns the acting `adminId` on success, or a
 * 401 NextResponse to return immediately. A firm session is NOT accepted —
 * only a valid admin session with an `adminId` (Constitution VIII, FR-002).
 */
import { NextResponse } from 'next/server';
import { getAdminSession } from './admin-session';

export type GuardResult =
  | { ok: true; adminId: string }
  | { ok: false; response: NextResponse };

export async function requireSuperAdmin(): Promise<GuardResult> {
  const session = await getAdminSession();
  if (!session.adminId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, adminId: session.adminId };
}
