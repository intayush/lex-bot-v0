'use client';

import { useState } from 'react';
import { LEAD_ACTION_LABELS, type LeadAction } from '@legal-chatbot/shared';

interface Lead {
  id: string;
  name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  case_type: string | null;
  classification: string | null;
  status: string | null;
  /** 013-lead-action-tracking: lawyer-recorded follow-up action slug or null. */
  follow_up_action: string | null;
  created_at: string | null;
}

const classificationStyles: Record<string, { dot: string; bg: string; text: string }> = {
  urgent: { dot: 'bg-[#DC2626]', bg: 'bg-[#FEF2F2]', text: 'text-[#991B1B]' },
  normal: { dot: 'bg-[#2563EB]', bg: 'bg-[#EFF6FF]', text: 'text-[#1E40AF]' },
  unqualified: { dot: 'bg-[#A3A3A3]', bg: 'bg-[#F5F5F5]', text: 'text-[#525252]' },
};

const statusStyles: Record<string, { dot: string; text: string }> = {
  new: { dot: 'bg-[#059669]', text: 'text-[#059669]' },
  contacted: { dot: 'bg-[#2563EB]', text: 'text-[#2563EB]' },
  dismissed: { dot: 'bg-[#A3A3A3]', text: 'text-[#737373]' },
};

/**
 * 013-lead-action-tracking: per-action visual style for the new "Action"
 * column. Slug → {dot, bg, text} colors per research.md R7.
 */
const actionStyles: Record<LeadAction, { dot: string; bg: string; text: string }> = {
  contacted: { dot: 'bg-[#059669]', bg: 'bg-[#ECFDF5]', text: 'text-[#047857]' },
  call_no_answer: { dot: 'bg-[#D97706]', bg: 'bg-[#FFFBEB]', text: 'text-[#92400E]' },
  meeting_fixed: { dot: 'bg-[#2563EB]', bg: 'bg-[#EFF6FF]', text: 'text-[#1E40AF]' },
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return 'Just now';
}

const filterOptions = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'normal', label: 'Normal' },
  { key: 'unqualified', label: 'Unqualified' },
];

export function LeadTable({ leads }: { leads: Lead[] }) {
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? leads
    : leads.filter((l) => l.classification === filter);

  return (
    <div>
      {/* Filter Pills */}
      <div className="mb-5 flex flex-wrap gap-2">
        {filterOptions.map((f) => {
          const isActive = filter === f.key;
          const count = f.key === 'all' ? leads.length : leads.filter((l) => l.classification === f.key).length;
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#171717] text-white'
                  : 'bg-white text-[#737373] border border-[#E5E5E5] hover:border-[#171717]'
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${isActive ? 'text-white/60' : 'text-[#A3A3A3]'}`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-xl border border-[#E5E5E5] py-16 flex flex-col items-center justify-center">
          <div className="w-12 h-12 rounded-xl bg-[#F5F5F5] flex items-center justify-center mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </div>
          <p className="text-sm font-medium text-[#525252]">No leads found</p>
          <p className="text-xs text-[#A3A3A3] mt-1">Leads will appear here when visitors interact with the chatbot</p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E5E5]">
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Name</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Case Type</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Classification</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Action</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Contact</th>
                  <th className="text-left px-5 py-3 text-xs font-medium uppercase tracking-wider text-[#A3A3A3]">Date</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => {
                  const cls = classificationStyles[lead.classification || 'normal'] ?? classificationStyles.normal;
                  const sts = statusStyles[lead.status || 'new'] ?? statusStyles.new;
                  const actionSlug = (lead.follow_up_action ?? null) as LeadAction | null;
                  const actionStyle = actionSlug ? actionStyles[actionSlug] : null;
                  return (
                    <tr key={lead.id} className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA] transition">
                      <td className="px-5 py-4">
                        <a
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-[#171717] hover:text-[#2563EB] transition-colors"
                        >
                          {lead.name || 'Anonymous'}
                        </a>
                      </td>
                      <td className="px-5 py-4 text-sm text-[#737373]">{lead.case_type || <span className="text-[#D4D4D4]">&mdash;</span>}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls.bg} ${cls.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cls.dot}`} />
                          {lead.classification || 'unknown'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium capitalize ${sts.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sts.dot}`} />
                          {lead.status || 'new'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {actionSlug && actionStyle ? (
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${actionStyle.bg} ${actionStyle.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${actionStyle.dot}`} />
                            {LEAD_ACTION_LABELS[actionSlug]}
                          </span>
                        ) : (
                          <span className="text-[#D4D4D4]">&mdash;</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {lead.contact_email ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-[#737373]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                              <rect x="2" y="4" width="20" height="16" rx="2" />
                              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                            </svg>
                            <span className="truncate max-w-[160px]">{lead.contact_email}</span>
                          </span>
                        ) : lead.contact_phone ? (
                          <span className="inline-flex items-center gap-1.5 text-sm text-[#737373]">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A3A3A3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                            </svg>
                            {lead.contact_phone}
                          </span>
                        ) : (
                          <span className="text-[#D4D4D4]">&mdash;</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm text-[#737373] font-mono tabular-nums">
                        {lead.created_at ? formatRelativeTime(lead.created_at) : <span className="text-[#D4D4D4]">&mdash;</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {filtered.map((lead) => {
              const cls = classificationStyles[lead.classification || 'normal'] ?? classificationStyles.normal;
              const sts = statusStyles[lead.status || 'new'] ?? statusStyles.new;
              return (
                <a
                  key={lead.id}
                  href={`/dashboard/leads/${lead.id}`}
                  className="block bg-white rounded-xl border border-[#E5E5E5] p-4 hover:border-[#D4D4D4] transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-medium text-[#171717] text-sm">{lead.name || 'Anonymous'}</p>
                      <p className="text-xs text-[#A3A3A3] mt-0.5">{lead.case_type || 'No case type'}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls.bg} ${cls.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${cls.dot}`} />
                      {lead.classification || 'unknown'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`inline-flex items-center gap-1.5 font-medium capitalize ${sts.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${sts.dot}`} />
                      {lead.status || 'new'}
                    </span>
                    <span className="text-[#A3A3A3] font-mono tabular-nums">
                      {lead.created_at ? formatRelativeTime(lead.created_at) : '\u2014'}
                    </span>
                  </div>
                  {(lead.contact_email || lead.contact_phone) && (
                    <div className="mt-2.5 pt-2.5 border-t border-[#F5F5F5] text-xs text-[#737373] flex items-center gap-1.5 truncate">
                      {lead.contact_email ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <rect x="2" y="4" width="20" height="16" rx="2" />
                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                          </svg>
                          <span className="truncate">{lead.contact_email}</span>
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                          {lead.contact_phone}
                        </>
                      )}
                    </div>
                  )}
                </a>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
