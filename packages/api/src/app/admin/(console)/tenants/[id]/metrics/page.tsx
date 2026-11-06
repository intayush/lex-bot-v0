'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft,
  MessagesSquare,
  Users,
  DollarSign,
  Zap,
  Percent,
  Mail,
  Loader2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  Legend,
} from 'recharts';

type MetricsWindow = '7d' | '30d' | '90d';

type TenantMetrics = {
  window: MetricsWindow;
  funnel: {
    conversationsStarted: number;
    leadsCaptured: number;
    breakdown: { HOT: number; WARM: number; COLD: number; SPAM: number };
    conversionRate: number;
  };
  usageCost: {
    conversationVolume: { date: string; count: number }[];
    avgMessagesPerConversation: number;
    tokens: { prompt: number; completion: number; total: number };
    estimatedSpend: number;
    byProviderModel: { provider: string; model: string; totalTokens: number; estimatedSpend: number }[];
  };
  routing: {
    hotLeadsRouted: number;
    emailsDispatched: number;
    followUpActions: { contacted: number; call_no_answer: number; meeting_fixed: number; none: number };
  };
};

const windows: { value: MetricsWindow; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const funnelColors: Record<string, string> = {
  HOT: '#059669',
  WARM: '#D97706',
  COLD: '#3B82F6',
  SPAM: '#9CA3AF',
};

/**
 * 028-admin-ui-rework — per-tenant metrics with stats, charts, window selector.
 * Uses the existing /api/admin/tenants/[id]/metrics?window= endpoint.
 */
export default function MetricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [window, setWindow] = useState<MetricsWindow>('30d');
  const [data, setData] = useState<TenantMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/tenants/${id}/metrics?window=${window}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [id, window]);

  const fmt = new Intl.NumberFormat('en-US');
  const fmtMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" className="mb-2 -ml-2">
          <Link href={`/admin/tenants/${id}`}>
            <ArrowLeft className="size-4 mr-1" />
            Tenant
          </Link>
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Funnel, usage, and routing outcomes.
            </p>
          </div>
          <div className="flex rounded-lg border p-0.5">
            {windows.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  window === w.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading || !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MessagesSquare className="size-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Conversations</span>
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{fmt.format(data.funnel.conversationsStarted)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Users className="size-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Leads captured</span>
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{fmt.format(data.funnel.leadsCaptured)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Percent className="size-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Conversion</span>
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {(data.funnel.conversionRate * 100).toFixed(1)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="size-4" />
                  <span className="text-xs font-medium uppercase tracking-wide">Est. spend</span>
                </div>
                <p className="mt-2 text-3xl font-semibold tabular-nums">{fmtMoney.format(data.usageCost.estimatedSpend)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Conversation volume chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conversation volume</CardTitle>
              <CardDescription>Daily conversations in the selected window.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.usageCost.conversationVolume} margin={{ left: -20, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="vol" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#2563EB" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#2563EB" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" name="Conversations" stroke="#2563EB" strokeWidth={2} fill="url(#vol)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Middle row: break down + provider usage */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Lead breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(data.funnel.breakdown).map(([k, v]) => ({ name: k, value: v }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" name="Leads" radius={[4, 4, 0, 0]}>
                        {Object.entries(data.funnel.breakdown).map(([k]) => (
                          <Cell key={k} fill={funnelColors[k] ?? '#9CA3AF'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Usage by model</CardTitle>
              </CardHeader>
              <CardContent>
                {data.usageCost.byProviderModel.length === 0 ? (
                  <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">
                    <Zap className="size-4 mr-2" />
                    No usage in this window.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.usageCost.byProviderModel.map((u) => (
                      <div key={`${u.provider}-${u.model}`} className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium">{u.provider} · {u.model}</p>
                          <p className="text-xs text-muted-foreground">{fmt.format(u.totalTokens)} tokens</p>
                        </div>
                        <Badge variant="secondary">{fmtMoney.format(u.estimatedSpend)}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Routing outcomes */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Routing outcomes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Hot leads routed</p>
                  <p className="text-2xl font-semibold tabular-nums">{fmt.format(data.routing.hotLeadsRouted)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    <Mail className="size-3" /> Emails dispatched
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">{fmt.format(data.routing.emailsDispatched)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Meetings fixed</p>
                  <p className="text-2xl font-semibold tabular-nums">{fmt.format(data.routing.followUpActions.meeting_fixed)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Attempts</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {fmt.format(data.routing.followUpActions.contacted + data.routing.followUpActions.call_no_answer)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}