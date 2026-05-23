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
import type {
  SOPConfiguration,
  SOPStep,
  CaseType,
} from '@legal-chatbot/shared';
import { StepForm, type StepDraft } from './step-form';
import { CaseTypesTab } from './case-types-tab';
import { GoodbyePhrasesTab } from './goodbye-phrases-tab';
import { useIsMounted } from './use-is-mounted';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = 'steps' | 'case_types' | 'goodbye_phrases';

interface SopEditorProps {
  initialSop: SOPConfiguration | null;
  initialCaseTypes: CaseType[];
  initialGoodbyePhrases: string[];
}

interface ResultMessage {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// SOP Editor (tab manager + Steps tab)
// ---------------------------------------------------------------------------

export function SopEditor({
  initialSop,
  initialCaseTypes,
  initialGoodbyePhrases,
}: SopEditorProps) {
  const [activeTab, setActiveTab] = useState<TabId>('steps');

  return (
    <div>
      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6">
        <TabButton active={activeTab === 'steps'} onClick={() => setActiveTab('steps')}>
          SOP Steps
        </TabButton>
        <TabButton active={activeTab === 'case_types'} onClick={() => setActiveTab('case_types')}>
          Case Types
        </TabButton>
        <TabButton active={activeTab === 'goodbye_phrases'} onClick={() => setActiveTab('goodbye_phrases')}>
          Goodbye Phrases
        </TabButton>
      </div>

      {activeTab === 'steps' && <StepsTab initialSop={initialSop} />}
      {activeTab === 'case_types' && <CaseTypesTab initialCaseTypes={initialCaseTypes} />}
      {activeTab === 'goodbye_phrases' && <GoodbyePhrasesTab initialPhrases={initialGoodbyePhrases} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 text-sm font-medium rounded-lg transition ${
        active ? 'bg-[#171717] text-white' : 'text-[#737373] hover:text-[#171717]'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Steps Tab (drag-drop reordering + threshold + Save/Publish)
// ---------------------------------------------------------------------------

function sopStepToDraft(step: SOPStep): StepDraft {
  return {
    slug: step.slug,
    position: step.position,
    question_text: step.question_text,
    chip_source: step.chip_source,
    inline_chips_json: step.inline_chips_json,
    accepts_free_text: step.accepts_free_text,
    is_required: step.is_required,
    counts_toward_threshold: step.counts_toward_threshold,
  };
}

const EMPTY_STEPS: StepDraft[] = [
  {
    slug: 'case_type',
    position: 1,
    question_text: 'What kind of legal matter can we help you with?',
    chip_source: 'case_types',
    inline_chips_json: null,
    accepts_free_text: true,
    is_required: true,
    counts_toward_threshold: true,
  },
];

function StepsTab({ initialSop }: { initialSop: SOPConfiguration | null }) {
  const initialSteps: StepDraft[] = useMemo(
    () =>
      initialSop && initialSop.steps.length > 0
        ? initialSop.steps.map(sopStepToDraft)
        : EMPTY_STEPS,
    [initialSop],
  );
  const [steps, setSteps] = useState<StepDraft[]>(initialSteps);
  const [threshold, setThreshold] = useState<number>(initialSop?.qualified_lead_threshold ?? 1);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const isMounted = useIsMounted();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const eligibleCount = steps.filter((s) => s.counts_toward_threshold).length;

  // Reorder via drag.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSteps((current) => {
      const oldIndex = current.findIndex((s) => s.slug === active.id);
      const newIndex = current.findIndex((s) => s.slug === over.id);
      if (oldIndex < 0 || newIndex < 0) return current;
      const reordered = arrayMove(current, oldIndex, newIndex);
      // Re-number positions to 1..N.
      return reordered.map((s, i) => ({ ...s, position: i + 1 }));
    });
  }, []);

  const handleAddStep = useCallback((draft: StepDraft) => {
    setSteps((current) => {
      const newPosition = current.length + 1;
      return [...current, { ...draft, position: newPosition }];
    });
    setShowAddForm(false);
  }, []);

  const handleEditStep = useCallback((index: number, draft: StepDraft) => {
    setSteps((current) => {
      const next = [...current];
      // Preserve the position from current; the form lets the user edit
      // everything else, but reorder is done via DnD.
      next[index] = { ...draft, position: current[index]?.position ?? index + 1 };
      return next;
    });
    setEditingIndex(null);
  }, []);

  const handleDeleteStep = useCallback((index: number) => {
    setSteps((current) => {
      const next = current.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, position: i + 1 }));
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch('/api/dashboard/sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          qualified_lead_threshold: threshold,
          steps,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResult({ ok: false, message: data.message ?? data.error ?? 'Save failed' });
      } else {
        setResult({ ok: true, message: `Saved as draft v${data.version}.` });
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setResult(null);
    try {
      const res = await fetch('/api/dashboard/sop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setResult({ ok: false, message: data.message ?? data.error ?? 'Publish failed' });
      } else {
        setResult({ ok: true, message: `Published v${data.version}.` });
        // Reload to refresh the v-badge in the page header.
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : 'Network error' });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] p-8">
      {/* Threshold */}
      <div className="mb-6 pb-6 border-b border-[#F5F5F5]">
        <label className="block text-sm font-medium text-[#171717] mb-1.5">
          Qualified-lead threshold
        </label>
        <p className="text-xs text-[#737373] mb-2">
          A lead is captured when this many SOP steps with{' '}
          <code className="text-[#171717] font-mono">counts_toward_threshold</code>{' '}
          have been completed. Currently {eligibleCount} step
          {eligibleCount === 1 ? '' : 's'} are eligible.
        </p>
        <input
          type="number"
          min={1}
          max={Math.max(eligibleCount, 1)}
          value={threshold}
          onChange={(e) => setThreshold(Number.parseInt(e.target.value, 10) || 1)}
          className="w-32 border border-[#E5E5E5] rounded-lg px-3.5 py-2.5 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
        />
      </div>

      {/* Steps list. The DnD-using subtree renders client-only because
          @dnd-kit/core generates unique element ids that differ between SSR
          and the first client render, otherwise producing a hydration warning.
          The SSR fallback below renders the same steps in the same order
          without drag handles, so the page is functional without JS. */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-[#171717] mb-3">
          Steps in order ({steps.length})
        </label>
        {isMounted ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={steps.map((s) => s.slug)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {steps.map((step, index) => (
                  <SortableStepRow
                    key={step.slug}
                    step={step}
                    index={index}
                    isEditing={editingIndex === index}
                    onEdit={() => setEditingIndex(index)}
                    onCancelEdit={() => setEditingIndex(null)}
                    onSave={(draft) => handleEditStep(index, draft)}
                    onDelete={() => handleDeleteStep(index)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <StepListPlaceholder steps={steps} />
        )}
      </div>

      {/* Add step */}
      {showAddForm ? (
        <div className="mt-3 bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] p-4">
          <p className="text-sm font-medium text-[#171717] mb-3">New step</p>
          <StepForm
            onSubmit={handleAddStep}
            onCancel={() => setShowAddForm(false)}
            existingSlugs={new Set(steps.map((s) => s.slug))}
          />
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="text-[#2563EB] text-sm font-medium hover:text-[#1D4ED8] mt-3 transition"
        >
          + Add step
        </button>
      )}

      {/* Actions */}
      <div className="mt-8 pt-6 border-t border-[#F5F5F5] flex gap-3 items-center flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving || publishing}
          className="bg-[#171717] hover:bg-[#262626] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Draft'}
        </button>
        <button
          onClick={handlePublish}
          disabled={saving || publishing}
          className="bg-[#059669] hover:bg-[#047857] text-white rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-50"
          title="Publishes the LATEST saved version. Save first if you have unsaved changes."
        >
          {publishing ? 'Publishing...' : 'Publish latest version'}
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
      <p className="text-xs text-[#A3A3A3] mt-3">
        Save creates a new draft version. Publish makes the latest saved version
        live; the chatbot picks it up on the next conversation.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable step row (drag-handle + summary + edit/delete)
// ---------------------------------------------------------------------------

function SortableStepRow({
  step,
  index,
  isEditing,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  step: StepDraft;
  index: number;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (draft: StepDraft) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.slug,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={style} className="bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] border-l-2 border-l-[#2563EB] p-4">
        <p className="text-sm font-medium text-[#171717] mb-3">Editing step #{index + 1}</p>
        <StepForm
          initial={step}
          onSubmit={onSave}
          onCancel={onCancelEdit}
          existingSlugs={new Set()}
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] border-l-2 border-l-[#2563EB] p-3 flex gap-3 items-center"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-[#A3A3A3] hover:text-[#737373] flex-shrink-0 px-1"
        aria-label={`Drag to reorder ${step.slug}`}
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

      <span className="text-xs text-[#A3A3A3] font-medium w-5 flex-shrink-0">
        {index + 1}.
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-sm font-mono text-[#171717]">{step.slug}</code>
          {step.is_required && (
            <span className="text-[10px] uppercase tracking-wider text-[#DC2626] bg-[#FEE2E2] px-1.5 py-0.5 rounded">
              required
            </span>
          )}
          {step.counts_toward_threshold && (
            <span className="text-[10px] uppercase tracking-wider text-[#059669] bg-[#ECFDF5] px-1.5 py-0.5 rounded">
              counts
            </span>
          )}
          {step.chip_source && (
            <span className="text-[10px] uppercase tracking-wider text-[#737373] bg-[#F5F5F5] px-1.5 py-0.5 rounded">
              {step.chip_source}
            </span>
          )}
        </div>
        <p className="text-sm text-[#737373] mt-1 truncate" title={step.question_text}>
          {step.question_text}
        </p>
      </div>

      <button
        onClick={onEdit}
        className="text-[#2563EB] text-xs font-medium hover:text-[#1D4ED8] transition flex-shrink-0"
      >
        Edit
      </button>
      <button
        onClick={onDelete}
        className="text-[#A3A3A3] hover:text-[#DC2626] text-xs transition flex-shrink-0"
      >
        Remove
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SSR placeholder — renders the same step list without drag handles.
// Avoids a hydration mismatch from @dnd-kit's client-only id generation.
// ---------------------------------------------------------------------------

function StepListPlaceholder({ steps }: { steps: StepDraft[] }) {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <div
          key={step.slug}
          className="bg-[#FAFAFA] rounded-lg border border-[#F5F5F5] border-l-2 border-l-[#2563EB] p-3 flex gap-3 items-center"
        >
          <span className="text-xs text-[#A3A3A3] font-medium w-5 flex-shrink-0">
            {index + 1}.
          </span>
          <div className="flex-1 min-w-0">
            <code className="text-sm font-mono text-[#171717]">{step.slug}</code>
            <p className="text-sm text-[#737373] mt-1 truncate">
              {step.question_text}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
