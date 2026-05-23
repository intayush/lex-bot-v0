'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CaseType } from '@legal-chatbot/shared';
import { useIsMounted } from './use-is-mounted';

/**
 * Case Types tab (010-sop-workflow Phase 8 — T066).
 *
 * Drag-reorder case-types. Inline expand-to-edit for each case-type's
 * sub-types (sub-types use up/down buttons rather than nested DnD —
 * nested sortable contexts are tricky and a flat DnD list is plenty
 * for the typical 3-15 sub-types per case-type).
 *
 * The "Save" button POSTs the full list to /api/dashboard/sop/case-types
 * (action='save'); the route diffs against existing rows.
 */

interface CaseTypeDraft {
  /** Existing rows keep their stable id; new rows have id=null. */
  id: string | null;
  slug: string;
  label: string;
  position: number;
  is_in_scope: boolean;
  sub_types: SubTypeDraft[];
}

interface SubTypeDraft {
  id: string | null;
  slug: string;
  label: string;
  position: number;
}

const SLUG_REGEX = /^[a-z][a-z0-9_]*$/;

interface ResultMessage {
  ok: boolean;
  message: string;
}

interface CaseTypesTabProps {
  initialCaseTypes: CaseType[];
}

export function CaseTypesTab({ initialCaseTypes }: CaseTypesTabProps) {
  const initial: CaseTypeDraft[] = useMemo(
    () =>
      initialCaseTypes.map((ct) => ({
        id: ct.id,
        slug: ct.slug,
        label: ct.label,
        position: ct.position,
        is_in_scope: ct.is_in_scope,
        sub_types: ct.sub_types.map((st) => ({
          id: st.id,
          slug: st.slug,
          label: st.label,
          position: st.position,
        })),
      })),
    [initialCaseTypes],
  );

  const [items, setItems] = useState<CaseTypeDraft[]>(initial);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const isMounted = useIsMounted();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setItems((current) => {
      const oldIndex = current.findIndex((c) => c.slug === active.id);
      const newIndex = current.findIndex((c) => c.slug === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      const reordered = arrayMove(current, oldIndex, newIndex);
      return reordered.map((c, i) => ({ ...c, position: i + 1 }));
    });
  }, []);

  const updateCaseType = useCallback(
    (slug: string, patch: Partial<CaseTypeDraft>) => {
      setItems((current) => current.map((c) => (c.slug === slug ? { ...c, ...patch } : c)));
    },
    [],
  );

  const updateSubTypes = useCallback(
    (caseSlug: string, subTypes: SubTypeDraft[]) => {
      setItems((current) =>
        current.map((c) => (c.slug === caseSlug ? { ...c, sub_types: subTypes } : c)),
      );
    },
    [],
  );

  function handleAddCaseType() {
    setError(null);
    const slug = newSlug.trim().toLowerCase();
    const label = newLabel.trim();
    if (!SLUG_REGEX.test(slug)) {
      setError('Slug must be lowercase snake_case starting with a letter.');
      return;
    }
    if (items.some((c) => c.slug === slug)) {
      setError(`A case type with slug "${slug}" already exists.`);
      return;
    }
    if (label.length === 0) {
      setError('Label cannot be empty.');
      return;
    }
    setItems((current) => [
      ...current,
      { id: null, slug, label, position: current.length + 1, is_in_scope: true, sub_types: [] },
    ]);
    setNewSlug('');
    setNewLabel('');
    setShowAddForm(false);
  }

  function handleDeleteCaseType(slug: string) {
    setItems((current) =>
      current.filter((c) => c.slug !== slug).map((c, i) => ({ ...c, position: i + 1 })),
    );
    if (expandedSlug === slug) setExpandedSlug(null);
  }

  async function handleSave() {
    setSaving(true);
    setResult(null);

    // Quick client-side validation: every sub-type slug must be valid.
    for (const ct of items) {
      if (!SLUG_REGEX.test(ct.slug)) {
        setResult({ ok: false, message: `Case type "${ct.slug}" has an invalid slug.` });
        setSaving(false);
        return;
      }
      for (const st of ct.sub_types) {
        if (!SLUG_REGEX.test(st.slug)) {
          setResult({
            ok: false,
            message: `Sub-type "${st.slug}" under "${ct.slug}" has an invalid slug.`,
          });
          setSaving(false);
          return;
        }
      }
    }

    try {
      const res = await fetch('/api/dashboard/sop/case-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          case_types: items.map((c) => ({
            slug: c.slug,
            label: c.label,
            position: c.position,
            is_in_scope: c.is_in_scope,
            sub_types: c.sub_types.map((s) => ({
              slug: s.slug,
              label: s.label,
              position: s.position,
            })),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResult({ ok: false, message: data.message ?? data.error ?? 'Save failed' });
      } else {
        setResult({ ok: true, message: 'Saved.' });
        setTimeout(() => window.location.reload(), 800);
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
          Case types ({items.length})
        </label>
        <p className="text-xs text-[#737373]">
          The chatbot uses these as chips on the case-type SOP step. Mark a type
          as "out of scope" to deflect those visitors with the configured
          out-of-scope response. Drag to reorder.
        </p>
      </div>

      {/* DnD subtree client-only — see sop-editor.tsx for the rationale. */}
      {isMounted ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((c) => c.slug)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map((ct, index) => (
                <SortableCaseTypeRow
                  key={ct.slug}
                  caseType={ct}
                  index={index}
                  isExpanded={expandedSlug === ct.slug}
                  onToggleExpand={() => setExpandedSlug(expandedSlug === ct.slug ? null : ct.slug)}
                  onPatch={(patch) => updateCaseType(ct.slug, patch)}
                  onSubTypesChange={(sts) => updateSubTypes(ct.slug, sts)}
                  onDelete={() => handleDeleteCaseType(ct.slug)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <CaseTypesPlaceholder items={items} />
      )}

      {/* Add new */}
      {showAddForm ? (
        <div className="mt-3 bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] p-4">
          <p className="text-sm font-medium text-[#171717] mb-3">New case type</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Slug</label>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm font-mono bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
                placeholder="immigration"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#171717] mb-1">Label</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="w-full border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
                placeholder="Immigration"
              />
            </div>
          </div>
          {error && (
            <p className="text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-md px-3 py-2 mb-3">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleAddCaseType}
              className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-4 py-2 text-xs font-medium transition"
            >
              Add case type
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setError(null);
              }}
              className="text-[#737373] hover:text-[#171717] rounded-lg px-4 py-2 text-xs font-medium transition"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] mt-3 transition"
        >
          + Add case type
        </button>
      )}

      {/* Save */}
      <div className="mt-8 pt-6 border-t border-[#F5F5F5] flex gap-3 items-center flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save case types'}
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

// ---------------------------------------------------------------------------
// Sortable case-type row
// ---------------------------------------------------------------------------

function SortableCaseTypeRow({
  caseType,
  index,
  isExpanded,
  onToggleExpand,
  onPatch,
  onSubTypesChange,
  onDelete,
}: {
  caseType: CaseTypeDraft;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<CaseTypeDraft>) => void;
  onSubTypesChange: (sts: SubTypeDraft[]) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: caseType.slug,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] border-l-2 border-l-[#2563EB]"
    >
      {/* Row header */}
      <div className="p-3 flex gap-3 items-center">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-[#A3A3A3] hover:text-[#737373] flex-shrink-0 px-1"
          aria-label={`Drag to reorder ${caseType.slug}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
        <span className="text-xs text-[#A3A3A3] font-medium w-5 flex-shrink-0">{index + 1}.</span>
        <input
          value={caseType.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          className="flex-1 min-w-0 border border-[#E5E5E5] rounded-md px-2.5 py-1.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
        />
        <code className="text-xs font-mono text-[#A3A3A3] hidden md:inline">{caseType.slug}</code>
        <label
          className="cursor-pointer text-xs whitespace-nowrap"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <input
            type="checkbox"
            checked={caseType.is_in_scope}
            onChange={(e) => onPatch({ is_in_scope: e.target.checked })}
            style={{ width: '14px', height: '14px', accentColor: '#2563EB', margin: 0 }}
          />
          <span>In scope</span>
        </label>
        <button
          onClick={onToggleExpand}
          className="text-[#2563EB] text-xs font-medium hover:text-[#1D4ED8] transition flex-shrink-0"
        >
          {isExpanded ? 'Collapse' : `${caseType.sub_types.length} sub-types`}
        </button>
        <button
          onClick={onDelete}
          className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition flex-shrink-0"
          title="Delete this case type (cascade-deletes its sub-types)"
        >
          Remove
        </button>
      </div>

      {/* Sub-types editor */}
      {isExpanded && (
        <div className="border-t border-[#F5F5F5] p-3 bg-white rounded-b-lg">
          <SubTypesEditor
            caseTypeSlug={caseType.slug}
            subTypes={caseType.sub_types}
            onChange={onSubTypesChange}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-types editor (up/down buttons, no nested DnD)
// ---------------------------------------------------------------------------

function SubTypesEditor({
  caseTypeSlug,
  subTypes,
  onChange,
}: {
  caseTypeSlug: string;
  subTypes: SubTypeDraft[];
  onChange: (sts: SubTypeDraft[]) => void;
}) {
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= subTypes.length) return;
    const next = [...subTypes];
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    onChange(next.map((s, i) => ({ ...s, position: i + 1 })));
  }

  function update(index: number, patch: Partial<SubTypeDraft>) {
    onChange(subTypes.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function remove(index: number) {
    onChange(subTypes.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i + 1 })));
  }

  function add() {
    setError(null);
    const slug = newSlug.trim().toLowerCase();
    const label = newLabel.trim();
    if (!SLUG_REGEX.test(slug)) {
      setError('Slug must be lowercase snake_case starting with a letter.');
      return;
    }
    if (subTypes.some((s) => s.slug === slug)) {
      setError(`A sub-type with slug "${slug}" already exists under ${caseTypeSlug}.`);
      return;
    }
    if (label.length === 0) {
      setError('Label cannot be empty.');
      return;
    }
    onChange([
      ...subTypes,
      { id: null, slug, label, position: subTypes.length + 1 },
    ]);
    setNewSlug('');
    setNewLabel('');
  }

  return (
    <div>
      <p className="text-xs text-[#A3A3A3] mb-2">
        Sub-types under <code className="font-mono text-[#737373]">{caseTypeSlug}</code> ({subTypes.length})
      </p>
      <div className="space-y-1.5">
        {subTypes.map((st, i) => (
          <div key={st.slug} className="flex gap-2 items-center text-sm">
            <span className="text-xs text-[#A3A3A3] font-medium w-5 flex-shrink-0">{i + 1}.</span>
            <input
              value={st.label}
              onChange={(e) => update(i, { label: e.target.value })}
              className="flex-1 min-w-0 border border-[#E5E5E5] rounded-md px-2.5 py-1.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
            />
            <code className="text-xs font-mono text-[#A3A3A3] hidden sm:inline">{st.slug}</code>
            <button
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="text-[#A3A3A3] hover:text-[#737373] disabled:opacity-30 px-1 transition"
              aria-label="Move up"
            >
              ▲
            </button>
            <button
              onClick={() => move(i, 1)}
              disabled={i === subTypes.length - 1}
              className="text-[#A3A3A3] hover:text-[#737373] disabled:opacity-30 px-1 transition"
              aria-label="Move down"
            >
              ▼
            </button>
            <button
              onClick={() => remove(i)}
              className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Add sub-type */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
          className="border border-[#E5E5E5] rounded-md px-2.5 py-1.5 text-sm font-mono bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          placeholder="new_sub_slug"
        />
        <div className="flex gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 min-w-0 border border-[#E5E5E5] rounded-md px-2.5 py-1.5 text-sm bg-white focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
            placeholder="New sub-type label"
          />
          <button
            onClick={add}
            className="bg-[#171717] hover:bg-[#262626] text-white rounded-md px-3 py-1.5 text-xs font-medium transition flex-shrink-0"
          >
            Add
          </button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-[#DC2626] bg-[#FEE2E2] border border-[#FECACA] rounded-md px-3 py-2 mt-2">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSR placeholder — see sop-editor.tsx for the hydration rationale.
// ---------------------------------------------------------------------------

function CaseTypesPlaceholder({ items }: { items: CaseTypeDraft[] }) {
  return (
    <div className="space-y-2">
      {items.map((ct, index) => (
        <div
          key={ct.slug}
          className="bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] border-l-2 border-l-[#2563EB] p-3 flex gap-3 items-center"
        >
          <span className="text-xs text-[#A3A3A3] font-medium w-5 flex-shrink-0">
            {index + 1}.
          </span>
          <span className="flex-1 min-w-0 text-sm text-[#171717]">{ct.label}</span>
          <code className="text-xs font-mono text-[#A3A3A3]">{ct.slug}</code>
        </div>
      ))}
    </div>
  );
}
