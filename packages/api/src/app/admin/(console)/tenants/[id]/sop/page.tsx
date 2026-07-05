import { getSopFlowView } from '../../../../../../lib/admin/sop-view';

export const dynamic = 'force-dynamic';

/** 027 US5 — read-only SOP flow visualization (no edit controls, FR-024). */
export default async function SopViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getSopFlowView(id);

  if (!view) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">SOP workflow</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          This tenant has no published SOP yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">SOP workflow</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        Read-only · version {view.version} · qualified-lead threshold {view.qualifiedLeadThreshold}.
        Edits happen in the firm SOP editor.
      </p>

      {/* Step flow */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Step flow</h2>
      <ol className="mb-8 space-y-2">
        {view.steps.map((s) => (
          <li key={s.slug} className="flex items-start gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--color-border)' }}>
            <span className="font-mono text-xs px-2 py-1 rounded" style={{ backgroundColor: 'var(--color-bg)' }}>{s.position}</span>
            <div>
              <div style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{s.questionText}</div>
              <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                {s.slug}{s.appliesWhenSubTypeSlug ? ` · only for ${s.appliesWhenSubTypeSlug}` : ''}
                {s.isRequired ? ' · required' : ''}{s.countsTowardThreshold ? ' · scores' : ''}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Case types → sub-types → branches */}
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-secondary)' }}>Case types &amp; branches</h2>
      <div className="space-y-4">
        {view.caseTypes.map((ct) => (
          <div key={ct.slug} className="rounded-lg border p-4" style={{ borderColor: 'var(--color-border)' }}>
            <div className="font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{ct.label}</div>
            <div className="space-y-2 pl-4">
              {ct.subTypes.map((st) => (
                <div key={st.slug}>
                  <div className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                    {st.label}
                    {st.branch ? (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                        branch · {st.branch.questions.length} question(s)
                      </span>
                    ) : (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>default flow</span>
                    )}
                  </div>
                  {st.branch && (
                    <ul className="pl-4 mt-1 space-y-1">
                      {st.branch.questions.map((q) => (
                        <li key={q.position} className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                          Q{q.position + 1}: {q.text} — {q.chips.map((c) => `${c.label} (${c.weight >= 0 ? '+' : ''}${c.weight})`).join(', ') || 'free text'}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
