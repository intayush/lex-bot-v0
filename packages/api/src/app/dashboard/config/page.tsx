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
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">Configuration</h2>
          {latest && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              latest.isPublished
                ? 'bg-[#ECFDF5] text-[#059669]'
                : 'bg-[#F5F5F5] text-[#737373]'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${latest.isPublished ? 'bg-[#059669]' : 'bg-[#A3A3A3]'}`} />
              v{latest.version} {latest.isPublished ? 'Published' : 'Draft'}
            </span>
          )}
        </div>
        <p className="text-sm text-[#737373] mt-1.5">Customize chatbot behavior, persona, and practice areas</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
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
