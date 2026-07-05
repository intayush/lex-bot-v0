'use client';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';
import type { Selection } from './case-matrix';

export interface WizardAttorney { name: string; email: string; mobile: string; subTypeAssignments: { caseTypeSlug: string; subTypeSlug: string }[] }

export function AttorneysStep({ selection, value, onChange }: { selection: Selection[]; value: WizardAttorney[]; onChange: (v: WizardAttorney[]) => void }) {
  const label = (ct: string, st: string) => {
    const c = DEFAULT_CASE_TYPE_MATRIX.find((x) => x.slug === ct);
    return `${c?.label ?? ct} · ${c?.subTypes.find((s) => s.slug === st)?.label ?? st}`;
  };
  const flat = selection.flatMap((s) => s.subTypeSlugs.map((st) => ({ caseTypeSlug: s.caseTypeSlug, subTypeSlug: st })));
  function update(i: number, patch: Partial<WizardAttorney>) { onChange(value.map((a, idx) => idx === i ? { ...a, ...patch } : a)); }
  function toggleAssign(i: number, ct: string, st: string) {
    const a = value[i];
    const has = a.subTypeAssignments.some((x) => x.caseTypeSlug === ct && x.subTypeSlug === st);
    const next = has ? a.subTypeAssignments.filter((x) => !(x.caseTypeSlug === ct && x.subTypeSlug === st)) : [...a.subTypeAssignments, { caseTypeSlug: ct, subTypeSlug: st }];
    update(i, { subTypeAssignments: next });
  }
  return (
    <div className="space-y-4">
      {value.map((a, i) => (
        <div key={i} className="rounded-lg border p-4 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <input placeholder="Name" value={a.name} onChange={(e) => update(i, { name: e.target.value })} />
          <input placeholder="Email" type="email" value={a.email} onChange={(e) => update(i, { email: e.target.value })} />
          <input placeholder="Mobile (optional)" value={a.mobile} onChange={(e) => update(i, { mobile: e.target.value })} />
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Assign to:</div>
          <div className="grid grid-cols-2 gap-1">
            {flat.map((f) => (
              <label key={`${f.caseTypeSlug}/${f.subTypeSlug}`} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={a.subTypeAssignments.some((x) => x.caseTypeSlug === f.caseTypeSlug && x.subTypeSlug === f.subTypeSlug)} onChange={() => toggleAssign(i, f.caseTypeSlug, f.subTypeSlug)} />
                {label(f.caseTypeSlug, f.subTypeSlug)}
              </label>
            ))}
          </div>
          <button className="btn" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>Remove</button>
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...value, { name: '', email: '', mobile: '', subTypeAssignments: [] }])}>+ Add attorney</button>
    </div>
  );
}
