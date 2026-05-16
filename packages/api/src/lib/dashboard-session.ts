import { getIronSession, type SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  accountId?: string;
  email?: string;
  firmName?: string;
}

const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET ?? '',
  cookieName: 'legal_chatbot_session',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
  },
};

export async function getAuthSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}
