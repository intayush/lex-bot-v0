import { redirect } from 'next/navigation';
import { getAuthSession } from '../../lib/dashboard-session';
import { LogoutButton } from './logout-button';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-lg">Legal Chatbot</h1>
          <nav className="flex gap-4 text-sm">
            <a href="/dashboard/leads" className="text-blue-600 hover:underline">Leads</a>
            <a href="/dashboard/config" className="text-blue-600 hover:underline">Configuration</a>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-600">{session.firmName}</span>
          <span className="text-gray-400">{session.email}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
