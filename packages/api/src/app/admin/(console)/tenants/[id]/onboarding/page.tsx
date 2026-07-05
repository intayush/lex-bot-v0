'use client';
import { use, useState, useEffect } from 'react';
import { CaseMatrix, type Selection } from './case-matrix';
import { AttorneysStep, type WizardAttorney } from './attorneys-step';

const STEPS = ['Firm details', 'Case types', 'Attorneys'] as const;

export default function OnboardingWizard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [step, setStep] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmIdentity, setFirm] = useState({ firmName: '', chatbotName: 'Assistant', email: '', domain: '' });
  const [caseTypeSelection, setSelection] = useState<Selection[]>([]);
  const [attorneys, setAttorneys] = useState<WizardAttorney[]>([]);

  useEffect(() => {
    fetch(`/api/admin/tenants/${id}/onboarding`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const draft = d?.draft;
        if (!draft) return;
        if (draft.firmIdentity) setFirm((f) => ({ ...f, ...draft.firmIdentity }));
        if (Array.isArray(draft.caseTypeSelection)) setSelection(draft.caseTypeSelection);
        if (Array.isArray(draft.attorneys)) {
          setAttorneys(draft.attorneys.map((a: { name?: string; email?: string; mobile?: string | null; subTypeAssignments?: { caseTypeSlug: string; subTypeSlug: string }[] }) => ({
            name: a.name ?? '', email: a.email ?? '', mobile: a.mobile ?? '', subTypeAssignments: a.subTypeAssignments ?? [],
          })));
        }
      })
      .catch(() => {});
  }, [id]);

  function payload(finish: boolean) {
    return { firmIdentity, caseTypeSelection, attorneys: attorneys.map((a) => ({ ...a, mobile: a.mobile || null })), finish };
  }
  async function autosave() {
    // silent — ignore errors, no blocking UI
    try { await fetch(`/api/admin/tenants/${id}/onboarding`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(false)) }); } catch { /* noop */ }
  }
  function goTo(next: number) { void autosave(); setStep(next); }

  async function finishAndPublish() {
    setPublishing(true); setError(null);
    const res = await fetch(`/api/admin/tenants/${id}/onboarding`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(true)) });
    if (!res.ok) {
      const b = await res.json();
      setError((b.error ?? 'Could not finish') + (b.missing ? ` (missing: ${b.missing.join(', ')})` : ''));
      setPublishing(false); return;
    }
    const pub = await fetch(`/api/admin/tenants/${id}/publish`, { method: 'POST' });
    if (pub.ok) { window.location.href = `/admin/tenants/${id}`; }
    else { setError('Publish failed'); setPublishing(false); }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">Onboarding</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
      <div key={step} className="onboarding-step">
        {step === 0 && (
          <div className="space-y-4">
            <label>Law firm name<input value={firmIdentity.firmName} onChange={(e) => setFirm({ ...firmIdentity, firmName: e.target.value })} /></label>
            <label>Chatbot assistant name<input value={firmIdentity.chatbotName} onChange={(e) => setFirm({ ...firmIdentity, chatbotName: e.target.value })} /></label>
            <label>Email<input type="email" value={firmIdentity.email} onChange={(e) => setFirm({ ...firmIdentity, email: e.target.value })} /></label>
            <label>Deployment domain<input placeholder="acme.law" value={firmIdentity.domain} onChange={(e) => setFirm({ ...firmIdentity, domain: e.target.value })} /></label>
          </div>
        )}
        {step === 1 && <CaseMatrix value={caseTypeSelection} onChange={setSelection} />}
        {step === 2 && <AttorneysStep selection={caseTypeSelection} value={attorneys} onChange={setAttorneys} />}
      </div>
      {error && <p className="text-sm mt-3" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <div className="flex items-center gap-3 mt-6">
        {step > 0 && <button className="btn" onClick={() => goTo(step - 1)}>Back</button>}
        {step < STEPS.length - 1 && <button className="btn" onClick={() => goTo(step + 1)}>Next</button>}
        {step === STEPS.length - 1 && <button className="btn btn-primary" disabled={publishing} onClick={finishAndPublish}>{publishing ? 'Publishing…' : 'Finish & publish'}</button>}
      </div>
    </div>
  );
}
