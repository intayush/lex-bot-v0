import { redirect } from 'next/navigation';
import { getAuthSession } from '../../../lib/dashboard-session';
import { getLatestConfig } from '../../../lib/config';
import { ConfigForm } from './config-form';
import { PreviewChat } from './preview-chat';

export const dynamic = 'force-dynamic';

export default async function ConfigPage() {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const latest = await getLatestConfig(session.accountId);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Chatbot Configuration</h2>
        {latest && (
          <span className="text-sm text-gray-500">
            Version {latest.version} {latest.isPublished ? '(Published)' : '(Draft)'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ConfigForm initialConfig={latest?.config ?? null} />
        </div>
        <div className="lg:col-span-1">
          <PreviewChat />
        </div>
      </div>
    </div>
  );
}
