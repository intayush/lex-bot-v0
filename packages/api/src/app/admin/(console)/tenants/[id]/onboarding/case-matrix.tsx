'use client';
import { DEFAULT_CASE_TYPE_MATRIX } from '@legal-chatbot/shared';

export interface Selection { caseTypeSlug: string; subTypeSlugs: string[] }

export function CaseMatrix({ value, onChange }: { value: Selection[]; onChange: (v: Selection[]) => void }) {
  const subSelected = (ct: string, st: string) => value.find((v) => v.caseTypeSlug === ct)?.subTypeSlugs.includes(st) ?? false;
  function toggle(ct: string, st: string) {
    const existing = value.find((v) => v.caseTypeSlug === ct);
    let next: Selection[];
    if (!existing) next = [...value, { caseTypeSlug: ct, subTypeSlugs: [st] }];
    else {
      const has = existing.subTypeSlugs.includes(st);
      const subs = has ? existing.subTypeSlugs.filter((s) => s !== st) : [...existing.subTypeSlugs, st];
      next = subs.length === 0 ? value.filter((v) => v.caseTypeSlug !== ct) : value.map((v) => v.caseTypeSlug === ct ? { ...v, subTypeSlugs: subs } : v);
    }
    onChange(next);
  }
  return (
    <div className="space-y-4">
      {DEFAULT_CASE_TYPE_MATRIX.map((ct) => (
        <div key={ct.slug} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
          <div className="font-semibold mb-2">{ct.label}</div>
          <div className="grid grid-cols-2 gap-2">
            {ct.subTypes.map((st) => (
              <label key={st.slug} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={subSelected(ct.slug, st.slug)} onChange={() => toggle(ct.slug, st.slug)} />
                {st.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
