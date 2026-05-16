import { redirect } from 'next/navigation';
import { getAuthSession } from '../../lib/dashboard-session';
import { Sidebar } from './sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: 'var(--color-bg)' }}>
      <Sidebar firmName={session.firmName} email={session.email} />

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Mobile spacer for fixed top bar */}
        <div className="h-14 lg:hidden" />
        <div className="p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
