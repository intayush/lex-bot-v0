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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Leads</h2>
      <LeadTable leads={allLeads} />
    </div>
  );
}
