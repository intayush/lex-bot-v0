/**
 * 027-platform-admin-console — super-admin iron-session.
 *
 * Deliberately parallel to (and cryptographically independent of) the
 * firm-facing `dashboard-session.ts`: a different cookie name AND a different
 * secret, so a firm session cookie can never validate as an admin session and
 * a firm login can never gain super-admin capability (Constitution VIII).
 */
import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { getAdminSessionSecret } from './env';

export interface AdminSessionData {
  adminId?: string;
  email?: string;
}

function sessionOptions(): SessionOptions {
  return {
    password: getAdminSessionSecret(),
    cookieName: 'legal_chatbot_admin',
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    },
  };
}

export async function getAdminSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSessionData>(cookieStore, sessionOptions());
}
