'use client';

import { use, useEffect, useState } from 'react';

type Detail = {
  tenant: { accountId: string; firmName: string | null; email: string; status: string; onboardingStatus: string };
  llmConfig: { provider: string; model: string } | null;
};

/** 027 US6 — tenant detail + lifecycle controls (suspend/reactivate/rotate/delete). */
export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/admin/tenants/${id}`);
    if (res.ok) setDetail(await res.json());
  }
  useEffect(() => { void load(); }, [id]);

  async function setTenantStatus(next: 'active' | 'suspended') {
    setStatus('Updating…');
    await fetch(`/api/admin/tenants/${id}/status`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }),
    });
    setStatus(null);
    await load();
  }

  async function rotate() {
    const res = await fetch(`/api/admin/tenants/${id}/rotate-key`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) setRotatedKey(data.apiKey);
  }

  async function remove() {
    if (!confirm('Soft-delete this tenant? Lead data is archived, not erased.')) return;
    const res = await fetch(`/api/admin/tenants/${id}`, { method: 'DELETE' });
    if (res.ok) window.location.href = '/admin';
  }

  if (!detail) return <p style={{ color: 'var(--color-text-muted)' }}>Loading…</p>;
  const t = detail.tenant;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">{t.firmName || t.email}</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        {t.email} · status: {t.status} · onboarding: {t.onboardingStatus}
        {detail.llmConfig ? ` · LLM: ${detail.llmConfig.provider}/${detail.llmConfig.model}` : ' · LLM: platform default'}
      </p>

      <div className="flex flex-wrap gap-2 mb-8">
        <a className="btn" href={`/admin/tenants/${id}/onboarding`}>Onboarding</a>
        <a className="btn" href={`/admin/tenants/${id}/llm`}>LLM config</a>
        <a className="btn" href={`/admin/tenants/${id}/metrics`}>Metrics</a>
        <a className="btn" href={`/admin/tenants/${id}/sop`}>SOP flow</a>
      </div>

      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Lifecycle</h2>
      <div className="flex flex-wrap items-center gap-2">
        {t.status === 'active'
          ? <button className="btn" onClick={() => setTenantStatus('suspended')}>Suspend</button>
          : <button className="btn btn-primary" onClick={() => setTenantStatus('active')}>Reactivate</button>}
        <button className="btn" onClick={rotate}>Rotate API key</button>
        <button className="btn" onClick={remove} style={{ color: 'var(--color-danger)' }}>Delete</button>
        {status && <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>

      {rotatedKey && (
        <div className="mt-4 rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>New API key (shown once):</p>
          <code className="block p-3 rounded text-sm break-all" style={{ backgroundColor: 'var(--color-bg)' }}>{rotatedKey}</code>
        </div>
      )}
    </div>
  );
}
