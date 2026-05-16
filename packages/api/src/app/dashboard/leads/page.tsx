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

  const totalCount = allLeads.length;
  const urgentCount = allLeads.filter((l) => l.classification === 'urgent').length;
  const normalCount = allLeads.filter((l) => l.classification === 'normal').length;
  const unqualifiedCount = allLeads.filter((l) => l.classification === 'unqualified').length;

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">Leads</h2>
        <p className="text-sm text-[#737373] mt-1">Track and manage incoming inquiries</p>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">Total Leads</p>
          <p className="text-2xl font-semibold text-[#171717] mt-1">{totalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">Urgent</p>
          <p className="text-2xl font-semibold text-[#DC2626] mt-1">{urgentCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">Normal</p>
          <p className="text-2xl font-semibold text-[#2563EB] mt-1">{normalCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#737373]">Unqualified</p>
          <p className="text-2xl font-semibold text-[#737373] mt-1">{unqualifiedCount}</p>
        </div>
      </div>

      {/* Table */}
      <LeadTable leads={allLeads} />
    </div>
  );
}
