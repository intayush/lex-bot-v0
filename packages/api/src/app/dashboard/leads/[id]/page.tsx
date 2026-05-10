import { eq, and } from 'drizzle-orm';
import { redirect, notFound } from 'next/navigation';
import { db } from '../../../../db';
import { leads, sessions } from '../../../../db/schema';
import { getAuthSession } from '../../../../lib/dashboard-session';

const badgeColors: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  normal: 'bg-blue-100 text-blue-800',
  unqualified: 'bg-gray-100 text-gray-600',
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

  return (
    <div>
      <a href="/dashboard/leads" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
        &larr; Back to Leads
      </a>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lead Info */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">{lead.name || 'Anonymous'}</h2>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${badgeColors[lead.classification || 'normal']}`}>
              {lead.classification}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-gray-500">Case Type</dt>
              <dd className="font-medium">{lead.case_type || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd className="font-medium capitalize">{lead.status}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Email</dt>
              <dd>{lead.contact_email || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Phone</dt>
              <dd>{lead.contact_phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Incident Date</dt>
              <dd>{lead.incident_date || '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Submitted</dt>
              <dd>{lead.created_at ? new Date(lead.created_at).toLocaleString() : '—'}</dd>
            </div>
          </dl>

          {lead.brief_description && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Description</h3>
              <p className="text-sm">{lead.brief_description}</p>
            </div>
          )}

          {lead.classification_rationale && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Classification Rationale</h3>
              <p className="text-sm">{lead.classification_rationale}</p>
            </div>
          )}

          {urgencyFactors.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-gray-500 mb-1">Urgency Factors</h3>
              <ul className="list-disc list-inside text-sm space-y-1">
                {urgencyFactors.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Chat Transcript */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-semibold mb-4">Chat Transcript</h3>
          {messages.length === 0 ? (
            <p className="text-gray-500 text-sm">No transcript available.</p>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-lg text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-50 ml-8'
                      : 'bg-gray-50 mr-8'
                  }`}
                >
                  <span className="text-xs font-medium text-gray-500 block mb-1">
                    {msg.role === 'user' ? 'Visitor' : 'Chatbot'}
                  </span>
                  {msg.content}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
