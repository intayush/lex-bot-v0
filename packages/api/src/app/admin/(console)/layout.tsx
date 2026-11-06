import { redirect } from 'next/navigation';
import { getAdminSession } from '../../../lib/admin-session';
import { AdminSidebar } from './sidebar';

/**
 * 028-admin-ui-rework — guarded console layout.
 * Keeps the server-side session guard from 027. Sidebar is replaced.
 */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session.adminId) redirect('/admin/login');

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <AdminSidebar email={session.email} />
      <main className="flex-1 min-w-0">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
