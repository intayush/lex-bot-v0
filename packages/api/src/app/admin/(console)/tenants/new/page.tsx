'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { Separator } from '@/components/ui/separator';
import { ArrowRight, Building2, Mail, KeyRound, Copy, Check } from 'lucide-react';

/**
 * 028-admin-ui-rework — register a new tenant; reveals the widget API key exactly once.
 */
export default function RegisterTenantPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accountId: string; apiKey: string } | null>(null);
  const [copied, setCopied] = useState(false);

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

  async function copyKey() {
    if (!result) return;
    await navigator.clipboard.writeText(result.apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    return (
      <div className="max-w-xl">
        <div className="space-y-1 mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Tenant registered</h1>
          <p className="text-sm text-muted-foreground">
            {result.accountId}
          </p>
        </div>

        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-amber-600" />
              <CardTitle className="text-sm text-amber-800">Widget API Key — shown once</CardTitle>
            </div>
            <CardDescription className="text-amber-700">
              Copy this key now. It cannot be retrieved again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <code className="block p-3 pr-24 rounded-md bg-white border text-sm break-all font-mono">
                {result.apiKey}
              </code>
              <Button
                variant="outline"
                size="sm"
                className="absolute right-1.5 top-1/2 -translate-y-1/2"
                onClick={copyKey}
              >
                {copied ? <Check className="size-3.5 mr-1 text-green-600" /> : <Copy className="size-3.5 mr-1" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between mt-6">
          <Button variant="ghost" size="sm">
            <Link href="/admin">Back to Fleet</Link>
          </Button>
          <Button>
            <Link href={`/admin/tenants/${result.accountId}/onboarding`} className="flex items-center">
              Continue to onboarding
              <ArrowRight className="size-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg">
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Register a new tenant</h1>
        <p className="text-sm text-muted-foreground">
          Create a firm account. A widget API key is generated and shown once.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="firmName" className="flex items-center gap-1.5">
                <Building2 className="size-3.5 text-muted-foreground" />
                Firm name
              </Label>
              <Input
                id="firmName"
                name="firmName"
                required
                placeholder="Acme Law LLP"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-1.5">
                <Mail className="size-3.5 text-muted-foreground" />
                Contact email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="intake@acme.law"
              />
            </div>
            <Separator />
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Registering…' : 'Register tenant'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}