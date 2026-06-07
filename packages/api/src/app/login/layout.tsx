import { redirect } from 'next/navigation';
import { getAuthSession } from '../../lib/dashboard-session';

/**
 * Force-dynamic so the session check below runs on every visit
 * (the page is otherwise statically cacheable, which would defeat
 * the auto-login bounce).
 */
export const dynamic = 'force-dynamic';

export default async function LoginLayout({ children }: { children: React.ReactNode }) {
  // Auto-login bounce: if the visitor already has a valid session
  // cookie, send them straight to the dashboard's lead table
  // instead of showing the login form. Pairs with `app/page.tsx`'s
  // root-level redirect (logged-out → /login, logged-in →
  // /dashboard/leads) so the entry-point UX is consistent regardless
  // of which URL the visitor lands on first.
  //
  // Iron-session decrypts the `legal_chatbot_session` cookie
  // transparently; an expired or missing cookie surfaces as
  // `session.accountId === undefined`, in which case we render the
  // form as usual.
  const session = await getAuthSession();
  if (session.accountId) {
    redirect('/dashboard/leads');
  }

  return children;
}
