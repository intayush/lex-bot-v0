'use client';

import { use, useState } from 'react';

type Wizard = {
  firmIdentity: { firmName: string; chatbotName: string; greetingMessage: string; language: string };
  caseTypes: { slug: string; label: string; subTypes: never[] }[];
  persona: { tone: 'formal' | 'friendly' | 'neutral' };
  contact: { phone: string; email: string; officeHours: never[]; afterHoursMessage: string };
  escalation: { triggers: string[]; message: string };
};

const STEPS = ['Firm identity', 'Case types', 'Persona', 'Contact', 'Escalation'] as const;

/** 027 US2 — guided onboarding wizard (super-admin fills on the firm's behalf). */
export default function OnboardingWizard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [data, setData] = useState<Wizard>({
    firmIdentity: { firmName: '', chatbotName: 'Assistant', greetingMessage: 'Hi! How can I help you today?', language: 'English' },
    caseTypes: [{ slug: 'general', label: 'General inquiry', subTypes: [] }],
    persona: { tone: 'friendly' },
    contact: { phone: '', email: '', officeHours: [], afterHoursMessage: '' },
    escalation: { triggers: [], message: '' },
  });

  async function save(finish: boolean) {
    setStatus(finish ? 'Finishing…' : 'Saving…');
    const res = await fetch(`/api/admin/tenants/${id}/onboarding`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, finish }),
    });
    const body = await res.json();
    if (res.ok) {
      setStatus(finish ? 'Draft ready. Publishing…' : 'Saved.');
      if (finish) await publish();
    } else {
      setStatus(body.error + (body.missing ? ` (missing: ${body.missing.join(', ')})` : ''));
    }
  }

  async function publish() {
    const res = await fetch(`/api/admin/tenants/${id}/publish`, { method: 'POST' });
    const body = await res.json();
    setStatus(res.ok ? 'Published — tenant is live! 🎉' : body.error);
    if (res.ok) window.location.href = `/admin/tenants/${id}`;
  }

  const fi = data.firmIdentity;
  const c = data.contact;

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-2">Onboarding</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-muted)' }}>
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      <div className="space-y-4">
        {step === 0 && (
          <>
            <label>Firm name<input value={fi.firmName} onChange={(e) => setData({ ...data, firmIdentity: { ...fi, firmName: e.target.value } })} /></label>
            <label>Chatbot name<input value={fi.chatbotName} onChange={(e) => setData({ ...data, firmIdentity: { ...fi, chatbotName: e.target.value } })} /></label>
            <label>Greeting<textarea value={fi.greetingMessage} onChange={(e) => setData({ ...data, firmIdentity: { ...fi, greetingMessage: e.target.value } })} /></label>
          </>
        )}
        {step === 1 && (
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            A default case type is pre-filled. Case types, sub-types, and branches are refined in the firm SOP editor after onboarding.
          </p>
        )}
        {step === 2 && (
          <label>Tone
            <select value={data.persona.tone} onChange={(e) => setData({ ...data, persona: { tone: e.target.value as Wizard['persona']['tone'] } })}>
              <option value="friendly">Friendly</option>
              <option value="formal">Formal</option>
              <option value="neutral">Neutral</option>
            </select>
          </label>
        )}
        {step === 3 && (
          <>
            <label>Phone<input value={c.phone} onChange={(e) => setData({ ...data, contact: { ...c, phone: e.target.value } })} /></label>
            <label>Email<input type="email" value={c.email} onChange={(e) => setData({ ...data, contact: { ...c, email: e.target.value } })} /></label>
            <label>After-hours message<textarea value={c.afterHoursMessage} onChange={(e) => setData({ ...data, contact: { ...c, afterHoursMessage: e.target.value } })} /></label>
          </>
        )}
        {step === 4 && (
          <label>Escalation message<textarea value={data.escalation.message} onChange={(e) => setData({ ...data, escalation: { ...data.escalation, message: e.target.value } })} /></label>
        )}
      </div>

      <div className="flex items-center gap-3 mt-6">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < STEPS.length - 1 && <button className="btn" onClick={() => { void save(false); setStep(step + 1); }}>Save & next</button>}
        {step === STEPS.length - 1 && <button className="btn btn-primary" onClick={() => save(true)}>Finish & publish</button>}
        {status && <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>
    </div>
  );
}
