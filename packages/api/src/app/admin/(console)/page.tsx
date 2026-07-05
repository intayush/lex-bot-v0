import Link from 'next/link';
import { getFleetSummary } from '../../../lib/admin/fleet';

export const dynamic = 'force-dynamic';

/** 027 US1 — fleet overview: every tenant, health at a glance (FR-004/FR-005). */
export default async function FleetOverviewPage() {
  const tenants = await getFleetSummary();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text-primary)' }}>
          Tenants
        </h1>
        <Link href="/admin/tenants/new" className="btn btn-primary">Register tenant</Link>
      </div>

      {tenants.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)' }}>No tenants yet. Register your first firm.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                <th className="px-4 py-3 font-medium">Firm</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Onboarding</th>
                <th className="px-4 py-3 font-medium">Leads (30d)</th>
                <th className="px-4 py-3 font-medium">Est. spend (30d)</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.accountId} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/tenants/${t.accountId}`} style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                      {t.firmName || t.email}
                    </Link>
                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>{t.email}</div>
                  </td>
                  <td className="px-4 py-3">{t.status}</td>
                  <td className="px-4 py-3">{t.onboardingStatus}</td>
                  <td className="px-4 py-3">{t.leadCount30d}</td>
                  <td className="px-4 py-3">${t.estimatedSpend30d.toFixed(2)}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--color-text-muted)' }}>
                    {t.lastActivityAt ? new Date(t.lastActivityAt).toLocaleDateString() : '—'}
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
