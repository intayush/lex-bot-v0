'use client';

import { useState } from 'react';
import type { ChipSource } from '@legal-chatbot/shared';

/**
 * Step form (010-sop-workflow Phase 8 — T065).
 *
 * Inline form for adding or editing a single SOP step. The parent owns the
 * step list; this form just emits a draft via `onSubmit`. Validation here
 * is "best effort UX" — slug shape, inline JSON parseability — but the
 * Route Handler is the source of truth for save-time validation
 * (see lib/sop/sop-config-validation.ts and the route at
 * app/api/dashboard/sop/route.ts).
 */

export interface StepDraft {
  slug: string;
  position: number; // Managed by parent (drag-reorder); included for API parity.
  question_text: string;
  chip_source: ChipSource;
  inline_chips_json: string | null;
  accepts_free_text: boolean;
  is_required: boolean;
  counts_toward_threshold: boolean;
}

interface StepFormProps {
  initial?: StepDraft;
  onSubmit: (draft: StepDraft) => void;
  onCancel: () => void;
  /** Slugs already in use; used to warn if the user picks one. */
  existingSlugs: Set<string>;
}

const SLUG_REGEX = /^[a-z][a-z0-9_]*$/;

const EMPTY_DRAFT: StepDraft = {
  slug: '',
  position: 1,
  question_text: '',
  chip_source: null,
  inline_chips_json: null,
  accepts_free_text: true,
  is_required: true,
  counts_toward_threshold: true,
};

export function StepForm({ initial, onSubmit, onCancel, existingSlugs }: StepFormProps) {
  const [draft, setDraft] = useState<StepDraft>(initial ?? EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof StepDraft>(key: K, value: StepDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setError(null);
  }

  function handleSubmit() {
    // Slug shape.
    if (!SLUG_REGEX.test(draft.slug)) {
      setError('Slug must be lowercase snake_case starting with a letter (a-z, 0-9, underscore).');
      return;
    }
    if (!initial && existingSlugs.has(draft.slug)) {
      setError(`A step with slug "${draft.slug}" already exists.`);
      return;
    }
    if (draft.question_text.trim().length === 0) {
      setError('Question text cannot be empty.');
      return;
    }

    // Inline chips JSON.
    if (draft.chip_source === 'inline') {
      if (!draft.inline_chips_json || draft.inline_chips_json.trim().length === 0) {
        setError('Inline chips JSON is required when chip source is "inline".');
        return;
      }
      try {
        const parsed = JSON.parse(draft.inline_chips_json);
        if (!Array.isArray(parsed)) {
          setError('Inline chips JSON must be a JSON array.');
          return;
        }
        for (const item of parsed) {
          if (
            !item
            || typeof item !== 'object'
            || typeof (item as { label?: unknown }).label !== 'string'
            || typeof (item as { slug?: unknown }).slug !== 'string'
          ) {
            setError('Each inline chip must be { "label": "...", "slug": "..." }.');
            return;
          }
        }
      } catch {
        setError('Inline chips JSON is not valid JSON.');
        return;
      }
    }

    // Answerability.
    if (!draft.accepts_free_text && draft.chip_source === null) {
      setError('A step is unanswerable: enable free-text input OR pick a chip source.');
      return;
    }

    onSubmit({
      ...draft,
      // Clear inline_chips_json when chip_source isn't inline.
      inline_chips_json: draft.chip_source === 'inline' ? draft.inline_chips_json : null,
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#171717] mb-1">
            Slug{' '}
            <span className="text-[#A3A3A3] font-normal">
              (machine identifier, e.g., <code className="font-mono">case_type</code>)
            </span>
          </label>
          <input
            value={draft.slug}
            onChange={(e) => update('slug', e.target.value.toLowerCase())}
            disabled={Boolean(initial)}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm font-mono bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition disabled:bg-[#F5F5F5] disabled:text-[#A3A3A3]"
            placeholder="case_type"
          />
          {initial && (
            <p className="text-[10px] text-[#A3A3A3] mt-1">
              Slug cannot be changed after creation (it's referenced by SOP-state snapshots).
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-[#171717] mb-1">Chip source</label>
          <select
            value={draft.chip_source ?? ''}
            onChange={(e) => {
              const val = e.target.value;
              update('chip_source', (val === '' ? null : val) as ChipSource);
            }}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          >
            <option value="">No chips (free-text only)</option>
            <option value="case_types">case_types (firm's case-type list)</option>
            <option value="sub_types">sub_types (children of captured case_type)</option>
            <option value="inline">inline (custom chip list below)</option>
            <option value="contact_form">contact_form (name + phone/email widget)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[#171717] mb-1">Question text</label>
        <textarea
          value={draft.question_text}
          onChange={(e) => update('question_text', e.target.value)}
          className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm h-20 bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          placeholder="What kind of legal matter can we help you with?"
        />
        <p className="text-[10px] text-[#A3A3A3] mt-1">
          Use <code className="font-mono">{'{slug}'}</code> placeholders to reference earlier
          captured values, e.g. <code className="font-mono">What kind of {'{case_type}'} matter is this?</code>
        </p>
      </div>

      {draft.chip_source === 'inline' && (
        <div>
          <label className="block text-xs font-medium text-[#171717] mb-1">
            Inline chips JSON{' '}
            <span className="text-[#A3A3A3] font-normal">
              (array of <code className="font-mono">{'{ label, slug }'}</code>)
            </span>
          </label>
          <textarea
            value={draft.inline_chips_json ?? ''}
            onChange={(e) => update('inline_chips_json', e.target.value)}
            className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-xs font-mono h-24 bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
            placeholder='[{"label":"Yes","slug":"yes"},{"label":"No","slug":"no"}]'
          />
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
        <Toggle
          label="Accepts free-text"
          description="If off, the visitor can only click a chip."
          checked={draft.accepts_free_text}
          onChange={(v) => update('accepts_free_text', v)}
        />
        <Toggle
          label="Required"
          description="Required steps must be captured before SOP finalization."
          checked={draft.is_required}
          onChange={(v) => update('is_required', v)}
        />
        <Toggle
          label="Counts toward threshold"
          description="Counts toward the qualified-lead threshold."
          checked={draft.counts_toward_threshold}
          onChange={(v) => update('counts_toward_threshold', v)}
        />
      </div>

      {error && (
        <p className="text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSubmit}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-4 py-2 text-xs font-medium transition"
        >
          {initial ? 'Save changes' : 'Add step'}
        </button>
        <button
          onClick={onCancel}
          className="text-[#737373] hover:text-[#171717] rounded-lg px-4 py-2 text-xs font-medium transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="cursor-pointer text-xs"
      style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}
      title={description}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: '14px', height: '14px', accentColor: '#2563EB', margin: 0, marginTop: '2px', flexShrink: 0 }}
      />
      <span style={{ lineHeight: '16px' }}>{label}</span>
    </label>
  );
}
