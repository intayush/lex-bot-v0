'use client';

import { useState } from 'react';
import type { CaseType } from '@legal-chatbot/shared';
import type { Attorney } from '../../../lib/attorneys';

interface AttorneysTabProps {
  initialAttorneys: Attorney[];
  caseTypes: CaseType[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  name: string;
  email: string;
  mobile: string;
  case_type_slugs: string[];
}

const emptyForm = (): FormState => ({ name: '', email: '', mobile: '', case_type_slugs: [] });

export function AttorneysTab({ initialAttorneys, caseTypes }: AttorneysTabProps) {
  const [attorneys, setAttorneys] = useState<Attorney[]>(initialAttorneys);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inScopeTypes = caseTypes.filter((c) => c.is_in_scope);

  function openAdd() {
    setEditingId(null);
    setForm(emptyForm());
    setError(null);
    setShowForm(true);
  }

  function openEdit(a: Attorney) {
    setEditingId(a.id);
    setForm({ name: a.name, email: a.email, mobile: a.mobile ?? '', case_type_slugs: [...a.case_type_slugs] });
    setError(null);
    setShowForm(true);
  }

  function cancel() {
    setShowForm(false);
    setEditingId(null);
    setError(null);
  }

  function toggleSlug(slug: string) {
    setForm((f) => ({
      ...f,
      case_type_slugs: f.case_type_slugs.includes(slug)
        ? f.case_type_slugs.filter((s) => s !== slug)
        : [...f.case_type_slugs, slug],
    }));
  }

  const canSubmit = form.name.trim().length > 0 && EMAIL_REGEX.test(form.email.trim());

  async function handleSave() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);

    const body = {
      name: form.name.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim() || null,
      case_type_slugs: form.case_type_slugs,
    };

    try {
      const url = editingId
        ? `/api/dashboard/attorneys/${editingId}`
        : '/api/dashboard/attorneys';
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Save failed');
        return;
      }
      // Refresh list
      const listRes = await fetch('/api/dashboard/attorneys');
      const listData = await listRes.json();
      setAttorneys(listData.attorneys ?? []);
      cancel();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from the attorney roster?`)) return;
    const res = await fetch(`/api/dashboard/attorneys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setAttorneys((prev) => prev.filter((a) => a.id !== id));
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1.5px solid #E5E7EB',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    backgroundColor: '#ffffff',
    color: '#111827',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '12px',
    fontWeight: 500,
    color: '#6B7280',
    marginBottom: '4px',
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#111827' }}>
            Attorneys ({attorneys.length})
          </div>
          <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>
            HOT leads are routed by email to attorneys matching the lead's case type.
          </div>
        </div>
        {!showForm && (
          <button
            onClick={openAdd}
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#4338ca',
              color: '#ffffff',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              fontFamily: 'inherit',
            }}
          >
            + Add attorney
          </button>
        )}
      </div>

      {/* Attorney list */}
      {attorneys.length === 0 && !showForm && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9CA3AF', fontSize: '14px' }}>
          No attorneys yet. Add one to start routing HOT leads.
        </div>
      )}

      {attorneys.map((a) => (
        <div key={a.id} style={{
          border: '1px solid #E5E7EB',
          borderRadius: '12px',
          padding: '14px 16px',
          marginBottom: '10px',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>{a.name}</div>
            <div style={{ fontSize: '13px', color: '#6B7280', marginTop: '2px' }}>{a.email}</div>
            {a.mobile && <div style={{ fontSize: '12px', color: '#9CA3AF', marginTop: '1px' }}>{a.mobile}</div>}
            {a.case_type_slugs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                {a.case_type_slugs.map((slug) => {
                  const ct = caseTypes.find((c) => c.slug === slug);
                  return (
                    <span key={slug} style={{
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: '#EEF2FF',
                      color: '#4338ca',
                      fontSize: '11px',
                      fontWeight: 500,
                    }}>
                      {ct?.label ?? slug}
                    </span>
                  );
                })}
              </div>
            )}
            {a.case_type_slugs.length === 0 && (
              <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '6px', fontStyle: 'italic' }}>
                No case types — will not receive routing emails
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              onClick={() => openEdit(a)}
              style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #E5E7EB', background: '#F9FAFB', color: '#374151', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
            >
              Edit
            </button>
            <button
              onClick={() => handleDelete(a.id, a.name)}
              style={{ padding: '5px 10px', borderRadius: '6px', border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit' }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* Add / Edit form */}
      {showForm && (
        <div style={{ border: '1.5px solid #4338ca', borderRadius: '12px', padding: '20px', background: '#FAFAFA', marginTop: '12px' }}>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827', marginBottom: '16px' }}>
            {editingId ? 'Edit attorney' : 'Add attorney'}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Sarah Kim Esq."
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="sarah@firm.com"
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Mobile (optional)</label>
            <input
              type="tel"
              value={form.mobile}
              onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
              placeholder="+1 412 555 0001"
              style={{ ...inputStyle, maxWidth: '280px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Case types (receives emails for HOT leads of these types)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '6px' }}>
              {inScopeTypes.map((ct) => {
                const checked = form.case_type_slugs.includes(ct.slug);
                return (
                  <label key={ct.slug} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSlug(ct.slug)}
                      style={{ width: '15px', height: '15px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '13px', color: '#374151' }}>{ct.label}</span>
                  </label>
                );
              })}
              {inScopeTypes.length === 0 && (
                <span style={{ fontSize: '13px', color: '#9CA3AF', fontStyle: 'italic' }}>
                  No case types defined. Add them in the SOP → Case Types tab first.
                </span>
              )}
            </div>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#FEF2F2', color: '#DC2626', fontSize: '13px', marginBottom: '12px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSave}
              disabled={!canSubmit || saving}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                background: canSubmit && !saving ? '#4338ca' : '#9CA3AF',
                color: '#ffffff',
                border: 'none',
                cursor: canSubmit && !saving ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: 500,
                fontFamily: 'inherit',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={cancel}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #E5E7EB', background: '#ffffff', color: '#374151', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
