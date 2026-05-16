'use client';

import { useState } from 'react';
import type { Configuration } from '@legal-chatbot/shared';

const DEFAULT_PRACTICE_AREAS = [
  'Personal Injury', 'Family Law', 'Estate Planning', 'Criminal Defense',
  'Immigration', 'Employment Law', 'Real Estate', 'Business Law',
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const defaultConfig: Configuration = {
  version: 0,
  saved_at: '',
  persona: { firm_name: '', chatbot_name: '', greeting_message: '', tone: 'friendly', language: 'English' },
  practice_areas: { active: [], custom: [], out_of_scope_response: '' },
  qualifying_questions: [{ question: '', required: true, order: 1 }],
  boundaries: { never_say: [''] },
  escalation: { triggers: [''], message: '' },
  contact: { phone: '', email: '', office_hours: [{ day: 'Monday', open: '9:00 AM', close: '5:00 PM' }], after_hours_message: '' },
  custom_instructions: '',
};

export function ConfigForm({ initialConfig }: { initialConfig: Configuration | null }) {
  const [config, setConfig] = useState<Configuration>(initialConfig ?? defaultConfig);
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [pubResult, setPubResult] = useState<{ success?: boolean; error?: string } | null>(null);

  const tabs = ['Persona', 'Practice Areas', 'Questions', 'Boundaries', 'Escalation', 'Contact', 'Custom'];

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', config }),
      });
      const data = await res.json();
      setSaveResult(data);
      if (data.success) {
        // Reload to get updated version number
        setTimeout(() => window.location.reload(), 500);
      }
    } catch {
      setSaveResult({ error: 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setPubResult(null);
    try {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      const data = await res.json();
      setPubResult(data);
      if (data.success) {
        setTimeout(() => window.location.reload(), 500);
      }
    } catch {
      setPubResult({ error: 'Network error' });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-4 border-b">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              activeTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-lg shadow p-6">
        {activeTab === 0 && <PersonaSection config={config} setConfig={setConfig} />}
        {activeTab === 1 && <PracticeAreasSection config={config} setConfig={setConfig} />}
        {activeTab === 2 && <QuestionsSection config={config} setConfig={setConfig} />}
        {activeTab === 3 && <BoundariesSection config={config} setConfig={setConfig} />}
        {activeTab === 4 && <EscalationSection config={config} setConfig={setConfig} />}
        {activeTab === 5 && <ContactSection config={config} setConfig={setConfig} />}
        {activeTab === 6 && <CustomSection config={config} setConfig={setConfig} />}
      </div>

      {/* Actions */}
      <div className="mt-4 flex gap-3 items-center">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="px-4 py-2 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {publishing ? 'Publishing...' : 'Publish'}
        </button>
        {saveResult?.success && <span className="text-green-600 text-sm">Saved!</span>}
        {saveResult?.error && <span className="text-red-600 text-sm">{saveResult.error}</span>}
        {pubResult?.success && <span className="text-green-600 text-sm">Published!</span>}
        {pubResult?.error && <span className="text-red-600 text-sm">{pubResult.error}</span>}
      </div>
    </div>
  );
}

// --- Section Components ---

type SectionProps = { config: Configuration; setConfig: (c: Configuration) => void };

function PersonaSection({ config, setConfig }: SectionProps) {
  const p = config.persona;
  const update = (fields: Partial<typeof p>) => setConfig({ ...config, persona: { ...p, ...fields } });

  return (
    <div className="space-y-4">
      <Field label="Firm Name" value={p.firm_name} onChange={(v) => update({ firm_name: v })} />
      <Field label="Chatbot Name" value={p.chatbot_name} onChange={(v) => update({ chatbot_name: v })} />
      <div>
        <label className="block text-sm font-medium mb-1">Greeting Message</label>
        <textarea
          value={p.greeting_message}
          onChange={(e) => update({ greeting_message: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm h-20"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Tone</label>
        <select
          value={p.tone}
          onChange={(e) => update({ tone: e.target.value as 'formal' | 'friendly' | 'neutral' })}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="formal">Formal</option>
          <option value="friendly">Friendly</option>
          <option value="neutral">Neutral</option>
        </select>
      </div>
      <Field label="Language" value={p.language} onChange={(v) => update({ language: v })} />
    </div>
  );
}

function PracticeAreasSection({ config, setConfig }: SectionProps) {
  const pa = config.practice_areas;
  const update = (fields: Partial<typeof pa>) => setConfig({ ...config, practice_areas: { ...pa, ...fields } });

  const toggleArea = (area: string) => {
    const active = pa.active.includes(area) ? pa.active.filter((a) => a !== area) : [...pa.active, area];
    update({ active });
  };

  const addCustom = () => update({ custom: [...pa.custom, ''] });
  const removeCustom = (i: number) => update({ custom: pa.custom.filter((_, idx) => idx !== i) });
  const setCustom = (i: number, v: string) => {
    const custom = [...pa.custom];
    custom[i] = v;
    update({ custom });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">Active Practice Areas</label>
        <div className="grid grid-cols-2 gap-2">
          {DEFAULT_PRACTICE_AREAS.map((area) => (
            <label key={area} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pa.active.includes(area)} onChange={() => toggleArea(area)} />
              {area}
            </label>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Custom Practice Areas</label>
        {pa.custom.map((c, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={c} onChange={(e) => setCustom(i, e.target.value)} className="flex-1 border rounded px-3 py-1 text-sm" />
            <button onClick={() => removeCustom(i)} className="text-red-500 text-sm">Remove</button>
          </div>
        ))}
        <button onClick={addCustom} className="text-blue-600 text-sm">+ Add custom area</button>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Out-of-Scope Response</label>
        <textarea
          value={pa.out_of_scope_response}
          onChange={(e) => update({ out_of_scope_response: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm h-20"
        />
      </div>
    </div>
  );
}

function QuestionsSection({ config, setConfig }: SectionProps) {
  const qs = config.qualifying_questions;
  const update = (questions: typeof qs) => setConfig({ ...config, qualifying_questions: questions });

  const add = () => update([...qs, { question: '', required: false, order: qs.length + 1 }]);
  const remove = (i: number) => update(qs.filter((_, idx) => idx !== i).map((q, idx) => ({ ...q, order: idx + 1 })));
  const set = (i: number, fields: Partial<(typeof qs)[0]>) => {
    const updated = [...qs];
    updated[i] = { ...updated[i], ...fields };
    update(updated);
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">Qualifying Questions (in order)</label>
      {qs.map((q, i) => (
        <div key={i} className="flex gap-2 items-start">
          <span className="text-xs text-gray-400 pt-2 w-5">{i + 1}.</span>
          <input
            value={q.question}
            onChange={(e) => set(i, { question: e.target.value })}
            className="flex-1 border rounded px-3 py-1 text-sm"
            placeholder="Enter question..."
          />
          <label className="flex items-center gap-1 text-xs whitespace-nowrap">
            <input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} />
            Required
          </label>
          <button onClick={() => remove(i)} className="text-red-500 text-xs">Remove</button>
        </div>
      ))}
      <button onClick={add} className="text-blue-600 text-sm">+ Add question</button>
    </div>
  );
}

function BoundariesSection({ config, setConfig }: SectionProps) {
  const rules = config.boundaries.never_say;
  const update = (never_say: string[]) => setConfig({ ...config, boundaries: { never_say } });

  const add = () => update([...rules, '']);
  const remove = (i: number) => update(rules.filter((_, idx) => idx !== i));
  const set = (i: number, v: string) => { const r = [...rules]; r[i] = v; update(r); };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">&quot;Never Say&quot; Rules</label>
      {rules.map((rule, i) => (
        <div key={i} className="flex gap-2">
          <input value={rule} onChange={(e) => set(i, e.target.value)} className="flex-1 border rounded px-3 py-1 text-sm" placeholder="Never..." />
          <button onClick={() => remove(i)} className="text-red-500 text-xs">Remove</button>
        </div>
      ))}
      <button onClick={add} className="text-blue-600 text-sm">+ Add rule</button>
    </div>
  );
}

function EscalationSection({ config, setConfig }: SectionProps) {
  const esc = config.escalation;
  const update = (fields: Partial<typeof esc>) => setConfig({ ...config, escalation: { ...esc, ...fields } });

  const triggers = esc.triggers;
  const addTrigger = () => update({ triggers: [...triggers, ''] });
  const removeTrigger = (i: number) => update({ triggers: triggers.filter((_, idx) => idx !== i) });
  const setTrigger = (i: number, v: string) => { const t = [...triggers]; t[i] = v; update({ triggers: t }); };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Escalation Triggers</label>
        {triggers.map((t, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <input value={t} onChange={(e) => setTrigger(i, e.target.value)} className="flex-1 border rounded px-3 py-1 text-sm" />
            <button onClick={() => removeTrigger(i)} className="text-red-500 text-xs">Remove</button>
          </div>
        ))}
        <button onClick={addTrigger} className="text-blue-600 text-sm">+ Add trigger</button>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Escalation Message</label>
        <textarea
          value={esc.message}
          onChange={(e) => update({ message: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm h-20"
        />
      </div>
    </div>
  );
}

function ContactSection({ config, setConfig }: SectionProps) {
  const c = config.contact;
  const update = (fields: Partial<typeof c>) => setConfig({ ...config, contact: { ...c, ...fields } });

  const setHour = (i: number, fields: Partial<(typeof c.office_hours)[0]>) => {
    const hours = [...c.office_hours];
    hours[i] = { ...hours[i], ...fields };
    update({ office_hours: hours });
  };
  const addHour = () => update({ office_hours: [...c.office_hours, { day: 'Monday', open: '9:00 AM', close: '5:00 PM' }] });
  const removeHour = (i: number) => update({ office_hours: c.office_hours.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-4">
      <Field label="Phone" value={c.phone} onChange={(v) => update({ phone: v })} />
      <Field label="Email" value={c.email} onChange={(v) => update({ email: v })} />
      <div>
        <label className="block text-sm font-medium mb-1">Office Hours</label>
        {c.office_hours.map((h, i) => (
          <div key={i} className="flex gap-2 mb-2 items-center">
            <select value={h.day} onChange={(e) => setHour(i, { day: e.target.value })} className="border rounded px-2 py-1 text-sm">
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <input value={h.open} onChange={(e) => setHour(i, { open: e.target.value })} className="border rounded px-2 py-1 text-sm w-24" />
            <span className="text-sm">to</span>
            <input value={h.close} onChange={(e) => setHour(i, { close: e.target.value })} className="border rounded px-2 py-1 text-sm w-24" />
            <button onClick={() => removeHour(i)} className="text-red-500 text-xs">Remove</button>
          </div>
        ))}
        <button onClick={addHour} className="text-blue-600 text-sm">+ Add hours</button>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">After-Hours Message</label>
        <textarea
          value={c.after_hours_message}
          onChange={(e) => update({ after_hours_message: e.target.value })}
          className="w-full border rounded px-3 py-2 text-sm h-20"
        />
      </div>
    </div>
  );
}

function CustomSection({ config, setConfig }: SectionProps) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">Custom Instructions</label>
      <textarea
        value={config.custom_instructions}
        onChange={(e) => setConfig({ ...config, custom_instructions: e.target.value })}
        className="w-full border rounded px-3 py-2 text-sm h-40"
        placeholder="Any additional behavioral instructions for the chatbot..."
      />
    </div>
  );
}

// --- Shared Components ---

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
    </div>
  );
}
