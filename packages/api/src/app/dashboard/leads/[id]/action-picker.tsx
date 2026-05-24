'use client';

import { useState } from 'react';
import { LEAD_ACTION_LABELS, type LeadAction } from '@legal-chatbot/shared';

/**
 * Lead follow-up action picker (013-lead-action-tracking T014).
 *
 * Native <select> + Save button on the lead detail page. Lawyer picks
 * one of the 3 fixed actions OR "No action yet" (clears). Save POSTs
 * to /api/dashboard/leads/[leadId]/action; on 200, updates the local
 * UI to reflect the new state + timestamp.
 *
 * Keeps the picker simple per research.md R5: native control, single
 * Save button (no auto-save), no modal, fewer-than-3-clicks per SC-001.
 *
 * Source of truth: contracts/lead-action-route-contract.md.
 */

interface ActionPickerProps {
  leadId: string;
  initialAction: LeadAction | null;
  initialChangedAt: string | null;
}

interface SaveState {
  status: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
}

/**
 * Format a UTC ISO 8601 timestamp into the lawyer's local timezone.
 * Example: "May 24, 2026, 2:14 PM"
 */
function formatTimestamp(iso: string | null): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return null;
  }
}

export function ActionPicker({
  leadId,
  initialAction,
  initialChangedAt,
}: ActionPickerProps) {
  // Display value in the <select>: empty string represents "no action yet".
  const [selectedValue, setSelectedValue] = useState<string>(initialAction ?? '');
  // The action that's been persisted (matches initialAction at first render).
  const [persistedAction, setPersistedAction] = useState<LeadAction | null>(initialAction);
  const [persistedChangedAt, setPersistedChangedAt] = useState<string | null>(initialChangedAt);
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });

  const isDirty = selectedValue !== (persistedAction ?? '');

  async function handleSave() {
    setSaveState({ status: 'saving' });
    const action: LeadAction | null = selectedValue === '' ? null : (selectedValue as LeadAction);

    try {
      const res = await fetch(`/api/dashboard/leads/${leadId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setSaveState({
          status: 'error',
          message: `Save failed (${res.status})`,
        });
        return;
      }
      const body: {
        success: boolean;
        follow_up_action: LeadAction | null;
        follow_up_action_changed_at: string | null;
      } = await res.json();
      setPersistedAction(body.follow_up_action);
      setPersistedChangedAt(body.follow_up_action_changed_at);
      setSaveState({ status: 'success' });
      // Fade success after 2s.
      setTimeout(() => {
        setSaveState((current) =>
          current.status === 'success' ? { status: 'idle' } : current,
        );
      }, 2000);
    } catch (err) {
      setSaveState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  const formatted = formatTimestamp(persistedChangedAt);

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[#A3A3A3] mb-4">
        Follow-up action
      </h3>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedValue}
          onChange={(e) => {
            setSelectedValue(e.target.value);
            // Reset error state when the user changes selection.
            if (saveState.status === 'error') {
              setSaveState({ status: 'idle' });
            }
          }}
          aria-label="Follow-up action"
          className="border border-[#E5E5E5] rounded-lg px-3.5 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition min-w-[14rem]"
        >
          <option value="">No action yet</option>
          {(Object.keys(LEAD_ACTION_LABELS) as LeadAction[]).map((slug) => (
            <option key={slug} value={slug}>
              {LEAD_ACTION_LABELS[slug]}
            </option>
          ))}
        </select>

        <button
          onClick={handleSave}
          disabled={!isDirty || saveState.status === 'saving'}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saveState.status === 'saving' ? 'Saving…' : 'Save'}
        </button>

        {saveState.status === 'success' && (
          <span
            className="text-sm text-[#059669] inline-flex items-center gap-1"
            role="status"
            aria-live="polite"
          >
            ✓ Saved
          </span>
        )}
        {saveState.status === 'error' && (
          <span
            className="text-sm text-[#DC2626]"
            role="alert"
            aria-live="assertive"
          >
            {saveState.message ?? 'Save failed'}
          </span>
        )}
      </div>

      {/* Timestamp line */}
      <p className="mt-3 text-xs italic text-[#737373]">
        {persistedAction && formatted
          ? `${LEAD_ACTION_LABELS[persistedAction]} on ${formatted}`
          : 'No action recorded yet.'}
      </p>
    </div>
  );
}
