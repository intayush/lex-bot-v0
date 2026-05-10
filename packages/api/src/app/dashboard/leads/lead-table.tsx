'use client';

import { useState } from 'react';

interface Lead {
  id: string;
  name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  case_type: string | null;
  classification: string | null;
  status: string | null;
  created_at: string | null;
}

const badgeColors: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  normal: 'bg-blue-100 text-blue-800',
  unqualified: 'bg-gray-100 text-gray-600',
};

const statusColors: Record<string, string> = {
  new: 'text-green-700',
  contacted: 'text-blue-700',
  dismissed: 'text-gray-500',
};

export function LeadTable({ leads }: { leads: Lead[] }) {
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all'
    ? leads
    : leads.filter((l) => l.classification === filter);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {['all', 'urgent', 'normal', 'unqualified'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-sm capitalize ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-white border text-gray-700 hover:bg-gray-50'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm">No leads found.</p>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Case Type</th>
                <th className="text-left px-4 py-3 font-medium">Classification</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((lead) => (
                <tr key={lead.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <a href={`/dashboard/leads/${lead.id}`} className="text-blue-600 hover:underline font-medium">
                      {lead.name || 'Anonymous'}
                    </a>
                  </td>
                  <td className="px-4 py-3">{lead.case_type || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badgeColors[lead.classification || 'normal']}`}>
                      {lead.classification || 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium capitalize ${statusColors[lead.status || 'new']}`}>
                      {lead.status || 'new'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.contact_email || lead.contact_phone || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
