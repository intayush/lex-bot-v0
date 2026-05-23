'use client';

import { useState, useMemo } from 'react';

/**
 * Goodbye Phrases tab (010-sop-workflow Phase 8 — T067).
 *
 * Simple add/remove chip-style list editor. The chatbot ends a
 * conversation with the configured polite closing only when the
 * visitor's message contains one of these phrases (word-boundary,
 * case-insensitive — see `lib/sop/goodbye-detector.ts` once US5 lands).
 *
 * Save POSTs the full list to /api/dashboard/sop/goodbye-phrases.
 * The route normalizes (trim + case-insensitive dedupe) on its side.
 */

interface ResultMessage {
  ok: boolean;
  message: string;
}

interface GoodbyePhrasesTabProps {
  initialPhrases: string[];
}

const MAX_PHRASES = 50;
const MAX_PHRASE_LENGTH = 50;

export function GoodbyePhrasesTab({ initialPhrases }: GoodbyePhrasesTabProps) {
  const initial = useMemo(() => [...initialPhrases], [initialPhrases]);
  const [phrases, setPhrases] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  function add() {
    setError(null);
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError('Phrase cannot be empty.');
      return;
    }
    if (trimmed.length > MAX_PHRASE_LENGTH) {
      setError(`Phrase must be ${MAX_PHRASE_LENGTH} characters or fewer.`);
      return;
    }
    if (phrases.length >= MAX_PHRASES) {
      setError(`Maximum ${MAX_PHRASES} phrases.`);
      return;
    }
    if (phrases.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in the list.`);
      return;
    }
    setPhrases((current) => [...current, trimmed]);
    setDraft('');
  }

  function remove(index: number) {
    setPhrases((current) => current.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  }

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/dashboard/sop/goodbye-phrases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrases }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResult({ ok: false, message: data.message ?? data.error ?? 'Save failed' });
      } else {
        setResult({ ok: true, message: `Saved ${data.count} phrase${data.count === 1 ? '' : 's'}.` });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-8">
      <div className="mb-4">
        <label className="block text-sm font-medium text-[#171717] mb-1.5">
          Goodbye phrases ({phrases.length}/{MAX_PHRASES})
        </label>
        <p className="text-xs text-[#737373]">
          When a visitor's message contains one of these phrases (word-boundary,
          case-insensitive), the chatbot uses your configured polite closing
          rather than continuing the SOP. Otherwise it always re-prompts the
          next pending step.
        </p>
      </div>

      {/* Chip list */}
      <div className="flex flex-wrap gap-2 mb-4 min-h-[2.5rem] p-3 bg-[#FAFAFA] rounded-lg border border-[#F5F5F5]">
        {phrases.length === 0 ? (
          <p className="text-xs text-[#A3A3A3] italic">No phrases configured yet.</p>
        ) : (
          phrases.map((phrase, i) => (
            <span
              key={`${phrase}-${i}`}
              className="inline-flex items-center gap-1.5 bg-white border border-[#E5E5E5] rounded-full pl-3 pr-2 py-1 text-xs"
            >
              <span className="text-[#171717]">{phrase}</span>
              <button
                onClick={() => remove(i)}
                aria-label={`Remove "${phrase}"`}
                className="text-[#A3A3A3] hover:text-[#DC2626] transition leading-none w-4 h-4 flex items-center justify-center rounded-full"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))
        )}
      </div>

      {/* Add */}
      <div className="flex gap-2 mb-2">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          maxLength={MAX_PHRASE_LENGTH}
          className="flex-1 border border-[#E5E5E5] rounded-lg px-3.5 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          placeholder="thanks, that's all, ok bye, ..."
        />
        <button
          onClick={add}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-4 py-2 text-sm font-medium transition"
        >
          Add
        </button>
      </div>
      {error && (
        <p className="text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-md px-3 py-2 mb-2">
          {error}
        </p>
      )}

      {/* Save */}
      <div className="mt-8 pt-6 border-t border-[#F5F5F5] flex gap-3 items-center flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save phrases'}
        </button>
        {result && (
          <span
            className={`text-sm ${result.ok ? 'text-[#059669]' : 'text-[#DC2626]'}`}
            role={result.ok ? 'status' : 'alert'}
          >
            {result.ok ? '✓ ' : ''}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}
