import { redirect } from 'next/navigation';
import { getAuthSession } from '../../../lib/dashboard-session';
import {
  getPublishedSOP,
  getCaseTypes,
  getGoodbyePhrases,
} from '../../../lib/sop-config';
import { SopEditor } from './sop-editor';

export const dynamic = 'force-dynamic';

/**
 * SOP editor page (010-sop-workflow Phase 8 — T063).
 *
 * Server component. Authenticates the user, fetches the account's
 * currently published SOP + case-types + goodbye-phrases, and passes
 * them to the client tab manager (`<SopEditor>`).
 *
 * Note on R11 lazy migration: when an account has no SOP yet
 * (legacy account that pre-dates 010), `getPublishedSOP` returns null.
 * Phase 9 (T071-T073) will hook a migration trigger here. Until then,
 * the editor surfaces an empty-state and a "Save your first SOP" affordance.
 */
export default async function SopPage() {
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const [sop, caseTypes, goodbyePhrases] = await Promise.all([
    getPublishedSOP(session.accountId),
    getCaseTypes(session.accountId),
    getGoodbyePhrases(session.accountId),
  ]);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">
            Standard Operating Procedure
          </h2>
          {sop && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#ECFDF5] text-[#059669]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#059669]" />
              v{sop.version} Published
            </span>
          )}
          {!sop && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[#FEF3C7] text-[#92400E]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#92400E]" />
              No published SOP
            </span>
          )}
        </div>
        <p className="text-sm text-[#737373] mt-1.5">
          Define the intake flow your chatbot follows to qualify leads. Reorder
          steps, customize case types, and configure when the bot ends conversations.
        </p>
      </div>

      <SopEditor
        initialSop={sop}
        initialCaseTypes={caseTypes}
        initialGoodbyePhrases={goodbyePhrases}
      />
    </div>
  );
}
