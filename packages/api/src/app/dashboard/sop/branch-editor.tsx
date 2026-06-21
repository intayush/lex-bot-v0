'use client';

/**
 * Spec 016 US4 — Branch editor (T054 / FR-022 / FR-023 / FR-024 / FR-025).
 *
 * Loads the per-pair detail from
 * `GET /api/dashboard/branches/[caseType]/[subType]` and renders an
 * inline editor with:
 *
 *   - Active toggle (FR-025)
 *   - Ordered question list (text + per-chip weights + free-text flag)
 *   - Add / remove / move-up / move-down questions (FR-022)
 *   - Add / remove / edit chips per question (label + slug + weight)
 *   - Threshold inputs (Self table only in v1; family_friend uses
 *     same defaults — admin-overridable later) (FR-024)
 *   - Hard-override toggles (FR-024)
 *   - Save (creates a new draft) and Publish (FR-017)
 *   - Delete (FR-026, with confirm)
 *
 * Save warnings (negative_total_max / positive_total_max_above_100 /
 * zero_questions) are displayed inline below the Save button (T056).
 *
 * Drag-and-drop reordering deferred to a later iteration; up/down
 * arrows keep the editor accessible without dnd-kit ceremony.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BranchDetailResponse,
  BranchQuestion,
  BranchSaveResponse,
  BranchSaveWarning,
  CaseValueBand,
  CaseValueConfig,
  ThresholdsFamilyFriend,
  ThresholdsSelf,
} from '@legal-chatbot/shared';

interface BranchEditorProps {
  caseTypeSlug: string;
  subTypeSlug: string;
  caseTypeLabel: string;
  subTypeLabel: string;
  existingBranchId: string | null;
  onAfterMutation: () => void | Promise<void>;
  onClose: () => void;
}

interface ResultMessage {
  ok: boolean;
  message: string;
}

const DEFAULT_THRESHOLDS_SELF: ThresholdsSelf = {
  hot: [76, 100],
  warm: [51, 75],
  cold: [26, 50],
  spam: [0, 25],
};

const DEFAULT_THRESHOLDS_FAMILY: ThresholdsFamilyFriend = {
  hot: [71, 100],
  warm: [46, 70],
  spam: [0, 45],
};

const DEFAULT_OVERRIDES = {
  missing_contact: true,
  out_of_scope: true,
  no_injury_no_treatment: true,
  fake_info: true,
};

function emptyQuestion(position: number): BranchQuestion {
  return {
    id: `new_q_${Date.now()}_${position}`,
    position,
    text: '',
    preface: null,
    chips: [],
    free_text_allowed: true,
    multi_select: false,
  };
}

export function BranchEditor({
  caseTypeSlug,
  subTypeSlug,
  caseTypeLabel,
  subTypeLabel,
  existingBranchId,
  onAfterMutation,
  onClose,
}: BranchEditorProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [isCaseValueEnabled, setIsCaseValueEnabled] = useState(false);
  const [caseValueBands, setCaseValueBands] = useState<CaseValueBand[]>([]);
  const [questions, setQuestions] = useState<BranchQuestion[]>([]);
  const [thresholdsSelf, setThresholdsSelf] = useState<ThresholdsSelf>(DEFAULT_THRESHOLDS_SELF);
  const [thresholdsFamily, setThresholdsFamily] =
    useState<ThresholdsFamilyFriend>(DEFAULT_THRESHOLDS_FAMILY);
  const [overrides, setOverrides] = useState(DEFAULT_OVERRIDES);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [warnings, setWarnings] = useState<BranchSaveWarning[]>([]);
  const [hasDraft, setHasDraft] = useState(false);

  // --- Import state (020-branch-csv-import) ---
  const [importState, setImportState] = useState<'idle' | 'uploading' | 'error' | 'preview'>('idle');
  const [importErrors, setImportErrors] = useState<Array<{ row: number; column: string; message: string }>>([]);
  const [importedQuestions, setImportedQuestions] = useState<BranchQuestion[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!existingBranchId) {
      setLoading(false);
      // Fresh branch: start with one empty question + defaults.
      setQuestions([emptyQuestion(0)]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as BranchDetailResponse;
      setIsActive(data.branch.is_active);
      setIsCaseValueEnabled((data.branch as { is_case_value_enabled?: boolean }).is_case_value_enabled ?? false);
      // Prefer draft over current_version in the editor (admins want
      // to keep iterating their pending edits).
      const v = data.draft_version ?? data.current_version;
      if (v) {
        setQuestions(v.questions);
        setThresholdsSelf(v.classification_thresholds.self);
        setThresholdsFamily(v.classification_thresholds.family_friend);
        setOverrides(v.hard_override_toggles);
        setCaseValueBands(v.case_value_config?.bands ?? []);
      }
      setHasDraft(data.draft_version !== null);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      setError(`Failed to load branch: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [caseTypeSlug, existingBranchId, subTypeSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  function moveQuestion(index: number, delta: -1 | 1) {
    setQuestions((curr) => {
      const target = index + delta;
      if (target < 0 || target >= curr.length) return curr;
      const copy = [...curr];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy.map((q, i) => ({ ...q, position: i }));
    });
  }

  function addQuestion() {
    setQuestions((curr) => [...curr, emptyQuestion(curr.length)]);
  }

  function removeQuestion(index: number) {
    setQuestions((curr) =>
      curr.filter((_, i) => i !== index).map((q, i) => ({ ...q, position: i })),
    );
  }

  function updateQuestion(index: number, patch: Partial<BranchQuestion>) {
    setQuestions((curr) => curr.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  async function handleSave() {
    setSaving(true);
    setResult(null);
    setWarnings([]);
    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_active: isActive,
            questions,
            classification_thresholds: {
              self: thresholdsSelf,
              family_friend: thresholdsFamily,
            },
            hard_override_toggles: overrides,
            case_value_config: caseValueBands.length > 0 ? { bands: caseValueBands } : null,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setResult({
          ok: false,
          message: data?.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      const saved = data as BranchSaveResponse;
      setWarnings(saved.warnings);
      setResult({
        ok: true,
        message: `Saved as draft v${saved.version_number}.${
          existingBranchId === null ? ' (Auto-published as v1.)' : ''
        }`,
      });
      setHasDraft(existingBranchId !== null); // first save auto-publishes
      await onAfterMutation();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  // --- Import handlers (020-branch-csv-import) ---

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!e.target) return;
    // Reset the input so the same file can be re-selected after an error fix.
    (e.target as HTMLInputElement).value = '';
    if (!file) return;

    setImportState('uploading');
    setImportErrors([]);
    setImportedQuestions(null);

    const fd = new FormData();
    fd.append('file', file);

    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}/import`,
        { method: 'POST', body: fd },
      );
      const data = await res.json() as { ok: boolean; questions?: BranchQuestion[]; errors?: Array<{ row: number; column: string; message: string }> };
      if (data.ok && data.questions) {
        setImportedQuestions(data.questions);
        setImportState('preview');
      } else {
        setImportErrors(data.errors ?? []);
        setImportState('error');
      }
    } catch {
      setImportErrors([{ row: 0, column: 'file', message: 'Network error — could not reach the server.' }]);
      setImportState('error');
    }
  }

  async function handleImportSaveAsDraft() {
    if (!importedQuestions) return;
    // Apply the imported questions, keep existing thresholds and overrides.
    setQuestions(importedQuestions);
    setImportState('idle');
    setImportedQuestions(null);
    // Trigger the regular save flow with the imported questions.
    setSaving(true);
    setResult(null);
    setWarnings([]);
    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_active: isActive,
            questions: importedQuestions,
            classification_thresholds: { self: thresholdsSelf, family_friend: thresholdsFamily },
            hard_override_toggles: overrides,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, message: data?.message ?? `HTTP ${res.status}` });
        return;
      }
      const saved = data as BranchSaveResponse;
      setWarnings(saved.warnings);
      setResult({ ok: true, message: `Imported and saved as draft v${saved.version_number}.` });
      setHasDraft(existingBranchId !== null);
      await onAfterMutation();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  function handleImportCancel() {
    setImportState('idle');
    setImportErrors([]);
    setImportedQuestions(null);
  }

  async function handlePublish() {
    setPublishing(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}/publish`,
        { method: 'POST' },
      );
      const data = await res.json();
      if (!res.ok) {
        setResult({
          ok: false,
          message: data?.message ?? `HTTP ${res.status}`,
        });
        return;
      }
      setResult({
        ok: true,
        message: `Published v${data.version_number}.`,
      });
      setHasDraft(false);
      await onAfterMutation();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Publish failed' });
    } finally {
      setPublishing(false);
    }
  }

  async function handleDelete() {
    if (!existingBranchId) return;
    if (
      !window.confirm(
        `Delete the branch for ${caseTypeLabel} → ${subTypeLabel}?\n\nHistorical leads keep their captured snapshots — only the live configuration is removed. New conversations will use the default-only flow.`,
      )
    )
      return;
    setDeleting(true);
    setResult(null);
    try {
      const res = await fetch(
        `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}`,
        { method: 'DELETE' },
      );
      if (res.status !== 204) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setResult({ ok: true, message: 'Branch deleted.' });
      await onAfterMutation();
      onClose();
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'Delete failed' });
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[#737373]">Loading…</p>;
  }
  if (error) {
    return (
      <div className="text-sm text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Active toggle */}
      <div className="flex items-center gap-2.5">
        <input
          id={`branch-active-${caseTypeSlug}-${subTypeSlug}`}
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-[#A3A3A3]"
        />
        <label
          htmlFor={`branch-active-${caseTypeSlug}-${subTypeSlug}`}
          className="text-sm text-[#171717]"
        >
          Active — fires after Step 6 for this pair when published.
        </label>
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <h4 className="text-sm font-semibold text-[#171717]">
            Questions ({questions.length})
          </h4>
          <button
            type="button"
            onClick={addQuestion}
            aria-label="Add question"
            title="Add question"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#171717] hover:bg-[#F5F5F5] rounded px-2 py-1 transition"
          >
            <PlusIcon />
            <span className="hidden sm:inline">Add question</span>
          </button>
        </div>
        <div className="space-y-3">
          {questions.map((q, index) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={index}
              total={questions.length}
              onChange={(patch) => updateQuestion(index, patch)}
              onRemove={() => removeQuestion(index)}
              onMoveUp={() => moveQuestion(index, -1)}
              onMoveDown={() => moveQuestion(index, 1)}
            />
          ))}
          {questions.length === 0 && (
            <p className="text-xs text-[#737373] italic">
              No questions yet. Click &ldquo;Add question&rdquo; to begin.
            </p>
          )}
        </div>
      </div>

      {/* Thresholds */}
      <ThresholdEditor
        thresholdsSelf={thresholdsSelf}
        thresholdsFamily={thresholdsFamily}
        onChangeSelf={setThresholdsSelf}
        onChangeFamily={setThresholdsFamily}
      />

      {/* Hard overrides */}
      <div>
        <h4 className="text-sm font-semibold text-[#171717] mb-2">
          Hard-override SPAM rules
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {(Object.keys(overrides) as Array<keyof typeof overrides>).map((k) => (
            <label
              key={k}
              className="flex items-center gap-2.5 text-sm text-[#171717]"
            >
              <input
                type="checkbox"
                checked={overrides[k]}
                onChange={(e) =>
                  setOverrides((curr) => ({ ...curr, [k]: e.target.checked }))
                }
                className="h-4 w-4 rounded border-[#A3A3A3]"
              />
              {k.replace(/_/g, ' ')}
            </label>
          ))}
        </div>
      </div>

      {/* --- Case Value Estimator (025-case-value-estimator) --- */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <h4 className="text-sm font-semibold text-[#171717]">Case Value Estimator</h4>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isCaseValueEnabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setIsCaseValueEnabled(enabled);
                if (existingBranchId) {
                  await fetch(
                    `/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}/toggle-case-value`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled }),
                    },
                  );
                }
              }}
              className="h-4 w-4"
            />
            <span className="text-xs text-[#737373]">{isCaseValueEnabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>
        {isCaseValueEnabled && (
          <div className="space-y-2">
            <p className="text-xs text-[#737373] mb-2">
              Define dollar ranges shown on HOT/WARM/COLD leads matching this branch. Score 0–100.
            </p>
            {caseValueBands.map((band, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 p-3 rounded-lg border border-[#E5E5E5] bg-[#FAFAFA]">
                <div className="flex items-center gap-1 text-xs text-[#737373]">
                  <span>Score</span>
                  <input
                    type="number" min={0} max={100} value={band.score_min}
                    onChange={(e) => setCaseValueBands((b) => b.map((x, j) => j === i ? { ...x, score_min: Number(e.target.value) } : x))}
                    className="w-14 px-1.5 py-1 border border-[#E5E5E5] rounded text-xs"
                  />
                  <span>–</span>
                  <input
                    type="number" min={0} max={100} value={band.score_max}
                    onChange={(e) => setCaseValueBands((b) => b.map((x, j) => j === i ? { ...x, score_max: Number(e.target.value) } : x))}
                    className="w-14 px-1.5 py-1 border border-[#E5E5E5] rounded text-xs"
                  />
                </div>
                <div className="flex items-center gap-1 text-xs text-[#737373]">
                  <span>→ $</span>
                  <input
                    type="number" min={0} value={band.value_min_usd}
                    onChange={(e) => setCaseValueBands((b) => b.map((x, j) => j === i ? { ...x, value_min_usd: Number(e.target.value) } : x))}
                    className="w-24 px-1.5 py-1 border border-[#E5E5E5] rounded text-xs"
                    placeholder="min USD"
                  />
                  <span>–</span>
                  <input
                    type="number" min={0} value={band.value_max_usd}
                    onChange={(e) => setCaseValueBands((b) => b.map((x, j) => j === i ? { ...x, value_max_usd: Number(e.target.value) } : x))}
                    className="w-24 px-1.5 py-1 border border-[#E5E5E5] rounded text-xs"
                    placeholder="max USD"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setCaseValueBands((b) => b.filter((_, j) => j !== i))}
                  className="text-xs text-[#EF4444] hover:text-[#DC2626] ml-auto"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setCaseValueBands((b) => [
                ...b,
                { score_min: 0, score_max: 100, value_min_usd: 0, value_max_usd: 0, position: b.length },
              ])}
              className="text-xs text-[#4338ca] hover:text-[#3730a3] font-medium"
            >
              + Add band
            </button>
          </div>
        )}
      </div>

      {/* --- CSV Import UI (020-branch-csv-import) --- */}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Import error panel */}
      {importState === 'error' && (
        <div className="mt-4 rounded-lg border border-[#FECACA] bg-[#FFF7F7] p-4">
          <p className="text-sm font-semibold text-[#991B1B] mb-2">Import failed — fix the issues below and re-upload.</p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[#6B7280]">
                <th className="pr-4 pb-1">Row</th>
                <th className="pr-4 pb-1">Column</th>
                <th className="pb-1">Issue</th>
              </tr>
            </thead>
            <tbody>
              {importErrors.map((err, i) => (
                <tr key={i} className="border-t border-[#FEE2E2]">
                  <td className="pr-4 py-1 text-[#374151]">{err.row || '—'}</td>
                  <td className="pr-4 py-1 font-mono text-[#374151]">{err.column}</td>
                  <td className="py-1 text-[#374151]">{err.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={handleImportClick}
            className="mt-3 px-3 py-1.5 rounded-md border border-[#E5E5E5] text-sm text-[#374151] hover:bg-[#F9FAFB] transition"
          >
            Re-upload fixed CSV
          </button>
        </div>
      )}

      {/* Import preview panel */}
      {importState === 'preview' && importedQuestions && (
        <div className="mt-4 rounded-lg border border-[#D1FAE5] bg-[#F0FDF4] p-4">
          <p className="text-sm font-semibold text-[#065F46] mb-3">
            Preview — {importedQuestions.length} question{importedQuestions.length !== 1 ? 's' : ''} parsed. Review and save as draft.
          </p>
          <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
            {importedQuestions.map((q, qi) => (
              <div key={qi} className="rounded-md border border-[#BBF7D0] bg-white p-3">
                <p className="text-xs font-semibold text-[#374151] mb-1">Q{qi + 1}: {q.text}</p>
                <p className="text-xs text-[#6B7280] mb-1.5">
                  Free text: {q.free_text_allowed ? 'Yes' : 'No'} · Multi-select: {q.multi_select ? 'Yes' : 'No'}
                </p>
                <div className="flex flex-wrap gap-1">
                  {q.chips.map((c, ci) => (
                    <span key={ci} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#ECFDF5] border border-[#6EE7B7] text-xs text-[#065F46]">
                      {c.label}
                      <span className="text-[#059669] font-medium">({c.score_weight >= 0 ? '+' : ''}{c.score_weight})</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleImportSaveAsDraft}
              disabled={saving}
              className="px-4 py-2 rounded-md bg-[#059669] text-white text-sm font-medium hover:bg-[#047857] disabled:opacity-60 transition"
            >
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              type="button"
              onClick={handleImportCancel}
              className="px-4 py-2 rounded-md border border-[#E5E5E5] text-sm text-[#374151] hover:bg-[#F9FAFB] transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Import loading indicator */}
      {importState === 'uploading' && (
        <div className="mt-4 text-sm text-[#6B7280] animate-pulse">Parsing CSV…</div>
      )}

      {/* Action bar — buttons share the same shape and size, and the
          row wraps onto multiple lines on narrow viewports so labels
          aren't truncated. The Delete button moves below the
          Save / Publish pair on mobile (no `ml-auto`); on sm:+ it
          right-aligns. */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#E5E5E5]">
        {/* Download CSV Template */}
        <a
          href={`/api/dashboard/branches/${encodeURIComponent(caseTypeSlug)}/${encodeURIComponent(subTypeSlug)}/template`}
          download
          className="flex-1 sm:flex-none min-w-[7rem] px-4 py-2 rounded-md border border-[#E5E5E5] text-[#374151] text-sm font-medium hover:bg-[#F9FAFB] transition text-center"
        >
          ↓ CSV Template
        </a>
        {/* Import from CSV */}
        <button
          type="button"
          onClick={handleImportClick}
          disabled={importState === 'uploading'}
          className="flex-1 sm:flex-none min-w-[7rem] px-4 py-2 rounded-md border border-[#2563EB] text-[#2563EB] text-sm font-medium hover:bg-[#EFF6FF] disabled:opacity-60 transition"
        >
          ↑ Import CSV
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 sm:flex-none min-w-[7rem] px-4 py-2 rounded-md bg-[#171717] text-white text-sm font-medium hover:bg-[#404040] disabled:opacity-60 transition"
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing || !hasDraft}
          title={hasDraft ? 'Make draft live' : 'No draft to publish'}
          className="flex-1 sm:flex-none min-w-[7rem] px-4 py-2 rounded-md bg-[#059669] text-white text-sm font-medium hover:bg-[#047857] disabled:opacity-60 transition"
        >
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
        {existingBranchId && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 sm:flex-none sm:ml-auto min-w-[7rem] px-4 py-2 rounded-md border border-[#FECACA] text-[#991B1B] text-sm font-medium hover:bg-[#FEF2F2] disabled:opacity-60 transition"
          >
            {deleting ? 'Deleting…' : 'Delete branch'}
          </button>
        )}
      </div>

      {/* Result + warnings */}
      {result && (
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            result.ok
              ? 'border border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]'
              : 'border border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]'
          }`}
        >
          {result.message}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm text-[#92400E]">
          <div className="font-medium mb-1">Warnings</div>
          <ul className="list-disc list-inside space-y-0.5">
            {warnings.map((w) => (
              <li key={w.code}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionRow
// ---------------------------------------------------------------------------

interface QuestionRowProps {
  question: BranchQuestion;
  index: number;
  total: number;
  onChange: (patch: Partial<BranchQuestion>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function QuestionRow({
  question,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: QuestionRowProps) {
  function updateChip(chipIdx: number, patch: Partial<BranchQuestion['chips'][0]>) {
    onChange({
      chips: question.chips.map((c, i) => (i === chipIdx ? { ...c, ...patch } : c)),
    });
  }
  function addChip() {
    onChange({
      chips: [
        ...question.chips,
        { slug: `chip_${question.chips.length + 1}`, label: 'New chip', score_weight: 0 },
      ],
    });
  }
  function removeChip(chipIdx: number) {
    onChange({ chips: question.chips.filter((_, i) => i !== chipIdx) });
  }

  return (
    <div className="rounded-md border border-[#E5E5E5] bg-[#FAFAFA] p-3">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-[#737373]">Q{index + 1}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Move up"
            className="text-xs text-[#737373] hover:text-[#171717] disabled:opacity-30 px-1.5 py-1 rounded hover:bg-[#F5F5F5]"
            title="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="Move down"
            className="text-xs text-[#737373] hover:text-[#171717] disabled:opacity-30 px-1.5 py-1 rounded hover:bg-[#F5F5F5]"
            title="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove question"
            title="Remove question"
            className="ml-2 inline-flex items-center gap-1.5 text-xs text-[#991B1B] hover:bg-[#FEF2F2] rounded px-2 py-1 transition"
          >
            <TrashIcon />
            <span className="hidden sm:inline">Remove</span>
          </button>
        </div>
      </div>

      <input
        type="text"
        value={question.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Question text"
        aria-label={`Question ${index + 1} text`}
        className="w-full px-2 py-1.5 text-sm rounded border border-[#E5E5E5] bg-white text-[#171717] placeholder:text-[#A3A3A3] focus:outline-none focus:ring-2 focus:ring-[#171717] focus:border-[#171717] mb-2"
      />

      <div className="flex items-center gap-4 mb-2 text-xs text-[#737373] flex-wrap">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={question.free_text_allowed}
            onChange={(e) => onChange({ free_text_allowed: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          Allow free-text
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={question.multi_select}
            onChange={(e) => onChange({ multi_select: e.target.checked })}
            className="h-3.5 w-3.5"
          />
          Multi-select
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium text-[#737373]">Chips</div>
        {/* Header row visible only at sm: and up where chips render
            in a 4-column grid. On mobile each chip stacks its fields
            with their own visible labels (see field labels below). */}
        {question.chips.length > 0 && (
          <div className="hidden sm:grid sm:items-center sm:gap-1.5 px-2 text-[10px] uppercase tracking-wide text-[#A3A3A3] chip-grid-row">
            <div>Label (visible)</div>
            <div>Slug (machine id)</div>
            <div className="text-right">Weight</div>
            <div aria-hidden />
          </div>
        )}
        {question.chips.map((chip, chipIdx) => (
          <div
            key={chipIdx}
            className="rounded border border-transparent sm:border-0 sm:bg-transparent bg-white sm:p-0 p-2"
          >
            {/*
              Mobile (default): each chip's fields stack vertically
              with their own visible labels so Label / Slug / Weight
              each get full width and aren't crammed into a 30%
              column.
              Desktop (sm:+): collapse back to the original 4-column
              grid via inline `gridTemplateColumns` (Tailwind's
              arbitrary-value `grid-cols-[…]` syntax doesn't reliably
              accept `minmax(0,1fr)` so the inline style is the most
              robust path).
            */}
            <div
              className="grid grid-cols-1 sm:items-center gap-2 sm:gap-1.5 chip-grid-row"
            >
              <label className="block sm:contents">
                <span className="block text-[10px] uppercase tracking-wide text-[#A3A3A3] mb-1 sm:hidden">
                  Label
                </span>
                <input
                  type="text"
                  value={chip.label}
                  onChange={(e) => updateChip(chipIdx, { label: e.target.value })}
                  placeholder="Display label (e.g. Myself)"
                  aria-label={`Chip ${chipIdx + 1} label`}
                  className="w-full px-2 py-1.5 text-sm rounded border border-[#E5E5E5] bg-white text-[#171717] placeholder:text-[#A3A3A3] focus:outline-none focus:ring-2 focus:ring-[#171717] focus:border-[#171717]"
                />
              </label>
              <label className="block sm:contents">
                <span className="block text-[10px] uppercase tracking-wide text-[#A3A3A3] mb-1 sm:hidden">
                  Slug
                </span>
                <input
                  type="text"
                  value={chip.slug}
                  onChange={(e) => updateChip(chipIdx, { slug: e.target.value })}
                  placeholder="slug"
                  pattern="[a-z0-9_-]+"
                  aria-label={`Chip ${chipIdx + 1} slug`}
                  className="w-full px-2 py-1.5 text-xs rounded border border-[#E5E5E5] bg-white font-mono text-[#171717] placeholder:text-[#A3A3A3] focus:outline-none focus:ring-2 focus:ring-[#171717] focus:border-[#171717]"
                />
              </label>
              <label className="block sm:contents">
                <span className="block text-[10px] uppercase tracking-wide text-[#A3A3A3] mb-1 sm:hidden">
                  Weight
                </span>
                <input
                  type="number"
                  value={chip.score_weight}
                  onChange={(e) =>
                    updateChip(chipIdx, { score_weight: Number(e.target.value) })
                  }
                  step={1}
                  min={-50}
                  max={50}
                  aria-label={`Chip ${chipIdx + 1} score weight`}
                  className="w-full px-2 py-1.5 text-xs rounded border border-[#E5E5E5] bg-white text-right text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#171717] focus:border-[#171717]"
                />
              </label>
              {/* Remove button — right-aligned full-width row on
                  mobile, single column on desktop. */}
              <div className="flex justify-end sm:block">
                <button
                  type="button"
                  onClick={() => removeChip(chipIdx)}
                  aria-label={`Remove chip ${chipIdx + 1}`}
                  title="Remove chip"
                  className="text-base leading-none text-[#991B1B] hover:bg-[#FEF2F2] rounded px-2 py-1 transition"
                >
                  ×
                </button>
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={addChip}
          aria-label="Add chip"
          title="Add chip"
          className="inline-flex items-center gap-1.5 text-xs text-[#171717] hover:bg-[#F5F5F5] rounded px-2 py-1 transition"
        >
          <PlusIcon />
          <span>Add chip</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ThresholdEditor
// ---------------------------------------------------------------------------

interface ThresholdEditorProps {
  thresholdsSelf: ThresholdsSelf;
  thresholdsFamily: ThresholdsFamilyFriend;
  onChangeSelf: (next: ThresholdsSelf) => void;
  onChangeFamily: (next: ThresholdsFamilyFriend) => void;
}

function ThresholdEditor({
  thresholdsSelf,
  thresholdsFamily,
  onChangeSelf,
  onChangeFamily,
}: ThresholdEditorProps) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-[#171717] mb-2">
        Classification thresholds
      </h4>
      <p className="text-xs text-[#737373] mb-3">
        Score ranges (inclusive) that map a numeric lead_score to a
        classification. Both tables MUST cover [0, 100] without gaps or
        overlaps.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ThresholdTable
          title="Self"
          buckets={[
            { name: 'hot', range: thresholdsSelf.hot, label: 'HOT' },
            { name: 'warm', range: thresholdsSelf.warm, label: 'WARM' },
            { name: 'cold', range: thresholdsSelf.cold, label: 'COLD' },
            { name: 'spam', range: thresholdsSelf.spam, label: 'SPAM' },
          ]}
          onChange={(name, range) =>
            onChangeSelf({ ...thresholdsSelf, [name]: range })
          }
        />
        <ThresholdTable
          title="Family / Friend"
          buckets={[
            { name: 'hot', range: thresholdsFamily.hot, label: 'HOT' },
            { name: 'warm', range: thresholdsFamily.warm, label: 'WARM' },
            { name: 'spam', range: thresholdsFamily.spam, label: 'SPAM' },
          ]}
          onChange={(name, range) =>
            onChangeFamily({ ...thresholdsFamily, [name]: range })
          }
        />
      </div>
    </div>
  );
}

interface ThresholdTableProps {
  title: string;
  buckets: Array<{ name: string; range: [number, number]; label: string }>;
  onChange: (name: string, range: [number, number]) => void;
}

function ThresholdTable({ title, buckets, onChange }: ThresholdTableProps) {
  return (
    <div>
      <div className="text-xs font-medium text-[#737373] mb-1.5">{title}</div>
      <div className="space-y-1.5">
        {buckets.map((b) => (
          <div
            key={b.name}
            className="flex items-center gap-2 text-xs flex-wrap"
          >
            <span className="w-14 text-[#171717] flex-shrink-0">{b.label}</span>
            <input
              type="number"
              value={b.range[0]}
              min={0}
              max={100}
              step={1}
              onChange={(e) =>
                onChange(b.name, [Number(e.target.value), b.range[1]])
              }
              aria-label={`${b.label} lower bound`}
              className="w-16 min-w-0 px-1.5 py-1 rounded border border-[#E5E5E5] bg-white text-right"
            />
            <span className="text-[#737373]">–</span>
            <input
              type="number"
              value={b.range[1]}
              min={0}
              max={100}
              step={1}
              onChange={(e) =>
                onChange(b.name, [b.range[0], Number(e.target.value)])
              }
              aria-label={`${b.label} upper bound`}
              className="w-16 min-w-0 px-1.5 py-1 rounded border border-[#E5E5E5] bg-white text-right"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs to avoid adding an icon-library dependency).
// 14×14, currentColor stroke, aria-hidden because the parent button
// carries the accessible label.
// ---------------------------------------------------------------------------

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4h10M6.5 4V2.5h3V4M5 4l.5 9h5l.5-9M7 7v4M9 7v4" />
    </svg>
  );
}
