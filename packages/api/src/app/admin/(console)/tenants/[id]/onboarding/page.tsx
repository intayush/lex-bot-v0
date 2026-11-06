'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Bot,
  Mail,
  Globe,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { CaseMatrix, type Selection } from './case-matrix';
import { AttorneysStep, type WizardAttorney } from './attorneys-step';

const STEPS = ['Firm details', 'Case types', 'Attorneys'] as const;

// ─── Progress indicator ────────────────────────────────────

function ProgressBar({ current }: { current: number }) {
  return (
    <div className="flex gap-1.5">
      {STEPS.map((_, i) => (
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
            i < current
              ? 'bg-[var(--color-success)]'
              : i === current
                ? 'bg-[var(--color-accent)]'
                : 'bg-border'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Wizard page ───────────────────────────────────────────

export default function OnboardingWizard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmIdentity, setFirm] = useState({
    firmName: '',
    chatbotName: 'Assistant',
    email: '',
    domain: '',
  });
  const [caseTypeSelection, setSelection] = useState<Selection[]>([]);
  const [attorneys, setAttorneys] = useState<WizardAttorney[]>([]);

  // Load draft
  useEffect(() => {
    fetch(`/api/admin/tenants/${id}/onboarding`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const draft = d?.draft;
        if (!draft) return;
        if (draft.firmIdentity)
          setFirm((f) => ({ ...f, ...draft.firmIdentity }));
        if (Array.isArray(draft.caseTypeSelection))
          setSelection(draft.caseTypeSelection);
        if (Array.isArray(draft.attorneys)) {
          setAttorneys(
            draft.attorneys.map(
              (a: {
                name?: string;
                email?: string;
                mobile?: string | null;
                subTypeAssignments?: {
                  caseTypeSlug: string;
                  subTypeSlug: string;
                }[];
              }) => ({
                name: a.name ?? '',
                email: a.email ?? '',
                mobile: a.mobile ?? '',
                subTypeAssignments: a.subTypeAssignments ?? [],
              }),
            ),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [id]);

  function payload(finish: boolean) {
    return {
      firmIdentity,
      caseTypeSelection,
      attorneys: attorneys.map((a) => ({
        ...a,
        mobile: a.mobile || null,
      })),
      finish,
    };
  }

  async function autosave() {
    try {
      await fetch(`/api/admin/tenants/${id}/onboarding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload(false)),
      });
    } catch {
      /* silent */
    }
  }

  function goTo(next: number) {
    setError(null);
    void autosave();
    setStep(next);
  }

  async function finishAndPublish() {
    setPublishing(true);
    setError(null);
    const res = await fetch(`/api/admin/tenants/${id}/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload(true)),
    });
    if (!res.ok) {
      const b = await res.json();
      setError(
        (b.error ?? 'Could not finish') +
          (b.missing ? ` (missing: ${b.missing.join(', ')})` : ''),
      );
      setPublishing(false);
      return;
    }
    const pub = await fetch(`/api/admin/tenants/${id}/publish`, {
      method: 'POST',
    });
    if (pub.ok) {
      window.location.href = `/admin/tenants/${id}`;
    } else {
      setError('Publish failed');
      setPublishing(false);
    }
  }

  if (!loaded) {
    return <LoadingSkeleton />;
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── Back link ─────────────────────────────────────── */}
      <Link href={`/admin/tenants/${id}`}>
        <Button variant="ghost" size="sm" className="-ml-2">
          <ArrowLeft className="size-4 mr-1" />
          Tenant
        </Button>
      </Link>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length}:{' '}
          <span className="font-medium text-foreground">{STEPS[step]}</span>
        </p>
      </div>

      <ProgressBar current={step} />

      {/* ── Error alert ───────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 px-4 py-3 text-sm text-[var(--color-danger)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Step content ──────────────────────────────────── */}
      <div key={step} className="onboarding-step">
        {/* Step 0: Firm details */}
        {step === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Firm Identity</CardTitle>
              <CardDescription>
                Basic information about the law firm and its chatbot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="firmName">
                  <Building2 className="size-3.5 mr-1.5 inline-block text-muted-foreground" />
                  Law firm name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="firmName"
                  placeholder="e.g. Smith &amp; Associates"
                  value={firmIdentity.firmName}
                  onChange={(e) =>
                    setFirm({ ...firmIdentity, firmName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="chatbotName">
                  <Bot className="size-3.5 mr-1.5 inline-block text-muted-foreground" />
                  Chatbot assistant name
                </Label>
                <Input
                  id="chatbotName"
                  placeholder="Assistant"
                  value={firmIdentity.chatbotName}
                  onChange={(e) =>
                    setFirm({ ...firmIdentity, chatbotName: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="email">
                  <Mail className="size-3.5 mr-1.5 inline-block text-muted-foreground" />
                  Contact email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="hello@smithlaw.com"
                  value={firmIdentity.email}
                  onChange={(e) =>
                    setFirm({ ...firmIdentity, email: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="domain">
                  <Globe className="size-3.5 mr-1.5 inline-block text-muted-foreground" />
                  Deployment domain
                </Label>
                <Input
                  id="domain"
                  placeholder="acme.law"
                  value={firmIdentity.domain}
                  onChange={(e) =>
                    setFirm({ ...firmIdentity, domain: e.target.value })
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Case types */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Practice Areas</CardTitle>
              <CardDescription>
                Select the case types and sub-types this firm handles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CaseMatrix value={caseTypeSelection} onChange={setSelection} />
            </CardContent>
          </Card>
        )}

        {/* Step 2: Attorneys */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attorneys</CardTitle>
              <CardDescription>
                Add attorney contact info and assign them to practice areas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AttorneysStep
                selection={caseTypeSelection}
                value={attorneys}
                onChange={setAttorneys}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Footer navigation ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="outline"
          disabled={step === 0}
          onClick={() => goTo(step - 1)}
        >
          <ArrowLeft className="size-4 mr-1.5" />
          Back
        </Button>

        {step < STEPS.length - 1 && (
          <Button onClick={() => goTo(step + 1)}>
            Next
            <ArrowRight className="size-4 ml-1.5" />
          </Button>
        )}

        {step === STEPS.length - 1 && (
          <Button disabled={publishing} onClick={finishAndPublish}>
            {publishing ? (
              <>
                <Loader2 className="size-4 mr-1.5 animate-spin" />
                Publishing…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 mr-1.5" />
                Finish &amp; publish
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
