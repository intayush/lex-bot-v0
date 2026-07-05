'use client';

import { useState } from 'react';

/** 027 US2 — register a new tenant; reveals the widget API key exactly once. */
export default function RegisterTenantPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accountId: string; apiKey: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: fd.get('email'), firmName: fd.get('firmName') }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
      } else {
        setError(data.error || 'Failed to register tenant');
      }
    } catch {
      setError('Network error');
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div className="max-w-lg">
        <h1 className="text-2xl font-bold mb-4">Tenant registered</h1>
        <div className="rounded-lg border p-4 mb-4" style={{ borderColor: 'var(--color-border)' }}>
          <p className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Copy this widget API key now — it is shown <strong>only once</strong> and cannot be retrieved again.
          </p>
          <code className="block p-3 rounded text-sm break-all" style={{ backgroundColor: 'var(--color-bg)' }}>
            {result.apiKey}
          </code>
        </div>
        <a href={`/admin/tenants/${result.accountId}/onboarding`} className="btn btn-primary">
          Continue to onboarding →
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Register a new tenant</h1>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="px-4 py-3 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-badge-urgent-bg)', color: 'var(--color-badge-urgent-text)' }}>
            {error}
          </div>
        )}
        <div>
          <label htmlFor="firmName">Firm name</label>
          <input id="firmName" name="firmName" required placeholder="Acme Law LLP" />
        </div>
        <div>
          <label htmlFor="email">Contact email</label>
          <input id="email" name="email" type="email" required placeholder="intake@acme.law" />
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Registering…' : 'Register tenant'}
        </button>
      </form>
    </div>
  );
}
