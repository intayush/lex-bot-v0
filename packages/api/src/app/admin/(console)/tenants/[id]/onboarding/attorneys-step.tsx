'use client';

import { useId } from 'react';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Trash2, UserPlus } from 'lucide-react';
import type { Selection } from './case-matrix';

export interface WizardAttorney {
  name: string;
  email: string;
  mobile: string;
  subTypeAssignments: { caseTypeSlug: string; subTypeSlug: string }[];
}

/** Look up the composite label like "Personal Injury · Car Accident" for a (caseTypeSlug, subTypeSlug) pair. */
function labelFor(caseTypeSlug: string, subTypeSlug: string): string {
  const ct = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === caseTypeSlug);
  if (!ct) return `${caseTypeSlug} · ${subTypeSlug}`;
  const st = ct.subTypes.find((s) => s.slug === subTypeSlug);
  return `${ct.label} · ${st?.label ?? subTypeSlug}`;
}

/** Step 3: attorney rows with sub-type assignment checkboxes. */
export function AttorneysStep({
  selection,
  value,
  onChange,
}: {
  selection: Selection[];
  value: WizardAttorney[];
  onChange: (v: WizardAttorney[]) => void;
}) {
  const uid = useId();

  // Flatten the selected case-type/sub-type pairs from step 2
  const flat = selection.flatMap((s) =>
    s.subTypeSlugs.map((st) => ({
      caseTypeSlug: s.caseTypeSlug,
      subTypeSlug: st,
    })),
  );

  function update(
    i: number,
    patch: Partial<WizardAttorney>,
  ) {
    onChange(value.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  function toggleAssign(
    i: number,
    caseTypeSlug: string,
    subTypeSlug: string,
  ) {
    const a = value[i];
    const has = a.subTypeAssignments.some(
      (x) => x.caseTypeSlug === caseTypeSlug && x.subTypeSlug === subTypeSlug,
    );
    const next = has
      ? a.subTypeAssignments.filter(
          (x) =>
            !(x.caseTypeSlug === caseTypeSlug && x.subTypeSlug === subTypeSlug),
        )
      : [...a.subTypeAssignments, { caseTypeSlug, subTypeSlug }];
    update(i, { subTypeAssignments: next });
  }

  // Empty state hint when no case types selected in step 2
  if (flat.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <UserPlus className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No case types selected yet. Go back to <strong>Case types</strong>{' '}
            and pick at least one sub-type before adding attorneys.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {value.map((a, i) => (
        <Card key={i}>
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div>
                <Label htmlFor={`${uid}-name-${i}`}>Name</Label>
                <Input
                  id={`${uid}-name-${i}`}
                  placeholder="Full name"
                  value={a.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${uid}-email-${i}`}>Email</Label>
                <Input
                  id={`${uid}-email-${i}`}
                  type="email"
                  placeholder="attorney@firm.com"
                  value={a.email}
                  onChange={(e) => update(i, { email: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${uid}-mobile-${i}`}>
                  Mobile{' '}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  id={`${uid}-mobile-${i}`}
                  type="tel"
                  placeholder="+1 555-0123"
                  value={a.mobile}
                  onChange={(e) => update(i, { mobile: e.target.value })}
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Remove attorney"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="size-4" />
            </Button>
          </CardHeader>
          <Separator />
          <CardContent className="pt-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Assign to:
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {flat.map((f) => {
                const inputId = `${uid}-assign-${i}-${f.caseTypeSlug}-${f.subTypeSlug}`;
                const checked = a.subTypeAssignments.some(
                  (x) =>
                    x.caseTypeSlug === f.caseTypeSlug &&
                    x.subTypeSlug === f.subTypeSlug,
                );
                return (
                  <label
                    key={inputId}
                    htmlFor={inputId}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted/50 has-[checked]:border-[var(--color-accent)] has-[checked]:bg-[var(--color-accent)]/5"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        toggleAssign(i, f.caseTypeSlug, f.subTypeSlug)
                      }
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <span className="text-foreground">
                      {labelFor(f.caseTypeSlug, f.subTypeSlug)}
                    </span>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        variant="secondary"
        onClick={() =>
          onChange([
            ...value,
            {
              name: '',
              email: '',
              mobile: '',
              subTypeAssignments: [],
            },
          ])
        }
      >
        <UserPlus className="size-4 mr-1.5" />
        Add attorney
      </Button>
    </div>
  );
}
