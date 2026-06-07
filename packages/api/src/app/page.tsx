import { redirect } from 'next/navigation';
import { getAuthSession } from '../lib/dashboard-session';

/**
 * Root entry point. Sends the visitor to one of two places depending
 * on whether they have an active dashboard session:
 *   - logged in     → /dashboard/leads (the lead table is the
 *                     practical "home" for firm staff)
 *   - logged out    → /login (the existing login form)
 *
 * iron-session restores the session from the encrypted
 * `legal_chatbot_session` cookie automatically; if the cookie is
 * present and valid the redirect short-circuits the form and the
 * user goes straight to the dashboard. That's the "auto-login if
 * cookies/session exist" behaviour.
 *
 * Forced server-side render (no static caching) so each visit
 * re-evaluates the session. `redirect()` throws Next's
 * `NEXT_REDIRECT` error which the framework turns into a 307; this
 * page never renders any HTML.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getAuthSession();
  if (session.accountId) {
    redirect('/dashboard/leads');
  }
  redirect('/login');
}
