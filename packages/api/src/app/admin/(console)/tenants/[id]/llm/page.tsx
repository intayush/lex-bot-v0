'use client';

import { use, useEffect, useState } from 'react';
import { LLM_MODELS_BY_PROVIDER, type LlmProvider } from '@legal-chatbot/shared';

/** 027 US3 — per-tenant LLM provider/model + optional key (write-only). */
export default function LlmConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [provider, setProvider] = useState<LlmProvider>('google');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/tenants/${id}/llm-config`)
      .then((r) => r.json())
      .then((v) => {
        if (v) {
          setProvider(v.provider);
          setModel(v.model);
          setHasKey(v.hasKey);
        }
      })
      .catch(() => {});
  }, [id]);

  async function save(clearKey = false) {
    setStatus('Saving…');
    const res = await fetch(`/api/admin/tenants/${id}/llm-config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, apiKey: apiKey || undefined, clearKey }),
    });
    const v = await res.json();
    if (res.ok) {
      setHasKey(v.hasKey);
      setApiKey('');
      setStatus('Saved.');
    } else {
      setStatus(v.error || 'Save failed');
    }
  }

  const models = LLM_MODELS_BY_PROVIDER[provider];

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-2">LLM configuration</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        No configuration falls back to the platform default (Google · gemini-2.5-flash).
      </p>

      <div className="space-y-4">
        <label>Provider
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as LlmProvider;
              setProvider(p);
              setModel(LLM_MODELS_BY_PROVIDER[p][0]);
            }}
          >
            <option value="google">Google (Gemini)</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </label>

        <label>Model
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>

        <label>Per-tenant API key {hasKey && <span style={{ color: 'var(--color-text-muted)' }}>(a key is set — leave blank to keep)</span>}
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? '••••••••' : 'Optional — uses platform key if blank'} autoComplete="off" />
        </label>
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button className="btn btn-primary" onClick={() => save(false)}>Save</button>
        {hasKey && <button className="btn" onClick={() => save(true)}>Clear key (use platform key)</button>}
        {status && <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>
    </div>
  );
}
