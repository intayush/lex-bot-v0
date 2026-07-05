import { redirect } from 'next/navigation';
import { getAdminSession } from '../../../lib/admin-session';
import { AdminSidebar } from './sidebar';

/**
 * 027 US1 — guarded console layout. Everything under the `(console)` route
 * group requires a super-admin session; `/admin/login` sits OUTSIDE this group
 * so it is not guarded (no redirect loop). Route groups don't affect the URL,
 * so `(console)/page.tsx` renders at `/admin`.
 */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session.adminId) redirect('/admin/login');

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <AdminSidebar email={session.email} />
      <main className="flex-1 min-w-0">
        <div className="h-14 lg:hidden" />
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
