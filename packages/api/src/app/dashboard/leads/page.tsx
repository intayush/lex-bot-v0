import { eq, desc } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db } from '../../../db';
import { leads } from '../../../db/schema';
import { getAuthSession } from '../../../lib/dashboard-session';
import { LeadTable } from './lead-table';

export default async function LeadsPage() {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const allLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.account_id, session.accountId))
    .orderBy(desc(leads.created_at));

  // Spec 015 / spec 016 — 4-value classification vocabulary:
  //   HOT (76-100) / WARM (51-75) / COLD (26-50) / SPAM (0-25)
  const totalCount = allLeads.length;
  const hotCount = allLeads.filter((l) => l.classification === 'HOT').length;
  const warmCount = allLeads.filter((l) => l.classification === 'WARM').length;
  const coldCount = allLeads.filter((l) => l.classification === 'COLD').length;
  const spamCount = allLeads.filter((l) => l.classification === 'SPAM').length;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">Leads</h2>
        <p className="text-sm text-[#737373] mt-1">Track and manage incoming inquiries</p>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">Total Leads</p>
          <p className="text-2xl font-semibold text-[#171717] mt-1">{totalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">HOT</p>
          <p className="text-2xl font-semibold text-[#DC2626] mt-1">{hotCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">WARM</p>
          <p className="text-2xl font-semibold text-[#EA580C] mt-1">{warmCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">COLD</p>
          <p className="text-2xl font-semibold text-[#2563EB] mt-1">{coldCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">SPAM</p>
          <p className="text-2xl font-semibold text-[#737373] mt-1">{spamCount}</p>
        </div>
      </div>

      {/* Table */}
      <LeadTable leads={allLeads} />
    </div>
  );
}
