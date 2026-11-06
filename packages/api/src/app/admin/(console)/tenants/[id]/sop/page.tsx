import Link from 'next/link';
import { AlertCircle, ArrowLeft, GitBranch, Layers, CheckCircle2, ListChecks, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { getSopFlowView } from '../../../../../../lib/admin/sop-view';

export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ScreenshotStep {
  position: number;
  slug: string;
  questionText: string;
  chipSource: string | null;
  appliesWhenSubTypeSlug: string | null;
  isRequired: boolean;
  countsTowardThreshold: boolean;
}

interface BranchQuestion {
  position: number;
  text: string;
  chips: { label: string; weight: number }[];
}

interface SopView {
  version: number;
  qualifiedLeadThreshold: number;
  steps: ScreenshotStep[];
  caseTypes: {
    slug: string;
    label: string;
    subTypes: {
      slug: string;
      label: string;
      branch: { questions: BranchQuestion[] } | null;
    }[];
  }[];
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function StepTimeline({ steps }: { steps: ScreenshotStep[] }) {
  return (
    <div className="relative">
      {/* Vertical connecting line behind circles */}
      <div
        className="absolute left-[17px] top-3 bottom-3 w-px bg-border"
        aria-hidden="true"
      />
      <ol className="space-y-6" aria-label="SOP step timeline">
        {steps.map((s, idx) => (
          <li key={s.slug} className="relative flex items-start gap-4">
            {/* Numbered circle */}
            <div
              className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              aria-label={`Step ${s.position}`}
            >
              {s.position}
            </div>
            {/* Content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-foreground">{s.questionText}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="font-mono text-xs tracking-tight">
                  {s.slug}
                </Badge>
                {s.chipSource && (
                  <Badge variant="secondary" className="text-xs">
                    {s.chipSource}
                  </Badge>
                )}
                {s.appliesWhenSubTypeSlug && (
                  <Badge variant="secondary" className="text-xs">
                    only for {s.appliesWhenSubTypeSlug}
                  </Badge>
                )}
                {s.isRequired && (
                  <Badge variant="destructive" className="text-xs">
                    required
                  </Badge>
                )}
                {s.countsTowardThreshold && (
                  <Badge variant="default" className="text-xs">
                    scores
                  </Badge>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className="mt-3" />
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WeightBadge({ weight }: { weight: number }) {
  const isPositive = weight >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none ${
        isPositive
          ? 'border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]'
          : 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]'
      }`}
    >
      {isPositive ? '+' : ''}{weight}
    </span>
  );
}

function BranchQuestionChip({ question }: { question: BranchQuestion }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <p className="text-xs font-medium text-foreground">
        Q{question.position + 1}: {question.text}
      </p>
      {question.chips.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {question.chips.map((chip, ci) => (
            <span
              key={ci}
              className="inline-flex items-center gap-1 rounded-md bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {chip.label}
              <WeightBadge weight={chip.weight} />
            </span>
          ))}
        </div>
      )}
      {question.chips.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">Free text response</p>
      )}
    </div>
  );
}

function StateCard({
  icon,
  iconWrapperClass,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconWrapperClass: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div
            className={`flex size-12 items-center justify-center rounded-full ${iconWrapperClass}`}
          >
            {icon}
          </div>
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <Link href={`/admin`}>
            <Button variant="outline" className="mt-2">
              <ArrowLeft className="size-4 mr-1.5" />
              Back to Fleet
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState() {
  return (
    <StateCard
      icon={<Package className="size-6 text-muted-foreground" />}
      iconWrapperClass="bg-muted"
      title="No published SOP yet"
      description="This tenant does not have a published SOP workflow. Complete the onboarding wizard first, then return here to visualise the flow."
    />
  );
}

function ErrorState() {
  return (
    <StateCard
      icon={<AlertCircle className="size-6 text-destructive" />}
      iconWrapperClass="bg-destructive/10"
      title="Could not load SOP workflow"
      description="An unexpected error occurred while loading the SOP flow data. Please try again or contact support if the issue persists."
    />
  );
}

// ────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────

/** 027 US5 / 028 — read-only SOP flow visualization (FR-024). */
export default async function SopViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let view: SopView | null;
  try {
    view = (await getSopFlowView(id)) as SopView | null;
  } catch {
    return <ErrorState />;
  }

  if (!view) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-8">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="space-y-1">
        <Link href={`/admin/tenants/${id}`}>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2">
            <ArrowLeft className="size-4 mr-1" />
            Tenant
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">SOP Workflow</h1>
          <Badge variant="outline" className="text-xs font-normal">
            Read-only
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Version <span className="font-mono font-medium text-foreground">{view.version}</span>
          {' · '}Qualified-lead threshold{' '}
          <span className="font-mono font-medium text-foreground">{view.qualifiedLeadThreshold}</span>
        </p>
      </div>

      {/* ── Step Flow — vertical timeline ─────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Step Flow</h2>
          <span className="text-xs text-muted-foreground">({view.steps.length} steps)</span>
        </div>
        <Card>
          <CardContent className="pt-6">
            {view.steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No steps configured.</p>
            ) : (
              <StepTimeline steps={view.steps} />
            )}
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── Case Types & Branches ─────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <GitBranch className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Case Types &amp; Branches</h2>
          <span className="text-xs text-muted-foreground">
            ({view.caseTypes.length} case type{view.caseTypes.length !== 1 ? 's' : ''})
          </span>
        </div>
        <div className="space-y-4">
          {view.caseTypes.map((ct) => (
            <Card key={ct.slug}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Layers className="size-4 text-muted-foreground" />
                  <CardTitle className="text-sm font-semibold">{ct.label}</CardTitle>
                  <span className="font-mono text-xs text-muted-foreground">{ct.slug}</span>
                </div>
                <CardDescription>
                  {ct.subTypes.length} sub-type{ct.subTypes.length !== 1 ? 's' : ''}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {ct.subTypes.map((st) => (
                  <div
                    key={st.slug}
                    className="rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="size-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{st.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {st.slug}
                        </span>
                      </div>
                      {st.branch ? (
                        <Badge variant="secondary" className="shrink-0 text-xs">
                          {st.branch.questions.length} branch question{st.branch.questions.length !== 1 ? 's' : ''}
                        </Badge>
                      ) : (
                        <Badge variant="ghost" className="shrink-0 text-xs">
                          Default flow
                        </Badge>
                      )}
                    </div>
                    {st.branch && st.branch.questions.length > 0 && (
                      <div className="mt-3 space-y-2 pl-5">
                        {st.branch.questions.map((q) => (
                          <BranchQuestionChip key={q.position} question={q} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
