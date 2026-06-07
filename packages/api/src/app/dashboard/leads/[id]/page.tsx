import { eq, and } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import { db } from '../../../../db';
import { leads, sessions } from '../../../../db/schema';
import { getAuthSession } from '../../../../lib/dashboard-session';
import { ActionPicker } from './action-picker';
import type { LeadAction } from '@legal-chatbot/shared';

// Spec 015 / spec 016 — 4-value classification vocabulary:
//   HOT (76-100) / WARM (51-75) / COLD (26-50) / SPAM (0-25)
const classificationStyles: Record<string, { dot: string; bg: string; text: string }> = {
  HOT: { dot: 'bg-[#DC2626]', bg: 'bg-[#FEF2F2]', text: 'text-[#991B1B]' },
  WARM: { dot: 'bg-[#EA580C]', bg: 'bg-[#FFF7ED]', text: 'text-[#9A3412]' },
  COLD: { dot: 'bg-[#2563EB]', bg: 'bg-[#EFF6FF]', text: 'text-[#1E40AF]' },
  SPAM: { dot: 'bg-[#A3A3A3]', bg: 'bg-[#F5F5F5]', text: 'text-[#525252]' },
};

const statusStyles: Record<string, { dot: string; text: string }> = {
  new: { dot: 'bg-[#059669]', text: 'text-[#059669]' },
  contacted: { dot: 'bg-[#2563EB]', text: 'text-[#2563EB]' },
  dismissed: { dot: 'bg-[#A3A3A3]', text: 'text-[#737373]' },
};

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getAuthSession();
  if (!session.accountId) redirect('/login');

  const leadRows = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.account_id, session.accountId)));

  const lead = leadRows[0];

  if (!lead) notFound();

  let messages: Message[] = [];
  if (lead.session_id) {
    const chatSessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, lead.session_id));
    const chatSession = chatSessionRows[0];
    if (chatSession?.messages_json) {
      try {
        messages = JSON.parse(chatSession.messages_json);
      } catch {}
    }
  }

  const urgencyFactors: string[] = lead.urgency_factors_json
    ? JSON.parse(lead.urgency_factors_json)
    : [];

  // Spec 016 — parse the branch snapshot (FR-018) when present.
  // The snapshot is frozen at finalization; rendering it here lets
  // lawyers see exactly which questions/answers contributed to the
  // lead's score, even if the live branch was later edited or deleted.
  type BranchSnapshotShape = {
    branch_id: string;
    branch_version_id: string;
    version_number: number;
    case_type_slug: string;
    sub_type_slug: string;
    questions_snapshot: Array<{
      id: string;
      position: number;
      text: string;
      chips: Array<{ slug: string; label: string; score_weight: number }>;
    }>;
    captured_chips: Array<{ question_id: string; chip_slugs: string[] }>;
    captured_free_text: Array<{ question_id: string; text: string }>;
    score: number;
    classification: string;
    reasons: string[];
    branch_incomplete: boolean;
    finalized_at: number;
  };
  const branchSnapshot: BranchSnapshotShape | null = lead.branch_snapshot_json
    ? (JSON.parse(lead.branch_snapshot_json) as BranchSnapshotShape)
    : null;

  const cls = classificationStyles[lead.classification ?? 'SPAM'] ?? classificationStyles.SPAM;
  const sts = statusStyles[lead.status || 'new'] ?? statusStyles.new;

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-[#737373] mb-6">
        <a href="/dashboard/leads" className="hover:text-[#171717] transition-colors">
          Leads
        </a>
        <span className="text-[#D4D4D4]">&gt;</span>
        <span className="text-[#171717] font-medium">{lead.name || 'Anonymous'}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-8">
        <h2 className="text-2xl font-semibold text-[#171717] tracking-tight">{lead.name || 'Anonymous'}</h2>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls.bg} ${cls.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cls.dot}`} />
            {lead.classification}
          </span>
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium capitalize ${sts.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${sts.dot}`} />
            {lead.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Lead Info — 3 cols */}
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3] mb-5">Details</h3>

            <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-4">
              <dt className="text-xs uppercase tracking-wide text-[#A3A3A3]">Case Type</dt>
              <dd className="text-sm text-[#171717]">{lead.case_type || <span className="text-[#D4D4D4]">&mdash;</span>}</dd>

              <dt className="text-xs uppercase tracking-wide text-[#A3A3A3]">Email</dt>
              <dd className="text-sm text-[#171717]">
                {lead.contact_email ? (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    {lead.contact_email}
                  </span>
                ) : (
                  <span className="text-[#D4D4D4]">&mdash;</span>
                )}
              </dd>

              <dt className="text-xs uppercase tracking-wide text-[#A3A3A3]">Phone</dt>
              <dd className="text-sm text-[#171717]">
                {lead.contact_phone ? (
                  <span className="inline-flex items-center gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {lead.contact_phone}
                  </span>
                ) : (
                  <span className="text-[#D4D4D4]">&mdash;</span>
                )}
              </dd>

              <dt className="text-xs uppercase tracking-wide text-[#A3A3A3]">Incident Date</dt>
              <dd className="text-sm text-[#171717] tabular-nums">{lead.incident_date || <span className="text-[#D4D4D4]">&mdash;</span>}</dd>

              <dt className="text-xs uppercase tracking-wide text-[#A3A3A3]">Submitted</dt>
              <dd className="text-sm text-[#171717] tabular-nums">{lead.created_at ? new Date(lead.created_at).toLocaleString() : <span className="text-[#D4D4D4]">&mdash;</span>}</dd>
            </dl>
          </div>

          {/* 013-lead-action-tracking T015: lawyer's follow-up action picker. */}
          <ActionPicker
            leadId={lead.id}
            initialAction={(lead.follow_up_action as LeadAction | null) ?? null}
            initialChangedAt={lead.follow_up_action_changed_at ?? null}
          />

          {/* Urgency Factors — surfaced FIRST in the descriptive content so
              lawyers see the most actionable signal immediately after the
              Lead Details card. The red panel + alert icon make it
              unmissable; lower-priority sections (Description, Classification
              Rationale, Branch snapshot) come below. */}
          {urgencyFactors.length > 0 && (
            <div className="bg-[#FEF2F2] rounded-xl border border-[#FECACA] p-6">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[#991B1B] mb-3 flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                Urgency Factors
              </h3>
              <ul className="space-y-2">
                {urgencyFactors.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#991B1B]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] mt-1.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lead.brief_description && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3] mb-3">Description</h3>
              <p className="text-sm text-[#171717] leading-relaxed">{lead.brief_description}</p>
            </div>
          )}

          {lead.classification_rationale && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3] mb-3">Classification Rationale</h3>
              <p className="text-sm text-[#171717] leading-relaxed">{lead.classification_rationale}</p>
            </div>
          )}

          {/* Spec 016 — Branch snapshot (FR-018). Rendered when the lead
              came through a configured branch. Survives branch
              deletion. */}
          {branchSnapshot && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <div className="flex items-baseline justify-between mb-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3]">
                  Branch intake
                </h3>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-[#A3A3A3]">
                    v{branchSnapshot.version_number}
                  </span>
                  {branchSnapshot.branch_incomplete && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#FEF3C7] text-[#92400E]">
                      Partial
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-3">
                {branchSnapshot.questions_snapshot
                  .slice()
                  .sort((a, b) => a.position - b.position)
                  .map((q) => {
                    const captured = branchSnapshot.captured_chips.find(
                      (c) => c.question_id === q.id,
                    );
                    const freeText = branchSnapshot.captured_free_text.find(
                      (c) => c.question_id === q.id,
                    );
                    const chosenChips = captured
                      ? q.chips.filter((c) => captured.chip_slugs.includes(c.slug))
                      : [];
                    return (
                      <div
                        key={q.id}
                        className="border-l-2 border-[#E5E5E5] pl-3 py-1"
                      >
                        <p className="text-xs text-[#737373] mb-1">{q.text}</p>
                        {chosenChips.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {chosenChips.map((chip) => (
                              <span
                                key={chip.slug}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[#F5F5F5] text-[#171717]"
                              >
                                {chip.label}
                                <span className="text-[10px] text-[#737373] tabular-nums">
                                  {chip.score_weight >= 0
                                    ? `+${chip.score_weight}`
                                    : chip.score_weight}
                                </span>
                              </span>
                            ))}
                          </div>
                        ) : freeText ? (
                          <p className="text-sm text-[#171717] italic">
                            &ldquo;{freeText.text}&rdquo;
                          </p>
                        ) : (
                          <p className="text-xs text-[#A3A3A3] italic">
                            (not answered)
                          </p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Spec 016 — when the captured (case_type, sub_type) had no
              configured branch, surface a small notice so lawyers can
              tell at a glance that scoring was driven by the legacy
              classifier rather than the deterministic branch. */}
          {!branchSnapshot && lead.case_type && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              <p className="text-xs text-[#737373]">
                No branch was configured for this matter. Classification was
                set by the legacy LLM classifier (default-only flow).
              </p>
            </div>
          )}
        </div>

        {/* Chat Transcript — 2 cols */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-[#E5E5E5]">
            <div className="px-6 py-4 border-b border-[#E5E5E5] flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3]">Conversation</h3>
              {messages.length > 0 && (
                <span className="text-[10px] text-[#A3A3A3] tabular-nums ml-auto">{messages.length} messages</span>
              )}
            </div>

            {messages.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-xl bg-[#F5F5F5] flex items-center justify-center mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[#525252]">No transcript available</p>
                <p className="text-xs text-[#A3A3A3] mt-1">Chat messages will appear here</p>
              </div>
            ) : (
              <div className="p-6 space-y-4 max-h-[700px] overflow-y-auto">
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] px-4 py-3 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#2563EB] text-white rounded-2xl rounded-br-md'
                          : 'bg-[#F5F5F5] text-[#171717] rounded-2xl rounded-bl-md'
                      }`}
                    >
                      <span className={`text-[10px] uppercase tracking-wide font-medium block mb-1.5 ${
                        msg.role === 'user' ? 'text-white/60' : 'text-[#A3A3A3]'
                      }`}>
                        {msg.role === 'user' ? 'Visitor' : 'Chatbot'}
                      </span>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
