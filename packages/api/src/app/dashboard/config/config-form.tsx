'use client';

import { useState } from 'react';
import type { Configuration, CaseType } from '@legal-chatbot/shared';
import { VersionHistory, type VersionSummary } from './version-history';
import { AttorneysTab } from './attorneys-tab';
import type { Attorney } from '../../../lib/attorneys';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const defaultConfig: Configuration = {
  version: 0,
  saved_at: '',
  persona: { firm_name: '', chatbot_name: '', greeting_message: '', tone: 'friendly', language: 'English' },
  out_of_scope_response: '',
  boundaries: { never_say: [''] },
  escalation: { triggers: [''], message: '' },
  contact: { phone: '', email: '', office_hours: [{ day: 'Monday', open: '09:00', close: '17:00' }], after_hours_message: '' },
  custom_instructions: '',
};

interface ConfigFormProps {
  initialConfig: Configuration | null;
  history?: VersionSummary[];
  latestVersionId?: string | null;
  initialAttorneys?: Attorney[];
  caseTypes?: CaseType[];
}

export function ConfigForm({ initialConfig, history = [], latestVersionId = null, initialAttorneys = [], caseTypes = [] }: ConfigFormProps) {
  const [config, setConfig] = useState<Configuration>(initialConfig ?? defaultConfig);
  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [pubResult, setPubResult] = useState<{ success?: boolean; error?: string } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');

  const tabs = ['Persona', 'Boundaries', 'Escalation', 'Contact', 'Custom', 'Attorneys'];

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', config, label: draftLabel.trim() || null }),
      });
      const data = await res.json();
      setSaveResult(data);
      if (data.success) {
        setDraftLabel('');
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

  async function handleRestore(versionId: string) {
    setRestoring(versionId);
    try {
      const res = await fetch('/api/dashboard/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore', source_version_id: versionId }),
      });
      if (res.ok) {
        window.location.reload();
      }
    } finally {
      setRestoring(null);
    }
  }

  async function handleLabelChange(versionId: string, label: string | null) {
    await fetch('/api/dashboard/config/label', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version_id: versionId, label }),
    });
  }

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        {tabs.map((tab, i) => (
          <button
            key={tab}
            onClick={() => setActiveTab(i)}
            className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition ${
              activeTab === i
                ? 'bg-[#171717] text-white'
                : 'text-[#737373] hover:text-[#171717]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-8">
        {activeTab === 0 && <PersonaSection config={config} setConfig={setConfig} />}
        {activeTab === 1 && <BoundariesSection config={config} setConfig={setConfig} />}
        {activeTab === 2 && <EscalationSection config={config} setConfig={setConfig} />}
        {activeTab === 3 && <ContactSection config={config} setConfig={setConfig} />}
        {activeTab === 4 && <CustomSection config={config} setConfig={setConfig} />}
        {activeTab === 5 && <AttorneysTab initialAttorneys={initialAttorneys} caseTypes={caseTypes} />}
      </div>

      {/* Actions — hidden on Attorneys tab (no config save needed) */}
      {activeTab === 5 ? null : null /* placeholder to preserve structure */}
      {/* Actions */}
      <div className="mt-6 space-y-3">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value.slice(0, 80))}
            placeholder="Version label (optional)"
            maxLength={80}
            className="flex-1 max-w-xs px-3 py-2 text-sm rounded-lg border border-[#E5E5E5] bg-white text-[#171717] placeholder:text-[#A3A3A3] focus:outline-none focus:ring-1 focus:ring-[#171717]"
          />
          {draftLabel.length > 0 && (
            <span className="text-xs text-[#A3A3A3]">{draftLabel.length}/80</span>
          )}
        </div>
        <div className="flex gap-3 items-center">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="bg-[#059669] hover:bg-[#047857] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {publishing ? 'Publishing...' : 'Publish'}
        </button>
        {saveResult?.success && <span className="text-[#059669] text-sm">&#10003; Saved!</span>}
        {saveResult?.error && <span className="text-[#DC2626] text-sm">{saveResult.error}</span>}
        {pubResult?.success && <span className="text-[#059669] text-sm">&#10003; Published!</span>}
        {pubResult?.error && <span className="text-[#DC2626] text-sm">{pubResult.error}</span>}
        </div>
      </div>

      {/* Version History */}
      {history.length > 0 && (
        <div className="mt-8">
          <VersionHistory
            type="config"
            versions={history}
            latestVersionId={latestVersionId ?? ''}
            onRestore={handleRestore}
            onLabelChange={handleLabelChange}
            restoring={restoring}
          />
        </div>
      )}
    </div>
  );
}

// --- Section Components ---

type SectionProps = { config: Configuration; setConfig: (c: Configuration) => void };

function PersonaSection({ config, setConfig }: SectionProps) {
  const p = config.persona;
  const update = (fields: Partial<typeof p>) => setConfig({ ...config, persona: { ...p, ...fields } });

  return (
    <div className="space-y-5">
      <Field label="Firm Name" value={p.firm_name} onChange={(v) => update({ firm_name: v })} />
      <Field label="Chatbot Name" value={p.chatbot_name} onChange={(v) => update({ chatbot_name: v })} />
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Greeting Message</label>
        <textarea
          value={p.greeting_message}
          onChange={(e) => update({ greeting_message: e.target.value })}
          className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm h-24 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Tone</label>
        <select
          value={p.tone}
          onChange={(e) => update({ tone: e.target.value as 'formal' | 'friendly' | 'neutral' })}
          className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
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

function BoundariesSection({ config, setConfig }: SectionProps) {
  const rules = config.boundaries.never_say;
  const update = (never_say: string[]) => setConfig({ ...config, boundaries: { never_say } });

  const add = () => update([...rules, '']);
  const remove = (i: number) => update(rules.filter((_, idx) => idx !== i));
  const set = (i: number, v: string) => { const r = [...rules]; r[i] = v; update(r); };

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[#171717]">&quot;Never Say&quot; Rules</label>
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={i} className="bg-[#FAFAFA] rounded-lg p-3 border border-[#F5F5F5] border-l-2 border-l-[#2563EB] flex gap-2.5 items-center">
            <input
              value={rule}
              onChange={(e) => set(i, e.target.value)}
              className="flex-1 border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
              placeholder="Never..."
            />
            <button onClick={() => remove(i)} className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition">Remove</button>
          </div>
        ))}
      </div>
      <button onClick={add} className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] transition">+ Add rule</button>
      <div className="pt-2">
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Out-of-Scope Response</label>
        <p className="text-xs text-[#737373] mb-2">Sent when a visitor asks about a legal area outside your firm&apos;s scope.</p>
        <textarea
          value={config.out_of_scope_response}
          onChange={(e) => setConfig({ ...config, out_of_scope_response: e.target.value })}
          className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm h-24 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          placeholder="We don't handle that type of matter — please consult a specialist."
        />
      </div>
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
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Escalation Triggers</label>
        <div className="space-y-2">
          {triggers.map((t, i) => (
            <div key={i} className="bg-[#FAFAFA] rounded-lg p-3 border border-[#F5F5F5] border-l-2 border-l-[#2563EB] flex gap-2.5 items-center">
              <input
                value={t}
                onChange={(e) => setTrigger(i, e.target.value)}
                className="flex-1 border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
              />
              <button onClick={() => removeTrigger(i)} className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition">Remove</button>
            </div>
          ))}
        </div>
        <button onClick={addTrigger} className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] mt-2.5 transition">+ Add trigger</button>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Escalation Message</label>
        <textarea
          value={esc.message}
          onChange={(e) => update({ message: e.target.value })}
          className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm h-24 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
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
  const addHour = () => update({ office_hours: [...c.office_hours, { day: 'Monday', open: '09:00', close: '17:00' }] });
  const removeHour = (i: number) => update({ office_hours: c.office_hours.filter((_, idx) => idx !== i) });

  return (
    <div className="space-y-5">
      <Field label="Phone" value={c.phone} onChange={(v) => update({ phone: v })} />
      <Field label="Email" value={c.email} onChange={(v) => update({ email: v })} />
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">Office Hours</label>
        <div className="space-y-2">
          {c.office_hours.map((h, i) => (
            <div key={i} className="bg-[#FAFAFA] rounded-lg p-3 border border-[#F5F5F5] border-l-2 border-l-[#2563EB] flex gap-2.5 items-center flex-wrap">
              <select
                value={h.day}
                onChange={(e) => setHour(i, { day: e.target.value })}
                className="border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
              >
                {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input
                type="time"
                value={h.open}
                onChange={(e) => setHour(i, { open: e.target.value })}
                className="border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm w-32 bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
              />
              <span className="text-sm text-[#737373]">to</span>
              <input
                type="time"
                value={h.close}
                onChange={(e) => setHour(i, { close: e.target.value })}
                className="border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm w-32 bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
              />
              <button onClick={() => removeHour(i)} className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition">Remove</button>
            </div>
          ))}
        </div>
        <button onClick={addHour} className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] mt-2.5 transition">+ Add hours</button>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#171717] mb-1.5">After-Hours Message</label>
        <textarea
          value={c.after_hours_message}
          onChange={(e) => update({ after_hours_message: e.target.value })}
          className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm h-24 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
        />
      </div>
    </div>
  );
}

function CustomSection({ config, setConfig }: SectionProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#171717] mb-1.5">Custom Instructions</label>
      <textarea
        value={config.custom_instructions}
        onChange={(e) => setConfig({ ...config, custom_instructions: e.target.value })}
        className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm h-44 focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
        placeholder="Any additional behavioral instructions for the chatbot..."
      />
    </div>
  );
}

// --- Shared Components ---

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#171717] mb-1.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
      />
    </div>
  );
}
