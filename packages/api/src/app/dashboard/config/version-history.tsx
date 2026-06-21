'use client';

import { useState } from 'react';

export interface VersionSummary {
  id: string;
  version: number;
  label: string | null;
  is_published: boolean;
  created_at: string;
  step_count?: number;
}

interface VersionHistoryProps {
  type: 'config' | 'sop';
  versions: VersionSummary[];
  latestVersionId: string;
  onRestore: (versionId: string) => void;
  onLabelChange: (versionId: string, label: string | null) => void;
  restoring?: string | null;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

function LabelCell({
  versionId,
  label,
  onChange,
}: {
  versionId: string;
  label: string | null;
  onChange: (versionId: string, label: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label ?? '');
  const [charError, setCharError] = useState(false);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    setCharError(false);
    onChange(versionId, trimmed === '' ? null : trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setDraft(label ?? ''); setEditing(false); setCharError(false); }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setCharError(val.length > 80);
    setDraft(val);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={handleChange}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          maxLength={85}
          placeholder="Version label (optional)"
          className={`px-2 py-1 text-xs rounded border ${charError ? 'border-[#EF4444]' : 'border-[#E5E5E5]'} bg-white text-[#171717] focus:outline-none focus:ring-1 focus:ring-[#171717] w-40`}
        />
        {charError && (
          <span className="text-[10px] text-[#EF4444]">{draft.length}/80 max</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => { setDraft(label ?? ''); setEditing(true); }}
      title="Click to edit label"
      className="text-left text-xs text-[#737373] hover:text-[#171717] hover:underline truncate max-w-[140px] block"
    >
      {label ?? <span className="italic text-[#A3A3A3]">Add label…</span>}
    </button>
  );
}

export function VersionHistory({
  type,
  versions,
  latestVersionId,
  onRestore,
  onLabelChange,
  restoring,
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E5E5] bg-[#FAFAFA] p-4 text-sm text-[#737373] italic">
        No saved versions yet.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[#E5E5E5] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[#E5E5E5] flex items-center justify-between">
        <span className="text-sm font-medium text-[#171717]">Version history</span>
        <span className="text-xs text-[#A3A3A3]">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
      </div>
      <ul className="divide-y divide-[#F5F5F5]">
        {versions.map((v) => {
          const isCurrent = v.id === latestVersionId;
          const isRestoring = restoring === v.id;
          return (
            <li key={v.id} className={`px-4 py-3 flex items-center gap-3 ${isCurrent ? 'bg-[#FAFAFA]' : ''}`}>
              {/* Version number */}
              <span className="text-xs font-mono text-[#A3A3A3] w-8 flex-shrink-0">v{v.version}</span>

              {/* Label + date */}
              <div className="flex-1 min-w-0">
                <LabelCell versionId={v.id} label={v.label} onChange={onLabelChange} />
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[#A3A3A3]">{formatDate(v.created_at)}</span>
                  {type === 'sop' && v.step_count !== undefined && (
                    <span className="text-[10px] text-[#A3A3A3]">· {v.step_count} step{v.step_count !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
                v.is_published
                  ? 'bg-[#ECFDF5] text-[#059669]'
                  : 'bg-[#F5F5F5] text-[#A3A3A3]'
              }`}>
                <span className={`w-1 h-1 rounded-full ${v.is_published ? 'bg-[#059669]' : 'bg-[#A3A3A3]'}`} />
                {v.is_published ? 'Published' : 'Draft'}
              </span>

              {/* Restore button — hidden for current (latest) version */}
              {!isCurrent ? (
                <button
                  type="button"
                  onClick={() => onRestore(v.id)}
                  disabled={!!restoring}
                  className="flex-shrink-0 text-xs font-medium text-[#171717] hover:bg-[#F5F5F5] rounded px-2 py-1 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isRestoring ? 'Restoring…' : 'Restore'}
                </button>
              ) : (
                <span className="flex-shrink-0 w-16 text-[10px] text-[#A3A3A3] text-right">current</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
