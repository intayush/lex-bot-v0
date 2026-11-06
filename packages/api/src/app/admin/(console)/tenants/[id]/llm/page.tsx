'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { LLM_MODELS_BY_PROVIDER, type LlmProvider } from '@legal-chatbot/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Bot,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

/**
 * 028-admin-ui-rework — per-tenant LLM provider/model + optional key (write-only).
 */
export default function LlmConfigPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [provider, setProvider] = useState<LlmProvider>('google');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error' | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function save(clearKey = false) {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/llm-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey: apiKey || undefined, clearKey }),
      });
      const v = await res.json();
      if (res.ok) {
        setHasKey(v.hasKey);
        setApiKey('');
        setStatus(clearKey ? 'Key cleared. Platform key will be used.' : 'Configuration saved.');
        setStatusType('success');
      } else {
        setStatus(v.error || 'Save failed');
        setStatusType('error');
      }
    } catch {
      setStatus('Network error');
      setStatusType('error');
    } finally {
      setSaving(false);
    }
  }

  const models = LLM_MODELS_BY_PROVIDER[provider];

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={`/admin/tenants/${id}`}>
            <ArrowLeft className="size-4 mr-1" />
            Tenant
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">LLM Configuration</h1>
          {hasKey && <Badge variant="secondary">Custom key</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          No configuration falls back to the platform default · Google gemini-2.5-flash.
        </p>
      </div>

      {loading ? (
        <Card>
          <CardContent className="pt-6 flex items-center justify-center py-10">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" />
              <CardTitle className="text-base">Model selection</CardTitle>
            </div>
            <CardDescription>
              Choose which provider and model this tenant&apos;s chat uses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as LlmProvider;
                  setProvider(p);
                  setModel(LLM_MODELS_BY_PROVIDER[p][0]);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="google">Google (Gemini)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <select
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey" className="flex items-center gap-1.5">
                <KeyRound className="size-3.5 text-muted-foreground" />
                Per-tenant API key
                {hasKey && (
                  <span className="text-xs text-muted-foreground font-normal">
                    — a key is set; leave blank to keep
                  </span>
                )}
              </Label>
              <Input
                id="apiKey"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '••••••••' : 'Optional — uses platform key if blank'}
                autoComplete="off"
                type="password"
              />
              <p className="text-xs text-muted-foreground">
                Key is encrypted at rest and never shown again after saving.
              </p>
            </div>

            <Separator />

            {status && (
              <div
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  statusType === 'error'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-green-50 text-green-700 border border-green-200'
                }`}
              >
                {statusType === 'error'
                  ? <XCircle className="size-4 shrink-0" />
                  : <CheckCircle2 className="size-4 shrink-0" />}
                {status}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button onClick={() => save(false)} disabled={saving}>
                {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
                Save configuration
              </Button>
              {hasKey && (
                <Button variant="outline" onClick={() => save(true)} disabled={saving}>
                  Clear key (use platform key)
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}