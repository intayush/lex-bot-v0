import { redirect } from 'next/navigation';
import { getAuthSession } from '../../../lib/dashboard-session';
import {
  getLatestSOP,
  getCaseTypes,
  getGoodbyePhrases,
} from '../../../lib/sop-config';
import { listBranchPairsForAccount } from '../../../lib/branches-config';
import { SopEditor } from './sop-editor';
import { PreviewChat } from '../config/preview-chat';

export const dynamic = 'force-dynamic';

/**
 * SOP editor page (010-sop-workflow Phase 8 — T063 + T069).
 *
 * Server component. Authenticates the user, fetches the account's
 * LATEST SOP (published or draft) plus case-types and goodbye-phrases,
 * and renders the editor alongside a sticky <PreviewChat> sidebar.
 *
 * Why latest (not just published)?
 *   The editor is the lawyer's working surface. If they have a draft
 *   v3 sitting on top of published v2, the editor should show v3 so
 *   their pending changes appear. The Publish button in <SopEditor>
 *   makes the latest live.
 *
 * The PreviewChat sidebar sends `x-preview: true` to /api/chat, which
 * (via T069's getSOPBundle change) loads the latest SOP — so the
 * lawyer can test their draft before publishing.
 *
 * Note on R11 lazy migration: when an account has no SOP yet
 * (legacy account that pre-dates 010), the loaders return null /
 * empty arrays. Phase 9 (T071-T073) will hook a migration trigger here.
 * Until then, the editor surfaces an empty-state and a
 * "Save your first SOP" affordance.
 */
export default async function SopPage() {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const [sop, caseTypes, goodbyePhrases, branchPairs] = await Promise.all([
    getLatestSOP(session.accountId),
    getCaseTypes(session.accountId),
    getGoodbyePhrases(session.accountId),
    listBranchPairsForAccount(session.accountId),
  ]);

  // Tagline: tell the lawyer whether they're looking at the live
  // version or a draft, so the page-header chip is unambiguous.
  let badge: { label: string; tone: 'green' | 'gray' | 'amber' } | null = null;
  if (sop && sop.is_published) {
    badge = { label: `v${sop.version} Published`, tone: 'green' };
  } else if (sop && !sop.is_published) {
    badge = { label: `v${sop.version} Draft (unpublished)`, tone: 'gray' };
  } else {
    badge = { label: 'No SOP yet', tone: 'amber' };
  }

  const tones = {
    green: { bg: 'bg-[#ECFDF5]', text: 'text-[#059669]', dot: 'bg-[#059669]' },
    gray: { bg: 'bg-[#F5F5F5]', text: 'text-[#737373]', dot: 'bg-[#A3A3A3]' },
    amber: { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', dot: 'bg-[#92400E]' },
  } as const;
  const t = tones[badge.tone];

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">
            Standard Operating Procedure
          </h2>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${t.bg} ${t.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
            {badge.label}
          </span>
        </div>
        <p className="text-sm text-[#737373] mt-1.5">
          Define the intake flow your chatbot follows to qualify leads. Reorder
          steps, customize case types, configure per-(case type, sub-type)
          scoring branches, and pick when the bot ends conversations.
          Use the preview pane on the right to test your draft before publishing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <SopEditor
            initialSop={sop}
            initialCaseTypes={caseTypes}
            initialGoodbyePhrases={goodbyePhrases}
            initialBranchPairs={branchPairs}
          />
        </div>
        <div className="lg:col-span-1">
          <PreviewChat />
        </div>
      </div>
    </div>
  );
}
