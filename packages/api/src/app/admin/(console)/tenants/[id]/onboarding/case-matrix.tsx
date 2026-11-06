'use client';

import { useId } from 'react';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface Selection {
  caseTypeSlug: string;
  subTypeSlugs: string[];
}

// Simple inline checkbox styled to match the design system
function Checkbox({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/50 has-[checked]:border-[var(--color-accent)] has-[checked]:bg-[var(--color-accent)]/5"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 accent-[var(--color-accent)]"
      />
      <span className="text-foreground">{label}</span>
    </label>
  );
}

/** Step 2: case-type checkbox matrix. Toggle behavior identical to original. */
export function CaseMatrix({
  value,
  onChange,
}: {
  value: Selection[];
  onChange: (v: Selection[]) => void;
}) {
  const uid = useId();

  function isSubSelected(caseTypeSlug: string, subTypeSlug: string) {
    return (
      value.find((v) => v.caseTypeSlug === caseTypeSlug)?.subTypeSlugs.includes(
        subTypeSlug,
      ) ?? false
    );
  }

  function toggle(caseTypeSlug: string, subTypeSlug: string) {
    const existing = value.find((v) => v.caseTypeSlug === caseTypeSlug);
    let next: Selection[];
    if (!existing) {
      next = [...value, { caseTypeSlug, subTypeSlugs: [subTypeSlug] }];
    } else {
      const has = existing.subTypeSlugs.includes(subTypeSlug);
      const subs = has
        ? existing.subTypeSlugs.filter((s) => s !== subTypeSlug)
        : [...existing.subTypeSlugs, subTypeSlug];
      next =
        subs.length === 0
          ? value.filter((v) => v.caseTypeSlug !== caseTypeSlug)
          : value.map((v) =>
              v.caseTypeSlug === caseTypeSlug
                ? { ...v, subTypeSlugs: subs }
                : v,
            );
    }
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {DEFAULT_CASE_TYPE_MATRIX.map((ct) => (
        <Card key={ct.slug}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {ct.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {ct.subTypes.map((st) => {
                const inputId = `${uid}-${ct.slug}-${st.slug}`;
                return (
                  <Checkbox
                    key={st.slug}
                    id={inputId}
                    checked={isSubSelected(ct.slug, st.slug)}
                    onChange={() => toggle(ct.slug, st.slug)}
                    label={st.label}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
