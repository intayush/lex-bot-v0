'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Settings,
  BarChart3,
  Share2,
  GitBranch,
  RotateCcw,
  Trash2,
  PauseCircle,
  PlayCircle,
  Key,
  ExternalLink,
} from 'lucide-react';

type LlmConfig = {
  provider: string;
  model: string;
  hasKey: boolean;
  isActive: boolean;
  updatedAt: string;
} | null;

type Detail = {
  tenant: {
    accountId: string;
    firmName: string | null;
    email: string;
    status: string;
    onboardingStatus: string;
  };
  llmConfig: LlmConfig;
};

const statusVariant: Record<string, 'default' | 'destructive' | 'secondary'> = {
  active: 'default',
  suspended: 'destructive',
  draft: 'secondary',
  live: 'default',
};

const onboardingVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  live: 'default',
  draft: 'secondary',
  completed: 'outline',
};

/**
 * 028-admin-ui-rework — Tenant detail page with lifecycle controls.
 */
export default function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, [id]);

  async function setTenantStatus(next: 'active' | 'suspended') {
    setActionPending(true);
    setActionMsg(null);
    try {
      await fetch(`/api/admin/tenants/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      setActionMsg(next === 'suspended' ? 'Tenant suspended.' : 'Tenant reactivated.');
      await load();
    } catch {
      setActionMsg('Operation failed.');
    } finally {
      setActionPending(false);
    }
  }

  async function rotate() {
    setActionPending(true);
    setRotatedKey(null);
    try {
      const res = await fetch(`/api/admin/tenants/${id}/rotate-key`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) setRotatedKey(data.apiKey);
      else setActionMsg('Rotation failed.');
    } catch {
      setActionMsg('Rotation failed.');
    } finally {
      setActionPending(false);
      setRotateOpen(false);
    }
  }

  async function remove() {
    setActionPending(true);
    try {
      const res = await fetch(`/api/admin/tenants/${id}`, { method: 'DELETE' });
      if (res.ok) window.location.href = '/admin';
      else setActionMsg('Delete failed.');
    } catch {
      setActionMsg('Delete failed.');
    } finally {
      setActionPending(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="h-24 rounded-lg" />))}
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Tenant not found.</p>
        <Button variant="outline" className="mt-4">
          <Link href="/admin">Back to Fleet</Link>
        </Button>
      </div>
    );
  }

  const t = detail.tenant;
  const llm = detail.llmConfig;

  const quickLinks = [
    { label: 'LLM Config', href: `/admin/tenants/${id}/llm`, icon: Settings, desc: 'Provider, model, API key' },
    { label: 'Metrics', href: `/admin/tenants/${id}/metrics`, icon: BarChart3, desc: 'Usage, funnel, costs' },
    { label: 'SOP Flow', href: `/admin/tenants/${id}/sop`, icon: GitBranch, desc: 'Steps, branches, routing' },
    { label: 'Onboarding', href: `/admin/tenants/${id}/onboarding`, icon: ExternalLink, desc: 'Wizard, config, publish' },
  ];

  return (
    <div className="space-y-8">
      {/* Back + header */}
      <div className="space-y-1">
        <Button variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href="/admin">
            <ArrowLeft className="size-4 mr-1" />
            Fleet
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t.firmName || t.email}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t.email}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant[t.status] ?? 'outline'}>{t.status}</Badge>
            <Badge variant={onboardingVariant[t.onboardingStatus] ?? 'outline'}>{t.onboardingStatus}</Badge>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <Card className="h-full transition-colors hover:bg-zinc-50 cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm font-medium">{link.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{link.desc}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* LLM info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">LLM Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          {llm ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Provider</p>
                <p className="font-medium">{llm.provider}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Model</p>
                <p className="font-medium font-mono text-xs">{llm.model}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">API Key</p>
                <p className="font-medium">{llm.hasKey ? 'Configured' : 'Platform default'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Last Updated</p>
                <p className="font-medium">{new Date(llm.updatedAt).toLocaleDateString()}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Using platform default (Gemini).</p>
          )}
        </CardContent>
      </Card>

      {/* Lifecycle controls */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle</CardTitle>
          <CardDescription>
            Manage tenant status, API keys, and data retention.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {t.status === 'active' ? (
              <Button
                variant="outline"
                size="sm"
                disabled={actionPending}
                onClick={() => setTenantStatus('suspended')}
              >
                <PauseCircle className="size-4 mr-1.5" />
                Suspend
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={actionPending}
                onClick={() => setTenantStatus('active')}
              >
                <PlayCircle className="size-4 mr-1.5" />
                Reactivate
              </Button>
            )}

            <Dialog open={rotateOpen} onOpenChange={setRotateOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <RotateCcw className="size-4 mr-1.5" />
                Rotate API Key
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rotate API Key</DialogTitle>
                  <DialogDescription>
                    The current widget API key will be revoked and a new one issued.
                    The new key will be shown once. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRotateOpen(false)}>Cancel</Button>
                  <Button onClick={rotate} disabled={actionPending}>
                    {actionPending ? 'Rotating…' : 'Rotate Key'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <DialogTrigger render={<Button variant="outline" size="sm" className="text-destructive hover:text-destructive" />}>
                <Trash2 className="size-4 mr-1.5" />
                Delete
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete Tenant</DialogTitle>
                  <DialogDescription>
                    This soft-deletes the tenant and archives all lead data.
                    The account is removed from the fleet but data is preserved.
                    This action is irreversible.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={remove} disabled={actionPending}>
                    {actionPending ? 'Deleting…' : 'Delete Tenant'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {actionMsg && (
            <p className="text-sm text-muted-foreground">{actionMsg}</p>
          )}
        </CardContent>
      </Card>

      {/* Rotated key reveal */}
      {rotatedKey && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Key className="size-4 text-amber-600" />
              <CardTitle className="text-sm text-amber-800">New API Key — shown once</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <code className="block p-3 rounded-md bg-white border text-sm break-all font-mono">
              {rotatedKey}
            </code>
            <p className="text-xs text-amber-600 mt-2">
              Copy this key now. It will not be shown again.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}