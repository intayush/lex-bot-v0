import { getTenantMetrics } from '../../../../../../lib/admin/metrics';

export const dynamic = 'force-dynamic';

/** 027 US4 — per-tenant metrics: funnel, usage/cost, routing outcomes. */
export default async function TenantMetricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getTenantMetrics(id, '30d');

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
      <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Metrics</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>Last 30 days</p>

      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Lead funnel</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Conversations" value={m.funnel.conversationsStarted} />
        <Stat label="Leads captured" value={m.funnel.leadsCaptured} />
        <Stat label="Conversion" value={`${(m.funnel.conversionRate * 100).toFixed(1)}%`} />
        <Stat label="HOT / WARM / COLD / SPAM" value={`${m.funnel.breakdown.HOT}/${m.funnel.breakdown.WARM}/${m.funnel.breakdown.COLD}/${m.funnel.breakdown.SPAM}`} />
      </div>

      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Usage &amp; cost</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Total tokens" value={m.usageCost.tokens.total.toLocaleString()} />
        <Stat label="Avg msgs / conv" value={m.usageCost.avgMessagesPerConversation} />
        <Stat label="Est. spend" value={`$${m.usageCost.estimatedSpend.toFixed(2)}`} />
        <Stat label="Providers used" value={m.usageCost.byProviderModel.length} />
      </div>
      {m.usageCost.byProviderModel.length > 0 && (
        <div className="mb-8 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {m.usageCost.byProviderModel.map((p) => (
            <div key={`${p.provider}/${p.model}`}>{p.provider} · {p.model}: {p.totalTokens.toLocaleString()} tokens (${p.estimatedSpend.toFixed(2)})</div>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Attorney routing</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="HOT leads routed" value={m.routing.hotLeadsRouted} />
        <Stat label="Emails dispatched" value={m.routing.emailsDispatched} />
        <Stat label="Contacted" value={m.routing.followUpActions.contacted} />
        <Stat label="Meetings fixed" value={m.routing.followUpActions.meeting_fixed} />
      </div>
    </div>
  );
}
