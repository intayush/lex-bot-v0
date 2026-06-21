import fs from 'node:fs';
import path from 'node:path';
import { eq, desc, and } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { db, schema } from '../../../db';
import { leads } from '../../../db/schema';
import { getAuthSession } from '../../../lib/dashboard-session';
import { resolveCaseValueBadge } from '../../../lib/case-value';
import { caseValueConfigSchema } from '@legal-chatbot/shared';
import { LeadTable } from './lead-table';

/**
 * Detect whether the test-matrix HTML report has been published to
 * `public/reports/lead-matrix-latest.html`. The "View test report"
 * button is rendered only when the file exists, so a fresh deploy
 * without a generated report doesn't surface a broken link.
 *
 * The check runs at request time (force-dynamic page), so
 * regenerating the report shows the button immediately on next
 * page load without a build / restart.
 */
function testReportAvailable(): boolean {
  try {
    const p = path.resolve(process.cwd(), 'public', 'reports', 'lead-matrix-latest.html');
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export const dynamic = 'force-dynamic';

export default async function LeadsPage() {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const allLeads = await db
    .select()
    .from(leads)
    .where(eq(leads.account_id, session.accountId))
    .orderBy(desc(leads.created_at));

  // 025-case-value-estimator: load active branch versions for accounts with
  // is_case_value_enabled=true to resolve value badges at read-time.
  const enabledBranchRows = await db
    .select({
      case_type_slug: schema.branches.case_type_slug,
      sub_type_slug: schema.branches.sub_type_slug,
      case_value_config_json: schema.branchVersions.case_value_config_json,
    })
    .from(schema.branches)
    .innerJoin(schema.branchVersions, eq(schema.branchVersions.id, schema.branches.current_version_id))
    .where(and(
      eq(schema.branches.account_id, session.accountId),
      eq(schema.branches.is_case_value_enabled, true),
    ));

  // Build case_type_slug → CaseValueConfig map (top-level slug only per spec)
  const caseValueMap = new Map<string, import('@legal-chatbot/shared').CaseValueConfig>();
  for (const row of enabledBranchRows) {
    if (!row.case_value_config_json || caseValueMap.has(row.case_type_slug)) continue;
    try {
      const parsed = caseValueConfigSchema.safeParse(JSON.parse(row.case_value_config_json));
      if (parsed.success) caseValueMap.set(row.case_type_slug, parsed.data);
    } catch { /* ignore malformed */ }
  }

  // Resolve value badge per lead
  const leadsWithBadge = allLeads.map((lead) => {
    const config = lead.case_type ? caseValueMap.get(lead.case_type) ?? null : null;
    const isSpam = lead.classification === 'SPAM';
    const badge = resolveCaseValueBadge(lead.lead_score ?? null, config, config !== null && !isSpam);
    return { ...lead, case_value_badge: badge };
  });

  // Spec 015 / spec 016 — 4-value classification vocabulary:
  //   HOT (76-100) / WARM (51-75) / COLD (26-50) / SPAM (0-25)
  const totalCount = allLeads.length;
  const hotCount = allLeads.filter((l) => l.classification === 'HOT').length;
  const warmCount = allLeads.filter((l) => l.classification === 'WARM').length;
  const coldCount = allLeads.filter((l) => l.classification === 'COLD').length;
  const spamCount = allLeads.filter((l) => l.classification === 'SPAM').length;
  const showTestReport = testReportAvailable();

  return (
    <div>
      {/* Page Header */}
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">Leads</h2>
          <p className="text-sm text-[#737373] mt-1">Track and manage incoming inquiries</p>
        </div>
        {showTestReport && (
          // Static published report from packages/api/scripts/
          // generate-matrix-report.ts. Opens in a new tab; the
          // file is self-contained (inlined CSS + JS) so no
          // build-time data binding is needed here.
          <a
            href="/reports/lead-matrix-latest.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#171717] hover:bg-[#404040] text-white rounded-lg px-4 py-2 text-sm font-medium transition"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 13V3h7l3 3v7H3z" />
              <path d="M10 3v3h3" />
              <path d="M5 8h6M5 10h6M5 12h4" />
            </svg>
            View test report
          </a>
        )}
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
      <LeadTable leads={leadsWithBadge} />
    </div>
  );
}
